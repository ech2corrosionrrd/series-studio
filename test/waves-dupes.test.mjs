import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRecipes } from "../src/recipes.mjs";
import { appendSupplyWave } from "../src/waves.mjs";
import { aHashFromGray, findDupes, hamming } from "../src/dupes.mjs";
import { createMockPng } from "../src/mock-image.mjs";
import { appendRenderLog, engineStatsToday, recentEngineErrors } from "../src/spend.mjs";

const demoPath = join(dirname(fileURLToPath(import.meta.url)), "..", "presets", "demo-series.json");

function loadDemo() {
  return JSON.parse(readFileSync(demoPath, "utf8"));
}

describe("supply waves", () => {
  it("keeps the first wave's DNA and seeds when a second wave is appended", () => {
    const preset = loadDemo();
    const before = buildRecipes(preset);
    const next = appendSupplyWave(preset, { size: 6, seed: `${preset.seed}-w2` });
    const after = buildRecipes(next);
    assert.equal(after.length, before.length + 6);
    assert.deepEqual(after.slice(0, before.length).map((r) => r.dna), before.map((r) => r.dna));
    assert.deepEqual(after.slice(0, before.length).map((r) => r.seed), before.map((r) => r.seed));
    assert.equal(after[0].wave, 1);
    assert.equal(after[before.length].wave, 2);
    assert.equal(after[before.length].edition, before.length + 1);
    const again = appendSupplyWave(next, { size: 4, seed: `${preset.seed}-w3` });
    const third = buildRecipes(again);
    assert.deepEqual(third.slice(0, after.length).map((r) => r.dna), after.map((r) => r.dna));
  });

  it("refuses a seed that another wave already uses", () => {
    const preset = loadDemo();
    assert.throws(() => appendSupplyWave(preset, { size: 4, seed: preset.seed }), /already used/);
  });
});

describe("visual dupes", () => {
  it("hamming is zero for the same hash and high for inverted halves", () => {
    const left = new Float64Array(64);
    const right = new Float64Array(64);
    for (let i = 0; i < 64; i++) {
      left[i] = i % 8 < 4 ? 0 : 255;
      right[i] = i % 8 < 4 ? 255 : 0;
    }
    const a = aHashFromGray(left);
    const b = aHashFromGray(right);
    assert.equal(hamming(a, a), 0);
    assert.ok(hamming(a, b) > 8);
  });

  it("finds two copies of the same png and ignores a different one only if it is far", () => {
    const dir = mkdtempSync(join(tmpdir(), "series-dupes-"));
    try {
      const png = createMockPng({ seed: 7, width: 64, height: 64 });
      writeFileSync(join(dir, "1.png"), png);
      writeFileSync(join(dir, "2.png"), png);
      writeFileSync(join(dir, "3.png"), createMockPng({ seed: 99, width: 64, height: 64 }));
      const found = findDupes(dir, { maxDistance: 0 });
      assert.ok(found.pairs.some((p) => p.distance === 0 && p.a === "1.png" && p.b === "2.png"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("engine failure share", () => {
  it("counts today's successes and failures per engine", () => {
    const dir = mkdtempSync(join(tmpdir(), "series-spend-"));
    const file = join(dir, "render-log.jsonl");
    const now = new Date("2026-09-25T12:00:00");
    try {
      appendRenderLog(file, { engine: "fal", ok: true, costUsd: 0.01 }, now);
      appendRenderLog(file, { engine: "fal", ok: false, costUsd: 0, error: "no" }, now);
      appendRenderLog(file, { engine: "fal", ok: false, costUsd: 0 }, now);
      appendRenderLog(file, { engine: "mock", ok: true, costUsd: 0 }, now);
      appendRenderLog(file, { engine: "fal", ok: false, costUsd: 0 }, new Date("2026-09-24T12:00:00"));
      const stats = engineStatsToday(file, now);
      assert.equal(stats.fal.ok, 1);
      assert.equal(stats.fal.fail, 2);
      assert.equal(stats.fal.failRate, 0.667);
      assert.equal(stats.mock.fail, 0);
      const errors = recentEngineErrors(file, 2);
      assert.equal(errors.length, 2);
      assert.equal(errors[0].engine, "fal");
      assert.equal(errors[0].error, "");
      assert.notEqual(errors[0].at, errors[1].at);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
