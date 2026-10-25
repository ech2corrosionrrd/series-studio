// layerOffset moves a trait's PNG layer in frame pixels, so a layer drawn on the base can be put back onto a face
// the model redrew a little higher or lower. No offset = the old bytes.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { composeEdition, shiftRgba, traitLayerOffset } from "../src/layers.mjs";
import { decodePngRgba } from "../src/dupes.mjs";
import { encodeRgbaPng } from "../src/png-fit.mjs";

const W = 6;
const H = 5;

function pngWith(pixels, fill = [0, 0, 0, 0]) {
  const rgba = Buffer.alloc(W * H * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba.set(fill, i);
  for (const [x, y, c] of pixels) rgba.set(c, (y * W + x) * 4);
  return encodeRgbaPng(W, H, rgba);
}

const RED = [220, 20, 20, 255];
const baseBuf = pngWith([], [10, 10, 10, 255]);
const layerBuf = pngWith([[1, 1, RED]]);

function paint(trait) {
  const items = [{ key: "mark", ...trait, options: [{ value: "None" }, { value: "Dot", weight: 1 }] }];
  const out = composeEdition({
    recipe: { edition: 1, line: "a", traits: { mark: "Dot" } },
    items,
    basePng: baseBuf,
    layerDir: "/layers",
    readFile: () => layerBuf,
  });
  return decodePngRgba(out.png).rgba;
}

const redAt = (rgba) => {
  const hits = [];
  for (let p = 0; p < W * H; p += 1) if (rgba[p * 4] === RED[0] && rgba[p * 4 + 1] === RED[1]) hits.push([p % W, Math.floor(p / W)]);
  return hits;
};

describe("traitLayerOffset", () => {
  it("reads whole pixels and ignores nothing-to-move values", () => {
    assert.deepEqual(traitLayerOffset({ layerOffset: { x: 3, y: -2 } }), { x: 3, y: -2 });
    assert.deepEqual(traitLayerOffset({ layerOffset: { x: "4.4", y: 1 } }), { x: 4, y: 1 });
    for (const bad of [undefined, null, {}, { layerOffset: null }, { layerOffset: "x" }, { layerOffset: { x: 0, y: 0 } }, { layerOffset: { x: "a", y: "b" } }]) {
      assert.equal(traitLayerOffset(bad), null, JSON.stringify(bad));
    }
  });
});

describe("shiftRgba", () => {
  it("moves a pixel, drops what leaves the frame and fills the rest with transparency", () => {
    const rgba = Buffer.alloc(W * H * 4);
    rgba.set(RED, (1 * W + 1) * 4);
    rgba.set(RED, (0 * W + 5) * 4);
    const moved = shiftRgba(rgba, W, H, 2, 3);
    assert.deepEqual(redAt(moved), [[3, 4]], "the pixel at (5,0) left the frame");
    assert.equal(moved.length, rgba.length);
    assert.equal(shiftRgba(rgba, W, H, 0, 0), rgba, "no offset returns the same buffer");
  });

  it("negative offsets move left and up, and a shift larger than the frame empties it", () => {
    const rgba = Buffer.alloc(W * H * 4);
    rgba.set(RED, (3 * W + 4) * 4);
    assert.deepEqual(redAt(shiftRgba(rgba, W, H, -2, -1)), [[2, 2]]);
    assert.deepEqual(redAt(shiftRgba(rgba, W, H, 99, 0)), []);
    assert.deepEqual(redAt(shiftRgba(rgba, W, H, 0, -99)), []);
  });
});

describe("composeEdition with layerOffset", () => {
  it("without an offset the layer stays where it was drawn", () => {
    assert.deepEqual(redAt(paint({})), [[1, 1]]);
    assert.deepEqual(redAt(paint({ layerOffset: { x: 0, y: 0 } })), [[1, 1]]);
  });

  it("with an offset the same layer lands that many pixels away, and the rest of the frame is untouched", () => {
    const before = paint({});
    const after = paint({ layerOffset: { x: 2, y: 1 } });
    assert.deepEqual(redAt(after), [[3, 2]]);
    const differing = [];
    for (let p = 0; p < W * H; p += 1) if (before.compare(after, p * 4, p * 4 + 4, p * 4, p * 4 + 4) !== 0) differing.push(p);
    assert.deepEqual(differing.sort((a, b) => a - b), [1 * W + 1, 2 * W + 3], "only the old and the new position changed");
  });
});

describe("the editor wiring", () => {
  const app = readFileSync(new URL("../server/ui/app.js", import.meta.url), "utf8");
  it("both offset fields are read into and written from trait.layerOffset, and cleared at 0/0", () => {
    assert.match(app, /trait\.layerOffset\?\.\[axis\]/);
    assert.match(app, /else trait\.layerOffset = next;/);
    assert.match(app, /next\.x === 0 && next\.y === 0\) delete trait\.layerOffset/);
  });
});
