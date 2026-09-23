import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { buildDatasetCaptions, exportDatasetZip } from "../src/dataset.mjs";

test("Wave 19: buildDatasetCaptions formats Danbooru-style tags with trigger word", (t) => {
  const recipes = [
    {
      edition: 1,
      who: "cyber female gremlin",
      traits: {
        hair: "Buzz Cut",
        outfit: "Neon Jacket",
        glasses: "None",
      },
    },
  ];

  const preset = {
    promptTemplate: {
      keep: ["masterpiece", "8k resolution"],
      suffix: "cinematic lighting",
    },
  };

  const captions = buildDatasetCaptions(recipes, preset, {
    triggerWord: "gfam_gremlin",
    format: "tags",
    includeKeep: true,
  });

  assert.equal(captions.length, 1);
  assert.equal(captions[0].edition, 1);
  assert.equal(captions[0].fileName, "1.txt");

  const expected = "gfam_gremlin, cyber female gremlin, buzz cut, neon jacket, masterpiece, 8k resolution";
  assert.equal(captions[0].caption, expected);
});

test("Wave 19: buildDatasetCaptions formats natural language prose", (t) => {
  const recipes = [
    {
      edition: 2,
      who: "steampunk inventor",
      traits: {
        goggles: "Brass Goggles",
        coat: "Leather Duster",
      },
    },
  ];

  const captions = buildDatasetCaptions(recipes, {}, {
    triggerWord: "gfam_steampunk",
    format: "prose",
  });

  assert.equal(captions.length, 1);
  assert.ok(captions[0].caption.includes("A detailed image of gfam_steampunk, depicting steampunk inventor"));
  assert.ok(captions[0].caption.includes("goggles is Brass Goggles"));
  assert.ok(captions[0].caption.includes("coat is Leather Duster"));
});

test("Wave 19: exportDatasetZip generates valid ZIP with image/txt pairs and dataset-info.json", async (t) => {
  const tmpDir = path.resolve("out", `test-dataset-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  fs.writeFileSync(path.join(tmpDir, "1.png"), Buffer.from("fake-png-1"));
  fs.writeFileSync(path.join(tmpDir, "2.png"), Buffer.from("fake-png-2"));

  const archive = {
    presetId: "test-series",
    recipes: [
      { edition: 1, who: "hero", traits: { weapon: "Sword" } },
      { edition: 2, who: "mage", traits: { weapon: "Staff" } },
    ],
  };

  const outZip = path.join(tmpDir, "dataset.zip");

  const result = await exportDatasetZip({
    archive,
    preset: { id: "test-series", name: "Test Series" },
    setDir: tmpDir,
    opts: {
      triggerWord: "my_hero",
      format: "tags",
      outPath: outZip,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.count, 2);
  assert.equal(result.triggerWord, "my_hero");
  assert.ok(fs.existsSync(outZip));

  // Inspect zip contents
  const zipBuf = fs.readFileSync(outZip);
  const zip = await JSZip.loadAsync(zipBuf);

  assert.ok(zip.file("dataset/1.png"));
  assert.ok(zip.file("dataset/1.txt"));
  assert.ok(zip.file("dataset/2.png"));
  assert.ok(zip.file("dataset/2.txt"));
  assert.ok(zip.file("dataset-info.json"));

  const txt1 = await zip.file("dataset/1.txt").async("string");
  assert.ok(txt1.includes("my_hero"));
  assert.ok(txt1.includes("sword"));

  const infoRaw = await zip.file("dataset-info.json").async("string");
  const info = JSON.parse(infoRaw);
  assert.equal(info.count, 2);
  assert.equal(info.triggerWord, "my_hero");

  // Cleanup
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});
