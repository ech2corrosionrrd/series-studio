import { test } from "node:test";
import assert from "node:assert/strict";
import { similarityToBase, SIMILARITY_METHOD, SIMILARITY_WARN_BELOW } from "../src/similarity.mjs";
import { encodeRgbaPng } from "../src/png-fit.mjs";

const SIZE = 192;

/** A chest-up-ish figure: head ring with eyes and a mouth bar, on a plain backdrop. */
function figure({ dx = 0, dy = 0, zoom = 1, bg = [30, 30, 30], fur = [190, 140, 70], eyeGap = 26 } = {}) {
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const px = (x - SIZE / 2 - dx) / zoom;
      const py = (y - SIZE * 0.36 - dy) / zoom;
      let c = bg;
      const r = Math.hypot(px, py);
      if (r < 52) c = fur;
      if (r > 44 && r < 52) c = [60, 40, 20];
      if (Math.hypot(Math.abs(px) - eyeGap / 2, py + 8) < 6) c = [20, 20, 20];
      if (Math.abs(py - 24) < 3 && Math.abs(px) < 16) c = [20, 20, 20];
      if (py > 56 && Math.abs(px) < 64) c = [90, 70, 50];
      const o = (y * SIZE + x) * 4;
      rgba[o] = c[0];
      rgba[o + 1] = c[1];
      rgba[o + 2] = c[2];
      rgba[o + 3] = 255;
    }
  }
  return encodeRgbaPng(SIZE, SIZE, rgba);
}

/** Different subject: diagonal stripes with a square. */
function other() {
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const stripe = Math.floor((x + y) / 9) % 2 === 0;
      const sq = x > 60 && x < 130 && y > 50 && y < 120;
      const v = sq ? 220 : stripe ? 90 : 150;
      const o = (y * SIZE + x) * 4;
      rgba[o] = v;
      rgba[o + 1] = v;
      rgba[o + 2] = v;
      rgba[o + 3] = 255;
    }
  }
  return encodeRgbaPng(SIZE, SIZE, rgba);
}

test("an identical frame scores 1 and does not warn", () => {
  const base = figure();
  const r = similarityToBase(base, base);
  assert.equal(r.method, SIMILARITY_METHOD);
  assert.equal(r.similarity, 1);
  assert.equal(r.warn, false);
  assert.equal(r.offline, true);
});

test("a recoloured, shifted and zoomed copy stays above the warning threshold", () => {
  const base = figure();
  const drift = figure({ dx: 6, dy: 4, zoom: 1.12, bg: [20, 60, 70], fur: [200, 160, 90] });
  const r = similarityToBase(drift, base);
  assert.ok(r.similarity >= SIMILARITY_WARN_BELOW, `got ${r.similarity}`);
  assert.equal(r.warn, false);
});

test("a different subject scores clearly lower and warns", () => {
  const base = figure();
  const same = similarityToBase(figure({ dx: 4, zoom: 1.08 }), base).similarity;
  const diff = similarityToBase(other(), base);
  assert.ok(diff.similarity < same - 0.1, `same ${same}, other ${diff.similarity}`);
  assert.equal(diff.warn, true);
});

test("the score is deterministic", () => {
  const base = figure();
  const frame = figure({ dx: 3 });
  assert.deepEqual(similarityToBase(frame, base), similarityToBase(frame, base));
});
