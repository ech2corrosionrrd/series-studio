// review: moved out of server/index.mjs without a change in behaviour (docs/QUALITY-REVIEW.md, step 2 of the split plan).
// `handleReviewRoutes` answers true when it handled the request, otherwise the caller carries on with its own routes.
// What lives inside the studio process (the current project's folders, the wallet, the stage charges) arrives in `ctx`.
import { COMPRESS_TARGET_BYTES, compressSet } from "../../src/compress.mjs";
import { SIMILARITY_METHOD, countMissingTraitFrames, findDupes, similarityToBase, triageBatch } from "../../src/index.mjs";
import { analyzeSetQuality } from "../../src/quality.mjs";
import { editionAssetFiles, shelveCurrent } from "../../src/versions.mjs";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadSharp } from "../../src/upscale.mjs";
import { attachStopOnDisconnect, readBody, writeSse } from "../http.mjs";
import { writeJsonAtomic } from "../../src/fs-safe.mjs";
import { writeVisibilityAck } from "../../src/trait-visibility.mjs";
import { send as sendResponse } from "../http.mjs";

export async function handleReviewRoutes(ctx) {
  const { req, res, url, pathname, P, chargeCredits, clearEditionMark, discardSelectionFiles, listArchives, listImageSets, listSetImages, loadArchiveFile, loadPresetByFile, primaryBasePng, readMarks, refundCharge, safeSetName, setPayload, visionCreditCost, writeMarks } = ctx;
  const send = (...a) => {
    sendResponse(...a);
    return true;
  };

  if (pathname === "/api/similarity" && req.method === "GET") {
    const dirName = safeSetName(url.searchParams.get("dir") || "");
    const setDir = join(P().out, dirName);
    if (!existsSync(setDir)) return send(res, 400, { error: "set not found" });
    const base = await primaryBasePng();
    if (!base.exists) return send(res, 400, { error: "No base image found to analyze" });
    if (!base.buf) return send(res, 200, { ok: true, method: SIMILARITY_METHOD, offline: true, editions: [], baseUnusable: true });
    const baseBuf = base.buf;
    const editions = [];
    for (const name of readdirSync(setDir)) {
      const m = /^(\d+)\.png$/i.exec(name);
      if (!m) continue;
      try {
        const row = similarityToBase(readFileSync(join(setDir, name)), baseBuf);
        editions.push({ edition: Number(m[1]), ...row });
      } catch {
        editions.push({ edition: Number(m[1]), similarity: null, warn: false, skipped: true });
      }
    }
    editions.sort((a, b) => a.edition - b.edition);
    return send(res, 200, { ok: true, method: SIMILARITY_METHOD, offline: true, editions });
  }

  if (pathname === "/api/set/compress" && req.method === "POST") {
    const body = await readBody(req);
    const dirName = safeSetName(body.dir || "");
    const setDir = join(P().out, dirName);
    if (!dirName || !existsSync(setDir) || !statSync(setDir).isDirectory()) return send(res, 404, { error: "set not found" });
    const maxBytes = Math.max(100_000, Math.min(20 * 1024 * 1024, Number(body.maxBytes) || COMPRESS_TARGET_BYTES));
    const dryRun = Boolean(body.dryRun);
    if (!dryRun && !(await loadSharp())) return send(res, 400, { error: "sharp_not_installed", sharp: false });
    const report = await compressSet(setDir, { maxBytes, dryRun });
    return send(res, 200, { ok: true, dir: dirName, dryRun, ...report });
  }

  if (pathname === "/api/quality" && req.method === "GET") {
    const dirName = safeSetName(url.searchParams.get("dir") || "");
    const setDir = join(P().out, dirName);
    if (!dirName || !existsSync(setDir) || !statSync(setDir).isDirectory()) return send(res, 400, { error: "set not found" });
    const base = await primaryBasePng();
    // `Accept: text/event-stream`: `start`, `progress` for every frame, then `done` (the report) or `stopped`; closing the connection (Stop) ends the walk.
    const stream = String(req.headers.accept || "").includes("text/event-stream");
    const stop = new AbortController();
    if (stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", Connection: "keep-alive" });
      res.flushHeaders?.();
      attachStopOnDisconnect(res, stop);
    }
    let report;
    try {
      report = await analyzeSetQuality({
        setDir,
        baseBuf: base.buf,
        marks: readMarks(dirName),
        ...(stream ? { onFrame: (p) => writeSse(res, { type: "progress", ...p }), shouldStop: () => stop.signal.aborted } : {}),
      });
    } catch (e) {
      if (!stream) throw e;
      writeSse(res, { type: "error", error: String(e.message || e) });
      res.end();
      return true;
    }
    if (stream) {
      writeSse(res, report.stopped ? { type: "stopped", ...report } : { type: "done", ok: true, dir: dirName, ...report, hasBase: base.exists, baseUnusable: base.exists && (!base.buf || (report.total > 0 && !report.similarity)) });
      res.end();
      return true;
    }
    // A base that exists but cannot be decoded must not read as "all good": say that similarity was not checked.
    return send(res, 200, { ok: true, dir: dirName, ...report, hasBase: base.exists, baseUnusable: base.exists && (!base.buf || (report.total > 0 && !report.similarity)) });
  }

  if (pathname === "/api/gallery/dupes" && req.method === "POST") {
    const body = await readBody(req);
    const dirName = safeSetName(body.dir || "");
    const dir = join(P().out, dirName);
    if (!existsSync(dir)) return send(res, 404, { error: "set not found" });
    const found = findDupes(dir, { maxDistance: body.maxDistance ?? 8 });
    return send(res, 200, { dir: dirName, ...found });
  }

  if (pathname === "/api/sets" && req.method === "GET") {
    return send(res, 200, { sets: listImageSets() });
  }

  if (pathname === "/api/set" && req.method === "GET") {
    const dir = url.searchParams.get("dir");
    if (!dir) return send(res, 400, { error: "dir required" });
    return send(res, 200, setPayload(dir));
  }

  if (pathname === "/api/set/delete" && req.method === "POST") {
    const body = await readBody(req);
    const dir = safeSetName(body.dir || "");
    const setDir = join(P().out, dir);
    if (!existsSync(setDir) || !statSync(setDir).isDirectory()) return send(res, 404, { error: "set not found" });
    let files;
    try {
      files = editionAssetFiles(setDir, body.edition);
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
    if (!files.length) return send(res, 400, { error: "nothing to delete" });
    discardSelectionFiles(files);
    clearEditionMark(dir, body.edition);
    return send(res, 200, { ok: true, dir, edition: Number(body.edition), ...setPayload(dir) });
  }

  if (pathname === "/api/set/drop" && req.method === "POST") {
    const body = await readBody(req);
    const dir = safeSetName(body.dir || "");
    const setDir = join(P().out, dir);
    if (!existsSync(setDir) || !statSync(setDir).isDirectory()) return send(res, 404, { error: "set not found" });
    let shelved;
    try {
      shelved = shelveCurrent(setDir, body.edition);
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
    clearEditionMark(dir, body.edition);
    return send(res, 200, { ok: true, dir, shelved, ...setPayload(dir) });
  }

  if (pathname === "/api/marks" && req.method === "GET") {
    const dir = url.searchParams.get("dir");
    if (!dir) return send(res, 400, { error: "dir required" });
    return send(res, 200, { dir: safeSetName(dir), marks: readMarks(dir) });
  }

  if (pathname === "/api/marks" && req.method === "POST") {
    const body = await readBody(req);
    if (!body.dir) return send(res, 400, { error: "dir required" });
    const dir = safeSetName(body.dir);
    let marks = readMarks(dir);
    if (body.marks && typeof body.marks === "object") {
      marks = body.marks;
    } else if (body.edition != null) {
      const key = String(body.edition);
      const val = body.mark; // "keep" | "redo" | "" | null
      if (!val) delete marks[key];
      else marks[key] = val === "keep" || val === "redo" ? val : String(val);
    } else {
      return send(res, 400, { error: "marks object or edition+mark required" });
    }
    writeMarks(dir, marks);
    return send(res, 200, { ok: true, dir, marks });
  }

  // Підтвердження автора: риси на кадрах не перевірено зором (метадані беруться з рецептів). Лише записує файл у теці набору.
  if (pathname === "/api/qa/visibility-ack" && req.method === "POST") {
    const body = await readBody(req);
    const dir = safeSetName(body.dir || body.set);
    if (!dir) return send(res, 400, { error: "dir required" });
    const setDir = join(P().out, dir);
    if (!existsSync(setDir) || !statSync(setDir).isDirectory()) {
      return send(res, 404, { error: `set directory not found: ${dir}` });
    }
    const doc = writeVisibilityAck(setDir, body.ack !== false);
    return send(res, 200, { ok: true, dir, ack: doc.ack, at: doc.at });
  }

  if (pathname === "/api/qa/triage" && req.method === "POST") {
    const body = await readBody(req);
    const dir = safeSetName(body.dir || body.set);
    if (!dir) return send(res, 400, { error: "dir required" });
    const setDir = join(P().out, dir);
    if (!existsSync(setDir) || !statSync(setDir).isDirectory()) {
      return send(res, 400, { error: `set directory not found: ${dir}` });
    }

    const { images } = listSetImages(dir);
    if (!images.length) {
      return send(res, 200, { ok: true, dir, total: 0, evaluated: 0, results: [], marks: readMarks(dir) });
    }

    // Resolve archive & preset for recipe mapping & styleLock
    let archive = null;
    let preset = null;
    if (body.archiveFile) {
      archive = loadArchiveFile(body.archiveFile).archive;
    } else {
      const list = listArchives();
      if (list.length) archive = loadArchiveFile(list[0].file).archive;
    }

    if (body.presetFile) {
      preset = loadPresetByFile(body.presetFile).preset;
    } else if (archive?.presetId) {
      try {
        preset = loadPresetByFile(`${archive.presetId}.json`).preset;
      } catch {
        preset = null;
      }
    }

    const recipeMap = new Map((archive?.recipes || []).map((r) => [r.edition, r]));
    const currentMarks = readMarks(dir);

    // Target filtering
    const mode = String(body.mode || (Array.isArray(body.editions) ? "specific" : "unmarked"));
    let targetImages = images;
    if (mode === "unmarked") {
      targetImages = images.filter((img) => img.edition != null && !currentMarks[String(img.edition)]);
    } else if (mode === "sample") {
      const limit = Math.max(1, Math.min(50, Number(body.limit) || 10));
      targetImages = images.slice(0, limit);
    } else if (mode === "specific" && Array.isArray(body.editions)) {
      const edSet = new Set(body.editions.map(Number));
      targetImages = images.filter((img) => img.edition != null && edSet.has(img.edition));
    }

    // Resolve provider & apiKey
    let provider = String(body.provider || "heuristic").toLowerCase();
    let apiKey = null;
    if (provider === "vision" || provider === "openai" || provider === "anthropic") {
      if (provider === "anthropic" && process.env.ANTHROPIC_API_KEY) {
        apiKey = process.env.ANTHROPIC_API_KEY;
        provider = "anthropic";
      } else if (process.env.OPENAI_API_KEY) {
        apiKey = process.env.OPENAI_API_KEY;
        provider = "openai";
      } else if (process.env.ANTHROPIC_API_KEY) {
        apiKey = process.env.ANTHROPIC_API_KEY;
        provider = "anthropic";
      } else {
        provider = "heuristic";
      }
    }

    const items = targetImages.map((img) => ({
      edition: img.edition,
      imagePath: join(P().out, dir, img.file),
      recipe: img.edition != null ? recipeMap.get(img.edition) : undefined,
    }));
    const triageCharge = provider !== "heuristic" && items.length
      ? chargeCredits({ engine: provider, credits: items.length * visionCreditCost(), note: "ai triage", rateLimited: false })
      : null;

    const concurrency = Math.max(1, Math.min(4, Number(body.concurrency) || 2));
    let results;
    try {
      results = await triageBatch(items, { concurrency, provider, apiKey, preset });
    } catch (e) {
      refundCharge(triageCharge);
      throw e;
    }

    const autoApply = Boolean(body.autoApplyMarks);
    const missingTraits = countMissingTraitFrames(results);
    writeJsonAtomic(join(setDir, "triage.json"), {
      at: new Date().toISOString(),
      provider,
      results,
      missingTraitFrames: missingTraits.frames,
    });

    if (autoApply) {
      for (const resItem of results) {
        if (resItem.edition != null && (resItem.verdict === "keep" || resItem.verdict === "redo")) {
          currentMarks[String(resItem.edition)] = resItem.verdict;
        }
      }
      writeMarks(dir, currentMarks);
    }

    return send(res, 200, {
      ok: true,
      dir,
      provider,
      autoApplied: autoApply,
      total: images.length,
      evaluated: results.length,
      results,
      marks: currentMarks,
      missingTraitFrames: missingTraits.frames,
    });
  }

  return false;
}
