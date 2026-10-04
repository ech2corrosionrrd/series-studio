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

/** 8-bit non-interlaced RGB or RGBA PNG → RGBA buffer. */
export function decodePngRgba(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error("not a png");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
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
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") break;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) throw new Error("unsupported png");
  if (!width || !height) throw new Error("empty png");
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
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
  if (bpp === 4) return { width, height, rgba: raw };
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < raw.length; i += 3, j += 4) {
    rgba[j] = raw[i];
    rgba[j + 1] = raw[i + 1];
    rgba[j + 2] = raw[i + 2];
    rgba[j + 3] = 255;
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

/**
 * Optional similarity of a frame to its base image.
 * Average hash only: no downloaded weights, no network.
 * A low score is a review warning. It is not a preflight error.
 */
export const SIMILARITY_WARN_BELOW = 0.75;

export function similarityToBase(imageBuf, baseBuf) {
  const distance = hamming(aHashPng(imageBuf), aHashPng(baseBuf));
  const similarity = Math.round((1 - distance / 64) * 1000) / 1000;
  return {
    distance,
    similarity,
    method: "ahash-64",
    weights: "none",
    offline: true,
    warn: similarity < SIMILARITY_WARN_BELOW,
  };
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
