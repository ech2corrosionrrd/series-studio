import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { createMockPng } from "../src/mock-image.mjs";
import { openRarityByEdition } from "../src/rarity.mjs";
import { calculateRarityScores } from "../src/scorecard.mjs";
import { calculateCollectionProvenance } from "../src/provenance.mjs";
import { addVersion, readMeta } from "../src/versions.mjs";
import { buildBundleZip } from "../src/export-bundle.mjs";

const preset = {
  id: "phase-b",
  seed: "preset-seed-42",
  traits: {
    items: [
      { key: "hat", options: [{ value: "cap", weight: 1, prompt: "a cap" }] },
    ],
  },
};

test("OpenRarity keeps the old score and counts a missing trait as null", () => {
  const recipes = [
    { edition: 1, traits: { hat: "cap" } },
    { edition: 2, traits: {} },
    { edition: 3, traits: { hat: "None" } },
  ];
  const open = openRarityByEdition(preset, recipes);
  const byEd = Object.fromEntries(open.editions.map((row) => [row.edition, row.openRarity]));
  assert.ok(Math.abs(byEd[1] - Math.log2(3)) < 1e-9);
  assert.ok(Math.abs(byEd[2] - (-Math.log2(2 / 3))) < 1e-9);
  assert.equal(byEd[2], byEd[3]);
  assert.notEqual(byEd[1], byEd[2]);

  const scores = calculateRarityScores({ recipes, seed: preset.seed }, preset);
  const old = Object.fromEntries(scores.editions.map((row) => [row.edition, row.rarityScore]));
  assert.ok(old[1] > 0);
  assert.equal(old[2], 0);
  assert.equal(scores.editions.find((row) => row.edition === 1).openRarity, byEd[1]);
});

test("provenance hash formula stays, and presetSeed is optional", () => {
  const images = [
    { edition: 2, file: "2.png", buffer: Buffer.from("bb") },
    { edition: 1, file: "1.png", buffer: Buffer.from("aa") },
  ];
  const plain = calculateCollectionProvenance(images);
  const withSeed = calculateCollectionProvenance(images, { presetSeed: "preset-seed-42" });
  assert.equal(withSeed.provenanceHash, plain.provenanceHash);
  assert.equal(withSeed.algorithm, "sha256");
  assert.equal(withSeed.presetSeed, "preset-seed-42");
  assert.equal(plain.presetSeed, undefined);
});

test("addVersion keeps creation fields and does not drop the previous row", () => {
  const set = mkdtempSync(join(tmpdir(), "series-creation-"));
  const first = addVersion(set, 4, Buffer.from("one"), {
    engine: "mock",
    model: "Offline Mock Generator (Free $0.00)",
    strength: 0.45,
    seed: 7,
    promptHash: "aa",
    baseSha256: "bb",
    score: 8,
    verdict: "keep",
  });
  const second = addVersion(set, 4, Buffer.from("two"), {
    engine: "mock",
    model: "Offline Mock Generator (Free $0.00)",
    strength: 0.65,
    seed: 8,
    promptHash: "cc",
    baseSha256: "bb",
  });
  assert.equal(first, 1);
  assert.equal(second, 2);
  const meta = readMeta(set, 4);
  assert.equal(meta.versions.length, 2);
  assert.equal(meta.versions[0].promptHash, "aa");
  assert.equal(meta.versions[0].score, 8);
  assert.equal(meta.versions[0].verdict, "keep");
  assert.equal(meta.versions[1].strength, 0.65);
  const creation = JSON.parse(readFileSync(join(set, "creation", "4.json"), "utf8"));
  assert.equal(creation.versions.length, 2);
  assert.equal(creation.versions[0].versionId, 1);
  assert.equal(creation.versions[0].baseSha256, "bb");
  assert.equal(creation.versions[1].promptHash, "cc");
  rmSync(set, { recursive: true, force: true });
});

test("archive ZIP has creation.json, OpenRarity, presetSeed, and no seed phrase", async () => {
  const dir = mkdtempSync(join(tmpdir(), "series-phase-b-zip-"));
  const setDir = join(dir, "set");
  const bundles = join(dir, "bundles");
  mkdirSync(setDir, { recursive: true });
  mkdirSync(bundles, { recursive: true });
  writeFileSync(join(setDir, "1.png"), createMockPng({ seed: 1, width: 32, height: 32 }));
  writeFileSync(join(setDir, "2.png"), createMockPng({ seed: 2, width: 32, height: 32 }));
  writeFileSync(join(setDir, "3.png"), createMockPng({ seed: 3, width: 32, height: 32 }));
  const recipes = [
    { edition: 1, dna: "1", traits: { hat: "cap" }, prompt: "a cap", seed: 1 },
    { edition: 2, dna: "2", traits: {}, prompt: "none", seed: 2 },
    { edition: 3, dna: "3", traits: { hat: "None" }, prompt: "none again", seed: 3 },
  ];
  const res = await buildBundleZip({
    archive: { presetId: "phase-b", seed: "preset-seed-42", recipes },
    preset,
    setDir,
    set: "set",
    bundlesDir: bundles,
    opts: {
      format: "erc721",
      profile: "opensea",
      description: "A tested collection",
      creatorAddress: "0x1111111111111111111111111111111111111111",
      sellerFeeBasisPoints: 500,
      locale: "uk",
      gate: true,
    },
  });
  assert.equal(res.ready, true, res.preflight?.report);
  const raw = readFileSync(join(bundles, res.file));
  // R16: images are stored as they are (PNG is compressed already), text is deflated; read the method of every local header
  const methods = {};
  for (let i = 0; i + 30 < raw.length; i++) {
    if (raw.readUInt32LE(i) !== 0x04034b50) continue;
    const nameLen = raw.readUInt16LE(i + 26);
    methods[raw.toString("utf8", i + 30, i + 30 + nameLen)] = raw.readUInt16LE(i + 8);
  }
  const imageEntries = Object.keys(methods).filter((n) => /\.png$/.test(n));
  assert.ok(imageEntries.length >= 2, `images in the ZIP: ${Object.keys(methods).join(", ")}`);
  for (const n of imageEntries) assert.equal(methods[n], 0, `${n} is stored`);
  assert.equal(methods["collection.json"], 8, "text is deflated");
  const zip = await JSZip.loadAsync(raw);
  assert.ok(zip.file("creation/1.json"));
  assert.ok(zip.file("creation/2.json"));
  const rarityTxt = await zip.file("rarity.txt").async("string");
  assert.match(rarityTxt, /OpenRarity/);
  assert.match(rarityTxt, /null/);
  const provenance = JSON.parse(await zip.file("provenance.json").async("string"));
  assert.equal(provenance.presetSeed, "preset-seed-42");
  assert.equal(provenance.algorithm, "sha256");
  const readme = await zip.file("README.txt").async("string");
  assert.match(readme, /РОЗКРИТТЯ ШІ/);
  assert.match(readme, /можна стерти|можна видалити/);
  const joined = await Promise.all(Object.values(zip.files).filter((f) => !f.dir).map((f) => f.async("string").catch(() => "")));
  const text = joined.join("\n");
  assert.doesNotMatch(text, /\b([a-z]{3,8} ){11}[a-z]{3,8}\b/);
  assert.doesNotMatch(text, /privateKey|BEGIN (?:OPENSSH |RSA )?PRIVATE KEY/);
  rmSync(dir, { recursive: true, force: true });
});
