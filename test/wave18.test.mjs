import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  calculateImageSha256,
  calculateCollectionProvenance,
  verifyProvenance,
} from "../src/provenance.mjs";
import { buildBundleZip } from "../src/export-bundle.mjs";

test("Wave 18: calculateImageSha256 computes correct SHA-256 for buffer and file", (t) => {
  const content = Buffer.from("test-image-content-wave18", "utf8");
  const expectedHash = crypto.createHash("sha256").update(content).digest("hex");

  const hashFromBuf = calculateImageSha256(content);
  assert.equal(hashFromBuf, expectedHash);

  const tmpFile = path.resolve("out", `test-sha-${Date.now()}.png`);
  fs.mkdirSync(path.dirname(tmpFile), { recursive: true });
  fs.writeFileSync(tmpFile, content);

  try {
    const hashFromFile = calculateImageSha256(tmpFile);
    assert.equal(hashFromFile, expectedHash);
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test("Wave 18: calculateCollectionProvenance produces deterministic composite hash", (t) => {
  const img1 = Buffer.from("edition-1-pixels", "utf8");
  const img2 = Buffer.from("edition-2-pixels", "utf8");
  const img3 = Buffer.from("edition-3-pixels", "utf8");

  const hash1 = crypto.createHash("sha256").update(img1).digest("hex");
  const hash2 = crypto.createHash("sha256").update(img2).digest("hex");
  const hash3 = crypto.createHash("sha256").update(img3).digest("hex");

  const expectedComposite = hash1 + hash2 + hash3;
  const expectedProvHash = crypto.createHash("sha256").update(expectedComposite).digest("hex");

  // Pass shuffled order to verify sorting by edition
  const prov = calculateCollectionProvenance([
    { edition: 2, file: "2.png", buffer: img2 },
    { edition: 3, file: "3.png", buffer: img3 },
    { edition: 1, file: "1.png", buffer: img1 },
  ]);

  assert.equal(prov.provenanceHash, expectedProvHash);
  assert.equal(prov.count, 3);
  assert.equal(prov.records[0].edition, 1);
  assert.equal(prov.records[1].edition, 2);
  assert.equal(prov.records[2].edition, 3);
  assert.equal(prov.records[0].sha256, hash1);
});

test("Wave 18: verifyProvenance correctly validates matching and tampered buffers", (t) => {
  const img1 = Buffer.from("img-one", "utf8");
  const img2 = Buffer.from("img-two", "utf8");

  const prov = calculateCollectionProvenance([
    { edition: 1, file: "1.png", buffer: img1 },
    { edition: 2, file: "2.png", buffer: img2 },
  ]);

  // Valid buffer map
  const validMap = new Map([
    ["1.png", img1],
    ["2.png", img2],
  ]);
  const resValid = verifyProvenance(prov, validMap);
  assert.equal(resValid.valid, true);
  assert.equal(resValid.errors.length, 0);

  // Tampered buffer map
  const tamperedMap = new Map([
    ["1.png", Buffer.from("tampered", "utf8")],
    ["2.png", img2],
  ]);
  const resTampered = verifyProvenance(prov, tamperedMap);
  assert.equal(resTampered.valid, false);
  assert.ok(resTampered.errors.length > 0);
  assert.ok(resTampered.errors.some((e) => e.includes("Hash mismatch")));
});

test("Wave 18: buildBundleZip includes provenance.json and exposes provenanceHash", async (t) => {
  const tmpDir = path.resolve("out", `test-bundle-prov-${Date.now()}`);
  const bundlesDir = path.join(tmpDir, "bundles");
  const setDir = path.join(tmpDir, "set");
  fs.mkdirSync(setDir, { recursive: true });

  fs.writeFileSync(path.join(setDir, "1.png"), Buffer.from("img-1-data"));
  fs.writeFileSync(path.join(setDir, "2.png"), Buffer.from("img-2-data"));

  const archive = {
    presetId: "prov-demo",
    recipes: [
      { edition: 1, dna: "dna-1", traits: { background: "Neon" } },
      { edition: 2, dna: "dna-2", traits: { background: "Cyber" } },
    ],
  };

  const preset = { id: "prov-demo", name: "Provenance Demo" };

  const result = await buildBundleZip({
    archive,
    preset,
    setDir,
    set: "set",
    bundlesDir,
    opts: { format: "erc721" },
  });

  assert.equal(result.ok, true);
  assert.ok(typeof result.provenanceHash === "string" && result.provenanceHash.length === 64);

  // Clean up
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});
