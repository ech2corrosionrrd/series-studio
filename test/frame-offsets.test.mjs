// Per-frame offset of the hand layers (kept with the set) and where a `-layers` set came from.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FRAME_OFFSETS_FILE, MAX_FRAME_OFFSET, frameOffsetFor, normalizeFrameOffset, readFrameOffsets, writeFrameOffset } from "../src/frame-offsets.mjs";
import { composeEdition, overlaySet, previewEdition } from "../src/layers.mjs";
import { readSetLineage } from "../src/set-lineage.mjs";
import { decodePngRgba } from "../src/dupes.mjs";
import { encodeRgbaPng } from "../src/png-fit.mjs";

const W = 8;
const H = 6;
const RED = [220, 20, 20, 255];
const png = (pixels, fill = [10, 10, 10, 255]) => {
  const rgba = Buffer.alloc(W * H * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba.set(fill, i);
  for (const [x, y, c] of pixels) rgba.set(c, (y * W + x) * 4);
  return encodeRgbaPng(W, H, rgba);
};
const frame = png([]);
const layer = encodeRgbaPng(W, H, (() => {
  const rgba = Buffer.alloc(W * H * 4);
  rgba.set(RED, (1 * W + 1) * 4);
  return rgba;
})());
const redAt = (buf) => {
  const rgba = decodePngRgba(buf).rgba;
  const hits = [];
  for (let p = 0; p < W * H; p += 1) if (rgba[p * 4] === RED[0] && rgba[p * 4 + 1] === RED[1]) hits.push([p % W, Math.floor(p / W)]);
  return hits;
};

describe("frame offsets file", () => {
  it("normalises to whole pixels, treats 0/0 as nothing and refuses a value past the limit", () => {
    assert.deepEqual(normalizeFrameOffset({ x: "3.4", y: -2 }), { x: 3, y: -2 });
    for (const none of [null, undefined, {}, { x: 0, y: 0 }, "x", { x: "a", y: "b" }]) assert.equal(normalizeFrameOffset(none), null, JSON.stringify(none));
    assert.throws(() => normalizeFrameOffset({ x: MAX_FRAME_OFFSET + 1, y: 0 }), /within/);
  });

  it("writes, reads, replaces and clears one frame without touching the others", () => {
    const dir = mkdtempSync(join(tmpdir(), "series-fo-"));
    assert.deepEqual(readFrameOffsets(dir), {});
    writeFrameOffset(dir, 3, 7, -2);
    writeFrameOffset(dir, 5, 1, 1);
    assert.deepEqual(readFrameOffsets(dir), { 3: { x: 7, y: -2 }, 5: { x: 1, y: 1 } });
    assert.deepEqual(frameOffsetFor(readFrameOffsets(dir), 3), { x: 7, y: -2 });
    assert.equal(frameOffsetFor(readFrameOffsets(dir), 4), null);
    writeFrameOffset(dir, 3, 0, 0);
    assert.deepEqual(readFrameOffsets(dir), { 5: { x: 1, y: 1 } }, "0/0 clears frame 3 only");
    assert.throws(() => writeFrameOffset(dir, 0, 1, 1), /whole number from 1/);
    assert.throws(() => writeFrameOffset(dir, 2, 99999, 0), /within/);
  });

  it("ignores a broken file and bad entries instead of failing the preview", () => {
    const dir = mkdtempSync(join(tmpdir(), "series-fo-"));
    writeFileSync(join(dir, FRAME_OFFSETS_FILE), "{ broken");
    assert.deepEqual(readFrameOffsets(dir), {});
    writeFileSync(join(dir, FRAME_OFFSETS_FILE), JSON.stringify({ "2": { x: 4, y: 0 }, "x": { x: 1, y: 1 }, "3": { x: 99999, y: 0 }, "4": "no", "0": { x: 1, y: 1 } }));
    assert.deepEqual(readFrameOffsets(dir), { 2: { x: 4, y: 0 } });
  });
});

describe("composeEdition with a frame offset", () => {
  const items = [{ key: "mark", layerOffset: { x: 1, y: 0 }, options: [{ value: "None" }, { value: "Dot", weight: 1 }] }];
  const paint = (frameOffset) =>
    composeEdition({ recipe: { edition: 1, line: "a", traits: { mark: "Dot" } }, items, basePng: frame, layerDir: "/layers", readFile: () => layer, skipMissing: true, frameOffset });

  it("adds to the trait offset and leaves the old bytes without it", () => {
    assert.deepEqual(redAt(paint(null).png), [[2, 1]], "only the trait offset (+1, 0)");
    assert.deepEqual(redAt(paint({ x: 2, y: 3 }).png), [[4, 4]], "trait (+1, 0) plus frame (+2, +3)");
    assert.equal(paint(null).sha256, paint(undefined).sha256);
  });

  it("is used by the preview too", () => {
    const archive = { recipes: [{ edition: 1, line: "a", traits: { mark: "Dot" } }] };
    const out = previewEdition({ archive, items, edition: 1, basePng: frame, layerDir: "/layers", readFile: () => layer, skipMissing: true, frameOffset: { x: -1, y: 2 } });
    assert.deepEqual(redAt(out.png), [[1, 3]]);
  });
});

describe("hybrid compose reads the offsets of its set", () => {
  const items = [{ key: "mark", options: [{ value: "None" }, { value: "Dot", weight: 1 }] }];
  const archive = {
    recipes: [
      { edition: 1, line: "a", traits: { mark: "Dot" } },
      { edition: 2, line: "a", traits: { mark: "Dot" } },
    ],
  };

  function setup() {
    const root = mkdtempSync(join(tmpdir(), "series-fo-set-"));
    const setDir = join(root, "kontext");
    mkdirSync(setDir, { recursive: true });
    for (const n of [1, 2]) writeFileSync(join(setDir, `${n}.png`), frame);
    const outDir = join(root, "kontext-layers");
    return { root, setDir, outDir };
  }
  const run = ({ setDir, outDir }) => overlaySet({ archive, items, setDir, layerDir: "/layers", outDir, readFile: (f) => (String(f).endsWith("Dot.png") ? layer : readFileSync(f)) });

  it("moves only the frames that have an offset and reports them", () => {
    const s = setup();
    writeFrameOffset(s.setDir, 2, 3, 2);
    const report = run(s);
    assert.equal(report.frameOffsetFrames, 1);
    assert.deepEqual(redAt(readFileSync(join(s.outDir, "1.png"))), [[1, 1]], "frame 1 has no offset");
    assert.deepEqual(redAt(readFileSync(join(s.outDir, "2.png"))), [[4, 3]], "frame 2 moved by (+3, +2)");
    assert.deepEqual(report.editions.find((e) => e.edition === 2).frameOffset, { x: 3, y: 2 });
    assert.equal(report.editions.find((e) => e.edition === 1).frameOffset, undefined);
  });

  it("reports where the new set came from, on both sides", () => {
    const s = setup();
    run(s);
    const out = readSetLineage(s.root, "kontext-layers");
    assert.deepEqual(out.derivedFrom, { set: "kontext", painted: 2, count: 2 });
    assert.deepEqual(out.derived, []);
    const src = readSetLineage(s.root, "kontext");
    assert.equal(src.derivedFrom, null);
    assert.deepEqual(src.derived, [{ set: "kontext-layers", painted: 2, count: 2 }]);
    assert.deepEqual(readSetLineage(s.root, "unrelated"), { derivedFrom: null, derived: [] });
  });
});
