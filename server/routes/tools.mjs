// tools: moved out of server/index.mjs without a change in behaviour (docs/QUALITY-REVIEW.md, step 2 of the split plan).
// `handleToolRoutes` answers true when it handled the request, otherwise the caller carries on with its own routes.
// What lives inside the studio process (the current project's folders, the wallet, the stage charges) arrives in `ctx`.
import { existsSync, readFileSync } from "node:fs";
import { formatEnginePrompt, runChecklist, sendTelegramNotification, sendTelegramTest } from "../../src/index.mjs";
import { isAdmin } from "../../src/platform/ops.mjs";
import { join } from "node:path";
import { readTriageDoc, readVisibilityAck } from "../../src/trait-visibility.mjs";
import { testEngineConnection } from "../../src/connectors.mjs";
import { readBody, send as sendResponse } from "../http.mjs";

export async function handleToolRoutes(ctx) {
  const { req, res, url, pathname, P, PUBLIC_MODE, ROOT, baseStatus, currentWallet, listArchives, listSetImages, loadArchiveFile, loadPresetFileSafe, loadPresetForArchive, readMarks, readWorkspace, safeSetName, writeWorkspace } = ctx;
  const send = (...a) => {
    sendResponse(...a);
    return true;
  };

  if (pathname === "/api/notifications/test" && req.method === "POST") {
    if (PUBLIC_MODE && !isAdmin(currentWallet())) return send(res, 403, { error: "admin only" });
    const body = await readBody(req);
    // Optional override for one-off tests; otherwise Series Lab config (SERIES_TELEGRAM_* / TELEGRAM_*).
    if (body.botToken && body.chatId) {
      const text = body.message || "🔔 *Series Lab*\nТестове сповіщення успішно надіслано!";
      const resNotify = await sendTelegramNotification({ botToken: body.botToken, chatId: body.chatId, text });
      return send(res, resNotify.ok ? 200 : 400, { ...resNotify, project: "Series Lab" });
    }
    const resNotify = await sendTelegramTest();
    return send(res, resNotify.ok ? 200 : 400, { ...resNotify, project: "Series Lab" });
  }

  if (pathname === "/api/matrix/preview" && req.method === "POST") {
    const body = await readBody(req);
    const recipe = body.recipe;
    const engine = body.engine || "flux";
    const preset = body.preset || {};
    if (!recipe) return send(res, 400, { error: "recipe object required" });
    const formatted = formatEnginePrompt(recipe, engine, preset);
    return send(res, 200, { ok: true, engine, prompt: formatted });
  }

  if (pathname === "/api/traits/matrix" && req.method === "GET") {
    const archiveName = url.searchParams.get("archive") || url.searchParams.get("file");
    if (!archiveName) return send(res, 400, { error: "archive parameter required" });
    const { archive } = loadArchiveFile(archiveName);
    const cooccurrence = {};
    const recipes = archive.recipes || [];
    for (const r of recipes) {
      const traits = Object.entries(r.traits || {}).filter(([, v]) => v && v !== "None");
      for (let i = 0; i < traits.length; i++) {
        for (let j = i + 1; j < traits.length; j++) {
          const pairKey = `${traits[i][0]}:${traits[i][1]} | ${traits[j][0]}:${traits[j][1]}`;
          cooccurrence[pairKey] = (cooccurrence[pairKey] || 0) + 1;
        }
      }
    }
    const topPairs = Object.entries(cooccurrence)
      .map(([pair, count]) => ({ pair, count, percentage: Math.round((count / (recipes.length || 1)) * 100) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50);
    return send(res, 200, { ok: true, totalRecipes: recipes.length, topPairs });
  }

  if (pathname === "/api/engines/test" && req.method === "POST") {
    const body = await readBody(req);
    const eng = body.engine || "fal";
    const result = await testEngineConnection(eng, process.env, globalThis.fetch);
    return send(res, 200, { ok: true, ...result });
  }

  if (pathname === "/api/comfyui/workflow" && req.method === "GET") {
    const wfPath = join(ROOT, "templates", "comfyui-workflow.json");
    if (!existsSync(wfPath)) return send(res, 404, { error: "comfyui-workflow.json not found" });
    const json = JSON.parse(readFileSync(wfPath, "utf8"));
    return send(res, 200, json);
  }

  if (pathname === "/api/doctor" && req.method === "GET") {
    const { runDoctorDiagnostics } = await import("../../src/doctor.mjs");
    const report = await runDoctorDiagnostics({ rootDir: ROOT, env: process.env });
    return send(res, 200, report);
  }

  if (pathname === "/api/checklist" && req.method === "GET") {
    const archiveName = url.searchParams.get("archive") || url.searchParams.get("file");
    const setName = url.searchParams.get("set") || url.searchParams.get("dir");
    let archive = null;
    let archiveFile = null;
    if (archiveName) {
      try {
        const loaded = loadArchiveFile(archiveName);
        archive = loaded.archive;
        archiveFile = loaded.file;
      } catch (e) {
        return send(res, 404, { error: String(e.message || e) });
      }
    } else {
      const list = listArchives();
      if (list.length) {
        const loaded = loadArchiveFile(list[0].file);
        archive = loaded.archive;
        archiveFile = loaded.file;
      }
    }
    let preset = null;
    if (archive) {
      try {
        preset = loadPresetForArchive(archive)?.preset || null;
      } catch {
        preset = loadPresetFileSafe(`${archive.presetId || "x"}.json`)?.preset || null;
      }
    }
    if (!preset && url.searchParams.get("preset")) {
      preset = loadPresetFileSafe(url.searchParams.get("preset"))?.preset || null;
    }
    let marks = {};
    let images = [];
    let triage = null;
    let visibilityAck = null;
    const set = setName ? safeSetName(setName) : null;
    if (set) {
      try {
        marks = readMarks(set);
        images = listSetImages(set).images;
        triage = readTriageDoc(join(P().out, set));
        visibilityAck = readVisibilityAck(join(P().out, set));
      } catch {
        images = [];
      }
    }
    const base = baseStatus();
    const items = runChecklist({
      preset,
      archive,
      marks,
      images,
      baseExists: Boolean(base.exists),
      triage,
      visibilityAck,
    });
    return send(res, 200, { ok: true, archive: archiveFile, set, items });
  }

  if (pathname === "/api/workspace" && req.method === "GET") {
    const data = readWorkspace();
    return send(res, 200, { ok: true, workspace: data, exists: Boolean(data) });
  }

  if (pathname === "/api/workspace" && req.method === "POST") {
    const body = await readBody(req);
    const prev = readWorkspace() || {};
    if (body.clear) {
      const cleared = writeWorkspace({
        presetId: null,
        locale: body.locale || prev.locale || null,
        lastArchive: null,
        lastSet: null,
        overview: {},
      });
      return send(res, 200, { ok: true, workspace: cleared });
    }
    const next = {
      ...prev,
      presetId: body.presetId ?? prev.presetId ?? null,
      locale: body.locale ?? prev.locale ?? null,
      lastArchive: body.lastArchive ?? prev.lastArchive ?? null,
      lastSet: body.lastSet ?? prev.lastSet ?? null,
    };
    if (body.overview && typeof body.overview === "object") {
      next.overview = { ...(prev.overview || {}), ...body.overview };
    }
    const saved = writeWorkspace(next);
    return send(res, 200, { ok: true, workspace: saved });
  }

  return false;
}
