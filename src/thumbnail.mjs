/**
 * Server-side thumbnails for the Review gallery and the base list (docs/BETA-REVIEW.md, B11).
 * A grid of 25 tiles used to download 25 full 1024 px frames; a tile only needs a few hundred pixels.
 * No image library: the PNG is decoded with `decodePngRgba`, averaged down by boxes and written back as a PNG.
 * Anything that is not a PNG we can read (JPEG, WebP, interlaced) returns null and the caller serves the original.
 */
import { deflateSync, crc32 } from "node:zlib";
import { decodePngRgba } from "./dupes.mjs";

export const THUMB_SIZES = [160, 256, 480];
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Maps the `w` query value to an allowed size, or 0 when none is asked for (a fixed list keeps the cache small). */
export function thumbWidth(value) {
  const n = Number(value);
  return n > 0 ? (THUMB_SIZES.find((s) => s >= n) ?? 0) : 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0);
  return Buffer.concat([len, t, data, crc]);
}

/** Box-averages RGBA down so the longest side is `maxSide`; the image is never enlarged. */
function boxDownscale({ rgba, width, height }, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  if (w === width && h === height) return { rgba, width, height };
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * height) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * width) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / w));
      let r = 0, g = 0, b = 0, a = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const o = (yy * width + xx) * 4;
          const al = rgba[o + 3];
          // Colour is weighted by alpha so a transparent edge does not bleed black into the tile.
          r += rgba[o] * al;
          g += rgba[o + 1] * al;
          b += rgba[o + 2] * al;
          a += al;
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      const o = (y * w + x) * 4;
      out[o] = a ? Math.round(r / a) : 0;
      out[o + 1] = a ? Math.round(g / a) : 0;
      out[o + 2] = a ? Math.round(b / a) : 0;
      out[o + 3] = Math.round(a / n);
    }
  }
  return { rgba: out, width: w, height: h };
}

/** Writes RGB (when fully opaque) or RGBA with the Sub filter, which the deflate stage compresses well on smooth art. */
function encodePng({ rgba, width, height }) {
  let opaque = true;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) { opaque = false; break; }
  const ch = opaque ? 3 : 4;
  const stride = width * ch;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    raw[row] = 1;
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < ch; c++) {
        const cur = rgba[(y * width + x) * 4 + c];
        const left = x ? rgba[(y * width + x - 1) * 4 + c] : 0;
        raw[row + 1 + x * ch + c] = (cur - left) & 255;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = opaque ? 2 : 6;
  return Buffer.concat([PNG_SIG, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
}

/** A PNG whose longest side is at most `maxSide`, or null when the source cannot be decoded (serve the original then). */
export function makeThumbnail(buf, maxSide) {
  try {
    const decoded = decodePngRgba(buf);
    if (Math.max(decoded.width, decoded.height) <= maxSide) return null;
    return encodePng(boxDownscale(decoded, maxSide));
  } catch {
    return null;
  }
}

const CACHE_LIMIT = 300;
const cache = new Map();

/** Cached thumbnail of a file on disk; the key carries mtime and size, so an edited frame never shows its old thumbnail. */
export function cachedThumbnail(file, stat, readBuf, maxSide) {
  const key = `${file}|${stat.mtimeMs}|${stat.size}|${maxSide}`;
  if (cache.has(key)) {
    const hit = cache.get(key);
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const thumb = makeThumbnail(readBuf(), maxSide);
  cache.set(key, thumb);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return thumb;
}
