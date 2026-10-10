import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { composeEdition, overlaySet, paintOrder, traitZ } from "../src/layers.mjs";
import { decodePngRgba } from "../src/dupes.mjs";
import { encodeRgbaPng } from "../src/png-fit.mjs";
import { buildPrompt, buildRecipes, dna } from "../src/recipes.mjs";
import { runChecklist } from "../src/checklist.mjs";
import { loadTraitsFromPreset } from "../src/traits.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const loadDemo = () => JSON.parse(readFileSync(join(ROOT, "presets", "demo-series.json"), "utf8"));

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
const firstPixel = (png) => [...decodePngRgba(png).rgba.subarray(0, 4)];

describe("layer paint order (z)", () => {
  it("traitZ accepts finite numbers and numeric strings only", () => {
    assert.equal(traitZ({ z: 3 }), 3);
    assert.equal(traitZ({ z: "5" }), 5);
    assert.equal(traitZ({ z: -2 }), -2);
    assert.equal(traitZ({ z: 0 }), 0);
    for (const bad of [undefined, null, "", "abc", NaN, Infinity]) assert.equal(traitZ({ z: bad }), null, String(bad));
    assert.equal(traitZ(null), null);
  });

  it("without z the order is the preset order", () => {
    const items = [{ key: "a" }, { key: "b" }, { key: "c" }];
    assert.deepEqual(paintOrder(items).map((t) => t.key), ["a", "b", "c"]);
    assert.deepEqual(paintOrder([]), []);
    assert.deepEqual(paintOrder(undefined), []);
  });

  it("a lower z paints earlier, a higher z later, and ties keep the preset order", () => {
    const items = [{ key: "a", z: 10 }, { key: "b" }, { key: "c", z: -1 }, { key: "d", z: 10 }];
    // b has no z: takes its index 1, so c(-1) < b(1) < a(10) = d(10), a before d
    assert.deepEqual(paintOrder(items).map((t) => t.key), ["c", "b", "a", "d"]);
  });

  it("does not mutate the items", () => {
    const items = [{ key: "a", z: 5 }, { key: "b", z: 1 }];
    const copy = JSON.stringify(items);
    paintOrder(items);
    assert.equal(JSON.stringify(items), copy);
  });

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), "series-z-"));
    mkdirSync(join(dir, "red"), { recursive: true });
    mkdirSync(join(dir, "green"), { recursive: true });
    writeFileSync(join(dir, "red", "On.png"), solidPng(255, 0, 0));
    writeFileSync(join(dir, "green", "On.png"), solidPng(0, 255, 0));
    return dir;
  }
  const itemsOf = (zRed, zGreen) => [
    { key: "red", ...(zRed === undefined ? {} : { z: zRed }), options: [{ value: "On", prompt: "r" }] },
    { key: "green", ...(zGreen === undefined ? {} : { z: zGreen }), options: [{ value: "On", prompt: "g" }] },
  ];
  const recipeFor = (items) => {
    const traits = { red: "On", green: "On" };
    return { edition: 1, line: "A", traits, prompt: "p", dna: dna("A", traits, items.map((t) => t.key)) };
  };

  it("composeEdition: the later trait is on top by default, z flips it", () => {
    const dir = setup();
    try {
      const base = solidPng(0, 0, 0);
      const def = itemsOf();
      const flipped = itemsOf(5, undefined); // red goes above green
      const a = composeEdition({ recipe: recipeFor(def), items: def, basePng: base, layerDir: dir });
      const b = composeEdition({ recipe: recipeFor(flipped), items: flipped, basePng: base, layerDir: dir });
      assert.deepEqual(firstPixel(a.png), [0, 255, 0, 255], "default: green (second) on top");
      assert.deepEqual(firstPixel(b.png), [255, 0, 0, 255], "z: red on top");
      assert.deepEqual(a.layers, ["base", "red/On", "green/On"]);
      assert.deepEqual(b.layers, ["base", "green/On", "red/On"]);
      // z moves pixels only: the DNA of the edition is the same
      assert.equal(a.dna, b.dna);
      assert.equal(a.dna, "A|On|On");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("composeEdition is deterministic with z", () => {
    const dir = setup();
    try {
      const items = itemsOf(2, 1);
      const r = recipeFor(items);
      const base = solidPng(0, 0, 0);
      const a = composeEdition({ recipe: r, items, basePng: base, layerDir: dir });
      const b = composeEdition({ recipe: r, items, basePng: base, layerDir: dir });
      assert.equal(a.sha256, b.sha256);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("overlaySet (hybrid mode) honours z too", () => {
    const dir = setup();
    const setDir = join(dir, "set");
    mkdirSync(setDir);
    writeFileSync(join(setDir, "1.png"), solidPng(9, 9, 9));
    try {
      const items = itemsOf(5, undefined);
      const archive = { recipes: [recipeFor(items)] };
      overlaySet({ archive, items, setDir, layerDir: dir, outDir: join(dir, "out") });
      assert.deepEqual(firstPixel(readFileSync(join(dir, "out", "1.png"))), [255, 0, 0, 255]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a preset without z paints exactly as before (same bytes as an explicit index order)", () => {
    const dir = setup();
    try {
      const plain = itemsOf();
      const explicit = itemsOf(0, 1);
      const base = solidPng(0, 0, 0);
      const a = composeEdition({ recipe: recipeFor(plain), items: plain, basePng: base, layerDir: dir });
      const b = composeEdition({ recipe: recipeFor(explicit), items: explicit, basePng: base, layerDir: dir });
      assert.equal(a.sha256, b.sha256);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("styleLock in the prompt", () => {
  const traitsOf = (preset) => {
    const items = loadTraitsFromPreset(preset);
    return Object.fromEntries(items.map((t) => [t.key, t.options[0].value]));
  };

  it("no styleLock: no Style lock paragraph", () => {
    const preset = loadDemo();
    delete preset.styleLock;
    assert.ok(!buildPrompt("a", traitsOf(preset), preset).includes("Style lock"));
  });

  it("an empty or blank styleLock adds nothing", () => {
    const preset = loadDemo();
    delete preset.styleLock;
    const without = buildPrompt("a", traitsOf(preset), preset);
    for (const lock of [{}, { angle: "", light: "   ", mood: null, extraKeep: [] }, "text", 42, null]) {
      preset.styleLock = lock;
      assert.equal(buildPrompt("a", traitsOf(preset), preset), without, JSON.stringify(lock));
    }
  });

  it("writes the fields in a fixed order and skips the empty ones", () => {
    const preset = loadDemo();
    preset.styleLock = { framing: "bust", mood: "calm", light: "  soft  ", angle: "" };
    const p = buildPrompt("a", traitsOf(preset), preset);
    assert.ok(p.includes("Style lock: light: soft; mood: calm; framing: bust."), p);
    assert.ok(!p.includes("angle:"));
  });

  it("extraKeep joins the keep part, before Change and the Style lock paragraph", () => {
    const preset = loadDemo();
    preset.styleLock = { angle: "front", extraKeep: ["no text", "  ", "no logo"] };
    const traits = traitsOf(preset);
    const p = buildPrompt("a", traits, preset);
    const keepAt = p.indexOf("no text, no logo");
    assert.ok(keepAt >= 0, p);
    assert.ok(p.indexOf("Style lock: angle: front.") > keepAt);
  });

  it("extraKeep given as one string is split per line (UI textarea, API)", () => {
    const preset = loadDemo();
    preset.styleLock = { extraKeep: "no text\r\n\nno watermark\n" };
    const p = buildPrompt("a", traitsOf(preset), preset);
    assert.ok(p.includes("no text, no watermark"), p);
    preset.styleLock = { extraKeep: 7 };
    assert.ok(!buildPrompt("a", traitsOf(preset), preset).includes("7"));
  });

  it("the lock is in every recipe of an archive, and the archive stays reproducible", () => {
    const preset = loadDemo();
    preset.styleLock = { angle: "chest-up centered", light: "soft studio", mood: "calm", framing: "square portrait" };
    const a = buildRecipes(preset);
    const b = buildRecipes(preset);
    assert.ok(a.length > 1);
    for (const r of a) assert.ok(r.prompt.includes("Style lock: angle: chest-up centered; light: soft studio; mood: calm; framing: square portrait."));
    assert.deepEqual(a.map((r) => r.prompt), b.map((r) => r.prompt));
  });

  it("styleLock changes the prompt but not the DNA", () => {
    const preset = loadDemo();
    delete preset.styleLock;
    const plain = buildRecipes(preset);
    preset.styleLock = { angle: "front", extraKeep: ["no text"] };
    const locked = buildRecipes(preset);
    assert.deepEqual(plain.map((r) => r.dna), locked.map((r) => r.dna));
    assert.notEqual(plain[0].prompt, locked[0].prompt);
  });

  it("the checklist notices a lock from any one field", () => {
    const preset = loadDemo();
    const level = (lock) => {
      preset.styleLock = lock;
      return runChecklist({ preset }).find((i) => i.id === "styleLock").level;
    };
    assert.equal(level(undefined), "warn");
    assert.equal(level({}), "warn");
    assert.equal(level({ mood: "calm" }), "ok");
    assert.equal(level({ extraKeep: ["no text"] }), "ok");
  });
});
