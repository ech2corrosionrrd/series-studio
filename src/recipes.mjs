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
import { collectConflicts, checkConflicts } from "./rules.mjs";
import { computeRarity } from "./rarity.mjs";

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

/** Trait keys that enter DNA. skipDna is the bypass flag, default off. */
export function dnaKeysFromItems(items) {
  return (items || []).filter((t) => t && t.skipDna !== true).map((t) => t.key);
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

  // A critical trait (layerOnly) is painted from a PNG layer, so the model is not asked to draw it.
  const layerOnly = new Set(items.filter((t) => t.layerOnly === true).map((t) => t.key));

  const changeBits = changeKeys.filter((key) => !layerOnly.has(key)).map((key) => {
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
    .filter((k) => !layerOnly.has(k) && traits[k] && traits[k] !== NONE)
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
  // The UI field is "one phrase per line", so a plain string (API, hand-edited preset) is split the same way.
  const extras = Array.isArray(lock.extraKeep)
    ? lock.extraKeep
    : typeof lock.extraKeep === "string"
      ? lock.extraKeep.split(/\r?\n/)
      : [];
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

function rollChunk(rng, items, lineIds, quotas, seen, conflictState = null, exactState = null) {
  const traitKeys = dnaKeysFromItems(items);
  const regular = [];
  for (const line of lineIds) {
    const need = quotas[line] || 0;
    let made = 0;
    let attempts = 0;
    while (made < need) {
      if (++attempts > MAX_ATTEMPTS) {
        if (exactState) {
          throw new Error(`exact count cannot be met with unique DNA: ${exactState.names}`);
        }
        const extra = conflictState?.count
          ? `; rejected ${conflictState.count} conflict attempts`
          : "";
        throw new Error(
          `not enough unique combinations for line "${line}" (need ${need}, made ${made})${extra}`,
        );
      }
      let traits = rollTraits(rng, items, line);
      if (exactState) {
        traits = { ...traits };
        for (const [key, bag] of Object.entries(exactState.decks)) {
          traits[key] = bag[exactState.cursor];
        }
      }
      if (conflictState?.rules?.length) {
        const hit = checkConflicts(traits, conflictState.rules);
        if (!hit.ok) {
          conflictState.count += 1;
          if (conflictState.examples.length < 6 && hit.hits[0]) {
            conflictState.examples.push(hit.hits[0]);
          }
          continue;
        }
      }
      const key = dna(line, traits, traitKeys);
      if (seen.has(key)) continue;
      seen.add(key);
      if (exactState) exactState.cursor += 1;
      regular.push({ line, traits });
      made++;
    }
  }
  return rng.shuffle(regular);
}

function exactPlans(items) {
  const plans = [];
  for (const t of items) {
    const opts = Array.isArray(t.options) ? t.options : [];
    const exacts = [];
    for (const o of opts) {
      if (o.exact == null || o.exact === "") continue;
      const n = Number(o.exact);
      if (!Number.isInteger(n) || n < 0) {
        throw new Error(`exact count for ${t.key}=${o.value} must be a non-negative integer`);
      }
      exacts.push({ value: String(o.value), n });
    }
    if (!exacts.length) continue;
    plans.push({
      key: t.key,
      exacts,
      sum: exacts.reduce((s, e) => s + e.n, 0),
      names: exacts.map((e) => `${t.key}=${e.value}`).join(", "),
      flex: opts
        .filter((o) => o.exact == null || o.exact === "")
        .map((o) => ({ value: String(o.value), weight: Number(o.weight) || 0 }))
        .filter((o) => o.value && o.weight > 0),
    });
  }
  return plans;
}

/** Deck of exact-N values for the whole supply. Null when no option has exact. */
function buildExactDecks(items, size, seed) {
  const plans = exactPlans(items);
  if (!plans.length) return null;
  const rng = makeRng(`${seed}:exact`);
  const decks = {};
  const names = [];
  for (const plan of plans) {
    if (plan.sum > size) {
      throw new Error(`exact counts exceed supply for trait "${plan.key}" (${plan.sum} > ${size}): ${plan.names}`);
    }
    if (plan.sum < size && !plan.flex.length) {
      throw new Error(`exact counts for trait "${plan.key}" leave empty slots: ${plan.names}`);
    }
    const bag = [];
    for (const entry of plan.exacts) {
      for (let i = 0; i < entry.n; i++) bag.push(entry.value);
    }
    while (bag.length < size) bag.push(String(rng.weighted(plan.flex).value));
    decks[plan.key] = rng.shuffle(bag);
    names.push(plan.names);
  }
  return { decks, cursor: 0, names: names.join(", ") };
}

/**
 * Build unique recipes for the whole series.
 * With preset.waves, each wave is rolled from its own seed and numbered
 * after the previous waves. Without waves, one roll from preset.seed.
 * @param {object} preset
 * @param {object} [overrides] — { items?: { [index]: { traits?, note? } } }
 */
function assembleRecipes(preset, overrides = {}, { rejectConflicts = false, pack = null } = {}) {
  const items = loadTraitsFromPreset(preset);
  if (!items.length) throw new Error("preset.traits.items is empty");
  const traitKeys = dnaKeysFromItems(items);
  const lineIds = resolveLines(preset);
  const supply = supplyWaves(preset);
  const seen = new Set();
  const conflictState = rejectConflicts
    ? { rules: collectConflicts(preset, pack), count: 0, examples: [] }
    : null;
  const exactState = buildExactDecks(items, preset.size, preset.seed);
  const chunks = supply
    ? supply.map((wave) => ({
        seed: wave.seed,
        wave: wave.n,
        items: rollChunk(makeRng(wave.seed), items, lineIds, wave.lines, seen, conflictState, exactState),
      }))
    : [{
        seed: preset.seed,
        wave: null,
        items: rollChunk(makeRng(preset.seed), items, lineIds, lineQuotas(preset, lineIds), seen, conflictState, exactState),
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
  return {
    recipes: out,
    rejectedConflicts: conflictState?.count || 0,
    conflictExamples: conflictState?.examples || [],
  };
}

/**
 * Build unique recipes for the whole series.
 * With preset.waves, each wave is rolled from its own seed and numbered
 * after the previous waves. Without waves, one roll from preset.seed.
 * @param {object} preset
 * @param {object} [overrides] — { items?: { [index]: { traits?, note? } } }
 */
export function buildRecipes(preset, overrides = {}) {
  return assembleRecipes(preset, overrides, { rejectConflicts: false }).recipes;
}

/**
 * Dry rarity run. Same builder and computeRarity. Conflict pairs are rejected
 * attempts, not a post-build error. Does not call an image engine.
 */
export function drySimulate(preset, pack = null) {
  const assembled = assembleRecipes(preset, {}, { rejectConflicts: true, pack });
  return {
    size: assembled.recipes.length,
    rejectedConflicts: assembled.rejectedConflicts,
    conflictExamples: assembled.conflictExamples,
    rarity: computeRarity(preset, assembled.recipes),
    engine: null,
  };
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

/**
 * The same character in two different collections: editions of `a` and `b` whose trait values are identical.
 * `diffArchives` compares one series with its own rebuild by edition number; this one ignores numbers and lines and
 * looks at the traits, so a sequel that re-rolled an old look is found. A trait that is None (or missing) counts as
 * absent, so two collections with different trait lists still compare on what they share.
 * @returns {{ countA: number, countB: number, shared: number, collisions: { traits: Record<string, string>, editionsA: number[], editionsB: number[] }[] }}
 */
export function collideArchives(a, b) {
  const fingerprint = (r) =>
    JSON.stringify(
      Object.entries(r?.traits || {})
        .filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== NONE)
        .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)),
    );
  const index = (archive) => {
    const map = new Map();
    for (const r of archive?.recipes || []) {
      const key = fingerprint(r);
      const row = map.get(key) || { traits: Object.fromEntries(JSON.parse(key)), editions: [] };
      row.editions.push(r.edition);
      map.set(key, row);
    }
    return map;
  };
  const left = index(a);
  const right = index(b);
  const collisions = [];
  for (const [key, l] of left) {
    const r = right.get(key);
    if (!r) continue;
    collisions.push({ traits: l.traits, editionsA: l.editions.sort((x, y) => x - y), editionsB: r.editions.sort((x, y) => x - y) });
  }
  collisions.sort((x, y) => x.editionsA[0] - y.editionsA[0]);
  const shared = collisions.reduce((n, c) => n + c.editionsA.length, 0);
  return { countA: (a?.recipes || []).length, countB: (b?.recipes || []).length, shared, collisions };
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
