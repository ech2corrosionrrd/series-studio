// presets: moved out of server/index.mjs without a change in behaviour (docs/QUALITY-REVIEW.md, step 2 of the split plan).
// `handlePresetRoutes` answers true when it handled the request, otherwise the caller carries on with its own routes.
// What lives inside the studio process (the current project's folders, the wallet, the stage charges) arrives in `ctx`.
import { existsSync, mkdirSync } from "node:fs";
import { exportPresetAsTraitPack, loadTraitsFromPreset, spinoffPreset, validateTraitPack } from "../../src/index.mjs";
import { join } from "node:path";
import { writeJsonAtomic } from "../../src/fs-safe.mjs";
import { httpError, readBody, send as sendResponse } from "../http.mjs";

export async function handlePresetRoutes(ctx) {
  const { req, res, url, pathname, P, admitNewProject, checkPreset, commitNewProject, guardProjectOverwrite, listPresets, listTemplates, listTraitPacks, loadPresetByFile, loadTemplateById, loadTraitPackById, presetRev, summarizeTraitPack, toTrash } = ctx;
  const send = (...a) => {
    sendResponse(...a);
    return true;
  };

  if (pathname === "/api/presets" && req.method === "GET") {
    return send(res, 200, { presets: listPresets() });
  }

  if (pathname === "/api/preset" && req.method === "GET") {
    const { preset, file, path } = loadPresetByFile(url.searchParams.get("file") || "demo-series.json");
    return send(res, 200, { file, preset, rev: presetRev(path) });
  }

  if (pathname === "/api/templates" && req.method === "GET") {
    return send(res, 200, { templates: listTemplates() });
  }

  if (pathname.startsWith("/api/templates/") && req.method === "GET") {
    const id = decodeURIComponent(pathname.slice("/api/templates/".length));
    const { preset } = loadTemplateById(id);
    return send(res, 200, { preset });
  }


  if (pathname === "/api/trait-packs" && req.method === "GET") {
    return send(res, 200, { packs: listTraitPacks() });
  }

  if (pathname.startsWith("/api/trait-packs/") && req.method === "GET") {
    const id = decodeURIComponent(pathname.slice("/api/trait-packs/".length));
    const { pack, summary, file } = loadTraitPackById(id);
    return send(res, 200, { file, summary, pack });
  }

  if (pathname === "/api/trait-packs/save" && req.method === "POST") {
    const body = await readBody(req);
    const pack = body.pack;
    const val = validateTraitPack(pack);
    if (!val.ok) return send(res, 400, { ok: false, errors: val.errors });
    mkdirSync(P().traits, { recursive: true });
    const id = String(pack.id).replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
    const filePath = join(P().traits, `${id}.json`);
    writeJsonAtomic(filePath, pack);
    return send(res, 200, { ok: true, id, file: `${id}.json`, summary: summarizeTraitPack(pack, `${id}.json`) });
  }

  if (pathname === "/api/trait-packs/export-from-preset" && req.method === "POST") {
    const body = await readBody(req);
    let preset = body.preset;
    if (!preset) {
      preset = loadPresetByFile(body.file || "demo-series.json").preset;
    }
    const pack = exportPresetAsTraitPack(preset, {
      id: body.id,
      name: body.name,
      description: body.description,
      tags: body.tags,
    });
    const val = validateTraitPack(pack);
    if (!val.ok) return send(res, 400, { ok: false, errors: val.errors });
    mkdirSync(P().traits, { recursive: true });
    const id = pack.id;
    const filePath = join(P().traits, `${id}.json`);
    writeJsonAtomic(filePath, pack);
    return send(res, 200, { ok: true, id, file: `${id}.json`, pack, summary: summarizeTraitPack(pack, `${id}.json`) });
  }

  if (pathname.startsWith("/api/trait-packs/") && req.method === "DELETE") {
    const id = decodeURIComponent(pathname.slice("/api/trait-packs/".length)).replace(/[^a-zA-Z0-9_-]/g, "");
    const filePath = join(P().traits, `${id}.json`);
    if (!existsSync(filePath)) return send(res, 404, { error: `trait pack not found: ${id}` });
    const trashed = toTrash([filePath], `trait pack ${id} deleted`);
    return send(res, 200, { ok: true, id, trashId: trashed?.id ?? null });
  }

  if (pathname === "/api/validate" && req.method === "POST") {
    const body = await readBody(req);
    let preset = body.preset;
    if (!preset) {
      preset = loadPresetByFile(body.file || "demo-series.json").preset;
    }
    const checked = checkPreset(preset);
    if (!checked.ok) return send(res, 400, { ok: false, errors: checked.errors });
    return send(res, 200, {
      ok: true,
      id: preset.id,
      size: preset.size,
      traits: loadTraitsFromPreset(preset).length,
    });
  }

  if (pathname === "/api/preset/save" && req.method === "POST") {
    const body = await readBody(req);
    const preset = body.preset;
    if (!preset || typeof preset !== "object") throw httpError(400, "preset required");
    const checked = checkPreset(preset);
    if (!checked.ok) return send(res, 400, { ok: false, errors: checked.errors });
    const id = String(preset.id || "").replace(/[^a-zA-Z0-9._-]/g, "-");
    if (!id) throw new Error("preset.id required");
    mkdirSync(P().presets, { recursive: true });
    // strip UI-only meta if saving as real preset (keep _meta optional)
    const outName = `${id}.json`;
    const outPath = join(P().presets, outName);
    let overwriting = guardProjectOverwrite(outName, body);
    // Optimistic concurrency: the client saw revision `baseRev`; if the file changed since (another tab, another
    // device), saving would drop that change. A client that sends no baseRev (CLI, old page) is not checked.
    if (existsSync(outPath) && typeof body.baseRev === "string" && body.baseRev && body.baseRev !== presetRev(outPath)) {
      if (body.overwrite !== true) {
        throw httpError(409, `The project "${id}" was changed elsewhere (another tab or device) after you opened it. Reload it, or confirm to replace it.`, {
          code: "project_stale", file: outName, rev: presetRev(outPath),
        });
      }
      overwriting = true;
    }
    const admission = admitNewProject(outName, body);
    // an overwrite keeps the previous version in the trash, so a mistaken "new project" is not a lost one
    if (overwriting && existsSync(outPath)) toTrash([outPath], `project overwritten: ${outName}`);
    writeJsonAtomic(outPath, preset);
    commitNewProject(outName, admission);
    return send(res, 200, { ok: true, file: outName, rev: presetRev(outPath), path: `presets/${outName}`, id, project: { new: admission.isNew, charged: admission.credits } });
  }

  if (pathname === "/api/preset/spinoff" && req.method === "POST") {
    const body = await readBody(req);
    const { preset } = loadPresetByFile(body.file || "");
    const checked = checkPreset(preset);
    if (!checked.ok) return send(res, 400, { ok: false, errors: checked.errors });
    let next = spinoffPreset(preset, body.suffix ? { suffix: String(body.suffix) } : {});
    let n = 2;
    while (existsSync(join(P().presets, `${next.id}.json`))) {
      next = spinoffPreset(preset, { suffix: `${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${n}` });
      n += 1;
      if (n > 20) return send(res, 409, { error: "could not pick a free spin-off id" });
    }
    mkdirSync(P().presets, { recursive: true });
    const file = `${next.id}.json`;
    const admission = admitNewProject(file, body);
    writeJsonAtomic(join(P().presets, file), next);
    commitNewProject(file, admission);
    return send(res, 200, { ok: true, file, preset: next, rev: presetRev(join(P().presets, file)), project: { new: true, charged: admission.credits } });
  }

  return false;
}
