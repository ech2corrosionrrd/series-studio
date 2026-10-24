import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { writeFilesZip } from "../src/kit-zip.mjs";

test("writeFilesZip: writes strings and buffers, skips null, creates folders", async () => {
  const out = join(mkdtempSync(join(tmpdir(), "kit-zip-")), "a", "b", "kit.zip");
  const size = await writeFilesZip({ "readme.txt": "привіт", "img/1.png": Buffer.from([1, 2, 3]), skipped: null }, out);
  assert.ok(existsSync(out));
  assert.equal(readFileSync(out).length, size);
  const zip = await JSZip.loadAsync(readFileSync(out));
  assert.deepEqual(Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort(), ["img/1.png", "readme.txt"]);
  assert.equal(await zip.file("readme.txt").async("string"), "привіт");
  assert.deepEqual([...(await zip.file("img/1.png").async("nodebuffer"))], [1, 2, 3]);
});

test("writeFilesZip: empty or missing map gives a valid empty archive", async () => {
  const out = join(mkdtempSync(join(tmpdir(), "kit-zip-")), "empty.zip");
  assert.ok((await writeFilesZip(undefined, out)) > 0);
  assert.equal(Object.keys((await JSZip.loadAsync(readFileSync(out))).files).length, 0);
});
