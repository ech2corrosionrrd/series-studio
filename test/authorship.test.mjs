import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { readFileSync } from "node:fs";
import { normalizeAuthorship, authorshipFacts, authorshipDoc, authorshipText } from "../src/authorship.mjs";
import { buildBundleZip } from "../src/export-bundle.mjs";
import { addVersion } from "../src/versions.mjs";
import { createMockPng } from "../src/mock-image.mjs";

test("normalizeAuthorship drops junk and returns null when nothing is declared", () => {
  assert.equal(normalizeAuthorship(null), null);
  assert.equal(normalizeAuthorship({ baseOrigin: "nonsense" }), null);
  const a = normalizeAuthorship({ baseOrigin: "hand", handEdited: true, note: "  x  ", extra: 1 });
  assert.deepEqual(a, { baseOrigin: "hand", handEdited: true, handLayers: false, note: "x" });
  assert.equal(normalizeAuthorship({ note: "y".repeat(5000) }).note.length, 1000);
});

test("authorshipFacts counts kept, regenerated and versions from the set", () => {
  const dir = mkdtempSync(join(tmpdir(), "auth-"));
  try {
    addVersion(dir, 1, createMockPng({ seed: 1, title: "a" }), { engine: "mock" });
    addVersion(dir, 1, createMockPng({ seed: 2, title: "a2" }), { engine: "mock" });
    addVersion(dir, 2, createMockPng({ seed: 3, title: "b" }), { engine: "mock" });
    const f = authorshipFacts({ setDir: dir, editions: [1, 2], marks: { 1: "keep", 2: "redo", 9: "redo" } });
    assert.deepEqual(f, { frames: 2, keptByHand: 1, redoMarked: 2, regenerated: 1, versions: 3 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("authorshipText is in the requested language and says it is not legal advice", () => {
  const doc = authorshipDoc({
    declared: normalizeAuthorship({ baseOrigin: "ai_curated", handLayers: true, note: "inks by me" }),
    facts: { frames: 4, keptByHand: 3, redoMarked: 1, regenerated: 2, versions: 6 },
  });
  const en = authorshipText("en", doc);
  const uk = authorshipText("uk", doc);
  assert.match(en, /not legal advice/);
  assert.match(en, /selected and refined by the author/);
  assert.match(en, /3 marked Keep/);
  assert.match(uk, /не юридичний висновок/);
  assert.match(uk, /відібрана й доопрацьована автором/);
  assert.equal(authorshipText("en", null), "");
});

test("an export ZIP carries authorship.json and a README block", async () => {
  const root = mkdtempSync(join(tmpdir(), "auth-zip-"));
  try {
    const setDir = join(root, "set");
    mkdirSync(setDir, { recursive: true });
    writeFileSync(join(setDir, "1.png"), createMockPng({ seed: 11, title: "a" }));
    writeFileSync(join(setDir, "2.png"), createMockPng({ seed: 12, title: "b" }));
    const result = await buildBundleZip({
      archive: { presetId: "au", recipes: [{ edition: 1, dna: "d1", traits: { b: "x" } }, { edition: 2, dna: "d2", traits: { b: "y" } }] },
      preset: { id: "au", name: "AU" },
      setDir,
      set: "set",
      marks: { 1: "keep" },
      bundlesDir: join(root, "bundles"),
      opts: { format: "erc721", locale: "en", authorship: { baseOrigin: "hand", handEdited: true } },
    });
    assert.equal(result.ok, true);
    const zip = await JSZip.loadAsync(readFileSync(join(root, "bundles", result.file)));
    const doc = JSON.parse(await zip.file("authorship.json").async("string"));
    assert.equal(doc.declared.baseOrigin, "hand");
    assert.equal(doc.facts.frames, 2);
    assert.equal(doc.facts.keptByHand, 1);
    const readme = await zip.file("README.txt").async("string");
    assert.match(readme, /HUMAN CONTRIBUTION/);
    assert.match(readme, /drawn by the author by hand/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an export without a declaration still records the facts", async () => {
  const root = mkdtempSync(join(tmpdir(), "auth-zip2-"));
  try {
    const setDir = join(root, "set");
    mkdirSync(setDir, { recursive: true });
    writeFileSync(join(setDir, "1.png"), createMockPng({ seed: 21, title: "a" }));
    const result = await buildBundleZip({
      archive: { presetId: "au", recipes: [{ edition: 1, dna: "d1", traits: { b: "x" } }] },
      preset: { id: "au", name: "AU" },
      setDir,
      set: "set",
      bundlesDir: join(root, "bundles"),
      opts: { format: "erc721", locale: "en" },
    });
    const zip = await JSZip.loadAsync(readFileSync(join(root, "bundles", result.file)));
    const doc = JSON.parse(await zip.file("authorship.json").async("string"));
    assert.equal(doc.declared, null);
    assert.equal(doc.facts.frames, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
