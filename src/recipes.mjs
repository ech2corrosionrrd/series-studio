/**
 * Recipe builder: preset + seed → deterministic unique recipes/prompts.
 * No network. Pure functions of preset (+ optional overrides).
 */
import { hashSeed, makeRng } from "./rng.mjs";
import {
  NONE,
  optionsFor,
  traitActive,
  option,
  loadTraitsFromPreset,
} from "./traits.mjs";

const MAX_ATTEMPTS = 100_000;

/**
 * DNA fingerprint for uniqueness: line + trait values in traitKeys order.
 * @param {string} line
 * @param {Record<string, string>} traits
 * @param {string[]} traitKeys
 */
export function dna(line, traits, traitKeys) {
  return [line, ...traitKeys.map((k) => traits[k] ?? NONE)].join("|");
}

function keepText(keep, who) {
  const raw = Array.isArray(keep) ? keep.join(", ") : String(keep ?? "");
  return raw.replaceAll("{who}", who);
}

function lineWho(preset, lineId) {
  const entry = preset.lines?.[lineId];
  if (entry && typeof entry.who === "string" && entry.who.trim()) return entry.who;
  return lineId;
}

/**
 * Build edit-style prompt from preset.promptTemplate.
 * keep (array→joined or string) with {who}; Change: from changeKeys;
 * Also add: from extraKeys when not None; then suffix and optional note.
 */
export function buildPrompt(line, traits, preset, note = "") {
  const items = loadTraitsFromPreset(preset);
  const tpl = preset.promptTemplate ?? {};
  const who = lineWho(preset, line);
  const keep = keepText(tpl.keep, who);
  const changeKeys = tpl.changeKeys ?? [];
  const extraKeys = tpl.extraKeys ?? [];

  const changeBits = changeKeys.map((key) => {
    const val = traits[key];
    if (val == null) return null;
    const opt = option(items, key, val);
    return opt.prompt || "";
  }).filter(Boolean);

  const change =
    changeBits.length > 0
      ? `Change: ${changeBits.join("; ")}.`
      : "";

  const extraBits = extraKeys
    .filter((k) => traits[k] && traits[k] !== NONE)
    .map((k) => option(items, k, traits[k]).prompt)
    .filter(Boolean);
  const also =
    extraBits.length > 0 ? `Also add: ${extraBits.join("; ")}.` : "";

  const suffix = (tpl.suffix ?? "").trim();
  const noteText = (note ?? "").trim();
  const { styleKeepExtra, styleParagraph } = styleLockBits(preset);

  const keepParts = [keep, ...styleKeepExtra].filter(Boolean);
  const keepJoined = keepParts.join(", ");

  return [keepJoined, change, also, styleParagraph, noteText, suffix]
    .filter(Boolean)
    .join(" ");
}

/**
 * Optional preset.styleLock → keep lines + a fixed Style lock paragraph.
 * extraKeep → keep; angle/light/mood/framing → Style lock paragraph (and keep if short).
 */
function styleLockBits(preset) {
  const lock = preset?.styleLock;
  if (!lock || typeof lock !== "object") {
    return { styleKeepExtra: [], styleParagraph: "" };
  }
  const styleKeepExtra = [];
  const extras = Array.isArray(lock.extraKeep) ? lock.extraKeep : [];
  for (const e of extras) {
    const s = String(e || "").trim();
    if (s) styleKeepExtra.push(s);
  }
  const bits = [];
  for (const key of ["angle", "light", "mood", "framing"]) {
    const v = String(lock[key] ?? "").trim();
    if (v) bits.push(`${key}: ${v}`);
  }
  const styleParagraph = bits.length
    ? `Style lock: ${bits.join("; ")}.`
    : "";
  return { styleKeepExtra, styleParagraph };
}

function resolveLines(preset) {
  if (preset.lines && typeof preset.lines === "object" && Object.keys(preset.lines).length > 0) {
    return Object.keys(preset.lines);
  }
  return ["default"];
}

/**
 * Quotas per line: use line.quota if set; otherwise equal split of preset.size.
 * Remainder goes to the first lines in key order.
 */
function lineQuotas(preset, lineIds) {
  const size = preset.size;
  const explicit = lineIds.map((id) => preset.lines?.[id]?.quota);
  if (explicit.every((q) => typeof q === "number" && q >= 0)) {
    const sum = explicit.reduce((a, b) => a + b, 0);
    if (sum !== size) {
      throw new Error(`line quotas sum to ${sum}, size is ${size}`);
    }
    return Object.fromEntries(lineIds.map((id, i) => [id, explicit[i]]));
  }
  const n = lineIds.length;
  const base = Math.floor(size / n);
  let rem = size - base * n;
  const quotas = {};
  for (const id of lineIds) {
    quotas[id] = base + (rem > 0 ? 1 : 0);
    if (rem > 0) rem--;
  }
  return quotas;
}

function rollTraits(rng, items, line, wave = Infinity) {
  const traits = {};
  for (const t of items) {
    if (!traitActive(t, wave)) {
      traits[t.key] = NONE;
      continue;
    }
    const opts = optionsFor(t, line, wave);
    if (!opts.length) {
      traits[t.key] = NONE;
      continue;
    }
    traits[t.key] = rng.weighted(opts).value;
  }
  return traits;
}

function recipeSeed(presetSeed, index) {
  return hashSeed(`${presetSeed}:${index}`);
}

/**
 * Build unique recipes for the whole series.
 * @param {object} preset
 * @param {object} [overrides] — { items?: { [index]: { traits?, note? } } }
 */
export function buildRecipes(preset, overrides = {}) {
  const items = loadTraitsFromPreset(preset);
  if (!items.length) throw new Error("preset.traits.items is empty");
  const traitKeys = items.map((t) => t.key);
  const lineIds = resolveLines(preset);
  const quotas = lineQuotas(preset, lineIds);
  const rng = makeRng(preset.seed);
  const seen = new Set();
  const regular = [];

  for (const line of lineIds) {
    const need = quotas[line];
    let made = 0;
    let attempts = 0;
    while (made < need) {
      if (++attempts > MAX_ATTEMPTS) {
        throw new Error(
          `not enough unique combinations for line "${line}" (need ${need}, made ${made})`,
        );
      }
      const traits = rollTraits(rng, items, line);
      const key = dna(line, traits, traitKeys);
      if (seen.has(key)) continue;
      seen.add(key);
      regular.push({ line, traits });
      made++;
    }
  }

  const shuffled = rng.shuffle(regular);
  if (shuffled.length !== preset.size) {
    throw new Error(`built ${shuffled.length} recipes, size is ${preset.size}`);
  }

  return shuffled.map((it, index) => {
    const edit = overrides.items?.[index] ?? overrides.items?.[String(index)];
    const traits = edit?.traits ? { ...it.traits, ...edit.traits } : it.traits;
    const note = edit?.note ?? "";
    const key = dna(it.line, traits, traitKeys);
    return {
      index,
      edition: index + 1,
      line: it.line,
      traits,
      dna: key,
      prompt: buildPrompt(it.line, traits, preset, note),
      seed: recipeSeed(preset.seed, index),
      note,
      edited: Boolean(edit),
    };
  });
}

/**
 * Groups of edition numbers that share the same DNA. Empty if all unique.
 * @param {Array} recipes
 * @param {string[]} traitKeys
 */
export function duplicates(recipes, traitKeys) {
  const by = new Map();
  for (const r of recipes) {
    const k = dna(r.line, r.traits, traitKeys);
    by.set(k, [...(by.get(k) ?? []), r.edition]);
  }
  return [...by.values()].filter((v) => v.length > 1);
}
