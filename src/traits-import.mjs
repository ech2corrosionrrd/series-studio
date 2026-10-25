/**
 * Trait tables from things the author already has: a folder of layer PNGs (`<trait>/<value>.png`) and a CSV sheet.
 *
 * Layers: every first-level folder is a trait, every PNG in it an option. A file name may carry a weight after
 * `#` (`Cap#20.png` = value "Cap", weight 20); then the option keeps the real path in `layer`, so no file is renamed.
 * CSV: one row per option, columns `trait,value,weight,prompt,exact,layer` (`,` `;` or tab, UTF-8, quotes allowed).
 *
 * Both are merged into the table that is already in the editor: nothing is removed, and without `overwrite`
 * what the author typed (weights, prompts) is kept.
 */

export const DEFAULT_WEIGHT = 10;
export const CSV_LIMITS = Object.freeze({ chars: 1_000_000, rows: 5000 });
export const CSV_COLUMNS = Object.freeze(["trait", "value", "weight", "prompt", "exact", "layer"]);

const WEIGHT_SUFFIX = /#(\d+(?:[.,]\d+)?)$/;

/** `Cap#20.png` → { value: "Cap", weight: 20 }; no suffix (or a non-positive one) → weight null. */
export function parseLayerName(fileName) {
  const base = String(fileName ?? "").replace(/\.png$/i, "").trim();
  const m = WEIGHT_SUFFIX.exec(base);
  if (!m) return { value: base, weight: null };
  const weight = Number(m[1].replace(",", "."));
  return { value: base.slice(0, m.index).trim(), weight: weight > 0 ? weight : null };
}

const cap = (key) => (key ? key[0].toUpperCase() + key.slice(1) : key);

/**
 * @param {string[]} relPaths paths inside the layers folder, `/`-separated
 * @returns {{ items: object[], skipped: { path: string, reason: string }[] }}
 */
export function traitsFromLayerFiles(relPaths) {
  const by = new Map();
  const skipped = [];
  for (const rel of relPaths || []) {
    const parts = String(rel).replaceAll("\\", "/").split("/").filter(Boolean);
    if (parts.length < 2 || parts.length > 3) {
      skipped.push({ path: rel, reason: "depth" });
      continue;
    }
    if (!/\.png$/i.test(parts.at(-1))) {
      skipped.push({ path: rel, reason: "not_png" });
      continue;
    }
    const key = parts[0];
    const { value, weight } = parseLayerName(parts.at(-1));
    if (!value) {
      skipped.push({ path: rel, reason: "empty_name" });
      continue;
    }
    const options = by.get(key) || new Map();
    if (options.has(value.toLowerCase())) {
      skipped.push({ path: rel, reason: "duplicate" });
      continue;
    }
    const option = { value, weight: weight ?? DEFAULT_WEIGHT, prompt: "" };
    if (parts.join("/") !== `${key}/${value}.png`) option.layer = parts.join("/");
    options.set(value.toLowerCase(), option);
    by.set(key, options);
  }
  const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
  const items = [...by.keys()]
    .sort(collator.compare)
    .map((key) => ({ key, type: cap(key), options: [...by.get(key).values()].sort((a, b) => collator.compare(a.value, b.value)) }));
  return { items, skipped };
}

/**
 * Adds `incoming` traits and options to `existing` (a copy; `existing` is not changed). With `overwrite` the fields
 * the incoming option carries replace the old ones; without it only a missing `layer` is filled in.
 * @returns {{ items: object[], stats: { traitsAdded: number, optionsAdded: number, optionsUpdated: number } }}
 */
export function mergeTraitItems(existing, incoming, { overwrite = false } = {}) {
  const items = JSON.parse(JSON.stringify(Array.isArray(existing) ? existing : []));
  const stats = { traitsAdded: 0, optionsAdded: 0, optionsUpdated: 0 };
  for (const inc of incoming || []) {
    let trait = items.find((t) => t.key === inc.key);
    if (!trait) {
      trait = { key: inc.key, type: inc.type || cap(inc.key), options: [] };
      items.push(trait);
      stats.traitsAdded += 1;
    }
    if (!Array.isArray(trait.options)) trait.options = [];
    for (const o of inc.options || []) {
      const old = trait.options.find((x) => String(x.value) === String(o.value));
      if (!old) {
        trait.options.push({ weight: DEFAULT_WEIGHT, prompt: "", ...o });
        stats.optionsAdded += 1;
        continue;
      }
      let changed = false;
      for (const field of ["weight", "prompt", "exact", "layer"]) {
        if (o[field] === undefined || o[field] === null || o[field] === "") continue;
        const take = overwrite || (field === "layer" && !old.layer);
        if (take && old[field] !== o[field]) {
          old[field] = o[field];
          changed = true;
        }
      }
      if (changed) stats.optionsUpdated += 1;
    }
  }
  return { items, stats };
}

/* ---------- CSV ---------- */

// Spreadsheets run a cell that starts with = + @ as a formula; the export marks such a cell with a leading quote.
const FORMULA_START = /^[=+@\t\r]/;

function csvCell(value) {
  let s = value === undefined || value === null ? "" : String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) || s !== s.trim() ? `"${s.replaceAll('"', '""')}"` : s;
}

/** One row per option. UTF-8 with a BOM so a spreadsheet reads Cyrillic correctly. */
export function traitsToCsv(items) {
  const rows = [CSV_COLUMNS.join(",")];
  for (const t of items || []) {
    for (const o of t.options || []) {
      rows.push([t.key, o.value, o.weight, o.prompt, o.exact, o.layer].map(csvCell).join(","));
    }
  }
  return `﻿${rows.join("\r\n")}\r\n`;
}

function detectDelimiter(firstLine) {
  const outside = firstLine.replace(/"[^"]*"/g, "");
  const count = (ch) => outside.split(ch).length - 1;
  const best = [",", ";", "\t"].map((d) => [d, count(d)]).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ",";
}

function parseCsvRows(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (quoted) throw new Error("csv: a quoted cell is not closed");
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const unformula = (s) => (/^'[=+@\t\r]/.test(s) ? s.slice(1) : s);

/**
 * @returns {{ items: object[], errors: { row: number, message: string }[] }} strict: the caller refuses the file when
 *   `errors` is not empty, so a half-read sheet never reaches the editor
 */
export function traitsFromCsv(text) {
  const src = String(text ?? "").replace(/^﻿/, "");
  if (src.length > CSV_LIMITS.chars) return { items: [], errors: [{ row: 0, message: `file is larger than ${CSV_LIMITS.chars} characters` }] };
  const first = src.split(/\r\n|\n|\r/, 1)[0];
  let rows;
  try {
    rows = parseCsvRows(src, detectDelimiter(first));
  } catch (e) {
    return { items: [], errors: [{ row: 0, message: String(e.message || e) }] };
  }
  if (!rows.length) return { items: [], errors: [{ row: 0, message: "the file is empty" }] };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = Object.fromEntries(CSV_COLUMNS.map((c) => [c, header.indexOf(c)]));
  if (col.trait < 0 || col.value < 0) return { items: [], errors: [{ row: 1, message: "the first row must name the columns, at least: trait, value" }] };
  if (rows.length - 1 > CSV_LIMITS.rows) return { items: [], errors: [{ row: 0, message: `more than ${CSV_LIMITS.rows} rows` }] };

  const errors = [];
  const by = new Map();
  rows.slice(1).forEach((cells, i) => {
    const n = i + 2;
    if (cells.every((c) => c.trim() === "")) return;
    const get = (name) => (col[name] >= 0 ? unformula(String(cells[col[name]] ?? "")).trim() : "");
    const key = get("trait");
    const value = get("value");
    if (!key || !value) {
      errors.push({ row: n, message: "trait and value must not be empty" });
      return;
    }
    const option = { value };
    const weight = get("weight");
    if (weight !== "") {
      const w = Number(weight.replace(",", "."));
      if (!(w > 0) || !Number.isFinite(w)) errors.push({ row: n, message: `weight must be a number above 0, got "${weight}"` });
      else option.weight = w;
    }
    const exact = get("exact");
    if (exact !== "") {
      const e = Number(exact);
      if (!Number.isInteger(e) || e < 1) errors.push({ row: n, message: `exact must be a whole number from 1, got "${exact}"` });
      else option.exact = e;
    }
    const prompt = get("prompt");
    if (prompt !== "") option.prompt = prompt;
    const layer = get("layer").replaceAll("\\", "/");
    if (layer !== "") {
      if (layer.startsWith("/") || /^[a-z]:/i.test(layer) || layer.split("/").includes("..")) errors.push({ row: n, message: `layer must be a relative path inside the layers folder, got "${layer}"` });
      else option.layer = layer;
    }
    const options = by.get(key) || [];
    if (options.some((o) => o.value.toLowerCase() === value.toLowerCase())) {
      errors.push({ row: n, message: `${key}/${value} is listed twice` });
      return;
    }
    options.push(option);
    by.set(key, options);
  });
  const items = [...by].map(([key, options]) => ({ key, type: cap(key), options }));
  return { items, errors };
}
