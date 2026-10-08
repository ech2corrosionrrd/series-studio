import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeSetQuality } from "../src/quality.mjs";
import { createMockPng } from "../src/mock-image.mjs";

function setDir() {
  return mkdtempSync(join(tmpdir(), "quality-"));
}
const png = (seed) => createMockPng({ seed, title: `t${seed}` });

test("a clean set has no problem frames", async () => {
  const dir = setDir();
  try {
    for (let i = 1; i <= 3; i++) writeFileSync(join(dir, `${i}.png`), png(i * 101));
    const r = await analyzeSetQuality({ setDir: dir });
    assert.equal(r.total, 3);
    assert.equal(r.hasBase, false);
    assert.equal(r.similarity, null);
    assert.equal(r.counts.bad_format, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a JPEG saved as .png and a tiny file are reported with the worst first", async () => {
  const dir = setDir();
  try {
    writeFileSync(join(dir, "1.png"), png(1));
    writeFileSync(join(dir, "2.png"), Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4096, 5)]));
    writeFileSync(join(dir, "3.png"), Buffer.from("tiny"));
    const r = await analyzeSetQuality({ setDir: dir });
    assert.equal(r.problemFrames, 2);
    assert.equal(r.counts.bad_format, 2);
    assert.equal(r.counts.tiny, 1);
    assert.deepEqual(r.problemEditions.sort(), [2, 3]);
    const f2 = r.weakest.find((f) => f.edition === 2);
    assert.ok(f2.issues.some((i) => i.kind === "bad_format" && i.detail === "jpeg"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("two identical frames are flagged as duplicates on both sides", async () => {
  const dir = setDir();
  try {
    const same = png(7);
    writeFileSync(join(dir, "1.png"), same);
    writeFileSync(join(dir, "2.png"), same);
    writeFileSync(join(dir, "3.png"), png(900));
    const r = await analyzeSetQuality({ setDir: dir });
    assert.equal(r.counts.duplicate, 2);
    const eds = r.weakest.filter((f) => f.issues.some((i) => i.kind === "duplicate")).map((f) => f.edition).sort();
    assert.deepEqual(eds, [1, 2]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("similarity to the base is reported, cached, and a redo mark is informational", async () => {
  const dir = setDir();
  try {
    const base = png(5);
    writeFileSync(join(dir, "1.png"), base);
    writeFileSync(join(dir, "2.png"), png(5));
    const r = await analyzeSetQuality({ setDir: dir, baseBuf: base, marks: { 2: "redo" } });
    assert.equal(r.hasBase, true);
    assert.ok(r.similarity.mean > 0.9);
    assert.equal(r.counts.marked_redo, 1);
    assert.ok(existsSync(join(dir, "quality-cache.json")));
    const again = await analyzeSetQuality({ setDir: dir, baseBuf: base, marks: {} });
    assert.equal(again.similarity.mean, r.similarity.mean);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing folder is an error", async () => {
  await assert.rejects(() => analyzeSetQuality({ setDir: "no-such-folder-qq" }), /not a folder/);
});
