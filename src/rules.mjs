/**
 * Trait conflict rules: optional rules.conflicts on pack or preset.
 * Pair form: { a: "key:value", b: "key:value", note? }
 */

/**
 * Parse "key:value" — value may contain colons.
 * @param {string} s
 * @returns {{ key: string, value: string } | null}
 */
export function parseTraitRef(s) {
  const raw = String(s ?? "").trim();
  const i = raw.indexOf(":");
  if (i <= 0) return null;
  const key = raw.slice(0, i).trim();
  const value = raw.slice(i + 1).trim();
  if (!key || !value) return null;
  return { key, value };
}

/**
 * Collect conflicts from pack and/or preset (preset wins merge by concat).
 * @param {object} [preset]
 * @param {object} [pack]
 */
export function collectConflicts(preset, pack) {
  const out = [];
  const seen = new Set();
  for (const src of [pack, preset]) {
    const list = src?.rules?.conflicts;
    if (!Array.isArray(list)) continue;
    for (const c of list) {
      if (!c || typeof c !== "object") continue;
      const a = String(c.a || "").trim();
      const b = String(c.b || "").trim();
      if (!a || !b) continue;
      const key = `${a.toLowerCase()}||${b.toLowerCase()}`;
      const keyRev = `${b.toLowerCase()}||${a.toLowerCase()}`;
      if (seen.has(key) || seen.has(keyRev)) continue;
      seen.add(key);
      out.push({ a, b, note: typeof c.note === "string" ? c.note : "" });
    }
  }
  return out;
}

/**
 * Check whether traits violate any conflict pairs.
 * @param {Record<string,string>} traits
 * @param {Array<{a:string,b:string,note?:string}>} conflicts
 * @returns {{ ok: boolean, hits: Array<{ a: string, b: string, note: string }> }}
 */
export function checkConflicts(traits, conflicts) {
  const t = traits && typeof traits === "object" ? traits : {};
  const hits = [];
  for (const c of conflicts || []) {
    const pa = parseTraitRef(c.a);
    const pb = parseTraitRef(c.b);
    if (!pa || !pb) continue;
    if (String(t[pa.key] ?? "") === pa.value && String(t[pb.key] ?? "") === pb.value) {
      hits.push({ a: c.a, b: c.b, note: c.note || "" });
    }
  }
  return { ok: hits.length === 0, hits };
}

/**
 * Human-readable message for API / UI.
 */
export function conflictMessage(hits) {
  if (!hits?.length) return "";
  return hits
    .map((h) => {
      const note = h.note ? ` (${h.note})` : "";
      return `${h.a} ↔ ${h.b}${note}`;
    })
    .join("; ");
}
