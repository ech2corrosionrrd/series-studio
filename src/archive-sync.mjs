/**
 * Is an archive still what the current preset would produce? Offline, no weights, no I/O.
 *
 * Recipes are a pure function of the preset (`buildRecipes` with `preset.overrides`), so the check rebuilds them and compares
 * DNA and prompt edition by edition. A paid frame is made from an archive prompt; when the preset changed after the archive
 * was built (weights, traits, seed, size, prompt parts) the frames, the metadata and the preset no longer describe the same series.
 */
import { buildRecipes } from "./recipes.mjs";

const SAMPLE = 8;

/**
 * @param {object|null} preset
 * @param {object|null} archive
 * @returns {{ status: "match"|"stale"|"unknown", reason?: string, total: number, expected: number, dnaChanged: number,
 *   promptChanged: number, missing: number, extra: number, editions: number[] }}
 *   `editions`: the first few editions that differ. `unknown` when there is no preset, no recipes or the preset cannot be built.
 */
export function archiveSync(preset, archive) {
  const recipes = Array.isArray(archive?.recipes) ? archive.recipes : [];
  const unknown = (reason, expected = 0) => ({
    status: "unknown",
    reason,
    total: recipes.length,
    expected,
    dnaChanged: 0,
    promptChanged: 0,
    missing: 0,
    extra: 0,
    editions: [],
  });
  if (!preset) return unknown("no_preset");
  if (!recipes.length) return unknown("no_recipes");
  let expected;
  try {
    expected = buildRecipes(preset, { items: preset.overrides || {} });
  } catch {
    return unknown("preset_invalid");
  }
  const want = new Map(expected.map((r) => [r.edition, r]));
  const have = new Set();
  let dnaChanged = 0;
  let promptChanged = 0;
  let extra = 0;
  const differing = [];
  for (const r of recipes) {
    have.add(r.edition);
    const e = want.get(r.edition);
    if (!e) {
      extra += 1;
      differing.push(r.edition);
    } else if (e.dna !== r.dna) {
      dnaChanged += 1;
      differing.push(r.edition);
    } else if (e.prompt !== r.prompt) {
      promptChanged += 1;
      differing.push(r.edition);
    }
  }
  const missingEditions = expected.filter((r) => !have.has(r.edition)).map((r) => r.edition);
  const stale = dnaChanged + promptChanged + extra + missingEditions.length > 0;
  return {
    status: stale ? "stale" : "match",
    total: recipes.length,
    expected: expected.length,
    dnaChanged,
    promptChanged,
    missing: missingEditions.length,
    extra,
    editions: [...differing, ...missingEditions].sort((a, b) => a - b).slice(0, SAMPLE),
  };
}

/** One line for logs and the checklist. */
export function describeSync(sync) {
  if (sync.status === "match") return `${sync.total} recipes match the preset`;
  if (sync.status === "unknown") return `cannot compare (${sync.reason})`;
  const parts = [];
  if (sync.dnaChanged) parts.push(`${sync.dnaChanged} with other traits`);
  if (sync.promptChanged) parts.push(`${sync.promptChanged} with another prompt`);
  if (sync.missing) parts.push(`${sync.missing} missing`);
  if (sync.extra) parts.push(`${sync.extra} not in the preset`);
  return `archive differs from the preset: ${parts.join(", ")} (editions ${sync.editions.join(", ")}${sync.dnaChanged + sync.promptChanged + sync.missing + sync.extra > sync.editions.length ? ", …" : ""})`;
}
