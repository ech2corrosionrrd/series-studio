// layerAlign: a layer drawn on the base is moved and zoomed by the shift found between the base and the model's frame.
// Synthetic pictures only: no model, no network, no paid call.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { estimateAlignment, warpRgba, ALIGN_MIN_SCORE } from "../src/layer-align.mjs";
import { composeEdition } from "../src/layers.mjs";
import { decodePngRgba } from "../src/dupes.mjs";
import { encodeRgbaPng } from "../src/png-fit.mjs";

const W = 256;
const H = 256;

/** Blocks of a fixed pseudo-random grey: plenty of edges, a subject in the middle, a dark border. */
function textured(seed = 1, whole = false) {
  const rgba = Buffer.alloc(W * H * 4);
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const cell = 16;
  const grey = [];
  for (let i = 0; i < (W / cell) * (H / cell); i += 1) grey.push(40 + Math.floor(rnd() * 180));
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const inside = whole || (x > 48 && x < 208 && y > 32 && y < 224);
      const g = inside ? grey[Math.floor(y / cell) * (W / cell) + Math.floor(x / cell)] : 20;
      rgba.set([g, g, g, 255], (y * W + x) * 4);
    }
  }
  return rgba;
}

const png = (rgba) => encodeRgbaPng(W, H, rgba);

describe("estimateAlignment", () => {
  it("recovers a shift and a zoom of the frame", () => {
    const base = textured();
    const frame = warpRgba(base, W, H, { dx: 12, dy: -8, scale: 1.05 });
    const r = estimateAlignment(png(base), png(frame));
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(Math.abs(r.dx - 12) <= 4, `dx ${r.dx}`);
    assert.ok(Math.abs(r.dy + 8) <= 4, `dy ${r.dy}`);
    assert.ok(Math.abs(r.scale - 1.05) <= 0.03, `scale ${r.scale}`);
    assert.ok(r.score >= ALIGN_MIN_SCORE);
  });

  it("finds no move for an identical frame", () => {
    const base = textured();
    const r = estimateAlignment(png(base), png(base));
    assert.deepEqual([r.ok, r.dx, r.dy, r.scale], [true, 0, 0, 1]);
  });

  it("refuses a flat picture, other proportions and an unrelated frame", () => {
    const flat = Buffer.alloc(W * H * 4, 128);
    for (let i = 3; i < flat.length; i += 4) flat[i] = 255;
    assert.equal(estimateAlignment(png(textured()), png(flat)).reason, "flat");
    const wide = encodeRgbaPng(W * 2, H, Buffer.alloc(W * 2 * H * 4, 255));
    assert.equal(estimateAlignment(png(textured()), wide).reason, "shape");
    const other = estimateAlignment(png(textured(1)), png(textured(99, true)));
    assert.equal(other.ok, false);
    assert.equal(other.reason, "low_match");
  });

  it("is deterministic", () => {
    const base = textured();
    const frame = png(warpRgba(base, W, H, { dx: -6, dy: 10, scale: 0.97 }));
    assert.deepEqual(estimateAlignment(png(base), frame), estimateAlignment(png(base), frame));
  });
});

describe("warpRgba", () => {
  it("is the identity for no move and moves a pixel by shift and zoom", () => {
    const rgba = Buffer.alloc(W * H * 4);
    rgba.set([255, 0, 0, 255], (100 * W + 100) * 4);
    assert.equal(Buffer.compare(warpRgba(rgba, W, H, {}), rgba), 0);
    const moved = warpRgba(rgba, W, H, { dx: 5, dy: 7 });
    assert.equal(moved[((107) * W + 105) * 4], 255);
    const zoomed = warpRgba(rgba, W, H, { scale: 2 });
    assert.equal(zoomed.length, rgba.length);
  });
});

describe("composeEdition with layerAlign", () => {
  const base = textured();
  const frame = png(warpRgba(base, W, H, { dx: 16, dy: 12, scale: 1 }));
  const layer = Buffer.alloc(W * H * 4);
  for (let y = 100; y < 110; y += 1) for (let x = 100; x < 110; x += 1) layer.set([220, 20, 20, 255], (y * W + x) * 4);
  const layerPng = png(layer);
  const recipe = { edition: 1, line: "a", traits: { mark: "Dot" } };
  const paint = (trait, alignRef) =>
    composeEdition({
      recipe,
      items: [{ key: "mark", ...trait, options: [{ value: "None" }, { value: "Dot", weight: 1 }] }],
      basePng: frame,
      layerDir: "/layers",
      readFile: () => layerPng,
      skipMissing: true,
      alignRef,
    });
  const redAt = (out, x, y) => decodePngRgba(out.png).rgba[(y * W + x) * 4 + 1] === 20;

  it("moves the layer onto the shifted subject", () => {
    const out = paint({ layerAlign: true }, png(base));
    assert.ok(out.align?.ok !== false && out.align.dx > 8, JSON.stringify(out.align));
    assert.ok(redAt(out, 100 + out.align.dx + 2, 100 + out.align.dy + 2));
    assert.equal(redAt(out, 102, 102), false, "the old place is clear");
  });

  it("leaves the layer where it was drawn without the flag or without a base", () => {
    const plain = paint({}, png(base));
    assert.equal(plain.align, null);
    assert.ok(redAt(plain, 102, 102));
    const noBase = paint({ layerAlign: true }, null);
    assert.deepEqual(noBase.align, { skipped: "no_base" });
    assert.equal(noBase.sha256, plain.sha256, "same bytes as without the flag");
  });

  it("adds the manual offset on top of the alignment", () => {
    const aligned = paint({ layerAlign: true }, png(base));
    const both = paint({ layerAlign: true, layerOffset: { x: 3, y: 0 } }, png(base));
    assert.ok(redAt(both, 100 + aligned.align.dx + 3 + 2, 100 + aligned.align.dy + 2));
  });
});
