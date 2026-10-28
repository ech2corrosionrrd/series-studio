/**
 * NFT quality checklist — pure checks (no I/O when inputs are passed in).
 */
import { archiveSync, describeSync } from "./archive-sync.mjs";
import { duplicates } from "./recipes.mjs";
import { loadTraitsFromPreset, NONE } from "./traits.mjs";
import { lintPrompts } from "./lint.mjs";

/**
 * @typedef {{ id: string, label: string, ok: boolean|null, detail: string, level?: 'ok'|'warn'|'fail' }} CheckItem
 */

function item(id, label, ok, detail, level) {
  const lv = level ?? (ok === true ? "ok" : ok === false ? "fail" : "warn");
  return { id, label, ok, detail: detail || "", level: lv };
}

/**
 * @param {object} ctx
 * @param {object} [ctx.preset]
 * @param {object} [ctx.archive]
 * @param {Record<string,string>} [ctx.marks]
 * @param {Array<{edition:number,file?:string}>} [ctx.images]
 * @param {boolean} [ctx.baseExists]
 */
export function runChecklist(ctx = {}) {
  const preset = ctx.preset || null;
  const archive = ctx.archive || null;
  const marks = ctx.marks && typeof ctx.marks === "object" ? ctx.marks : {};
  const images = Array.isArray(ctx.images) ? ctx.images : [];
  const baseExists = Boolean(ctx.baseExists);
  const items = [];

  if (!preset) {
    items.push(item("preset", "Preset loaded", false, "No preset"));
  } else {
    const missing = [];
    if (!preset.name) missing.push("name");
    if (!preset.id) missing.push("id");
    if (!preset.size) missing.push("size");
    if (!preset.seed) missing.push("seed");
    items.push(
      item(
        "preset",
        "Preset has name/id/size/seed",
        missing.length === 0,
        missing.length ? `Missing: ${missing.join(", ")}` : `${preset.id} · size ${preset.size}`,
      ),
    );
  }

  if (!archive) {
    items.push(item("archive", "Archive exists", false, "No archive"));
  } else {
    const n = archive.recipes?.length ?? 0;
    const size = archive.size ?? preset?.size;
    const match = size == null || n === size;
    items.push(
      item(
        "archive",
        "Archive exists matching size",
        match && n > 0,
        n === 0 ? "Empty recipes" : match ? `${n} recipes` : `recipes=${n} vs size=${size}`,
      ),
    );
  }

  if (preset && archive) {
    // Frames and metadata come from the archive; if the preset changed after the archive was built they no longer describe the same series.
    const sync = archiveSync(preset, archive);
    items.push(
      item(
        "sync",
        "Archive built from the current preset",
        sync.status === "match" ? true : null,
        describeSync(sync),
        sync.status === "match" ? "ok" : "warn",
      ),
    );
  }

  items.push(
    item(
      "base",
      "Primary base image present",
      baseExists,
      baseExists ? "input/primary (or mother) found" : "Upload a main base on stage 2",
    ),
  );

  const sl = preset?.styleLock;
  const hasLock =
    sl &&
    typeof sl === "object" &&
    Boolean(
      sl.angle ||
        sl.light ||
        sl.mood ||
        sl.framing ||
        (Array.isArray(sl.extraKeep) && sl.extraKeep.length),
    );
  items.push(
    item(
      "styleLock",
      "Style lock set",
      hasLock ? true : null,
      hasLock ? "Style lock present" : "Optional — set in Constructor for tighter frame consistency",
      hasLock ? "ok" : "warn",
    ),
  );

  if (archive?.recipes?.length && preset) {
    let traitKeys;
    try {
      traitKeys = loadTraitsFromPreset(preset).map((t) => t.key);
    } catch {
      traitKeys = Object.keys(archive.recipes[0]?.traits || {});
    }
    const dupes = duplicates(archive.recipes, traitKeys);
    items.push(
      item(
        "uniqueness",
        "Uniqueness (no DNA dupes)",
        dupes.length === 0,
        dupes.length === 0 ? "All DNA unique" : `${dupes.length} duplicate group(s)`,
      ),
    );
  } else {
    items.push(item("uniqueness", "Uniqueness (no DNA dupes)", null, "Need archive + preset", "warn"));
  }

  const keepEds = Object.entries(marks)
    .filter(([, v]) => v === "keep")
    .map(([k]) => Number(k))
    .filter((n) => Number.isFinite(n));
  const size = archive?.size ?? archive?.recipes?.length ?? preset?.size ?? 0;
  if (keepEds.length === 0) {
    items.push(
      item(
        "keeps",
        "Keep marks vs size",
        null,
        size ? `0 keep / ${size} size — mark keep in Review` : "No keep marks yet",
        "warn",
      ),
    );
  } else {
    const ratio = size ? keepEds.length / size : 1;
    const ok = ratio >= 0.5;
    items.push(
      item(
        "keeps",
        "Keep marks vs size",
        ok ? true : null,
        `${keepEds.length} keep / ${size || "?"} size`,
        ok ? "ok" : "warn",
      ),
    );
  }

  const imageEds = new Set(
    images.map((im) => Number(im.edition)).filter((n) => Number.isFinite(n) && n > 0),
  );
  if (keepEds.length) {
    const missing = keepEds.filter((e) => !imageEds.has(e));
    items.push(
      item(
        "images",
        "Images present for keep",
        missing.length === 0,
        missing.length === 0
          ? `${keepEds.length} keep images OK`
          : `Missing images for keep: ${missing.slice(0, 12).join(", ")}${missing.length > 12 ? "…" : ""}`,
      ),
    );
  } else {
    const n = imageEds.size;
    items.push(
      item(
        "images",
        "Images present",
        n > 0 ? true : null,
        n > 0 ? `${n} image file(s) in set` : "No images in set yet — generate on stage 5",
        n > 0 ? "ok" : "warn",
      ),
    );
  }

  const sample = (archive?.recipes || []).slice(0, 12).map((r) => r.prompt || "");
  if (!sample.length) {
    items.push(item("lint", "Lint clean on sample prompts", null, "No prompts to lint", "warn"));
  } else {
    const lint = lintPrompts(sample);
    items.push(
      item(
        "lint",
        "Lint clean on sample prompts",
        lint.ok,
        lint.ok
          ? `Clean (${sample.length} sampled)`
          : `Hits: ${(lint.hits || []).slice(0, 8).join(", ")}`,
      ),
    );
  }

  return items;
}

/** NFT attributes from traits (drop None, support OpenSea display_type). */
export function traitsToAttributes(traits, traitItems = []) {
  const itemMap = new Map((traitItems || []).map((t) => [t.key, t]));
  const out = [];
  for (const [key, value] of Object.entries(traits || {})) {
    if (value == null || value === "" || value === NONE) continue;
    const def = itemMap.get(key);
    const attr = { trait_type: def?.type || key, value: String(value) };
    if (def?.display_type) {
      attr.display_type = String(def.display_type);
      if (
        def.display_type === "number" ||
        def.display_type === "boost_number" ||
        def.display_type === "boost_percentage"
      ) {
        const n = Number(value);
        if (Number.isFinite(n)) attr.value = n;
      }
      if (def.max_value !== undefined) {
        const maxN = Number(def.max_value);
        if (Number.isFinite(maxN)) attr.max_value = maxN;
      }
    }
    out.push(attr);
  }
  return out;
}

