/**
 * Engine output is saved as N.png. Some engines (Pollinations edit) return JPEG
 * bytes, so the file name lies and PNG-only code (similarity, resize) throws.
 * ensurePng converts JPEG / WebP / GIF to PNG when sharp is installed. Without
 * sharp the bytes pass through unchanged and the caller gets `converted: false`.
 */
import { loadSharp } from "./upscale.mjs";

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
