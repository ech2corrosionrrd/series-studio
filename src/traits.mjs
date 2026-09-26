/**
 * Trait dictionary helpers. Traits come from JSON preset (preset.traits.items),
 * not a hardcoded collection lore array.
 */

export const NONE = "None";

/**
 * Options available for a trait on a given line (and optional wave).
 * `wave` defaults to Infinity so all options are included when waves are unused.
 */
export function optionsFor(trait, line, wave = Infinity) {
  return trait.options.filter(
    (o) => (!o.lines || o.lines.includes(line)) && (o.since ?? 1) <= wave,
  );
}

/** Whether the generator rolls this trait in wave `wave` (else force None). */
export function traitActive(trait, wave = Infinity) {
  return (trait.since ?? 1) <= wave;
}

/**
 * Look up an option by trait key and value from a traits.items array.
 * @param {Array} traitsItems
 * @param {string} key
 * @param {string} value
 */
export function option(traitsItems, key, value) {
  const trait = traitsItems.find((t) => t.key === key);
  if (!trait) throw new Error(`unknown trait key: ${key}`);
  const found = trait.options.find((o) => o.value === value);
  if (!found) throw new Error(`unknown ${key}: ${value}`);
  return found;
}

/**
 * Load and normalize trait items from a preset object.
 * Returns a shallow-copied items array (or empty).
 */
export function loadTraitsFromPreset(preset) {
  const items = preset?.traits?.items;
  if (!Array.isArray(items)) {
    throw new Error("preset.traits.items must be an array");
  }
  return items.map((t) => ({
    ...t,
    options: (t.options ?? []).map((o) => ({ ...o })),
  }));
}

/**
 * Normalize a single option object for the series snapshot editor.
 * Hard-requires non-empty value and weight > 0 when validating;
 * this helper coerces types and trims strings.
 * @param {unknown} raw
 * @returns {{ value: string, weight: number, prompt: string, lines?: string[], since?: number }}
 */
export function normalizeOption(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  const value = String(o.value ?? "").trim();
  let weight = Number(o.weight);
  if (!Number.isFinite(weight)) weight = 1;
  const prompt = String(o.prompt ?? "");
  const out = { value, weight, prompt };
  if (o.exact != null && o.exact !== "") {
    const exact = Number(o.exact);
    if (Number.isFinite(exact)) out.exact = exact;
  }
  if (Array.isArray(o.lines) && o.lines.length) {
    out.lines = o.lines.map((x) => String(x));
  }
  if (typeof o.since === "number" && o.since >= 1) {
    out.since = o.since;
  }
  return out;
}

/**
 * Normalize a list of options (shallow map via normalizeOption).
 * @param {unknown} list
 * @returns {Array<{ value: string, weight: number, prompt: string }>}
 */
/**
 * Share of one weight inside a trait, as a percent of the option weights.
 * @param {number} weight
 * @param {Array<{ weight?: number }>} options
 */
export function weightPercent(weight, options) {
  const sum = (Array.isArray(options) ? options : []).reduce((s, o) => s + (Number(o?.weight) || 0), 0);
  const w = Number(weight) || 0;
  if (!(sum > 0)) return 0;
  return (w / sum) * 100;
}

export function normalizeOptions(list) {
  if (!Array.isArray(list)) return [];
  return list.map((o) => normalizeOption(o));
}

/**
 * Validate options for one trait key (UI + pure helper).
 * Hard errors: missing/empty value, weight <= 0 / not a number, duplicate values.
 * Warnings: empty prompt (recommended).
 * @param {unknown} list
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
export function validateOptions(list) {
  const errors = [];
  const warnings = [];
  const options = Array.isArray(list) ? list : [];
  if (!options.length) {
    errors.push("no options");
    return { ok: false, errors, warnings };
  }
  const seen = new Map();
  options.forEach((raw, i) => {
    const o = normalizeOption(raw);
    const label = `option[${i}]`;
    if (!o.value) errors.push(`${label}: value required`);
    if (!Number.isFinite(o.weight) || o.weight <= 0) {
      errors.push(`${label}: weight must be > 0`);
    }
    if (!String(o.prompt ?? "").trim()) {
      warnings.push(`${label}: empty prompt (recommended)`);
    }
    if (raw.exact != null && raw.exact !== "") {
      const exact = Number(raw.exact);
      if (!Number.isInteger(exact) || exact < 0) {
        errors.push(`${label}: exact must be a non-negative integer`);
      }
    }
    if (o.value) {
      const prev = seen.get(o.value);
      if (prev !== undefined) {
        errors.push(`duplicate value "${o.value}" at ${label} and option[${prev}]`);
      } else {
        seen.set(o.value, i);
      }
    }
  });
  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Duplicate an option with a unique value suffix.
 * @param {object} opt
 * @param {string[]} existingValues
 */
export function duplicateOption(opt, existingValues = []) {
  const base = normalizeOption(opt);
  const taken = new Set((existingValues || []).map((v) => String(v)));
  let value = base.value ? `${base.value} copy` : "option copy";
  let n = 2;
  while (taken.has(value)) {
    value = `${base.value || "option"} copy ${n}`;
    n += 1;
  }
  return { ...base, value };
}

/**
 * Validate a trait pack object.
 * @param {object} pack
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateTraitPack(pack) {
  const errors = [];
  if (!pack || typeof pack !== "object") {
    return { ok: false, errors: ["pack must be an object"] };
  }
  const id = String(pack.id || "").trim();
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    errors.push("pack.id must be alphanumeric with hyphens/underscores");
  }
  if (!pack.name || !String(pack.name).trim()) {
    errors.push("pack.name is required");
  }
  if (!Array.isArray(pack.items) || pack.items.length === 0) {
    errors.push("pack.items must be a non-empty array");
  } else {
    const keySet = new Set();
    pack.items.forEach((item, i) => {
      if (!item.key || !String(item.key).trim()) {
        errors.push(`item[${i}]: key is required`);
      } else {
        if (keySet.has(item.key)) {
          errors.push(`duplicate trait key "${item.key}"`);
        }
        keySet.add(item.key);
      }
      const optRes = validateOptions(item.options);
      if (!optRes.ok) {
        errors.push(...optRes.errors.map((e) => `item[${item.key || i}]: ${e}`));
      }
    });
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Export a preset's current traits and prompt keys as a reusable trait pack.
 * @param {object} preset
 * @param {object} [meta]
 * @returns {object}
 */
export function exportPresetAsTraitPack(preset, meta = {}) {
  const items = loadTraitsFromPreset(preset);
  const id = String(meta.id || preset.id || "custom-pack").replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
  const name = String(meta.name || preset.name || id);
  const description = String(meta.description || `Trait pack exported from preset ${preset.name || preset.id || id}`);
  const tags = Array.isArray(meta.tags) ? meta.tags : ["custom", "series-export"];
  const defaults = {
    changeKeys: Array.isArray(preset.promptTemplate?.changeKeys)
      ? [...preset.promptTemplate.changeKeys]
      : items.map((t) => t.key),
    extraKeys: Array.isArray(preset.promptTemplate?.extraKeys)
      ? [...preset.promptTemplate.extraKeys]
      : [],
  };
  const rules = {
    conflicts: Array.isArray(preset.rules?.conflicts)
      ? [...preset.rules.conflicts]
      : [],
  };
  return {
    schema: "series-trait-pack/v0",
    id,
    name,
    description,
    tags,
    items,
    defaults,
    rules,
  };
}

