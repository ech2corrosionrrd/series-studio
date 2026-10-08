/**
 * Engine output is saved as N.png. Some engines (Pollinations edit) return JPEG
 * bytes, so the file name lies and PNG-only code (similarity, resize) throws.
 * ensurePng converts JPEG / WebP / GIF to PNG when sharp is installed. Without
 * sharp the bytes pass through unchanged and the caller gets `converted: false`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadSharp } from "./upscale.mjs";
import { atomicWriteFileSync } from "./fs-safe.mjs";

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** @returns {"png"|"jpeg"|"webp"|"gif"|"unknown"} */
export function imageFormat(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return "unknown";
  if (PNG_SIG.every((b, i) => buf[i] === b)) return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (buf.toString("ascii", 0, 3) === "GIF") return "gif";
  return "unknown";
}

/**
 * @param {Buffer} buf
 * @returns {Promise<{ buffer: Buffer, format: string, converted: boolean }>}
 */
export async function ensurePng(buf) {
  const format = imageFormat(buf);
  if (format === "png" || format === "unknown") return { buffer: buf, format, converted: false };
  const sharp = await loadSharp();
  if (!sharp) return { buffer: buf, format, converted: false };
  try {
    const out = await sharp(buf).png().toBuffer();
    return { buffer: out, format, converted: true };
  } catch {
    return { buffer: buf, format, converted: false };
  }
}

let warned = false;

/** Wrap an engine so generate() always resolves to PNG bytes when it can. */
export function withPngOutput(engine) {
  const inner = engine.generate;
  engine.generate = async function generate(...args) {
    const buf = await inner.apply(this, args);
    const r = await ensurePng(buf);
    if (!r.converted && r.format !== "png" && r.format !== "unknown" && !warned) {
      warned = true;
      process.emitWarning(
        `Engine returned ${r.format}, saved as .png without conversion. Install sharp (npm i sharp) to convert.`,
      );
    }
    return r.buffer;
  };
  return engine;
}

/**
 * Convert JPEG / WebP / GIF bytes stored under .png names in a set folder
 * (current frames and versions/) to real PNG. Files already PNG are skipped.
 * Hashes of converted files change: rebuild any bundle or provenance made before.
 *
 * @param {string} dir set folder, e.g. out/fal-s0.45
 * @param {{ dryRun?: boolean }} [opts]
 * @returns {Promise<{ scanned: number, png: number, converted: string[], failed: string[], sharp: boolean }>}
 */
export async function repairPngFiles(dir, { dryRun = false } = {}) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`not a folder: ${dir}`);
  const sharp = Boolean(await loadSharp());
  const res = { scanned: 0, png: 0, converted: [], failed: [], sharp };
  const walk = async (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) {
        await walk(p);
        continue;
      }
      if (!/\.png$/i.test(name)) continue;
      res.scanned++;
      const buf = readFileSync(p);
      const format = imageFormat(buf);
      if (format === "png" || format === "unknown") {
        res.png++;
        continue;
      }
      if (dryRun) {
        res.converted.push(p);
        continue;
      }
      const r = await ensurePng(buf);
      if (!r.converted) {
        res.failed.push(p);
        continue;
      }
      atomicWriteFileSync(p, r.buffer);
      res.converted.push(p);
    }
  };
  await walk(dir);
  return res;
}
