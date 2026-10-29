// archives: moved out of server/index.mjs without a change in behaviour (docs/QUALITY-REVIEW.md, step 2 of the split plan).
// `handleArchiveRoutes` answers true when it handled the request, otherwise the caller carries on with its own routes.
// What lives inside the studio process (the current project's folders, the wallet, the stage charges) arrives in `ctx`.
import { appendSupplyWave, describeSupply } from "../../src/index.mjs";
import { archiveSync } from "../../src/archive-sync.mjs";
import { readFileSync } from "node:fs";
import { writeJsonAtomic } from "../../src/fs-safe.mjs";
import { readBody, send as sendResponse } from "../http.mjs";

export async function handleArchiveRoutes(ctx) {
  const { req, res, url, pathname, archiveToCsv, archiveToTxt, checkPreset, listArchives, loadArchiveFile, loadPresetByFile, loadPresetForArchive } = ctx;
  const send = (...a) => {
    sendResponse(...a);
    return true;
  };

  if (pathname === "/api/archive/list" && req.method === "GET") {
    return send(res, 200, { archives: listArchives() });
  }

  // Чи архів досі збігається з пресетом, з якого його зібрано (рецепти перебудовуються й порівнюються за DNA і промптом).
  if (pathname === "/api/archive/sync" && req.method === "GET") {
    const name = url.searchParams.get("file");
    if (!name) return send(res, 400, { error: "file required" });
    let loaded;
    try {
      loaded = loadArchiveFile(name);
    } catch (e) {
      return send(res, e.status || 404, { error: String(e.message || e) });
    }
    let preset = null;
    try {
      preset = loadPresetForArchive(loaded.archive)?.preset || null;
    } catch {
      preset = null;
    }
    return send(res, 200, { file: loaded.file, ...archiveSync(preset, loaded.archive) });
  }

  if (pathname === "/api/archive/latest" && req.method === "GET") {
    const list = listArchives();
    if (!list.length) return send(res, 404, { error: "no archives" });
    const { archive, file } = loadArchiveFile(list[0].file);
    return send(res, 200, { file, archive });
  }

  if (pathname === "/api/archive/file" && req.method === "GET") {
    const { path, file } = loadArchiveFile(url.searchParams.get("file"));
    return send(res, 200, readFileSync(path), "application/json; charset=utf-8", {
      "Content-Disposition": `attachment; filename="${file}"`,
    });
  }

  if (pathname === "/api/export/csv" && req.method === "GET") {
    let file = url.searchParams.get("file");
    if (!file) {
      const list = listArchives();
      if (!list.length) return send(res, 404, { error: "no archives" });
      file = list[0].file;
    }
    const { archive } = loadArchiveFile(file);
    const csv = archiveToCsv(archive);
    const outName = String(file).replace(/\.json$/i, "") + "-prompts.csv";
    return send(res, 200, csv, "text/csv; charset=utf-8", {
      "Content-Disposition": `attachment; filename="${outName}"`,
    });
  }

  if (pathname === "/api/export/txt" && req.method === "GET") {
    let file = url.searchParams.get("file");
    if (!file) {
      const list = listArchives();
      if (!list.length) return send(res, 404, { error: "no archives" });
      file = list[0].file;
    }
    const { archive } = loadArchiveFile(file);
    const txt = archiveToTxt(archive);
    const outName = String(file).replace(/\.json$/i, "") + "-prompts.txt";
    return send(res, 200, txt, "text/plain; charset=utf-8", {
      "Content-Disposition": `attachment; filename="${outName}"`,
    });
  }

  if (pathname === "/api/waves" && req.method === "GET") {
    const { preset, file } = loadPresetByFile(url.searchParams.get("file") || "demo-series.json");
    return send(res, 200, { file, size: preset.size, waves: describeSupply(preset) });
  }

  if (pathname === "/api/waves/append" && req.method === "POST") {
    const body = await readBody(req);
    const loaded = loadPresetByFile(body.file || "");
    const preset = appendSupplyWave(loaded.preset, {
      size: body.size,
      seed: body.seed,
      name: body.name,
    });
    const checked = checkPreset(preset);
    if (!checked.ok) return send(res, 400, { ok: false, errors: checked.errors });
    writeJsonAtomic(loaded.path, preset);
    return send(res, 200, { ok: true, file: loaded.file, size: preset.size, waves: describeSupply(preset), preset });
  }

  return false;
}
