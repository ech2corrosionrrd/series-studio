import { test } from "node:test";
import assert from "node:assert/strict";
import { imageFormat, ensurePng } from "../src/png-normalize.mjs";
import { ENGINES } from "../src/engines.mjs";
import { createMockPng } from "../src/mock-image.mjs";
import { loadSharp } from "../src/upscale.mjs";

const sharp = await loadSharp();

async function jpegBytes() {
  return sharp({ create: { width: 32, height: 32, channels: 3, background: "#c08040" } }).jpeg().toBuffer();
}

test("imageFormat recognises png, jpeg and unknown bytes", async () => {
  assert.equal(imageFormat(createMockPng({ seed: 1, title: "t" })), "png");
  assert.equal(imageFormat(Buffer.from("not an image at all")), "unknown");
  if (sharp) assert.equal(imageFormat(await jpegBytes()), "jpeg");
});

test("ensurePng leaves png and unknown bytes untouched", async () => {
  const png = createMockPng({ seed: 2, title: "t" });
  const a = await ensurePng(png);
  assert.equal(a.converted, false);
  assert.equal(a.buffer, png);
  const junk = Buffer.from("fake image bytes from a test double");
  const b = await ensurePng(junk);
  assert.equal(b.converted, false);
  assert.equal(b.buffer, junk);
});

test("ensurePng converts jpeg to a real png", { skip: !sharp }, async () => {
  const r = await ensurePng(await jpegBytes());
  assert.equal(r.converted, true);
  assert.equal(r.format, "jpeg");
  assert.equal(imageFormat(r.buffer), "png");
});

test("pollinations edit returns png even when the service sends jpeg", { skip: !sharp }, async () => {
  const jpeg = await jpegBytes();
  const fetch = async () => new Response(jpeg, { status: 200, headers: { "content-type": "image/jpeg" } });
  const out = await ENGINES.pollinations.generate(
    { prompt: "x", image: createMockPng({ seed: 3, title: "b" }), mime: "image/png", seed: 1, strength: 0.45 },
    { fetch, env: { POLLINATIONS_API_KEY: "test" } },
  );
  assert.equal(imageFormat(out), "png");
});

test("repairPngFiles converts jpeg bytes under .png names, versions included, and is repeatable", { skip: !sharp }, async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { repairPngFiles } = await import("../src/png-normalize.mjs");
  const dir = mkdtempSync(join(tmpdir(), "repair-png-"));
  try {
    const png = createMockPng({ seed: 4, title: "keep" });
    mkdirSync(join(dir, "versions", "1"), { recursive: true });
    writeFileSync(join(dir, "1.png"), await jpegBytes());
    writeFileSync(join(dir, "2.png"), png);
    writeFileSync(join(dir, "versions", "1", "v1.png"), await jpegBytes());
    writeFileSync(join(dir, "notes.txt"), "not an image");

    const dry = await repairPngFiles(dir, { dryRun: true });
    assert.equal(dry.converted.length, 2);
    assert.equal(imageFormat(readFileSync(join(dir, "1.png"))), "jpeg");

    const r = await repairPngFiles(dir);
    assert.equal(r.scanned, 3);
    assert.equal(r.converted.length, 2);
    assert.equal(r.failed.length, 0);
    assert.equal(imageFormat(readFileSync(join(dir, "1.png"))), "png");
    assert.equal(imageFormat(readFileSync(join(dir, "versions", "1", "v1.png"))), "png");
    assert.deepEqual(readFileSync(join(dir, "2.png")), png);

    const again = await repairPngFiles(dir);
    assert.equal(again.converted.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("repairPngFiles rejects a missing folder", async () => {
  const { repairPngFiles } = await import("../src/png-normalize.mjs");
  await assert.rejects(() => repairPngFiles("no-such-folder-xyz"), /not a folder/);
});
