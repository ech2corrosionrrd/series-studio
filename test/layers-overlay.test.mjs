import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodePngRgba } from "../src/dupes.mjs";
import { encodeRgbaPng } from "../src/png-fit.mjs";
import { composeEdition, overlaySet } from "../src/layers.mjs";
import { dna } from "../src/recipes.mjs";

function solid(w, h, r, g, b, a = 255) {
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = a;
  }
  return encodeRgbaPng(w, h, rgba);
}
const px = (png) => [...decodePngRgba(png).rgba.subarray(0, 4)];

const items = [
  { key: "bg", options: [{ value: "Red", prompt: "red" }, { value: "Blue", prompt: "blue" }] },
  { key: "hat", options: [{ value: "Crown", prompt: "crown" }, { value: "Cap", prompt: "cap" }] },
];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "overlay-"));
  const set = join(root, "set");
  const layers = join(root, "layers");
  mkdirSync(set, { recursive: true });
  mkdirSync(join(layers, "hat"), { recursive: true });
  // кадри, які «намалювала модель»: синя заливка 4x4
  for (const ed of [1, 2]) writeFileSync(join(set, `${ed}.png`), solid(4, 4, 0, 0, 200));
  // ручний шар лише для hat/Crown (2x2, буде масштабований до кадру); для hat/Cap файлу немає
  writeFileSync(join(layers, "hat", "Crown.png"), solid(2, 2, 250, 220, 0));
  const recipe = (edition, traits) => ({ edition, line: "A", traits, prompt: `p${edition}`, dna: dna("A", traits, ["bg", "hat"]) });
  const archive = { presetId: "x", recipes: [recipe(1, { bg: "Red", hat: "Crown" }), recipe(2, { bg: "Blue", hat: "Cap" })] };
  return { root, set, layers, archive };
}

test("composeEdition: skipMissing leaves a trait without a layer as the frame had it, and reports it", () => {
  const { root, layers, archive } = fixture();
  try {
    const frame = solid(4, 4, 0, 0, 200);
    const r = composeEdition({ recipe: archive.recipes[1], items, basePng: frame, layerDir: layers, skipMissing: true });
    assert.deepEqual(r.layers, ["base"]);
    assert.deepEqual(r.skipped, ["bg/Blue", "hat/Cap"], "traits without a layer file are reported, the model drew them");
    assert.deepEqual(px(r.png), [0, 0, 200, 255]);
    // без skipMissing поведінка стара: відсутній шар це помилка
    assert.throws(() => composeEdition({ recipe: archive.recipes[1], items, basePng: frame, layerDir: layers }), /missing layer bg=Blue/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("composeEdition: `only` restricts which traits are painted", () => {
  const { root, layers, archive } = fixture();
  try {
    const frame = solid(4, 4, 0, 0, 200);
    const painted = composeEdition({ recipe: archive.recipes[0], items, basePng: frame, layerDir: layers, only: ["hat"], skipMissing: true });
    assert.deepEqual(painted.layers, ["base", "hat/Crown"]);
    assert.deepEqual(px(painted.png), [250, 220, 0, 255]);
    const none = composeEdition({ recipe: archive.recipes[0], items, basePng: frame, layerDir: layers, only: ["bg"], skipMissing: true });
    assert.deepEqual(none.layers, ["base"], "bg has no layer file and is not in the layer set");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("overlaySet paints layers over the set's frames into a new folder and leaves the source alone", () => {
  const { root, set, layers, archive } = fixture();
  try {
    const out = join(root, "set-layers");
    const before = readFileSync(join(set, "1.png"));
    const report = overlaySet({ archive, items, setDir: set, layerDir: layers, outDir: out });
    assert.equal(report.source, "layers-over-set");
    assert.equal(report.over, "set");
    assert.equal(report.count, 2);
    assert.equal(report.painted, 1);
    assert.equal(report.unpainted, 1);
    assert.deepEqual(report.editions[0].layers, ["hat/Crown"]);
    assert.deepEqual(report.editions[0].skipped, ["bg/Red"]);
    assert.deepEqual(report.editions[1].skipped, ["bg/Blue", "hat/Cap"]);
    assert.deepEqual(px(readFileSync(join(out, "1.png"))), [250, 220, 0, 255]);
    assert.deepEqual(px(readFileSync(join(out, "2.png"))), [0, 0, 200, 255]);
    assert.ok(readFileSync(join(set, "1.png")).equals(before), "source frame is untouched");
    assert.equal(JSON.parse(readFileSync(join(out, "dna.json"), "utf8")).painted, 1);
    assert.ok(readdirSync(out).includes("dna.json"));
    // повторний запуск дає ті самі байти (детермінізм)
    const again = overlaySet({ archive, items, setDir: set, layerDir: layers, outDir: out });
    assert.equal(again.editions[0].sha256, report.editions[0].sha256);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("overlaySet reports editions without a frame and refuses unusable input", () => {
  const { root, set, layers, archive } = fixture();
  try {
    rmSync(join(set, "2.png"));
    const out = join(root, "o");
    const r = overlaySet({ archive, items, setDir: set, layerDir: layers, outDir: out });
    assert.deepEqual(r.missingFrames, [2]);
    assert.equal(r.count, 1);
    assert.throws(() => overlaySet({ archive, items, setDir: set, layerDir: layers, outDir: set }), /must differ/);
    assert.throws(() => overlaySet({ archive: { recipes: [] }, items, setDir: set, layerDir: layers, outDir: out }), /no recipes/);
    const empty = join(root, "empty");
    mkdirSync(empty);
    assert.throws(() => overlaySet({ archive, items, setDir: empty, layerDir: layers, outDir: join(root, "o2") }), /no frames/);
    assert.equal(existsSync(join(root, "o2", "dna.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
