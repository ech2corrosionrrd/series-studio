import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildRecipes,
  buildPrompt,
  dna,
  duplicates,
} from "../src/recipes.mjs";
import { loadTraitsFromPreset, NONE } from "../src/traits.mjs";
import {
  validatePreset,
  validatePresetSemantics,
  validateArchive,
} from "../src/validate.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const demoPath = join(__dirname, "..", "presets", "demo-series.json");

function loadDemo() {
  return JSON.parse(readFileSync(demoPath, "utf8"));
}

function withSize(preset, size) {
  const lines = preset.lines ? { ...preset.lines } : { default: {} };
  const ids = Object.keys(lines);
  const base = Math.floor(size / ids.length);
  let rem = size - base * ids.length;
  const next = {};
  for (const id of ids) {
    const q = base + (rem > 0 ? 1 : 0);
    if (rem > 0) rem--;
    next[id] = { ...lines[id], quota: q };
  }
  return { ...preset, size, lines: next, seed: `${preset.seed}-size-${size}` };
}

describe("demo preset", () => {
  it("validates against schema + semantics", () => {
    const preset = loadDemo();
    assert.equal(validatePreset(preset).ok, true);
    assert.equal(validatePresetSemantics(preset).ok, true);
  });
});

describe("seed stability", () => {
  it("two builds with same seed produce identical DNA lists", () => {
    const preset = loadDemo();
    const a = buildRecipes(preset).map((r) => r.dna);
    const b = buildRecipes(preset).map((r) => r.dna);
    assert.deepEqual(a, b);
    assert.equal(a.length, preset.size);
  });

  it("recipe seeds are deterministic from preset.seed + index", () => {
    const preset = loadDemo();
    const a = buildRecipes(preset).map((r) => r.seed);
    const b = buildRecipes(preset).map((r) => r.seed);
    assert.deepEqual(a, b);
  });
});

describe("golden builds", () => {
  it("size 20: unique recipes, valid prompts, no duplicates", () => {
    const preset = withSize(loadDemo(), 20);
    const recipes = buildRecipes(preset);
    assert.equal(recipes.length, 20);
    const keys = loadTraitsFromPreset(preset).map((t) => t.key);
    assert.deepEqual(duplicates(recipes, keys), []);
    for (const r of recipes) {
      assert.ok(r.prompt.includes("Change:"));
      assert.ok(r.prompt.length > 40);
      assert.equal(r.dna, dna(r.line, r.traits, keys));
      assert.equal(r.edition, r.index + 1);
    }
  });

  it("size 100: unique recipes, no duplicates", () => {
    const preset = withSize(loadDemo(), 100);
    const recipes = buildRecipes(preset);
    assert.equal(recipes.length, 100);
    const keys = loadTraitsFromPreset(preset).map((t) => t.key);
    assert.deepEqual(duplicates(recipes, keys), []);
    const dnas = new Set(recipes.map((r) => r.dna));
    assert.equal(dnas.size, 100);
  });

  it("demo size 48: duplicates empty after build", () => {
    const preset = loadDemo();
    const recipes = buildRecipes(preset);
    assert.equal(recipes.length, 48);
    const keys = loadTraitsFromPreset(preset).map((t) => t.key);
    assert.deepEqual(duplicates(recipes, keys), []);
  });
});

describe("buildPrompt", () => {
  it("uses who from line and skips None extras", () => {
    const preset = loadDemo();
    const traits = Object.fromEntries(
      loadTraitsFromPreset(preset).map((t) => [t.key, t.options[0].value]),
    );
    traits.headwear = NONE;
    traits.mark = NONE;
    const prompt = buildPrompt("a", traits, preset);
    assert.ok(prompt.includes("studio portrait subject"));
    assert.ok(!prompt.includes("Also add:"));
    assert.ok(prompt.endsWith("single character.") || prompt.includes("single character."));
  });

  it("includes Also add when extras are set", () => {
    const preset = loadDemo();
    const items = loadTraitsFromPreset(preset);
    const traits = Object.fromEntries(items.map((t) => [t.key, t.options[0].value]));
    const beanie = items.find((t) => t.key === "headwear").options.find((o) => o.value === "Beanie");
    traits.headwear = "Beanie";
    traits.mark = NONE;
    const prompt = buildPrompt("a", traits, preset);
    assert.ok(prompt.includes("Also add:"));
    assert.ok(prompt.includes(beanie.prompt));
  });
});

describe("archive shape", () => {
  it("produced archive validates", () => {
    const preset = withSize(loadDemo(), 20);
    const recipes = buildRecipes(preset);
    const archive = {
      schema: "series-archive/v0",
      presetId: preset.id,
      createdAt: "2026-09-21T23:00:00+03:00",
      seed: preset.seed,
      size: preset.size,
      recipes,
    };
    assert.equal(validateArchive(archive).ok, true);
  });
});
