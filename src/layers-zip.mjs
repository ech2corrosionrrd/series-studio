/**
 * Layer PNGs from a ZIP: the hosted studio has no file system for the user, so the layers that
 * "Compose layers" stacks (`<layers>/<trait key>/<value>.png`) come in as one ZIP.
 *
 * The ZIP is untrusted input. Nothing is written into the layers folder until every entry has
 * passed: unsafe paths reject the whole upload (zip-slip), size/count limits bound memory and
 * disk (the container has 512 MB), every file must be a real PNG with sane dimensions. Files are
 * staged next to the layers folder and moved in at the end, so a failed upload leaves nothing.
 */
import JSZip from "jszip";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { layerFileFor } from "./layers.mjs";
import { NONE } from "./traits.mjs";

export const LAYER_LIMITS = Object.freeze({
  zipBytes: 40 * 1024 * 1024, // the uploaded ZIP
  entries: 1500,
  fileBytes: 8 * 1024 * 1024, // one PNG, unpacked
  totalBytes: 120 * 1024 * 1024, // all PNGs of one upload, unpacked
  dirBytes: 200 * 1024 * 1024, // the whole layers folder after the merge
  maxSide: 8192,
  maxPixels: 40_000_000,
  maxDepth: 3, // <key>/<value>.png or <key>/<sub>/<value>.png
  maxName: 120,
});

export class LayersZipError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LayersZipError";
    this.code = code;
    this.status = code === "zip_too_large" ? 413 : 400;
  }
}

const JUNK = /^(thumbs\.db|desktop\.ini|\.ds_store)$/i;
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[\x00-\x1f:*?"<>|]/;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/**
 * @returns {{ skip: string } | { rel: string }} skip = ignored harmlessly (folder, junk, not a PNG);
 * unsafe paths throw.
 */
export function normalizeEntryPath(name, limits = LAYER_LIMITS) {
  let p = String(name ?? "").replaceAll("\\", "/").normalize("NFC");
  while (p.startsWith("./")) p = p.slice(2);
  if (!p) return { skip: "empty" };
  if (p.endsWith("/")) return { skip: "folder" };
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p)) throw new LayersZipError("unsafe_path", `absolute path in ZIP: "${name}"`);
  const segs = p.split("/");
  if (segs.some((s) => s === "..")) throw new LayersZipError("unsafe_path", `".." in ZIP path: "${name}"`);
  if (segs[0] === "__MACOSX" || segs.some((s) => JUNK.test(s) || (s.startsWith(".") && s !== "."))) return { skip: "junk" };
  if (segs.some((s) => s === "." || s === "")) throw new LayersZipError("unsafe_path", `bad segment in ZIP path: "${name}"`);
  for (const s of segs) {
    if (BAD_CHARS.test(s)) throw new LayersZipError("unsafe_path", `forbidden character in ZIP path: "${name}"`);
    if (RESERVED.test(s) || /[. ]$/.test(s)) throw new LayersZipError("unsafe_path", `reserved name in ZIP path: "${name}"`);
    if (s.length > limits.maxName) throw new LayersZipError("name_too_long", `name longer than ${limits.maxName}: "${name}"`);
  }
  if (!/\.png$/i.test(segs[segs.length - 1])) return { skip: "not_png" };
  if (segs.length < 2) return { skip: "no_folder" };
  if (segs.length > limits.maxDepth + 1) return { skip: "too_deep" };
  segs[segs.length - 1] = segs[segs.length - 1].replace(/\.png$/i, ".png");
  return { rel: segs.join("/") };
}

/** PNG signature + IHDR sanity (no pixel decoding here). Returns {width,height} or throws. */
export function checkPngHeader(buf, label, limits = LAYER_LIMITS) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 33 || !buf.subarray(0, 8).equals(sig) || buf.subarray(12, 16).toString("latin1") !== "IHDR") {
    throw new LayersZipError("not_png", `${label}: not a PNG file`);
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (!width || !height || width > limits.maxSide || height > limits.maxSide || width * height > limits.maxPixels) {
    throw new LayersZipError("png_dimensions", `${label}: ${width}x${height} is outside the allowed size (max ${limits.maxSide}px side, ${limits.maxPixels / 1e6} MP)`);
  }
  return { width, height };
}

function walk(dir, base = dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith(".")) continue;
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) walk(abs, base, out);
    else if (ent.isFile()) out.push({ rel: abs.slice(base.length + 1).replaceAll("\\", "/"), bytes: statSync(abs).size });
  }
  return out;
}

/** Absolute paths of every layer file (for moving them to the trash). */
export function listLayerFiles(layerDir) {
  return walk(layerDir).map((f) => join(layerDir, f.rel));
}

export function dirBytes(dir) {
  return walk(dir).reduce((s, f) => s + f.bytes, 0);
}

function keysOf(files) {
  const by = new Map();
  for (const f of files) {
    const key = f.rel.split("/")[0];
    by.set(key, (by.get(key) || 0) + 1);
  }
  return [...by].map(([key, count]) => ({ key, count })).sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Validate and import a ZIP of layer PNGs into `layerDir`.
 * `clear` empties the folder first (after the upload passed every check; `onClear` runs just before,
 * e.g. to move the old files to the trash); otherwise files merge (same names are replaced).
 */
export async function importLayersZip(buffer, layerDir, { clear = false, limits = LAYER_LIMITS, onClear = null } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new LayersZipError("empty", "upload is empty");
  if (buffer.length > limits.zipBytes) throw new LayersZipError("zip_too_large", `ZIP is larger than ${Math.round(limits.zipBytes / 1048576)} MB`);
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new LayersZipError("bad_zip", "not a valid ZIP file");
  }
  const entries = Object.values(zip.files);
  if (entries.length > limits.entries) throw new LayersZipError("too_many_files", `ZIP has more than ${limits.entries} entries`);

  const skipped = [];
  const accepted = [];
  for (const e of entries) {
    if (e.dir) continue;
    const r = normalizeEntryPath(e.name, limits);
    if (r.skip) {
      if (r.skip !== "folder" && r.skip !== "empty") skipped.push({ name: e.name, reason: r.skip });
      continue;
    }
    accepted.push({ entry: e, rel: r.rel });
  }
  // ZIPs made from a folder usually wrap everything in `layers/`: drop that one level.
  if (accepted.length && accepted.every((a) => a.rel.startsWith("layers/") && a.rel.split("/").length >= 3)) {
    for (const a of accepted) a.rel = a.rel.slice("layers/".length);
  }
  if (!accepted.length) throw new LayersZipError("no_layers", "no PNG layers found: expected <trait>/<value>.png inside the ZIP");

  const seen = new Map();
  for (const a of accepted) {
    const k = a.rel.toLowerCase();
    if (seen.has(k)) throw new LayersZipError("duplicate", `two entries map to the same file: "${seen.get(k)}" and "${a.rel}"`);
    seen.set(k, a.rel);
    const declared = a.entry._data?.uncompressedSize;
    if (Number.isFinite(declared) && declared > limits.fileBytes) {
      throw new LayersZipError("file_too_large", `${a.rel}: unpacked size ${declared} B exceeds ${Math.round(limits.fileBytes / 1048576)} MB`);
    }
  }

  mkdirSync(dirname(layerDir), { recursive: true });
  const stage = mkdtempSync(join(dirname(layerDir), ".layers-upload-"));
  try {
    let total = 0;
    const staged = [];
    for (const a of accepted) {
      const buf = await a.entry.async("nodebuffer");
      if (buf.length > limits.fileBytes) throw new LayersZipError("file_too_large", `${a.rel}: larger than ${Math.round(limits.fileBytes / 1048576)} MB`);
      total += buf.length;
      if (total > limits.totalBytes) throw new LayersZipError("upload_too_large", `unpacked layers exceed ${Math.round(limits.totalBytes / 1048576)} MB`);
      checkPngHeader(buf, a.rel, limits);
      const dest = join(stage, a.rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, buf);
      staged.push({ rel: a.rel, bytes: buf.length });
    }
    const existing = clear ? 0 : dirBytes(layerDir);
    if (existing + total > limits.dirBytes) {
      throw new LayersZipError("folder_full", `layers folder would exceed ${Math.round(limits.dirBytes / 1048576)} MB; clear it first or upload less`);
    }
    // Commit: nothing above touched layerDir.
    if (clear) {
      if (onClear) await onClear(layerDir);
      rmSync(layerDir, { recursive: true, force: true });
    }
    for (const f of staged) {
      const to = join(layerDir, f.rel);
      mkdirSync(dirname(to), { recursive: true });
      renameSync(join(stage, f.rel), to);
    }
    return { files: staged.length, bytes: total, keys: keysOf(staged), skipped, cleared: Boolean(clear) };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

export function clearLayers(layerDir) {
  const had = walk(layerDir).length;
  rmSync(layerDir, { recursive: true, force: true });
  return { removed: had };
}

/**
 * What is in the layers folder and, given the preset's trait items, how much of it the series needs.
 * `None` paints nothing, so it needs no file.
 */
export function layersStatus(layerDir, items = null) {
  const files = walk(layerDir);
  const status = { exists: files.length > 0, files: files.length, bytes: files.reduce((s, f) => s + f.bytes, 0), keys: keysOf(files), coverage: null };
  if (Array.isArray(items) && items.length) {
    const have = new Set(files.map((f) => f.rel.toLowerCase()));
    const missing = [];
    const criticalMissing = [];
    let expected = 0;
    for (const trait of items) {
      for (const o of trait.options || []) {
        if (o.value == null || o.value === NONE || o.value === "") continue;
        expected += 1;
        let rel;
        try {
          rel = layerFileFor("", trait, o.value, o).replaceAll("\\", "/").replace(/^\/+/, "");
        } catch {
          missing.push(`${trait.key}/${o.value}.png`);
          if (trait.layerOnly === true) criticalMissing.push(`${trait.key}/${o.value}.png`);
          continue;
        }
        if (!have.has(rel.toLowerCase())) {
          missing.push(rel);
          if (trait.layerOnly === true) criticalMissing.push(rel);
        }
      }
    }
    status.coverage = { expected, present: expected - missing.length, missing: missing.slice(0, 40), missingCount: missing.length };
    // only presets with a critical trait (layerOnly) get these fields, so the shape stays the same for the rest
    if (items.some((t) => t.layerOnly === true)) {
      status.coverage.criticalMissing = criticalMissing.slice(0, 40);
      status.coverage.criticalMissingCount = criticalMissing.length;
    }
  }
  return status;
}
