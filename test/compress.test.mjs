import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { compressImage, compressSet } from "../src/compress.mjs";
import { imageFormat } from "../src/png-normalize.mjs";
import { createMockPng } from "../src/mock-image.mjs";
import { loadSharp } from "../src/upscale.mjs";

const sharp = await loadSharp();
const LIMIT = 300_000;

/** Noisy RGB frame: a big PNG that does not shrink by deflate alone. */
async function bigPng(size = 640) {
  const raw = randomBytes(size * size * 3);
  return sharp(raw, { raw: { width: size, height: size, channels: 3 } }).png({ compressionLevel: 1 }).toBuffer();
}

test("compressImage brings a large PNG under the limit and returns a PNG", { skip: !sharp }, async () => {
  const big = await bigPng();
  assert.ok(big.length > LIMIT);
  const r = await compressImage(big, LIMIT);
  assert.equal(r.ok, true);
  assert.ok(r.bytes <= LIMIT);
  assert.equal(imageFormat(r.buffer), "png");
  assert.match(r.method, /^(palette|resize)-/);
});

test("compressImage reports unreadable bytes without throwing", { skip: !sharp }, async () => {
  const r = await compressImage(Buffer.from("definitely not an image"), LIMIT);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unreadable");
});

test("compressSet keeps the original as a version and is repeatable", { skip: !sharp }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "compress-"));
  try {
    const big = await bigPng();
    writeFileSync(join(dir, "1.png"), big);
    writeFileSync(join(dir, "2.png"), createMockPng({ seed: 2, title: "small" }));

    const dry = await compressSet(dir, { maxBytes: LIMIT, dryRun: true });
    assert.equal(dry.scanned, 2);
    assert.deepEqual(dry.over.map((o) => o.edition), [1]);
    assert.equal(statSync(join(dir, "1.png")).size, big.length);

    const r = await compressSet(dir, { maxBytes: LIMIT });
    assert.equal(r.compressed.length, 1);
    assert.equal(r.failed.length, 0);
    assert.ok(statSync(join(dir, "1.png")).size <= LIMIT);
    assert.ok(r.savedBytes > 0);
    const original = join(dir, "versions", "1", "v1.png");
    assert.ok(existsSync(original));
    assert.deepEqual(readFileSync(original), big);

    const again = await compressSet(dir, { maxBytes: LIMIT });
    assert.equal(again.over.length, 0);
    assert.equal(again.compressed.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("compressSet rejects a missing folder", async () => {
  await assert.rejects(() => compressSet("no-such-folder-cc"), /not a folder/);
});
