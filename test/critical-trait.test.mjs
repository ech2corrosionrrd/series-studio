// A critical trait (trait.layerOnly) is painted from a PNG layer: it stays out of the model prompt,
// DNA and rarity are untouched, and the layers status names the layer files that are still missing.
import { describe, it } from "node:test";
import { readUiSource } from "../scripts/ui-source.mjs";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPrompt, dnaKeysFromItems } from "../src/recipes.mjs";
import { layersStatus } from "../src/layers-zip.mjs";
import { loadTraitsFromPreset } from "../src/traits.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const loadDemo = () => JSON.parse(readFileSync(join(ROOT, "presets", "demo-series.json"), "utf8"));
const firstValues = (preset) => Object.fromEntries(loadTraitsFromPreset(preset).map((t) => [t.key, t.options[0].value]));
const promptKeys = (preset) => [...(preset.promptTemplate.changeKeys || []), ...(preset.promptTemplate.extraKeys || [])];

describe("layerOnly in the prompt", () => {
  it("a critical trait is left out of the prompt, the others stay", () => {
    const preset = loadDemo();
    const key = promptKeys(preset).find((k) => preset.traits.items.find((t) => t.key === k).options[0].prompt);
    const traits = firstValues(preset);
    const fragment = preset.traits.items.find((t) => t.key === key).options[0].prompt;
    assert.ok(buildPrompt("a", traits, preset).includes(fragment), "precondition: the fragment is in the prompt");
    preset.traits.items.find((t) => t.key === key).layerOnly = true;
    const after = buildPrompt("a", traits, preset);
    assert.ok(!after.includes(fragment));
    assert.ok(after.length > 0);
  });

  it("false or absent layerOnly changes nothing", () => {
    const preset = loadDemo();
    const traits = firstValues(preset);
    const before = buildPrompt("a", traits, preset);
    for (const t of preset.traits.items) t.layerOnly = false;
    assert.equal(buildPrompt("a", traits, preset), before);
  });

  it("DNA keys do not depend on layerOnly", () => {
    const preset = loadDemo();
    const before = dnaKeysFromItems(preset.traits.items);
    for (const t of preset.traits.items) t.layerOnly = true;
    assert.deepEqual(dnaKeysFromItems(preset.traits.items), before);
  });
});

describe("layersStatus and critical traits", () => {
  const items = [
    { key: "scar", layerOnly: true, options: [{ value: "None" }, { value: "Cheek" }, { value: "Brow" }] },
    { key: "hat", options: [{ value: "Cap" }] },
  ];

  it("names the missing layers of critical traits only", () => {
    const dir = mkdtempSync(join(tmpdir(), "series-critical-"));
    try {
      mkdirSync(join(dir, "scar"), { recursive: true });
      writeFileSync(join(dir, "scar", "Cheek.png"), Buffer.from([0]));
      const c = layersStatus(dir, items).coverage;
      assert.equal(c.missingCount, 2, "Brow and Cap");
      assert.equal(c.criticalMissingCount, 1);
      assert.deepEqual(c.criticalMissing.map((x) => x.replaceAll("\\", "/")), ["scar/Brow.png"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("an empty folder still reports the critical layers as missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "series-critical-"));
    try {
      const s = layersStatus(dir, items);
      assert.equal(s.exists, false);
      assert.equal(s.coverage.criticalMissingCount, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the editor wiring", () => {
  const app = readUiSource();
  it("the checkbox reads and writes trait.layerOnly, and removes the field when off", () => {
    assert.match(app, /layerOnly\.checked = trait\.layerOnly === true/);
    assert.match(app, /trait\.layerOnly = true;\r?\n\s*else delete trait\.layerOnly;/);
  });
});
