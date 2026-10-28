// generate: moved out of server/index.mjs without a change in behaviour (docs/QUALITY-REVIEW.md, step 2 of the split plan).
// `handleGenerateRoutes` answers true when it handled the request, otherwise the caller carries on with its own routes.
// What lives inside the studio process (the current project's folders, the wallet, the stage charges) arrives in `ctx`.
import { ENGINES, clampStrength, engineCtx, getEngine, pickAvailableEngine, withRetry } from "../../src/engines.mjs";
import { addVersion, listVersions } from "../../src/versions.mjs";
import { attachStopOnDisconnect, httpError, readBody, send, writeSse } from "../http.mjs";
import { capError, spendCap, spentToday } from "../../src/spend.mjs";
import { creditCost, getBalance } from "../../src/platform/billing.mjs";
import { dispatchBatchNotification, duplicateGroups, duplicates, lintPrompts, mapConcurrent, resolveBaseImageForRecipe } from "../../src/index.mjs";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { failureBreaker } from "../../src/pool.mjs";
import { join } from "node:path";
import { licenseWarning } from "../../src/license.mjs";
import { modelTitle, promptHash, sha256Hex } from "../../src/creation.mjs";
import { send as sendResponse } from "../http.mjs";
import { dna } from "../../src/recipes.mjs";

export async function handleGenerateRoutes(ctx) {
  const { req, res, url, pathname, IMAGE_EST_BYTES, P, PUBLIC_MODE, assertEngineAllowed, assertSpend, assertWalletDisk, blockLicenseCharge, blockedPrompts, chargeCredits, currentWallet, insufficient, licenseForBody, listArchives, listBases, loadArchiveFile, logRender, mimeOf, noteDiskWrite, paidCall, refundCharge, renderLog, resolveGenerateSelection, safeSetName, setDirName, toTrash, trackFunnel, waitForRateSlot } = ctx;
  const send = (...a) => {
    sendResponse(...a);
    return true;
  };

  if (pathname === "/api/estimate" && req.method === "POST") {
    const body = await readBody(req);
    let file = body.file;
    if (!file) {
      const list = listArchives();
      if (!list.length) return send(res, 404, { error: "no archives — build recipes first" });
      file = list[0].file;
    }
    const { archive, file: archiveFile } = loadArchiveFile(file);
    const strength = clampStrength(body.strength);
    const engineWanted = body.engine || "kontext";
    const set = setDirName(engineWanted, strength);
    const sel = resolveGenerateSelection(archive, body, set);
    const unit = ENGINES[engineWanted]?.costUsd ?? ENGINES.kontext?.costUsd ?? 0.04;
    const cost = Math.round(sel.editions.length * unit * 1000) / 1000;
    const cap = spendCap(process.env.SERIES_SPEND_CAP_USD);
    const spent = spentToday(renderLog());
    const capMsg = capError({ cap, spent, planned: cost });
    const creditsNeeded = PUBLIC_MODE ? sel.editions.length * creditCost(engineWanted, { reference: true, costUsd: unit }) : null;
    const creditsBalance = PUBLIC_MODE ? getBalance(currentWallet()) : null;
    const lines = [
      `Archive: ${archiveFile} (${archive.size} recipes)`,
      `Engine: ${engineWanted} · strength ${strength}`,
      `Set folder: out/${set}/`,
      `Mode: ${sel.mode}` + (sel.force ? " · FORCE re-render (old images kept as versions)" : ""),
      `To generate: ${sel.editions.length}` + (sel.editions.length ? ` → #${sel.editions.slice(0, 24).join(", #")}${sel.editions.length > 24 ? "…" : ""}` : ""),
      sel.skippedExisting.length ? `Skip existing: ${sel.skippedExisting.length}` : "Skip existing: 0",
      PUBLIC_MODE
        ? `Cost: ${creditsNeeded} credits (${creditCost(engineWanted, { reference: true, costUsd: unit })}/image) · your balance: ${creditsBalance}`
        : `Est. cost: ~$${cost} ($${unit}/image)`,
      ...(PUBLIC_MODE ? [] : [`Spent today: ~$${spent}` + (cap != null ? ` of $${cap} daily cap` : " (no daily cap — set SERIES_SPEND_CAP_USD)")]),
      ...(capMsg ? ["", PUBLIC_MODE ? "⛔ The service is at its daily capacity — please try again tomorrow." : `⛔ ${capMsg}`] : []),
      "",
      "Estimate is free. Generate will call the image API.",
    ];
    const licenseNotice = licenseForBody(engineWanted, body);
    if (licenseNotice) {
      lines.push("", `Licence: ${licenseNotice.en}`);
    }
    const lint = lintPrompts((sel.recipes || []).map((r) => r.prompt || ""));
    if (!lint.ok) {
      lines.push("", `⚠ Lint warn (will block Generate): ${lint.hits.join(", ")}`);
    }
    return send(res, 200, {
      ok: true,
      file: archiveFile,
      engine: engineWanted,
      strength,
      set,
      mode: sel.mode,
      force: sel.force,
      editions: sel.editions,
      skippedExisting: sel.skippedExisting,
      count: sel.editions.length,
      unitCostUsd: unit,
      costUsd: cost,
      spentTodayUsd: spent,
      creditsNeeded,
      creditsBalance,
      capUsd: cap,
      capError: capMsg,
      text: lines.join("\n"),
      lint: { ok: lint.ok, hits: lint.hits },
      licenseWarning: licenseNotice,
    });
  }

  if (pathname === "/api/generate" && req.method === "POST") {
    const body = await readBody(req);
    const primary = listBases().find((f) => f.primary);
    if (!primary) throw new Error("Upload or generate a primary base image first (tab Base)");

    // Legacy single-prompt mode (explicit prompt, no selection mode)
    if (body.prompt && !body.mode && !body.selection && body.only == null && body.pilot == null && body.first == null) {
      const prompt = String(body.prompt || "").trim();
      if (!prompt) throw new Error("prompt required");
      {
        const blocked = blockedPrompts([prompt]);
        if (blocked) return send(res, 400, blocked);
      }
      const requestedEngine = body.engine || "kontext";
      const engineName = pickAvailableEngine(requestedEngine, process.env, ENGINES, { exact: true });
      if (!engineName) {
        throw httpError(400, `Engine unavailable for edit: ${requestedEngine}`, {
          code: "engine_unavailable",
          requestedEngine,
        });
      }
      const eng = getEngine(engineName);
      const licenseNotice = licenseForBody(engineName, body);
      if (blockLicenseCharge(res, licenseNotice, body)) return;
      const image = readFileSync(join(P().input, primary.file));
      const mime = mimeOf(primary.file);
      const str = clampStrength(body.strength);
      const ctx = engineCtx(process.env);
      const seed = body.seed != null ? Number(body.seed) : undefined;
      const tag = String(body.edition ?? body.index ?? Date.now()).replace(/[^a-zA-Z0-9_-]/g, "") || String(Date.now());
      assertWalletDisk(IMAGE_EST_BYTES);
      assertSpend(eng.costUsd ?? null);
      const buf = await paidCall(
        { source: "studio", kind: "pilot", engine: engineName, edition: tag, costUsd: eng.costUsd ?? null, seed, reference: true },
        () => withRetry(() => eng.generate({ prompt, image, mime, seed, strength: str }, ctx)),
      );
      const dir = join(P().out, "pilots");
      mkdirSync(dir, { recursive: true });
      const name = `pilot-${tag}.png`;
      if (existsSync(join(dir, name))) toTrash([join(dir, name)], `pilot ${name} regenerated`);
      writeFileSync(join(dir, name), buf);
      noteDiskWrite(buf.length);
      return send(res, 200, {
        ok: true,
        stub: false,
        engine: engineName,
        requestedEngine,
        costUsd: eng.costUsd,
        path: `out/pilots/${name}`,
        file: name,
      });
    }

    // Batch mode from archive recipes
    let file = body.file;
    if (!file) {
      const list = listArchives();
      if (!list.length) throw new Error("no archives — build recipes first");
      file = list[0].file;
    }
    const { archive, file: archiveFile } = loadArchiveFile(file);
    const dnaDupes = duplicateGroups(archive.recipes);
    if (dnaDupes.length) {
      return send(res, 400, {
        error: `Duplicate DNA before render: ${dnaDupes.map((g) => g.join("+")).join(", ")}`,
        code: "dna",
        duplicates: dnaDupes,
      });
    }
    const strength = clampStrength(body.strength);
    const engineWanted = body.engine || "kontext";
    const licenseNotice = licenseForBody(engineWanted, body);
    if (blockLicenseCharge(res, licenseNotice, body)) return;
    const engineName = pickAvailableEngine(engineWanted, process.env, ENGINES, { exact: true });
    if (!engineName) {
      throw httpError(400, `Engine unavailable for edit: ${engineWanted}`, {
        code: "engine_unavailable",
        requestedEngine: engineWanted,
      });
    }
    const set = setDirName(engineWanted, strength);
    const sel = resolveGenerateSelection(archive, body, set);
    if (!sel.editions.length) {
      // Do not open SSE. A finished JSON body is the whole reply; the panel
      // must not sit on a 0% "live stream" waiting for a done event.
      return send(res, 200, {
        ok: true,
        stream: false,
        file: archiveFile,
        engine: engineName,
        requestedEngine: engineWanted,
        strength,
        set,
        count: 0,
        results: [],
        message: "Nothing to generate (all exist or empty selection). Enable force or pick other editions.",
      });
    }
    {
      const blocked = blockedPrompts((sel.recipes || []).map((r) => r.prompt || ""));
      if (blocked) return send(res, 400, blocked);
    }
    const eng = getEngine(engineName);
    const unitCost = eng.costUsd ?? null;
    assertSpend(unitCost == null ? null : sel.recipes.length * unitCost);
    assertEngineAllowed(engineName);
    assertWalletDisk(IMAGE_EST_BYTES); // no room for even one more frame: stop before any call is paid
    if (PUBLIC_MODE) {
      // Check the whole batch up front so it never stops half-way for lack of credits.
      const need = sel.recipes.length * creditCost(engineName, { reference: true, costUsd: unitCost ?? 0 });
      if (need > getBalance(currentWallet())) throw insufficient(currentWallet(), need);
      trackFunnel("generate", { kind: "batch", count: sel.recipes.length, engine: engineName });
    }
    const allBases = listBases();
    const ctx = engineCtx(process.env);
    const stop = new AbortController();
    ctx.signal = stop.signal;
    const timedFetch = ctx.fetch;
    ctx.fetch = (url, init = {}) => {
      const signal = init.signal ? AbortSignal.any([init.signal, stop.signal]) : stop.signal;
      return timedFetch(url, { ...init, signal });
    };
    const outDir = join(P().out, set);
    const breaker = failureBreaker({ maxConsecutive: Number(process.env.SERIES_MAX_CONSECUTIVE_FAILURES) || 5 });
    mkdirSync(outDir, { recursive: true });

    const isStream = Boolean(body.stream) || String(req.headers["accept"] || "").includes("text/event-stream");
    const concurrency = Math.max(1, Math.min(4, Number(body.concurrency) || 2));
    const batchSignal = AbortSignal.any([breaker.signal, stop.signal]);
    attachStopOnDisconnect(res, stop);

    if (isStream) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        Connection: "keep-alive",
      });
      res.flushHeaders?.();
      res.socket?.setNoDelay?.(true);
      writeSse(res, {
        type: "start",
        total: sel.recipes.length,
        engine: engineName,
        requestedEngine: engineWanted,
        strength,
        set,
        licenseWarning: licenseNotice,
      });
    }

    let results;
    try {
      results = await mapConcurrent(
        sel.recipes,
        concurrency,
        async (recipe) => {
          let charge = null;
          try {
            if (stop.signal.aborted) {
              return { ok: false, skipped: true, edition: recipe.edition, index: recipe.index, code: "stopped" };
            }
            await waitForRateSlot();
            if (stop.signal.aborted) {
              return { ok: false, skipped: true, edition: recipe.edition, index: recipe.index, code: "stopped" };
            }
            assertWalletDisk(IMAGE_EST_BYTES); // checked before the charge: a full disk never costs credits
            charge = chargeCredits({ engine: engineName, costUsd: unitCost ?? 0, reference: true });
            const recipeBase = resolveBaseImageForRecipe(recipe, allBases) || primary;
            const image = readFileSync(join(P().input, recipeBase.file));
            const mime = mimeOf(recipeBase.file);
            const buf = await withRetry(() =>
              eng.generate({
                prompt: recipe.prompt,
                image,
                mime,
                seed: recipe.seed,
                strength,
              }, ctx),
            );
            if (stop.signal.aborted) {
              refundCharge(charge);
              return { ok: false, skipped: true, edition: recipe.edition, index: recipe.index, code: "stopped" };
            }
            const name = `${recipe.edition}.png`;
            const v = addVersion(outDir, recipe.edition, buf, {
              engine: engineName,
              model: modelTitle(engineName, "edit"),
              strength,
              seed: recipe.seed,
              promptHash: promptHash(recipe.prompt),
              baseSha256: sha256Hex(image),
              ...(licenseNotice ? { licenseWarning: licenseNotice } : {}),
            });
            noteDiskWrite(buf.length);
            logRender({ source: "studio", kind: "batch", engine: engineName, set, edition: recipe.edition, v, ok: true, costUsd: unitCost, seed: recipe.seed });
            breaker.record(true);
            return {
              ok: true,
              edition: recipe.edition,
              index: recipe.index,
              file: name,
              v,
              path: `out/${set}/${name}`,
              url: `/out/${set}/${name}?v=${v}`,
            };
          } catch (e) {
            refundCharge(charge);
            const stopped = stop.signal.aborted || e?.name === "AbortError";
            if (!stopped) {
              logRender({ source: "studio", kind: "batch", engine: engineName, set, edition: recipe.edition, ok: false, costUsd: 0, error: String(e.message || e).slice(0, 300) });
              breaker.record(false);
            }
            return {
              ok: false,
              skipped: stopped,
              edition: recipe.edition,
              index: recipe.index,
              ...(stopped ? { code: "stopped" } : { error: String(e.message || e) }),
            };
          }
        },
        (progress) => {
          if (isStream) {
            writeSse(res, {
              type: "progress",
              result: progress.result,
              completed: progress.completed,
              total: progress.total,
            });
          }
        },
        { signal: batchSignal },
      );
    } catch (e) {
      if (isStream) {
        writeSse(res, { type: "error", error: String(e.message || e) });
        if (!res.writableEnded) {
          try { res.end(); } catch { /* client already gone */ }
        }
        return;
      }
      throw e;
    }

    const okN = results.filter((r) => r.ok).length;
    const finalPayload = {
      ok: true,
      stub: false,
      file: archiveFile,
      engine: engineName,
      requestedEngine: engineWanted,
      strength,
      set,
      count: okN,
      costUsd: Math.round(okN * (eng.costUsd || 0) * 1000) / 1000,
      stopped: breaker.reason || (stop.signal.aborted ? "stopped" : null),
      skipped: results.filter((r) => r.skipped).length,
      results,
      thumbs: results.filter((r) => r.ok).map((r) => ({ edition: r.edition, url: r.url, path: r.path })),
    };

    // Operator batch summary names the series and its folder. On a public host that would send every
    // user's work to the operator's chat, so it stays a local-studio feature (payments still notify).
    if (!PUBLIC_MODE) {
      dispatchBatchNotification({
        presetId: archive.presetId,
        total: sel.recipes.length,
        success: okN,
        failed: results.length - okN,
        outputDir: `out/${set}`,
      }).catch(() => {});
    }

    if (isStream) {
      writeSse(res, { type: "done", ...finalPayload });
      if (!res.writableEnded) {
        try { res.end(); } catch { /* client already gone */ }
      }
      return;
    }

    return send(res, 200, finalPayload);
  }

  if (pathname === "/api/versions" && req.method === "GET") {
    const dir = safeSetName(url.searchParams.get("dir") || "");
    const edition = url.searchParams.get("edition");
    return send(res, 200, { dir, ...listVersions(join(P().out, dir), dir, edition) });
  }

  return false;
}
