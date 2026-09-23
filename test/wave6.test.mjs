import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveBaseImageForRecipe,
  filterRedoEditions,
  filterRedoRecipes,
  validateTraitPack,
  exportPresetAsTraitPack,
} from "../src/index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const preset = JSON.parse(readFileSync(join(ROOT, "presets", "demo-series.json"), "utf8"));

describe("Wave 6: Line-specific base image resolution", () => {
  const bases = [
    { file: "primary.png", primary: true, role: "primary", line: null },
    { file: "base-cyborg.png", primary: false, role: "line", line: "cyborg" },
    { file: "base-alien.png", primary: false, role: "line", line: "alien" },
  ];

  it("resolves exact line match if line-specific base exists", () => {
    const resCyborg = resolveBaseImageForRecipe({ line: "cyborg" }, bases);
    assert.equal(resCyborg.file, "base-cyborg.png");

    const resAlien = resolveBaseImageForRecipe({ line: "alien" }, bases);
    assert.equal(resAlien.file, "base-alien.png");
  });

  it("falls back to primary base if line has no specific base", () => {
    const resOther = resolveBaseImageForRecipe({ line: "human" }, bases);
    assert.equal(resOther.file, "primary.png");
  });

  it("handles empty or missing bases safely", () => {
    assert.equal(resolveBaseImageForRecipe({ line: "cyborg" }, []), null);
    assert.equal(resolveBaseImageForRecipe({ line: "cyborg" }, null), null);
  });
});

describe("Wave 6: Redo filtering helpers", () => {
  const marks = {
    "1": "keep",
    "2": "redo",
    "3": "keep",
    "7": "redo",
    "15": "redo",
    "bad": "redo",
  };

  it("filterRedoEditions returns sorted positive integer editions", () => {
    const eds = filterRedoEditions(marks);
    assert.deepEqual(eds, [2, 7, 15]);
  });

  it("filterRedoRecipes filters matching recipes", () => {
    const recipes = [
      { edition: 1, prompt: "p1" },
      { edition: 2, prompt: "p2" },
      { edition: 3, prompt: "p3" },
      { edition: 7, prompt: "p7" },
    ];
    const filtered = filterRedoRecipes(recipes, marks);
    assert.deepEqual(filtered.map((r) => r.edition), [2, 7]);
  });
});

describe("Wave 6: Trait pack validation and export", () => {
  it("validates clean trait pack", () => {
    const pack = {
      schema: "series-trait-pack/v0",
      id: "my-custom-pack",
      name: "My Custom Pack",
      description: "A test pack",
      items: [
        {
          key: "hair",
          type: "Hair",
          options: [
            { value: "Buzz", weight: 5, prompt: "buzz cut" },
            { value: "Long", weight: 5, prompt: "long hair" },
          ],
        },
      ],
    };
    const res = validateTraitPack(pack);
    assert.equal(res.ok, true);
  });

  it("catches invalid pack id, missing name, or duplicate keys", () => {
    const bad = {
      id: "bad id with spaces!",
      name: "",
      items: [
        { key: "hair", options: [{ value: "A", weight: 1, prompt: "a" }] },
        { key: "hair", options: [{ value: "B", weight: 1, prompt: "b" }] },
      ],
    };
    const res = validateTraitPack(bad);
    assert.equal(res.ok, false);
    assert.ok(res.errors.length >= 2);
  });

  it("exportPresetAsTraitPack extracts preset traits and rules into a valid pack", () => {
    const exported = exportPresetAsTraitPack(preset, {
      id: "exported-demo",
      name: "Exported Demo Pack",
    });
    assert.equal(exported.id, "exported-demo");
    assert.equal(exported.name, "Exported Demo Pack");
    assert.ok(Array.isArray(exported.items) && exported.items.length > 0);
    assert.ok(Array.isArray(exported.defaults?.changeKeys));

    const val = validateTraitPack(exported);
    assert.equal(val.ok, true);
  });
});
