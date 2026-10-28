/**
 * Aligns a hand layer to a model-drawn frame. Offline, no weights, no network.
 *
 * A layer is drawn on the series base image. A model that redraws the picture (Kontext at 0.45) moves and
 * rescales the subject a little, so the layer lands beside where it belongs. This finds the shift and zoom
 * that carry the base onto the frame by matching edge maps (Sobel, normalised correlation), coarse then fine,
 * and `warpRgba` applies the same move to the layer.
 *
 * It finds ONE global move (shift + zoom). It does not detect a face and does not follow a changed pose:
 * when the match is weak it says so (`ok: false`) and the layer is left where it was drawn.
 */
import { decodePngRgba } from "./dupes.mjs";

export const ALIGN_METHOD = "edge-ncc-1";
/** Below this correlation of the edge maps the match is not trusted. */
export const ALIGN_MIN_SCORE = 0.3;
/** The base and the frame must share the proportions, otherwise the same move does not fit both. */
const MAX_ASPECT_DRIFT = 0.15;
const COARSE = 64;
const FINE = 192;
const SCALES = [0.85, 0.875, 0.9, 0.925, 0.95, 0.975, 1, 1.025, 1.05, 1.075, 1.1, 1.125, 1.15, 1.2];
const MIN_OVERLAP = 0.55;

/** Luma of an RGBA picture box-averaged onto a gw×gh grid (alpha ignored: a base is opaque). */
function lumaGrid(rgba, width, height, gw, gh) {
  const sum = new Float64Array(gw * gh);
  const cnt = new Float64Array(gw * gh);
  for (let y = 0; y < height; y += 1) {
    const gy = Math.min(gh - 1, Math.floor((y * gh) / height));
    for (let x = 0; x < width; x += 1) {
      const gx = Math.min(gw - 1, Math.floor((x * gw) / width));
      const o = (y * width + x) * 4;
      sum[gy * gw + gx] += 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2];
      cnt[gy * gw + gx] += 1;
    }
  }
  for (let i = 0; i < sum.length; i += 1) sum[i] = cnt[i] ? sum[i] / cnt[i] : 0;
  return sum;
}

/** Sobel magnitude, then a 3×3 box blur so a one-cell wobble does not break the match. */
function edgeMap(luma, w, h) {
  const mag = new Float64Array(w * h);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      const gx = luma[i - w + 1] + 2 * luma[i + 1] + luma[i + w + 1] - luma[i - w - 1] - 2 * luma[i - 1] - luma[i + w - 1];
      const gy = luma[i + w - 1] + 2 * luma[i + w] + luma[i + w + 1] - luma[i - w - 1] - 2 * luma[i - w] - luma[i - w + 1];
      mag[i] = Math.hypot(gx, gy);
    }
  }
  const out = new Float64Array(w * h);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) s += mag[(y + dy) * w + x + dx];
      out[y * w + x] = s / 9;
    }
  }
  return out;
}

/** `src` scaled by `s` about the centre of the grid (bilinear), so scale 1.1 means the subject grows 10 %. */
function zoomGrid(src, w, h, s) {
  if (s === 1) return src;
  const out = new Float64Array(w * h);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  for (let y = 0; y < h; y += 1) {
    const sy = cy + (y - cy) / s;
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    if (y0 < 0 || y0 >= h - 1) continue;
    for (let x = 0; x < w; x += 1) {
      const sx = cx + (x - cx) / s;
      const x0 = Math.floor(sx);
      const fx = sx - x0;
      if (x0 < 0 || x0 >= w - 1) continue;
      const i = y0 * w + x0;
      out[y * w + x] = src[i] * (1 - fx) * (1 - fy) + src[i + 1] * fx * (1 - fy) + src[i + w] * (1 - fx) * fy + src[i + w + 1] * fx * fy;
    }
  }
  return out;
}

/** Normalised correlation of `a` moved by (tx, ty) against `b` over their overlap; -1 when the overlap is too small. */
function nccShift(a, b, w, h, tx, ty) {
  const x0 = Math.max(0, tx);
  const x1 = Math.min(w, w + tx);
  const y0 = Math.max(0, ty);
  const y1 = Math.min(h, h + ty);
  const n = (x1 - x0) * (y1 - y0);
  if (x1 <= x0 || y1 <= y0 || n < MIN_OVERLAP * w * h) return -1;
  let sa = 0;
  let sb = 0;
  let saa = 0;
  let sbb = 0;
  let sab = 0;
  for (let y = y0; y < y1; y += 1) {
    const ra = (y - ty) * w - tx;
    const rb = y * w;
    for (let x = x0; x < x1; x += 1) {
      const va = a[ra + x];
      const vb = b[rb + x];
      sa += va;
      sb += vb;
      saa += va * va;
      sbb += vb * vb;
      sab += va * vb;
    }
  }
  const cov = sab - (sa * sb) / n;
  const va = saa - (sa * sa) / n;
  const vb = sbb - (sb * sb) / n;
  if (va <= 1e-9 || vb <= 1e-9) return -1;
  return cov / Math.sqrt(va * vb);
}

function search(ref, frame, w, h, scales, shifts) {
  let best = { score: -2, scale: 1, tx: 0, ty: 0 };
  for (const s of scales) {
    const z = zoomGrid(ref, w, h, s);
    for (const ty of shifts.y) {
      for (const tx of shifts.x) {
        const sc = nccShift(z, frame, w, h, tx, ty);
        // Ties go to the smaller move: scales and shifts are listed from the centre outwards by the callers' order.
        if (sc > best.score + 1e-9) best = { score: sc, scale: s, tx, ty };
      }
    }
  }
  return best;
}

function range(centre, radius) {
  const out = [centre];
  for (let d = 1; d <= radius; d += 1) out.push(centre - d, centre + d);
  return out;
}

/**
 * The move that carries the reference (base) onto the frame.
 * @param {Buffer} refPng the picture the layers were drawn on
 * @param {Buffer} framePng the model-drawn frame
 * @returns {{ ok: boolean, dx: number, dy: number, scale: number, score: number, reason?: string, method: string }}
 *   `dx`/`dy` in pixels of the frame (+x right, +y down), `scale` about the frame centre. `reason`: `flat`, `shape` or `low_match`.
 */
export function estimateAlignment(refPng, framePng) {
  const none = (reason, score = 0) => ({ ok: false, dx: 0, dy: 0, scale: 1, score, reason, method: ALIGN_METHOD });
  const ref = decodePngRgba(refPng);
  const frame = decodePngRgba(framePng);
  const aspectRef = ref.width / ref.height;
  const aspectFrame = frame.width / frame.height;
  if (Math.abs(aspectRef / aspectFrame - 1) > MAX_ASPECT_DRIFT) return none("shape");
  const grids = (long) => {
    const k = long / Math.max(frame.width, frame.height);
    const w = Math.max(16, Math.round(frame.width * k));
    const h = Math.max(16, Math.round(frame.height * k));
    return {
      w,
      h,
      ref: edgeMap(lumaGrid(ref.rgba, ref.width, ref.height, w, h), w, h),
      frame: edgeMap(lumaGrid(frame.rgba, frame.width, frame.height, w, h), w, h),
    };
  };
  const lo = grids(COARSE);
  const energy = (g) => g.reduce((a, v) => a + v, 0) / g.length;
  if (energy(lo.ref) < 0.5 || energy(lo.frame) < 0.5) return none("flat");
  const reach = Math.round(lo.w * 0.2);
  const coarse = search(lo.ref, lo.frame, lo.w, lo.h, SCALES, { x: range(0, reach), y: range(0, Math.round(lo.h * 0.2)) });
  const hi = grids(FINE);
  const k = hi.w / lo.w;
  const fineScales = [coarse.scale - 0.0125, coarse.scale, coarse.scale + 0.0125].filter((s) => s > 0.7 && s < 1.4);
  const fine = search(hi.ref, hi.frame, hi.w, hi.h, fineScales, {
    x: range(Math.round(coarse.tx * k), 3),
    y: range(Math.round(coarse.ty * k), 3),
  });
  const score = Math.round(fine.score * 1000) / 1000;
  if (!(fine.score >= ALIGN_MIN_SCORE)) return none("low_match", score);
  // The move is relative to the picture centre in the grid; the same fractions apply to the frame in pixels.
  const dx = Math.round((fine.tx / hi.w) * frame.width);
  const dy = Math.round((fine.ty / hi.h) * frame.height);
  const scale = Math.round(fine.scale * 1000) / 1000;
  return { ok: true, dx, dy, scale, score, method: ALIGN_METHOD };
}

/**
 * Applies a move to an RGBA layer: zoom by `scale` about the centre, then shift by (dx, dy).
 * What leaves the frame is dropped, what enters is transparent. Colour is blended on premultiplied alpha.
 */
export function warpRgba(rgba, width, height, { dx = 0, dy = 0, scale = 1 } = {}) {
  const out = Buffer.alloc(rgba.length);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  for (let y = 0; y < height; y += 1) {
    const sy = cy + (y - dy - cy) / scale;
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    if (y0 < 0 || y0 >= height - 1) continue;
    for (let x = 0; x < width; x += 1) {
      const sx = cx + (x - dx - cx) / scale;
      const x0 = Math.floor(sx);
      const fx = sx - x0;
      if (x0 < 0 || x0 >= width - 1) continue;
      const i00 = (y0 * width + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + width * 4;
      const i11 = i01 + 4;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      const a = rgba[i00 + 3] * w00 + rgba[i10 + 3] * w10 + rgba[i01 + 3] * w01 + rgba[i11 + 3] * w11;
      if (a < 0.5) continue;
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        const p = rgba[i00 + c] * rgba[i00 + 3] * w00 + rgba[i10 + c] * rgba[i10 + 3] * w10 + rgba[i01 + c] * rgba[i01 + 3] * w01 + rgba[i11 + c] * rgba[i11 + 3] * w11;
        out[o + c] = Math.max(0, Math.min(255, Math.round(p / a)));
      }
      out[o + 3] = Math.min(255, Math.round(a));
    }
  }
  return out;
}
