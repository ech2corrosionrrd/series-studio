import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { calculateCollectionProvenance, verifyProvenance, duplicateImages } from "../src/provenance.mjs";
import { checkProvenance } from "../src/provenance-verifier.mjs";
import { createMockPng } from "../src/mock-image.mjs";

function setup(n = 4) {
  const dir = mkdtempSync(join(tmpdir(), "prov-"));
  const images = [];
  for (let i = 1; i <= n; i++) {
    writeFileSync(join(dir, `${i}.png`), createMockPng({ seed: i * 7, title: `t${i}` }));
    images.push({ edition: i, path: join(dir, `${i}.png`), file: `${i}.png` });
  }
  const prov = calculateCollectionProvenance(images);
  writeFileSync(join(dir, "provenance.json"), JSON.stringify(prov));
  return { dir, prov };
}

test("a clean set verifies with no errors", () => {
  const { dir, prov } = setup();
  try {
    const r = verifyProvenance(prov, dir);
    assert.equal(r.valid, true);
    assert.deepEqual(r.errors, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a changed image, a missing image and a count mismatch are errors", () => {
  const { dir, prov } = setup();
  try {
    writeFileSync(join(dir, "2.png"), createMockPng({ seed: 999, title: "other" }));
    rmSync(join(dir, "3.png"));
    const r = verifyProvenance({ ...prov, count: 9 }, dir);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /Hash mismatch for edition #2/.test(e)));
    assert.ok(r.errors.some((e) => /File missing: 3\.png/.test(e)));
    assert.ok(r.errors.some((e) => /count says 9/.test(e)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("two editions with the same image are an error (the BAYC failure)", () => {
  const dir = mkdtempSync(join(tmpdir(), "prov-"));
  try {
    const same = createMockPng({ seed: 5, title: "same" });
    writeFileSync(join(dir, "1.png"), same);
    writeFileSync(join(dir, "2.png"), same);
    writeFileSync(join(dir, "3.png"), createMockPng({ seed: 6, title: "x" }));
    const prov = calculateCollectionProvenance([1, 2, 3].map((e) => ({ edition: e, path: join(dir, `${e}.png`), file: `${e}.png` })));
    assert.deepEqual(duplicateImages(prov.records), [[1, 2]]);
    const r = verifyProvenance(prov, dir);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /same image/.test(e)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a record edited by hand is caught before the files are opened", () => {
  const { dir, prov } = setup();
  try {
    const forged = JSON.parse(JSON.stringify(prov));
    forged.records[0].sha256 = "0".repeat(64);
    const r = verifyProvenance(forged, dir);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /record is inconsistent/.test(e)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("file names with a path are refused, so a record cannot read outside the folder", () => {
  const { dir, prov } = setup();
  try {
    const evil = JSON.parse(JSON.stringify(prov));
    evil.records[0].file = "../secret.txt";
    const r = verifyProvenance(evil, dir);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /Unsafe or empty file name/.test(e)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("warnings: extra image in the folder, skipped edition number, JPEG named .png", () => {
  const dir = mkdtempSync(join(tmpdir(), "prov-"));
  try {
    writeFileSync(join(dir, "1.png"), createMockPng({ seed: 1, title: "a" }));
    writeFileSync(join(dir, "3.png"), Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]));
    writeFileSync(join(dir, "9.png"), createMockPng({ seed: 2, title: "extra" }));
    const prov = calculateCollectionProvenance([
      { edition: 1, path: join(dir, "1.png"), file: "1.png" },
      { edition: 3, path: join(dir, "3.png"), file: "3.png" },
    ]);
    const r = verifyProvenance(prov, dir);
    assert.equal(r.valid, true);
    assert.ok(r.warnings.some((w) => /skip 1 value/.test(w)));
    assert.ok(r.warnings.some((w) => /not in the record: 9\.png/.test(w)));
    assert.ok(r.warnings.some((w) => /3\.png is named \.png but the bytes are not a PNG/.test(w)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the order of records in the file does not change the result", () => {
  const { dir, prov } = setup();
  try {
    const shuffled = { ...prov, records: [...prov.records].reverse() };
    assert.equal(verifyProvenance(shuffled, dir).valid, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the standalone script from the ZIP passes a clean set and fails a changed one", () => {
  const { dir } = setup();
  try {
    const script = join(process.cwd(), "src", "provenance-verifier.mjs");
    const ok = spawnSync(process.execPath, [script, dir, join(dir, "provenance.json")], { encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /^OK /);
    writeFileSync(join(dir, "1.png"), createMockPng({ seed: 321, title: "swapped" }));
    const bad = spawnSync(process.execPath, [script, dir, join(dir, "provenance.json")], { encoding: "utf8" });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /FAILED/);
    assert.match(bad.stderr, /Hash mismatch for edition #1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("checkProvenance rejects a structureless record", () => {
  assert.equal(checkProvenance(null, { read: () => null }).valid, false);
  assert.equal(checkProvenance({ provenanceHash: "x", records: [] }, { read: () => null }).valid, false);
  assert.ok(readFileSync(join(process.cwd(), "src", "provenance-verifier.mjs"), "utf8").startsWith("#!/usr/bin/env node"));
});

test("an export ZIP carries verify-provenance.mjs that passes on its own images/", async () => {
  const { buildBundleZip } = await import("../src/export-bundle.mjs");
  const JSZip = (await import("jszip")).default;
  const { mkdirSync } = await import("node:fs");
  const root = mkdtempSync(join(tmpdir(), "prov-zip-"));
  try {
    const setDir = join(root, "set");
    mkdirSync(setDir, { recursive: true });
    writeFileSync(join(setDir, "1.png"), createMockPng({ seed: 11, title: "a" }));
    writeFileSync(join(setDir, "2.png"), createMockPng({ seed: 12, title: "b" }));
    const result = await buildBundleZip({
      archive: {
        presetId: "pv",
        recipes: [
          { edition: 1, dna: "d1", traits: { background: "Neon" } },
          { edition: 2, dna: "d2", traits: { background: "Cyber" } },
        ],
      },
      preset: { id: "pv", name: "PV" },
      setDir,
      set: "set",
      bundlesDir: join(root, "bundles"),
      opts: { format: "erc721" },
    });
    assert.equal(result.ok, true);
    const zip = await JSZip.loadAsync(readFileSync(join(root, "bundles", result.file)));
    assert.ok(zip.file("verify-provenance.mjs"), "script is in the ZIP");
    const out = join(root, "unzipped");
    mkdirSync(join(out, "images"), { recursive: true });
    for (const name of Object.keys(zip.files)) {
      if (zip.files[name].dir) continue;
      if (name === "verify-provenance.mjs" || name === "provenance.json" || name.startsWith("images/")) {
        writeFileSync(join(out, name), await zip.file(name).async("nodebuffer"));
      }
    }
    const run = spawnSync(process.execPath, ["verify-provenance.mjs"], { cwd: out, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /^OK +2 files/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
