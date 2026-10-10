import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { composeArchive, overlaySet, previewEdition } from "../src/layers.mjs";
import { decodePngRgba } from "../src/dupes.mjs";
import { encodeRgbaPng } from "../src/png-fit.mjs";
import { dna } from "../src/recipes.mjs";

function solidPng(r, g, b, a = 255) {
  const rgba = Buffer.alloc(2 * 2 * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = a;
  }
  return encodeRgbaPng(2, 2, rgba);
}

const items = [
  { key: "bg", options: [{ value: "Red", prompt: "r" }, { value: "Blue", prompt: "b" }] },
  { key: "fx", options: [{ value: "Glow", prompt: "g" }, { value: "None", prompt: "" }] },
];
const mkRecipe = (edition, traits) => ({ edition, line: "A", traits, prompt: `p${edition}`, dna: dna("A", traits, ["bg", "fx"]) });
const archive = {
  recipes: [mkRecipe(1, { bg: "Red", fx: "Glow" }), mkRecipe(2, { bg: "Blue", fx: "None" }), mkRecipe(3, { bg: "Red", fx: "None" })],
};

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "series-preview-"));
  const layers = join(dir, "layers");
  mkdirSync(join(layers, "bg"), { recursive: true });
  mkdirSync(join(layers, "fx"), { recursive: true });
  writeFileSync(join(layers, "bg", "Red.png"), solidPng(200, 0, 0));
  writeFileSync(join(layers, "bg", "Blue.png"), solidPng(0, 0, 200));
  // fx/Glow has no file on purpose: in the hybrid mode it must stay as the model drew it
  const set = join(dir, "set");
  mkdirSync(set);
  for (const ed of [1, 2, 3]) writeFileSync(join(set, `${ed}.png`), solidPng(ed * 10, 9, 9));
  return { dir, layers, set };
}
const px = (png) => [...decodePngRgba(png).rgba.subarray(0, 4)];

describe("single frame preview", () => {
  it("full stack: the preview is byte-identical to the frame composeArchive writes", () => {
    const { dir, layers } = setup();
    try {
      const base = solidPng(0, 0, 40);
      const itemsFull = [items[0]];
      const archiveFull = { recipes: archive.recipes.map((r) => ({ ...r, dna: dna("A", r.traits, ["bg"]) })) };
      const out = join(dir, "out");
      composeArchive({ archive: archiveFull, items: itemsFull, basePng: base, layerDir: layers, outDir: out });
      for (const ed of [1, 2, 3]) {
        const p = previewEdition({ archive: archiveFull, items: itemsFull, edition: ed, basePng: base, layerDir: layers });
        assert.equal(Buffer.compare(p.png, readFileSync(join(out, `${ed}.png`))), 0, `edition ${ed}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("hybrid: the preview equals the frame overlaySet writes, and an unpainted trait stays", () => {
    const { dir, layers, set } = setup();
    try {
      const out = join(dir, "out");
      overlaySet({ archive, items, setDir: set, layerDir: layers, outDir: out });
      for (const ed of [1, 2, 3]) {
        const p = previewEdition({ archive, items, edition: ed, basePng: readFileSync(join(set, `${ed}.png`)), layerDir: layers, skipMissing: true });
        assert.equal(Buffer.compare(p.png, readFileSync(join(out, `${ed}.png`))), 0, `edition ${ed}`);
      }
      const p1 = previewEdition({ archive, items, edition: 1, basePng: readFileSync(join(set, "1.png")), layerDir: layers, skipMissing: true });
      assert.deepEqual(p1.skipped, ["fx/Glow"]);
      assert.deepEqual(p1.layers, ["base", "bg/Red"]);
      assert.deepEqual(px(p1.png), [200, 0, 0, 255]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes nothing: the layers and set folders are untouched", () => {
    const { dir, layers, set } = setup();
    try {
      const before = [readdirSync(dir).sort(), readdirSync(set).sort(), readdirSync(join(layers, "bg")).sort()];
      previewEdition({ archive, items, edition: 2, basePng: readFileSync(join(set, "2.png")), layerDir: layers, skipMissing: true });
      assert.deepEqual([readdirSync(dir).sort(), readdirSync(set).sort(), readdirSync(join(layers, "bg")).sort()], before);
      assert.equal(existsSync(join(dir, "out")), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("an edition that is not in the archive is a 404, bad numbers too", () => {
    const { dir, layers, set } = setup();
    try {
      const basePng = readFileSync(join(set, "1.png"));
      for (const bad of [99, 0, -1, 1.5, "abc", null, undefined]) {
        assert.throws(
          () => previewEdition({ archive, items, edition: bad, basePng, layerDir: layers, skipMissing: true }),
          (e) => e.status === 404 && /not in the archive/.test(e.message),
          String(bad),
        );
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the full-stack mode still demands every layer, like the real compose", () => {
    const { dir, layers } = setup();
    try {
      assert.throws(
        () => previewEdition({ archive, items, edition: 1, basePng: solidPng(0, 0, 0), layerDir: layers }),
        /missing layer fx=Glow/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("honours `only` and the trait order z", () => {
    const { dir, layers, set } = setup();
    try {
      const basePng = readFileSync(join(set, "1.png"));
      const none = previewEdition({ archive, items, edition: 1, basePng, layerDir: layers, only: ["fx"], skipMissing: true });
      assert.deepEqual(none.layers, ["base"]);
      assert.deepEqual(px(none.png), px(basePng));
      const withZ = [{ ...items[0], z: 5 }, items[1]];
      const z = previewEdition({ archive, items: withZ, edition: 1, basePng, layerDir: layers, skipMissing: true });
      assert.deepEqual(z.layers, ["base", "bg/Red"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("series compose --preview (CLI)", () => {
  const CLI = fileURLToPath(new URL("../bin/series.mjs", import.meta.url));

  function cliSetup() {
    const { dir, layers, set } = setup();
    const full = [items[0]];
    const arch = { presetId: "x", recipes: archive.recipes.map((r) => ({ ...r, dna: dna("A", r.traits, ["bg"]) })) };
    writeFileSync(join(dir, "archive.json"), JSON.stringify(arch));
    writeFileSync(join(dir, "preset.json"), JSON.stringify({ traits: { items: full } }));
    writeFileSync(join(dir, "base.png"), solidPng(0, 0, 40));
    return { dir, layers, set, arch, full };
  }
  const run = (dir, args) =>
    spawnSync(process.execPath, [CLI, "compose", join(dir, "archive.json"), "--preset", join(dir, "preset.json"), ...args], { encoding: "utf8", cwd: dir });

  it("writes one PNG equal to the frame the full compose writes, and no set or dna.json", () => {
    const { dir, layers, arch, full } = cliSetup();
    try {
      const out = join(dir, "frame.png");
      const r = run(dir, ["--layers", layers, "--base", join(dir, "base.png"), "--preview", "2", "-o", out]);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /Preview of edition 2/);
      const full2 = join(dir, "full");
      composeArchive({ archive: arch, items: full, basePng: readFileSync(join(dir, "base.png")), layerDir: layers, outDir: full2 });
      assert.equal(Buffer.compare(readFileSync(out), readFileSync(join(full2, "2.png"))), 0);
      assert.equal(existsSync(join(dir, "out")), false, "no out/ set was created");
      assert.equal(existsSync(join(dir, "dna.json")), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("hybrid: reads the frame of the set and paints the layers over it", () => {
    const { dir, layers, set } = cliSetup();
    try {
      const out = join(dir, "h.png");
      const r = run(dir, ["--layers", layers, "--over", set, "--preview", "1", "-o", out]);
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(px(readFileSync(out)), [200, 0, 0, 255]);
      assert.equal(existsSync(join(dir, "set-layers")), false, "the hybrid set was not created");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a bad number, an edition outside the archive and a missing frame", () => {
    const { dir, layers, set } = cliSetup();
    try {
      for (const bad of ["abc", "0", "-3", "1.5"]) {
        const r = run(dir, ["--layers", layers, "--base", join(dir, "base.png"), "--preview", bad]);
        assert.equal(r.status, 1, bad);
        assert.match(r.stderr, /edition number/);
      }
      const nope = run(dir, ["--layers", layers, "--base", join(dir, "base.png"), "--preview", "99"]);
      assert.equal(nope.status, 1);
      assert.match(nope.stderr, /not in the archive/);
      const noFrame = run(dir, ["--layers", layers, "--over", set, "--preview", "40"]);
      assert.equal(noFrame.status, 1);
      assert.match(noFrame.stderr, /frame is missing/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
