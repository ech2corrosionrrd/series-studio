// recipes: moved out of server/index.mjs without a change in behaviour (docs/QUALITY-REVIEW.md, step 2 of the split plan).
// `handleRecipeRoutes` answers true when it handled the request, otherwise the caller carries on with its own routes.
// What lives inside the studio process (the current project's folders, the wallet, the stage charges) arrives in `ctx`.
import { buildPrompt, buildRecipes, checkConflicts, collectConflicts, collideArchives, computeRarity, conflictMessage, diffArchives, dna, drySimulate, lintPrompt, lintPrompts, loadTraitsFromPreset, optionsFor } from "../../src/index.mjs";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { writeJsonAtomic } from "../../src/fs-safe.mjs";
import { readBody, send as sendResponse } from "../http.mjs";

export async function handleRecipeRoutes(ctx) {
  const { req, res, url, pathname, P, checkPreset, enrichRecipe, listArchives, loadArchiveFile, loadPresetByFile, loadPresetForArchive, makeArchive, recipesPayload, traitsEqual } = ctx;
  const send = (...a) => {
    sendResponse(...a);
    return true;
  };

  if (pathname === "/api/build" && req.method === "POST") {
    const body = await readBody(req);
    const { preset } = loadPresetByFile(body.file || "demo-series.json");
    const checked = checkPreset(preset);
    if (!checked.ok) return send(res, 400, { ok: false, errors: checked.errors });
    let built;
    try {
      built = makeArchive(preset);
    } catch (e) {
      // an impossible preset (too few unique combinations, unmet exact counts) is bad input, not a server fault
      return send(res, 400, { ok: false, error: String(e.message || e), code: "build" });
    }
    const { archive, dupes } = built;
    mkdirSync(P().out, { recursive: true });
    const outName = `${preset.id || "archive"}.json`;
    writeJsonAtomic(join(P().out, outName), archive);
    return send(res, 200, {
      ok: true,
      out: `out/${outName}`,
      size: archive.size,
      duplicates: dupes,
      recipes: archive.recipes.map((r) => ({
        index: r.index,
        edition: r.edition,
        line: r.line,
        dna: r.dna,
        prompt: r.prompt,
        traits: r.traits,
        seed: r.seed,
        note: r.note ?? "",
        edited: Boolean(r.edited),
        ...(r.wave != null ? { wave: r.wave } : {}),
      })),
    });
  }

  if (pathname === "/api/simulate" && req.method === "POST") {
    const body = await readBody(req);
    let preset = body.preset;
    if (!preset) {
      preset = loadPresetByFile(body.file || "demo-series.json").preset;
    }
    const checked = checkPreset(preset);
    if (!checked.ok) return send(res, 400, { ok: false, errors: checked.errors });
    try {
      const sim = drySimulate(preset, body.pack || null);
      return send(res, 200, { ok: true, ...sim });
    } catch (e) {
      return send(res, 400, { ok: false, error: String(e.message || e), code: "simulate" });
    }
  }

  if (pathname === "/api/diff-seed" && req.method === "POST") {
    const body = await readBody(req);
    const { preset } = loadPresetByFile(body.file || "demo-series.json");
    const checked = checkPreset(preset);
    if (!checked.ok) return send(res, 400, { ok: false, errors: checked.errors });
    let a;
    let b;
    try {
      a = buildRecipes(preset).map((r) => r.dna);
      b = buildRecipes(preset).map((r) => r.dna);
    } catch (e) {
      return send(res, 400, { ok: false, error: String(e.message || e), code: "diff-seed" });
    }
    const ok = a.length === b.length && a.every((d, i) => d === b[i]);
    return send(res, ok ? 200 : 500, { ok, size: a.length });
  }

  if (pathname === "/api/recipes" && req.method === "GET") {
    let file = url.searchParams.get("file");
    if (!file) {
      const list = listArchives();
      if (!list.length) return send(res, 404, { error: "no archives" });
      file = list[0].file;
    }
    const { archive, file: archiveFile } = loadArchiveFile(file);
    const { preset } = loadPresetForArchive(archive);
    return send(res, 200, recipesPayload(archiveFile, archive, preset));
  }

  if (pathname === "/api/rarity" && req.method === "GET") {
    let file = url.searchParams.get("file");
    if (!file) {
      const list = listArchives();
      if (!list.length) return send(res, 404, { error: "no archives" });
      file = list[0].file;
    }
    const { archive, file: archiveFile } = loadArchiveFile(file);
    const { preset } = loadPresetForArchive(archive);
    const rarity = computeRarity(preset, archive.recipes || []);
    return send(res, 200, { file: archiveFile, presetId: archive.presetId, rarity });
  }

  if (pathname === "/api/lint" && req.method === "POST") {
    const body = await readBody(req);
    if (Array.isArray(body.texts)) {
      return send(res, 200, lintPrompts(body.texts.map((t) => String(t ?? ""))));
    }
    const text = String(body.text ?? body.prompt ?? "");
    return send(res, 200, lintPrompt(text));
  }

  if (pathname === "/api/recipe" && req.method === "POST") {
    const body = await readBody(req);
    if (body.file == null || body.index == null) {
      return send(res, 400, { error: "file and index required" });
    }
    const { archive, path: archivePath, file: archiveFile } = loadArchiveFile(body.file);
    const { preset } = loadPresetForArchive(archive);
    const items = loadTraitsFromPreset(preset);
    const traitKeys = items.map((t) => t.key);
    const idx = Number(body.index);
    const recipes = archive.recipes || [];
    const recipe = recipes.find((r) => r.index === idx);
    if (!recipe) return send(res, 404, { error: `recipe index ${idx} not found` });

    if (!recipe.originalTraits) {
      recipe.originalTraits = structuredClone(recipe.traits);
    }
    if (recipe.originalNote === undefined) {
      recipe.originalNote = typeof recipe.note === "string" ? recipe.note : "";
    }

    if (body.reset) {
      recipe.traits = structuredClone(recipe.originalTraits);
      recipe.note = recipe.originalNote ?? "";
    } else {
      if (body.traits && typeof body.traits === "object") {
        // validate values against preset options (line-aware)
        for (const key of traitKeys) {
          if (body.traits[key] == null) continue;
          const traitDef = items.find((t) => t.key === key);
          const allowed = optionsFor(traitDef, recipe.line).map((o) => o.value);
          if (!allowed.includes(body.traits[key])) {
            return send(res, 400, { error: `invalid ${key}: ${body.traits[key]}` });
          }
        }
        recipe.traits = { ...recipe.traits, ...body.traits };
      }
      if (body.note != null) {
        recipe.note = String(body.note).slice(0, 500);
      }
    }

    const conflicts = collectConflicts(preset);
    const conflictCheck = checkConflicts(recipe.traits, conflicts);
    if (!conflictCheck.ok) {
      return send(res, 400, {
        error: `Trait conflict: ${conflictMessage(conflictCheck.hits)}`,
        conflicts: conflictCheck.hits,
      });
    }

    recipe.dna = dna(recipe.line, recipe.traits, traitKeys);
    recipe.prompt = buildPrompt(recipe.line, recipe.traits, preset, recipe.note || "");
    recipe.edited = !(
      traitsEqual(recipe.traits, recipe.originalTraits) &&
      String(recipe.note || "") === String(recipe.originalNote || "")
    );

    const twin = recipes.find((r) => r.index !== recipe.index && r.dna === recipe.dna);
    if (twin) {
      return send(res, 400, {
        error: `Duplicate DNA with edition #${twin.edition}`,
        twin: twin.edition,
      });
    }

    writeJsonAtomic(archivePath, archive);
    try {
      const loaded = loadPresetForArchive(archive);
      const overrides = { ...(loaded.preset.overrides || {}) };
      const key = String(idx);
      if (!recipe.edited) delete overrides[key];
      else overrides[key] = { traits: recipe.traits, note: recipe.note || "" };
      loaded.preset.overrides = overrides;
      writeJsonAtomic(loaded.path, loaded.preset);
    } catch {
      /* the archive still holds the edit if the preset file is missing */
    }
    return send(res, 200, { ok: true, file: archiveFile, recipe: enrichRecipe(recipe) });
  }

  if (pathname === "/api/archive/diff" && req.method === "POST") {
    const body = await readBody(req);
    const left = loadArchiveFile(body.a || body.left || "");
    const right = loadArchiveFile(body.b || body.right || "");
    return send(res, 200, { a: left.file, b: right.file, ...diffArchives(left.archive, right.archive) });
  }

  // The same character in two different collections (a sequel that re-rolled an old look).
  if (pathname === "/api/archive/collisions" && req.method === "POST") {
    const body = await readBody(req);
    const left = loadArchiveFile(body.a || body.left || "");
    const right = loadArchiveFile(body.b || body.right || "");
    if (left.file === right.file) return send(res, 400, { error: "choose two different archives" });
    const found = collideArchives(left.archive, right.archive);
    return send(res, 200, { a: left.file, b: right.file, ...found, collisions: found.collisions.slice(0, 200), collisionCount: found.collisions.length });
  }

  return false;
}
