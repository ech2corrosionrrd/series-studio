/**
 * Rarity report: actual trait option frequency vs weight-expected %.
 */

import { loadTraitsFromPreset, NONE } from "./traits.mjs";

const NULL_TRAIT = new Set(["", NONE, "__NONE__", "None", "null"]);

function traitValueOrNull(traits, key) {
  const v = traits?.[key];
  if (v == null || NULL_TRAIT.has(String(v))) return "null";
  return String(v);
}

/**
 * OpenRarity information content: sum of −log2(P) per layer.
 * A layer that exists in the preset but is missing on the edition counts as "null".
 * Does not replace the frequency report.
 */
export function openRarityByEdition(preset, recipes) {
  const list = Array.isArray(recipes) ? recipes : [];
  const n = list.length;
  let keys = [];
  if (Array.isArray(preset?.traits?.items)) {
    try {
      keys = loadTraitsFromPreset(preset).map((t) => t.key);
    } catch {
      keys = [];
    }
  }
  if (!keys.length) {
    keys = [...new Set(list.flatMap((r) => Object.keys(r?.traits || {})))];
  }
  const counts = {};
  for (const key of keys) counts[key] = {};
  for (const recipe of list) {
    for (const key of keys) {
      const value = traitValueOrNull(recipe?.traits, key);
      counts[key][value] = (counts[key][value] || 0) + 1;
    }
  }
  const editions = list.map((recipe) => {
    let openRarity = 0;
    const traits = [];
    for (const key of keys) {
      const value = traitValueOrNull(recipe?.traits, key);
      const count = counts[key][value] || 0;
      const p = n > 0 ? count / n : 0;
      const information = p > 0 ? -Math.log2(p) : 0;
      openRarity += information;
      traits.push({ trait: key, value, count, p, information });
    }
    return { edition: recipe?.edition ?? null, openRarity, traits };
  });
  return {
    method: "openrarity",
    formula: "sum(-log2(P))",
    nullValue: "null",
    editions,
  };
}

function roundPct(n) {
  return Math.round(n * 1000) / 10; // 1 decimal place
}

/**
 * Expected share of an option among available options for a trait,
 * using weights (normalized). Lines ignored here — report is global.
 * @param {{ value: string, weight?: number }[]} options
 */
export function expectedShares(options) {
  const opts = Array.isArray(options) ? options : [];
  const total = opts.reduce((s, o) => s + (Number(o.weight) || 0), 0);
  const map = {};
  for (const o of opts) {
    const w = Number(o.weight) || 0;
    map[o.value] = total > 0 ? (w / total) * 100 : 0;
  }
  return map;
}

/**
 * @param {object} preset
 * @param {Array<{ traits?: Record<string,string> }>} recipes
 * @returns {{ traits: Array<{ key: string, type?: string, options: Array<{ value: string, count: number, actualPct: number, expectedPct: number }> }> }}
 */
export function computeRarity(preset, recipes) {
  const items = loadTraitsFromPreset(preset);
  const list = Array.isArray(recipes) ? recipes : [];
  const n = list.length || 1;
  const traits = [];

  for (const t of items) {
    const counts = Object.create(null);
    for (const r of list) {
      const v = r?.traits?.[t.key];
      if (v == null || v === "") continue;
      counts[v] = (counts[v] || 0) + 1;
    }
    const expected = expectedShares(t.options || []);
    const values = new Set([
      ...Object.keys(counts),
      ...(t.options || []).map((o) => o.value),
    ]);
    const options = [...values]
      .map((value) => {
        const count = counts[value] || 0;
        return {
          value,
          count,
          actualPct: roundPct((count / n) * 100),
          expectedPct: roundPct(expected[value] ?? 0),
        };
      })
      .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)));
    traits.push({
      key: t.key,
      type: t.type || t.key,
      options,
    });
  }

  return { traits, sampleSize: list.length };
}
