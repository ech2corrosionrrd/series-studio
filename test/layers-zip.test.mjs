import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { createMockPng } from "../src/mock-image.mjs";
import {
  LAYER_LIMITS,
  LayersZipError,
  checkPngHeader,
  clearLayers,
  importLayersZip,
  layersStatus,
  normalizeEntryPath,
} from "../src/layers-zip.mjs";

const png = (seed = 1, w = 16, h = 16) => createMockPng({ seed, width: w, height: h });

async function zipOf(files) {
  const z = new JSZip();
  for (const [name, data] of Object.entries(files)) z.file(name, data);
  return z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "series-layers-"));
  return { root, layers: join(root, "layers"), done: () => rmSync(root, { recursive: true, force: true }) };
}

async function rejects(promise, code) {
  await assert.rejects(promise, (e) => e instanceof LayersZipError && e.code === code, `expected ${code}`);
}

test("normalizeEntryPath: safe paths pass, junk and folders are skipped", () => {
  assert.deepEqual(normalizeEntryPath("hair/Wavy Medium.png"), { rel: "hair/Wavy Medium.png" });
  assert.deepEqual(normalizeEntryPath("hair\\Bob.PNG"), { rel: "hair/Bob.png" }, "Windows separators and extension case");
  assert.deepEqual(normalizeEntryPath("./hair/Bob.png"), { rel: "hair/Bob.png" });
  assert.deepEqual(normalizeEntryPath("колір/Рудий.png"), { rel: "колір/Рудий.png" }, "non-Latin names are fine");
  assert.equal(normalizeEntryPath("hair/").skip, "folder");
  assert.equal(normalizeEntryPath("__MACOSX/hair/._Bob.png").skip, "junk");
  assert.equal(normalizeEntryPath("hair/.DS_Store").skip, "junk");
  assert.equal(normalizeEntryPath("hair/Thumbs.db").skip, "junk");
  assert.equal(normalizeEntryPath("hair/readme.txt").skip, "not_png");
  assert.equal(normalizeEntryPath("loose.png").skip, "no_folder");
  assert.equal(normalizeEntryPath("a/b/c/d/e.png").skip, "too_deep");
});

test("normalizeEntryPath rejects zip-slip and unsafe names for the whole upload", () => {
  for (const bad of ["../evil.png", "hair/../../evil.png", "/etc/x.png", "C:/x/y.png", "hair\\..\\..\\x.png", "hair/a:b.png", "hair/CON.png", "hair/nul", "hair./x.png", "hair/x./y.png"]) {
    assert.throws(() => normalizeEntryPath(bad), (e) => e instanceof LayersZipError, bad);
  }
  assert.throws(() => normalizeEntryPath(`hair/${"x".repeat(200)}.png`), (e) => e.code === "name_too_long");
});

test("checkPngHeader: real PNGs pass; fakes and oversized dimensions fail", () => {
  assert.deepEqual(checkPngHeader(png(1, 16, 8), "x"), { width: 16, height: 8 });
  assert.throws(() => checkPngHeader(Buffer.from("not a png at all, just text padding 0123456789"), "x"), (e) => e.code === "not_png");
  const huge = Buffer.from(png(2));
  huge.writeUInt32BE(100000, 16);
  assert.throws(() => checkPngHeader(huge, "x"), (e) => e.code === "png_dimensions");
});

test("import: merges layers, strips a layers/ wrapper, reports skipped junk", async () => {
  const s = sandbox();
  try {
    const zip = await zipOf({
      "layers/hair/Bob.png": png(1),
      "layers/hair/Wavy Medium.png": png(2),
      "layers/eyes/Blue.png": png(3),
      "layers/readme.txt": "hi",
      "__MACOSX/layers/hair/._Bob.png": "junk",
    });
    const r = await importLayersZip(zip, s.layers);
    assert.equal(r.files, 3);
    assert.deepEqual(r.keys, [{ key: "eyes", count: 1 }, { key: "hair", count: 2 }]);
    assert.ok(r.skipped.some((x) => x.reason === "junk") && r.skipped.some((x) => x.reason === "not_png"));
    assert.ok(existsSync(join(s.layers, "hair", "Bob.png")));
    assert.equal(readdirSync(s.root).filter((n) => n.startsWith(".layers-upload-")).length, 0, "staging folder is gone");

    // second upload merges: same file replaced, others kept
    const again = await importLayersZip(await zipOf({ "hair/Bob.png": png(9), "mouth/Smile.png": png(4) }), s.layers);
    assert.equal(again.files, 2);
    assert.equal(layersStatus(s.layers).files, 4);
    assert.ok(readFileSync(join(s.layers, "hair", "Bob.png")).equals(png(9)), "replaced by the new file");
  } finally {
    s.done();
  }
});

test("import: clear=true empties the folder first", async () => {
  const s = sandbox();
  try {
    await importLayersZip(await zipOf({ "hair/Bob.png": png(1), "eyes/Blue.png": png(2) }), s.layers);
    const r = await importLayersZip(await zipOf({ "mouth/Smile.png": png(3) }), s.layers, { clear: true });
    assert.equal(r.cleared, true);
    assert.deepEqual(layersStatus(s.layers).keys, [{ key: "mouth", count: 1 }]);
  } finally {
    s.done();
  }
});

test("import is all-or-nothing: one bad file leaves the folder untouched", async () => {
  const s = sandbox();
  try {
    await importLayersZip(await zipOf({ "hair/Bob.png": png(1) }), s.layers);
    const before = layersStatus(s.layers);
    await rejects(importLayersZip(await zipOf({ "hair/New.png": png(2), "eyes/Fake.png": "this is not a png file, only text" }), s.layers), "not_png");
    await rejects(importLayersZip(await zipOf({ "hair/New.png": png(2), "/abs.png": png(3) }), s.layers), "unsafe_path");
    assert.deepEqual(layersStatus(s.layers), before);
    assert.equal(readdirSync(s.root).filter((n) => n.startsWith(".layers-upload-")).length, 0);
    assert.equal(existsSync(join(s.root, "evil.png")), false);
  } finally {
    s.done();
  }
});

test("import limits: not a zip, empty, nothing usable, duplicates, size, count", async () => {
  const s = sandbox();
  try {
    await rejects(importLayersZip(Buffer.from("definitely not a zip"), s.layers), "bad_zip");
    await rejects(importLayersZip(Buffer.alloc(0), s.layers), "empty");
    await rejects(importLayersZip(await zipOf({ "notes.txt": "x", "loose.png": png(1) }), s.layers), "no_layers");
    await rejects(importLayersZip(await zipOf({ "hair/Bob.png": png(1), "hair/bob.png": png(2) }), s.layers), "duplicate");
    const small = { ...LAYER_LIMITS, zipBytes: 100 };
    await rejects(importLayersZip(await zipOf({ "hair/Bob.png": png(1) }), s.layers, { limits: small }), "zip_too_large");
    const fewer = { ...LAYER_LIMITS, entries: 1 };
    await rejects(importLayersZip(await zipOf({ "hair/A.png": png(1), "hair/B.png": png(2) }), s.layers, { limits: fewer }), "too_many_files");
    const tinyFile = { ...LAYER_LIMITS, fileBytes: 50 };
    await rejects(importLayersZip(await zipOf({ "hair/A.png": png(1) }), s.layers, { limits: tinyFile }), "file_too_large");
    const tinyTotal = { ...LAYER_LIMITS, totalBytes: 200 };
    await rejects(importLayersZip(await zipOf({ "hair/A.png": png(1), "hair/B.png": png(2), "hair/C.png": png(3), "hair/D.png": png(4) }), s.layers, { limits: tinyTotal }), "upload_too_large");
    const tinyDir = { ...LAYER_LIMITS, dirBytes: 200 };
    await importLayersZip(await zipOf({ "hair/A.png": png(1) }), s.layers, { limits: tinyDir });
    await rejects(importLayersZip(await zipOf({ "hair/B.png": png(2), "hair/C.png": png(3), "hair/D.png": png(4) }), s.layers, { limits: tinyDir }), "folder_full");
    assert.equal(layersStatus(s.layers).files, 1, "failed uploads left the folder as it was");
  } finally {
    s.done();
  }
});

test("layersStatus reports coverage against the preset traits; None needs no file", async () => {
  const s = sandbox();
  try {
    const items = [
      { key: "hair", options: [{ value: "Bob" }, { value: "Wavy Medium" }, { value: "None" }] },
      { key: "eyes", options: [{ value: "Blue" }] },
      { key: "hat", options: [{ value: "Cap", layer: "hats/cap-front.png" }] },
    ];
    assert.deepEqual(layersStatus(s.layers, items).coverage, { expected: 4, present: 0, missing: ["hair/Bob.png", "hair/Wavy Medium.png", "eyes/Blue.png", "hats/cap-front.png"], missingCount: 4 });
    await importLayersZip(await zipOf({ "hair/Bob.png": png(1), "eyes/Blue.png": png(2), "hats/cap-front.png": png(3) }), s.layers);
    const st = layersStatus(s.layers, items);
    assert.equal(st.coverage.present, 3);
    assert.deepEqual(st.coverage.missing, ["hair/Wavy Medium.png"]);
    assert.equal(layersStatus(s.layers).coverage, null, "no items: no coverage");
  } finally {
    s.done();
  }
});

test("clearLayers removes everything and reports how many files", async () => {
  const s = sandbox();
  try {
    await importLayersZip(await zipOf({ "hair/Bob.png": png(1), "eyes/Blue.png": png(2) }), s.layers);
    assert.equal(clearLayers(s.layers).removed, 2);
    assert.equal(layersStatus(s.layers).exists, false);
    assert.equal(clearLayers(s.layers).removed, 0, "idempotent");
  } finally {
    s.done();
  }
});

test("a '..' entry cannot write outside the layers folder (JSZip neutralises it, we check again)", async () => {
  const s = sandbox();
  try {
    const r = await importLayersZip(await zipOf({ "../evil.png": png(1), "hair/../../evil2.png": png(2), "hair/Bob.png": png(3) }), s.layers);
    assert.equal(r.files, 1, "only the real layer is imported");
    assert.equal(existsSync(join(s.root, "evil.png")), false);
    assert.equal(existsSync(join(s.root, "evil2.png")), false);
    assert.equal(existsSync(join(s.layers, "evil.png")), false);
  } finally {
    s.done();
  }
});
