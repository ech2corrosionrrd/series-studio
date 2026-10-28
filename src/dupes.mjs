/**
 * Visual near-duplicates by average hash. No network and no extra packages:
 * PNG is decoded with node:zlib; other formats are skipped.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { join } from "node:path";
import { writeJsonAtomic } from "./fs-safe.mjs";

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Samples per pixel and the bit depths the PNG spec allows for each colour type. */
const PNG_CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const PNG_DEPTHS = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };

/** Sample number `n` (0-based) of a scanline at the given bit depth, as an integer of that depth. */
function pngSample(row, n, depth) {
  if (depth === 8) return row[n];
  if (depth === 16) return (row[n * 2] << 8) | row[n * 2 + 1];
  const perByte = 8 / depth;
  const shift = 8 - depth * ((n % perByte) + 1);
  return (row[Math.floor(n / perByte)] >> shift) & ((1 << depth) - 1);
}

/**
 * Non-interlaced PNG → 8-bit RGBA buffer. Reads every colour type (grayscale, RGB, palette, gray+alpha, RGBA) at the
 * bit depths the spec allows, with `tRNS` transparency; 16-bit samples keep their high byte. Interlaced files are refused.
 */
export function decodePngRgba(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error("not a png");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let palette = null;
  let trns = null;
  const idat = [];
  while (offset + 8 <= buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    offset += 12 + len;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error("interlaced png");
    } else if (type === "PLTE") {
      palette = data;
    } else if (type === "tRNS") {
      trns = data;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") break;
  }
  if (!PNG_DEPTHS[colorType]?.includes(bitDepth)) throw new Error("unsupported png");
  if (!width || !height) throw new Error("empty png");
  if (colorType === 3 && (!palette || palette.length < 3)) throw new Error("png has no palette");
  const channels = PNG_CHANNELS[colorType];
  const bpp = Math.max(1, (channels * bitDepth) >> 3); // bytes per pixel for filtering; 1 below 8 bits
  const stride = Math.ceil((width * channels * bitDepth) / 8);
  const inflated = inflateSync(Buffer.concat(idat));
  const rowSize = stride + 1;
  if (inflated.length < rowSize * height) throw new Error("truncated png");
  const raw = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = inflated[y * rowSize];
    const src = inflated.subarray(y * rowSize + 1, y * rowSize + 1 + stride);
    const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? cur[i - bpp] : 0;
      const up = prev[i];
      const ul = i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      if (filter === 1) v = (v + left) & 255;
      else if (filter === 2) v = (v + up) & 255;
      else if (filter === 3) v = (v + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) v = (v + paeth(left, up, ul)) & 255;
      else if (filter !== 0) throw new Error("bad png filter");
      cur[i] = v;
    }
    cur.copy(raw, y * stride);
    prev = cur;
  }
  if (bitDepth === 8 && colorType === 6) return { width, height, rgba: raw };
  const rgba = Buffer.alloc(width * height * 4);
  const max = (1 << Math.min(bitDepth, 8)) - 1;
  const to8 = (v) => (bitDepth === 16 ? v >> 8 : bitDepth === 8 ? v : Math.round((v * 255) / max));
  // tRNS: per-index alpha for a palette; one colour key (16-bit values) for grayscale and RGB.
  const keyOf = (n) => (trns && trns.length >= (n + 1) * 2 ? trns.readUInt16BE(n * 2) : null);
  const key = colorType === 0 ? [keyOf(0)] : colorType === 2 ? [keyOf(0), keyOf(1), keyOf(2)] : null;
  const keyed = key && key.every((k) => k !== null);
  for (let y = 0; y < height; y++) {
    const row = raw.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const n = x * channels;
      if (colorType === 3) {
        const idx = pngSample(row, x, bitDepth);
        if (idx * 3 + 2 >= palette.length) throw new Error("bad png palette index");
        rgba[o] = palette[idx * 3];
        rgba[o + 1] = palette[idx * 3 + 1];
        rgba[o + 2] = palette[idx * 3 + 2];
        rgba[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
      } else if (colorType === 0 || colorType === 4) {
        const v = pngSample(row, n, bitDepth);
        rgba[o] = rgba[o + 1] = rgba[o + 2] = to8(v);
        rgba[o + 3] = colorType === 4 ? to8(pngSample(row, n + 1, bitDepth)) : keyed && v === key[0] ? 0 : 255;
      } else {
        const r = pngSample(row, n, bitDepth);
        const g = pngSample(row, n + 1, bitDepth);
        const b = pngSample(row, n + 2, bitDepth);
        rgba[o] = to8(r);
        rgba[o + 1] = to8(g);
        rgba[o + 2] = to8(b);
        rgba[o + 3] = colorType === 6 ? to8(pngSample(row, n + 3, bitDepth)) : keyed && r === key[0] && g === key[1] && b === key[2] ? 0 : 255;
      }
    }
  }
  return { width, height, rgba };
}

/** Average the image into 8×8 luma samples. */
export function rgbaTo8x8(rgba, width, height) {
  const grays = new Float64Array(64);
  const counts = new Float64Array(64);
  for (let y = 0; y < height; y++) {
    const gy = Math.min(7, Math.floor((y * 8) / height));
    for (let x = 0; x < width; x++) {
      const gx = Math.min(7, Math.floor((x * 8) / width));
      const o = (y * width + x) * 4;
      const g = 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2];
      const i = gy * 8 + gx;
      grays[i] += g;
      counts[i] += 1;
    }
  }
  for (let i = 0; i < 64; i++) grays[i] = counts[i] ? grays[i] / counts[i] : 0;
  return grays;
}

/** 64-bit average hash from 64 luma samples. */
export function aHashFromGray(grays) {
  let sum = 0;
  for (let i = 0; i < 64; i++) sum += grays[i];
  const avg = sum / 64;
  let hash = 0n;
  for (let i = 0; i < 64; i++) {
    if (grays[i] >= avg) hash |= 1n << BigInt(63 - i);
  }
  return hash;
}

export function aHashPng(buf) {
  const { rgba, width, height } = decodePngRgba(buf);
  return aHashFromGray(rgbaTo8x8(rgba, width, height));
}

/** Same default the review tool uses. Preflight warns at or under this distance. */
export const AHASH_WARN_DISTANCE = 8;

/** Hamming distance between two hashes (bigint | decimal string). */
export function hamming(a, b) {
  let x = BigInt(a) ^ BigInt(b);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/**
 * Pairs of images in a set folder whose average hashes are within maxDistance.
 * @returns {{ pairs: { a: string, b: string, distance: number }[], hashed: number, skipped: string[] }}
 */
export function findDupes(dir, { maxDistance = AHASH_WARN_DISTANCE } = {}) {
  const limit = Math.max(0, Math.min(32, Number(maxDistance) || 0));
  const cacheFile = join(dir, "hashes.json");
  let cache = {};
  if (existsSync(cacheFile)) {
    try { cache = JSON.parse(readFileSync(cacheFile, "utf8")); } catch { cache = {}; }
  }
  let dirty = false;
  const hashes = [];
  const skipped = [];
  const files = readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort();
  for (const file of files) {
    const imgPath = join(dir, file);
    try {
      const st = statSync(imgPath);
      const entry = cache[file];
      let h;
      if (entry && entry.mtime === st.mtimeMs && entry.h) {
        h = BigInt(entry.h);
      } else if (/\.png$/i.test(file)) {
        h = aHashPng(readFileSync(imgPath));
        cache[file] = { h: h.toString(), mtime: st.mtimeMs };
        dirty = true;
      } else {
        skipped.push(file);
        continue;
      }
      hashes.push({ file, h });
    } catch {
      skipped.push(file);
    }
  }
  if (dirty) {
    try { writeJsonAtomic(cacheFile, cache); } catch { /* cache is optional */ }
  }
  const pairs = [];
  for (let x = 0; x < hashes.length; x++) {
    for (let y = x + 1; y < hashes.length; y++) {
      const distance = hamming(hashes[x].h, hashes[y].h);
      if (distance <= limit) pairs.push({ a: hashes[x].file, b: hashes[y].file, distance });
    }
  }
  pairs.sort((p, q) => p.distance - q.distance || p.a.localeCompare(q.a));
  return { pairs, hashed: hashes.length, skipped };
}
