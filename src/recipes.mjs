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
import { lineIdsOf, quotasOf, supplyWaves } from "./waves.mjs";

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
  return lineIdsOf(preset);
}

/** Quotas per line: explicit quotas, or an equal split of preset.size. */
function lineQuotas(preset, lineIds) {
  return quotasOf(preset, lineIds);
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

function rollChunk(rng, items, lineIds, quotas, seen) {
  const traitKeys = items.map((t) => t.key);
  const regular = [];
  for (const line of lineIds) {
    const need = quotas[line] || 0;
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
  return rng.shuffle(regular);
}

/**
 * Build unique recipes for the whole series.
 * With preset.waves, each wave is rolled from its own seed and numbered
 * after the previous waves. Without waves, one roll from preset.seed.
 * @param {object} preset
 * @param {object} [overrides] — { items?: { [index]: { traits?, note? } } }
 */
export function buildRecipes(preset, overrides = {}) {
  const items = loadTraitsFromPreset(preset);
  if (!items.length) throw new Error("preset.traits.items is empty");
  const traitKeys = items.map((t) => t.key);
  const lineIds = resolveLines(preset);
  const supply = supplyWaves(preset);
  const seen = new Set();
  const chunks = supply
    ? supply.map((wave) => ({
        seed: wave.seed,
        wave: wave.n,
        items: rollChunk(makeRng(wave.seed), items, lineIds, wave.lines, seen),
      }))
    : [{
        seed: preset.seed,
        wave: null,
        items: rollChunk(makeRng(preset.seed), items, lineIds, lineQuotas(preset, lineIds), seen),
      }];

  const out = [];
  let index = 0;
  for (const chunk of chunks) {
    for (const it of chunk.items) {
      const edit = overrides.items?.[index] ?? overrides.items?.[String(index)];
      const traits = edit?.traits ? { ...it.traits, ...edit.traits } : it.traits;
      const note = edit?.note ?? "";
      const row = {
        index,
        edition: index + 1,
        line: it.line,
        traits,
        dna: dna(it.line, traits, traitKeys),
        prompt: buildPrompt(it.line, traits, preset, note),
        seed: recipeSeed(chunk.seed, index),
        note,
        edited: Boolean(edit),
      };
      if (chunk.wave != null) row.wave = chunk.wave;
      out.push(row);
      index++;
    }
  }
  if (out.length !== preset.size) {
    throw new Error(`built ${out.length} recipes, size is ${preset.size}`);
  }
  return out;
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

/** Groups of editions that already share the stored DNA string. */
export function duplicateGroups(recipes) {
  const by = new Map();
  for (const r of recipes || []) {
    if (!r?.dna) continue;
    by.set(r.dna, [...(by.get(r.dna) ?? []), r.edition]);
  }
  return [...by.values()].filter((v) => v.length > 1);
}

/** Prompt and DNA changes between two archives, matched by edition number. */
export function diffArchives(a, b) {
  const mapA = new Map((a?.recipes || []).map((r) => [r.edition, r]));
  const mapB = new Map((b?.recipes || []).map((r) => [r.edition, r]));
  const editions = [...new Set([...mapA.keys(), ...mapB.keys()])].sort((x, y) => x - y);
  const changed = [];
  const onlyA = [];
  const onlyB = [];
  let same = 0;
  for (const edition of editions) {
    const ra = mapA.get(edition);
    const rb = mapB.get(edition);
    if (!ra) { onlyB.push(edition); continue; }
    if (!rb) { onlyA.push(edition); continue; }
    if (ra.dna === rb.dna && ra.prompt === rb.prompt) { same += 1; continue; }
    changed.push({
      edition,
      dnaA: ra.dna,
      dnaB: rb.dna,
      promptA: ra.prompt,
      promptB: rb.prompt,
    });
  }
  return { same, changed, onlyA, onlyB };
}

/** Same traits and prompt structure, new id and seed. Waves and point edits start clean. */
export function spinoffPreset(preset, { suffix } = {}) {
  const stamp = suffix || new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const next = structuredClone(preset);
  next.id = `${preset.id}-spin-${stamp}`.replace(/[^a-z0-9-]+/gi, "-").replace(/-+/g, "-").slice(0, 80);
  next.name = `${preset.name || preset.id} spin`;
  next.seed = `${preset.seed}-spin-${stamp}`;
  next.waves = null;
  delete next.overrides;
  return next;
}
