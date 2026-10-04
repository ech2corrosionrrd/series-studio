/**
 * Demo series archive for tests. Built from presets/demo-series.json in-process
 * so `npm test` does not need the gitignored `out/demo-series.json`.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRecipes, duplicates } from "../../src/recipes.mjs";
import { loadTraitsFromPreset } from "../../src/traits.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function loadDemoPreset() {
  return JSON.parse(readFileSync(join(ROOT, "presets", "demo-series.json"), "utf8"));
}

/** Same shape as `makeArchive` in bin/series.mjs, with a fixed timestamp. */
export function buildDemoArchive(preset = loadDemoPreset()) {
  const recipes = buildRecipes(preset);
  const traitKeys = loadTraitsFromPreset(preset).map((t) => t.key);
  const dups = duplicates(recipes, traitKeys);
  if (dups.length) throw new Error(`duplicate DNA groups: ${JSON.stringify(dups)}`);
  return {
    schema: "series-archive/v0",
    presetId: preset.id,
    createdAt: "2026-01-01T00:00:00.000Z",
    seed: preset.seed,
    size: preset.size,
    recipes,
  };
}

export function writeDemoArchive(dest, preset = loadDemoPreset()) {
  const archive = buildDemoArchive(preset);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, JSON.stringify(archive));
  return archive;
}
