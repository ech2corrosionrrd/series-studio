/**
 * Re-colours the studio backdrop of a frame without a model. A model told "teal backdrop" can keep a near-black
 * navy one (Kontext, 25.10.2026, ENGINES.md section 9) and a PNG layer cannot do a backdrop (an opaque layer would
 * cover the subject), so the backdrop is found in the frame itself and tinted there.
 *
 * How: grow a region from the frame border over pixels that look like the backdrop (dark, a colour close to the
 * border's, smooth), feather its edge, and move only the colour of that region to the target while keeping its
 * brightness. It works for a smooth studio backdrop. A textured one (clouds, a wall) is not found, and then the
 * frame is returned unchanged: `applied: false` says so, a wrong guess is never painted.
 */

const STEP = 7; // largest colour jump between two neighbouring backdrop pixels
const FROM_BORDER = 42; // largest distance from the backdrop colour measured on the border
const CHROMA = 9; // how far the backdrop's hue (channel differences) may drift
const SMOOTH = 3.5; // largest local brightness deviation (the backdrop is smooth, fabric and fur are not)
const DARK = 0.42; // a backdrop brighter than this (max channel / 255) is not grown into
const MIN_SHARE = 0.2; // a studio backdrop fills a good part of a portrait; less is a guess (clouds gave 6-13%)
const MAX_SHARE = 0.75;

/** `#rrggbb` → [r, g, b], or null for anything else. */
export function parseBackdropColor(value) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(value ?? "").trim());
  return m ? [0, 2, 4].map((o) => parseInt(m[1].slice(o, o + 2), 16)) : null;
}

/** Local brightness deviation on a sparse 7×7 window, computed where the region growth asks for it. */
function makeRoughness(rgba, width, height) {
  const lum = (i) => 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  const cache = new Float32Array(width * height).fill(-1);
  return (x, y) => {
    const key = y * width + x;
    if (cache[key] >= 0) return cache[key];
    let s1 = 0;
    let s2 = 0;
    let k = 0;
    for (let dy = -3; dy <= 3; dy += 2) {
      for (let dx = -3; dx <= 3; dx += 2) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const v = lum(ny * width + nx);
        s1 += v;
        s2 += v * v;
        k += 1;
      }
    }
    const mean = s1 / k;
    cache[key] = Math.sqrt(Math.max(0, s2 / k - mean * mean));
    return cache[key];
  };
}

/** Three passes of a separable box blur (radius 2) over a 0/1 mask. */
function feather(mask, width, height) {
  let src = Float32Array.from(mask);
  const R = 2;
  for (let pass = 0; pass < 3; pass += 1) {
    const tmp = new Float32Array(src.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let s = 0;
        let k = 0;
        for (let dx = -R; dx <= R; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          s += src[y * width + nx];
          k += 1;
        }
        tmp[y * width + x] = s / k;
      }
    }
    const out = new Float32Array(src.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let s = 0;
        let k = 0;
        for (let dy = -R; dy <= R; dy += 1) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          s += tmp[ny * width + x];
          k += 1;
        }
        out[y * width + x] = s / k;
      }
    }
    src = out;
  }
  return src;
}

/**
 * @param {Buffer} rgba straight-alpha RGBA, width × height
 * @param {string} color `#rrggbb`, the backdrop colour wanted
 * @returns {{ rgba: Buffer, applied: boolean, share: number, reason?: string }} `rgba` is a new buffer, the input is not changed
 */
export function tintBackdrop(rgba, width, height, color) {
  const target = parseBackdropColor(color);
  if (!target) return { rgba, applied: false, share: 0, reason: "bad_color" };
  const px = (i) => [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]];
  const val = (c) => Math.max(c[0], c[1], c[2]) / 255;
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  const mask = new Uint8Array(width * height);
  const queue = [];
  const seed = (x, y) => {
    const i = y * width + x;
    if (mask[i] || val(px(i)) > DARK) return;
    mask[i] = 1;
    queue.push(i);
  };
  for (let x = 0; x < width; x += 1) for (let y = 0; y < Math.min(6, height); y += 1) seed(x, y);
  for (let y = 0; y < height * 0.45; y += 1) {
    for (let x = 0; x < Math.min(6, width); x += 1) {
      seed(x, y);
      seed(width - 1 - x, y);
    }
  }
  if (!queue.length) return { rgba, applied: false, share: 0, reason: "no_backdrop" };

  const ref = [0, 0, 0];
  for (const i of queue) {
    const c = px(i);
    ref[0] += c[0];
    ref[1] += c[1];
    ref[2] += c[2];
  }
  ref[0] /= queue.length;
  ref[1] /= queue.length;
  ref[2] /= queue.length;
  const rough = makeRoughness(rgba, width, height);

  for (let h = 0; h < queue.length; h += 1) {
    const i = queue[h];
    const x = i % width;
    const y = (i / width) | 0;
    const c = px(i);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (mask[j]) continue;
      const d = px(j);
      if (
        dist(c, d) <= STEP &&
        dist(ref, d) <= FROM_BORDER &&
        val(d) <= DARK &&
        Math.abs(d[0] - d[2] - (ref[0] - ref[2])) <= CHROMA &&
        Math.abs(d[1] - d[2] - (ref[1] - ref[2])) <= CHROMA &&
        rough(nx, ny) <= SMOOTH
      ) {
        mask[j] = 1;
        queue.push(j);
      }
    }
  }
  const share = queue.length / (width * height);
  if (share < MIN_SHARE) return { rgba, applied: false, share, reason: "not_smooth" };
  if (share > MAX_SHARE) return { rgba, applied: false, share, reason: "whole_frame" };

  const soft = feather(mask, width, height);
  const targetLum = 0.299 * target[0] + 0.587 * target[1] + 0.114 * target[2] || 1;
  const out = Buffer.from(rgba);
  for (let i = 0; i < width * height; i += 1) {
    const m = soft[i];
    if (m <= 0.001) continue;
    const c = px(i);
    const lum = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    const k = Math.max(lum, 24) / targetLum; // the target at this pixel's brightness, so a dark backdrop stays dark but reads as the colour
    for (let ch = 0; ch < 3; ch += 1) out[i * 4 + ch] = Math.round(c[ch] * (1 - m) + Math.min(255, target[ch] * k) * m);
  }
  return { rgba: out, applied: true, share };
}
