/**
 * Shrink frames that are over the 1 MB Metaplex asks for ("keep file sizes under
 * 1 MB where possible"). Needs sharp (optional dependency).
 *
 * The original is never lost: the smaller file becomes a new version of the
 * frame (versions.mjs), so the old bytes stay in versions/. Provenance hashes
 * are taken at export time, so compress before exporting.
 *
 * Order of attempts: palette PNG with fewer colours first (keeps the picture
 * size), then a smaller picture. A frame that cannot get under the limit is
 * left alone and reported.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadSharp } from "./upscale.mjs";
import { addVersion, readMeta } from "./versions.mjs";
import { PREFLIGHT_RECOMMENDED_IMAGE_BYTES } from "./preflight.mjs";
import { imageFormat } from "./png-normalize.mjs";

export const COMPRESS_TARGET_BYTES = PREFLIGHT_RECOMMENDED_IMAGE_BYTES;

const PALETTE_STEPS = [256, 192, 128, 64];
const SCALE_STEPS = [0.9, 0.8, 0.7, 0.6, 0.5];
const MIN_SIDE = 512;

/**
 * @param {Buffer} buf PNG (or any format sharp reads)
 * @param {number} maxBytes
 * @returns {Promise<{ ok: boolean, reason?: string, buffer?: Buffer, bytes?: number, method?: string, width?: number, height?: number, best?: number }>}
 */
export async function compressImage(buf, maxBytes = COMPRESS_TARGET_BYTES) {
  const sharp = await loadSharp();
  if (!sharp) return { ok: false, reason: "sharp_not_installed" };
  let meta;
  try {
    meta = await sharp(buf).metadata();
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  const w = meta.width || 0;
  const h = meta.height || 0;
  if (!w || !h) return { ok: false, reason: "unreadable" };

  let best = buf.length;
  const attempt = async (width, colors, method) => {
    const img = width === w ? sharp(buf) : sharp(buf).resize(width, null, { kernel: "lanczos3" });
    const out = await img.png({ palette: true, colors, quality: 90, effort: 6, compressionLevel: 9, dither: 1.0 }).toBuffer();
    best = Math.min(best, out.length);
    if (out.length <= maxBytes) {
      const m = await sharp(out).metadata();
      return { ok: true, buffer: out, bytes: out.length, method, width: m.width, height: m.height };
    }
    return null;
  };

  for (const colors of PALETTE_STEPS) {
    const r = await attempt(w, colors, `palette-${colors}`);
    if (r) return r;
  }
  for (const scale of SCALE_STEPS) {
    const width = Math.round(w * scale);
    if (Math.min(width, Math.round(h * scale)) < MIN_SIDE) break;
    const r = await attempt(width, 256, `resize-${Math.round(scale * 100)}`);
    if (r) return r;
  }
  return { ok: false, reason: "still_over", best };
}

/**
 * @param {string} setDir out/<set>
 * @param {{ maxBytes?: number, dryRun?: boolean }} [opts]
 */
export async function compressSet(setDir, { maxBytes = COMPRESS_TARGET_BYTES, dryRun = false } = {}) {
  if (!existsSync(setDir) || !statSync(setDir).isDirectory()) throw new Error(`not a folder: ${setDir}`);
  const sharp = Boolean(await loadSharp());
  const res = { maxBytes, sharp, scanned: 0, over: [], compressed: [], failed: [], savedBytes: 0 };
  const files = readdirSync(setDir)
    .filter((f) => /^\d+\.png$/i.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  for (const file of files) {
    const edition = parseInt(file, 10);
    const path = join(setDir, file);
    const bytes = statSync(path).size;
    res.scanned++;
    if (bytes <= maxBytes) continue;
    res.over.push({ edition, bytes });
    if (dryRun) continue;
    const src = readFileSync(path);
    if (imageFormat(src) === "unknown") {
      res.failed.push({ edition, reason: "unreadable" });
      continue;
    }
    const r = await compressImage(src, maxBytes);
    if (!r.ok) {
      res.failed.push({ edition, reason: r.reason, bytes, best: r.best });
      continue;
    }
    const meta = readMeta(setDir, edition);
    const cur = meta.versions.find((v) => v.v === meta.current) || {};
    const { v: _v, at: _at, ...inherited } = cur;
    addVersion(setDir, edition, r.buffer, {
      ...inherited,
      source: "compress",
      compressedFromBytes: bytes,
      compressMethod: r.method,
    });
    res.compressed.push({ edition, before: bytes, after: r.bytes, method: r.method });
    res.savedBytes += bytes - r.bytes;
  }
  return res;
}
