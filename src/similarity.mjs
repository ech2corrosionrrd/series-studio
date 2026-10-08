/**
 * Similarity of a rendered frame to the series base image.
 * Offline, no weights, no network. PNG only (see png-normalize.mjs).
 *
 * Average hash (dupes.mjs) only compares an 8×8 brightness layout, so camera
 * drift and a lighter mane move it as much as a different subject does. This
 * compares edge-orientation histograms (HOG) of the upper-centre subject area,
 * after letting the frame's crop shift and zoom a little to follow the camera.
 * Colours are ignored on purpose: scarf and background are traits that change.
 *
 * It does not recognise a face. A mirrored base scores like the base, and it
 * assumes the chest-up, centred framing the prompt template asks for.
 */
import { decodePngRgba, aHashPng, hamming } from "./dupes.mjs";

export const SIMILARITY_METHOD = "hog-aligned-1";
/**
 * Warn below this. Midpoint between the lowest score of 48 rendered frames
 * (0.771) and the highest of 24 frames from another series (0.687), 08.10.2026.
 */
export const SIMILARITY_WARN_BELOW = 0.73;

const WORK = 256; // longest side after the first reduction
const GRID = 64; // luma grid per crop
const CELL = 8;
const BINS = 9;
const BASE_BOX = [0.3, 0.12, 0.7, 0.6]; // upper centre, where a chest-up face sits
const SCALES = [0.8, 0.9, 1, 1.1, 1.25, 1.4];
const SHIFTS = [-0.08, -0.04, 0, 0.04, 0.08];

/** Luma reduced to at most WORK×WORK by box averaging. */
function reduceLuma(rgba, width, height) {
  const w = Math.min(WORK, width);
  const h = Math.min(WORK, height);
  const sum = new Float64Array(w * h);
  const cnt = new Float64Array(w * h);
  for (let y = 0; y < height; y++) {
    const gy = Math.min(h - 1, Math.floor((y * h) / height));
    for (let x = 0; x < width; x++) {
      const gx = Math.min(w - 1, Math.floor((x * w) / width));
      const o = (y * width + x) * 4;
      sum[gy * w + gx] += 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2];
      cnt[gy * w + gx] += 1;
    }
  }
  for (let i = 0; i < sum.length; i++) sum[i] = cnt[i] ? sum[i] / cnt[i] : 0;
  return { luma: sum, w, h };
}

/** GRID×GRID luma of a box given as fractions of the image. */
function cropGrid({ luma, w, h }, box) {
  const x0 = Math.round(box[0] * w);
  const y0 = Math.round(box[1] * h);
  const x1 = Math.max(x0 + 1, Math.round(box[2] * w));
  const y1 = Math.max(y0 + 1, Math.round(box[3] * h));
  const g = new Float64Array(GRID * GRID);
  const c = new Float64Array(GRID * GRID);
  for (let y = y0; y < y1; y++) {
    const gy = Math.min(GRID - 1, Math.floor(((y - y0) * GRID) / (y1 - y0)));
    for (let x = x0; x < x1; x++) {
      const gx = Math.min(GRID - 1, Math.floor(((x - x0) * GRID) / (x1 - x0)));
      g[gy * GRID + gx] += luma[y * w + x];
      c[gy * GRID + gx] += 1;
    }
  }
  for (let i = 0; i < g.length; i++) g[i] = c[i] ? g[i] / c[i] : 0;
  return g;
}

/** Per-cell L2-normalised orientation histograms; null when the crop is flat. */
function hog(g) {
  const cells = GRID / CELL;
  const out = new Float64Array(cells * cells * BINS);
  let energy = 0;
  for (let y = 1; y < GRID - 1; y++) {
    for (let x = 1; x < GRID - 1; x++) {
      const dx = g[y * GRID + x + 1] - g[y * GRID + x - 1];
      const dy = g[(y + 1) * GRID + x] - g[(y - 1) * GRID + x];
      const m = Math.hypot(dx, dy);
      energy += m;
      let a = Math.atan2(dy, dx);
      if (a < 0) a += Math.PI;
      const bin = Math.min(BINS - 1, Math.floor((a / Math.PI) * BINS));
      out[(Math.floor(y / CELL) * cells + Math.floor(x / CELL)) * BINS + bin] += m;
    }
  }
  if (energy / (GRID * GRID) < 0.5) return null;
  for (let c = 0; c < cells * cells; c++) {
    let s = 0;
    for (let b = 0; b < BINS; b++) s += out[c * BINS + b] ** 2;
    s = Math.sqrt(s) + 1e-6;
    for (let b = 0; b < BINS; b++) out[c * BINS + b] /= s;
  }
  return out;
}

function cosine(a, b) {
  let d = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    x += a[i] * a[i];
    y += b[i] * b[i];
  }
  return d / (Math.sqrt(x * y) + 1e-9);
}

function candidateBoxes() {
  const boxes = [];
  for (const sc of SCALES) {
    for (const dx of SHIFTS) {
      for (const dy of SHIFTS) {
        const bw = (BASE_BOX[2] - BASE_BOX[0]) * sc;
        const bh = (BASE_BOX[3] - BASE_BOX[1]) * sc;
        const cx = (BASE_BOX[0] + BASE_BOX[2]) / 2 + dx;
        const cy = (BASE_BOX[1] + BASE_BOX[3]) / 2 + dy;
        const box = [cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2].map((v) => Math.min(1, Math.max(0, v)));
        if (box[2] - box[0] >= 0.15 && box[3] - box[1] >= 0.15) boxes.push(box);
      }
    }
  }
  return boxes;
}

const BOXES = candidateBoxes();

/**
 * @param {Buffer} imageBuf rendered frame (PNG)
 * @param {Buffer} baseBuf series base image (PNG)
 * @returns {{ similarity: number, distance: number, method: string, weights: "none", offline: true, warn: boolean }}
 *   `distance` is the old 64-bit average-hash distance, kept for reference.
 */
export function similarityToBase(imageBuf, baseBuf) {
  const a = decodePngRgba(imageBuf);
  const b = decodePngRgba(baseBuf);
  const distance = hamming(aHashPng(imageBuf), aHashPng(baseBuf));
  const baseHog = hog(cropGrid(reduceLuma(b.rgba, b.width, b.height), BASE_BOX));
  const frame = reduceLuma(a.rgba, a.width, a.height);
  let score;
  let method = SIMILARITY_METHOD;
  const flatFrame = hog(cropGrid(frame, BASE_BOX)) === null;
  if (baseHog === null || flatFrame) {
    // No edges to compare (blank or tiny image): fall back to the brightness layout.
    score = 1 - distance / 64;
    method = "ahash-64";
  } else {
    score = -1;
    for (const box of BOXES) {
      const h = hog(cropGrid(frame, box));
      if (h) score = Math.max(score, cosine(baseHog, h));
    }
    score = Math.max(0, score);
  }
  const similarity = Math.round(score * 1000) / 1000;
  return {
    distance,
    similarity,
    method,
    weights: "none",
    offline: true,
    warn: similarity < SIMILARITY_WARN_BELOW,
  };
}
