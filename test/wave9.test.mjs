import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import {
  buildOrdinalsMeta,
  traitsToAttributes,
  buildBundleZip,
  NONE,
} from "../src/index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function tinyPng() {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

describe("Wave 9: Metadata Extensions & Bitcoin Ordinals Export", () => {
  const sampleRecipe = {
    edition: 7,
    seed: 12345,
    dna: "head:helmet,eyes:laser,level:42",
    prompt: "A cyber warrior with helmet and laser eyes",
    traits: {
      head: "Cyber Helmet",
      eyes: "Laser Glow",
      level: "42",
      stamina: "88",
      missingTrait: NONE,
      emptyTrait: "",
    },
  };

  const traitDefinitions = [
    { key: "head", label: "Head", type: "Headgear" },
    { key: "eyes", label: "Eyes", type: "Eye FX" },
    { key: "level", label: "Level", type: "Level", display_type: "number", max_value: 100 },
    { key: "stamina", label: "Stamina", type: "Stamina Boost", display_type: "boost_number" },
  ];

  it("traitsToAttributes formats string and display_type attributes correctly", () => {
    const attrs = traitsToAttributes(sampleRecipe.traits, traitDefinitions);

    assert.equal(attrs.length, 4);

    const head = attrs.find((a) => a.trait_type === "Headgear");
    assert.ok(head);
    assert.equal(head.value, "Cyber Helmet");
    assert.equal(head.display_type, undefined);

    const level = attrs.find((a) => a.trait_type === "Level");
    assert.ok(level);
    assert.equal(level.value, 42);
    assert.equal(level.display_type, "number");
    assert.equal(level.max_value, 100);

    const stamina = attrs.find((a) => a.trait_type === "Stamina Boost");
    assert.ok(stamina);
    assert.equal(stamina.value, 88);
    assert.equal(stamina.display_type, "boost_number");

    // Ensure NONE and empty traits are omitted
    assert.equal(attrs.some((a) => a.trait_type === "missingTrait"), false);
    assert.equal(attrs.some((a) => a.trait_type === "emptyTrait"), false);
  });

  it("buildOrdinalsMeta produces Bitcoin Ordinals manifest structure", () => {
    const meta = buildOrdinalsMeta(
      sampleRecipe,
      {
        namePrefix: "Cyber Gremlins #",
        symbol: "GREM",
        description: "Pixel gremlin on Bitcoin",
      },
      traitDefinitions,
    );

    assert.equal(meta.id, "GREM-7");
    assert.equal(meta.name, "Cyber Gremlins #7");
    assert.equal(meta.description, "Pixel gremlin on Bitcoin");
    assert.equal(meta.image, "7.png");
    assert.equal(meta.properties.edition, 7);
    assert.equal(meta.properties.collection, "Cyber Gremlins");
    assert.deepEqual(meta.properties.files, [{ uri: "7.png", type: "image/png" }]);
    assert.equal(meta.attributes.length, 4);
  });

  it("buildBundleZip packs ordinals manifest and metadata in ZIP", async () => {
    const setDir = join(ROOT, "out", "test-ordinals-set");
    const bundlesDir = join(ROOT, "out", "bundles");
    mkdirSync(setDir, { recursive: true });
    mkdirSync(bundlesDir, { recursive: true });

    const png = tinyPng();
    writeFileSync(join(setDir, "1.png"), png);
    writeFileSync(join(setDir, "2.png"), png);

    const archive = {
      presetId: "test-ordinals",
      size: 2,
      recipes: [
        { edition: 1, traits: { head: "Cap", level: "10" }, prompt: "p1" },
        { edition: 2, traits: { head: "Helmet", level: "20" }, prompt: "p2" },
      ],
    };

    const preset = {
      id: "test-ordinals",
      name: "Test Ordinals",
      traits: {
        items: [
          { key: "head", label: "Head", type: "Head" },
          { key: "level", label: "Level", type: "Level", display_type: "number" },
        ],
      },
    };

    const result = await buildBundleZip({
      archive,
      preset,
      setDir,
      set: "test-ordinals-set",
      bundlesDir,
      opts: {
        format: "ordinals",
        onlyKeep: false,
        namePrefix: "Runes #",
        symbol: "RUNE",
        description: "Ordinals on BTC",
        locale: "uk",
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.count, 2);
    assert.equal(result.format, "ordinals");

    const zipPath = join(ROOT, result.path);
    assert.ok(existsSync(zipPath));

    const zipBuf = readFileSync(zipPath);
    const zip = await JSZip.loadAsync(zipBuf);

    assert.ok(zip.file("images/1.png"));
    assert.ok(zip.file("images/2.png"));
    assert.ok(zip.file("metadata/1.json"));
    assert.ok(zip.file("metadata/2.json"));
    assert.ok(zip.file("collection.json"));
    assert.ok(zip.file("README.txt"));

    const item1Text = await zip.file("metadata/1.json").async("text");
    const item1 = JSON.parse(item1Text);
    assert.equal(item1.id, "RUNE-1");
    assert.equal(item1.name, "Runes #1");
    assert.equal(item1.properties.collection, "Runes");
    assert.equal(item1.attributes.find((a) => a.trait_type === "Level").value, 10);

    const collText = await zip.file("collection.json").async("text");
    const coll = JSON.parse(collText);
    assert.equal(coll.format, "ordinals");
    assert.equal(coll.symbol, "RUNE");
  });
});
