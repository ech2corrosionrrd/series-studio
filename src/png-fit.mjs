/**
 * Nearest-neighbour PNG resize using the built-in decoder (no sharp).
 * JPEG/WebP are left to sharp when it is installed; this module only speaks PNG.
 */
import { deflateSync, crc32 as zlibCrc32 } from "node:zlib";
import { decodePngRgba } from "./dupes.mjs";

function crc32(buf) {
  if (typeof zlibCrc32 === "function") return zlibCrc32(buf);
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** Encode an RGBA buffer (width * height * 4) as a non-interlaced PNG. */
export function encodeRgbaPng(width, height, rgba) {
  const w = Number(width);
  const h = Number(height);
  if (!w || !h || rgba.length < w * h * 4) throw new Error("bad rgba");
  const rowSize = 1 + w * 4;
  const raw = Buffer.alloc(rowSize * h);
  for (let y = 0; y < h; y++) {
    raw[y * rowSize] = 0;
    rgba.copy(raw, y * rowSize + 1, y * w * 4, (y + 1) * w * 4);
  }
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = deflateSync(raw, { level: 6 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

export function pngDimensions(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * Resize a PNG to exact pixel size (nearest neighbour).
 * @returns {{ ok: true, buffer: Buffer, width: number, height: number, source: { width: number, height: number } } | { ok: false, reason: string }}
 */
export function resizePng(buf, width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 4096 || h > 4096) {
    return { ok: false, reason: "bad_target" };
  }
  let decoded;
  try {
    decoded = decodePngRgba(buf);
  } catch (e) {
    return { ok: false, reason: String(e.message || e) };
  }
  const src = decoded.rgba;
  const sw = decoded.width;
  const sh = decoded.height;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(sh - 1, Math.floor((y + 0.5) * sh / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(sw - 1, Math.floor((x + 0.5) * sw / w));
      const si = (sy * sw + sx) * 4;
      const di = (y * w + x) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
    }
  }
  return {
    ok: true,
    buffer: encodeRgbaPng(w, h, out),
    width: w,
    height: h,
    source: { width: sw, height: sh },
  };
}
