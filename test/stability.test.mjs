import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { createMockPng } from "../src/mock-image.mjs";
import { runDoctorDiagnostics, formatDoctorReport } from "../src/doctor.mjs";
import { ENGINES, TXT2IMG, pickAvailableEngine } from "../src/engines.mjs";

test("Stability: createMockPng generates valid PNG buffer with magic bytes", () => {
  const buf = createMockPng({ width: 256, height: 256, seed: 99 });
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 500);

  // Check PNG magic bytes: \x89PNG\r\n\x1a\n
  const expectedSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.deepEqual(buf.subarray(0, 8), expectedSig);
});

test("Stability: mock engine is registered in ENGINES and TXT2IMG with $0 cost", async () => {
  assert.ok(ENGINES.mock, "mock in ENGINES");
  assert.ok(TXT2IMG.mock, "mock in TXT2IMG");
  assert.equal(ENGINES.mock.costUsd, 0.0);
  assert.equal(TXT2IMG.mock.costUsd, 0.0);

  const editBuf = await ENGINES.mock.generate({ prompt: "cyber cat", seed: 1 });
  assert.ok(Buffer.isBuffer(editBuf));

  const txtBuf = await TXT2IMG.mock.generate({ prompt: "cyber dog", seed: 2 });
  assert.ok(Buffer.isBuffer(txtBuf));

  const picked = pickAvailableEngine("mock", {}, ENGINES);
  assert.equal(picked, "mock");
});

test("Stability: runDoctorDiagnostics validates environment, directories, and presets", async () => {
  const report = await runDoctorDiagnostics({ rootDir: resolve(".") });
  assert.equal(typeof report.ok, "boolean");
  assert.ok(report.system.nodeOk, "Node version >= 20");
  assert.ok(report.presets.total >= 3, "At least 3 presets present");
  assert.equal(report.presets.errors.length, 0, "All presets are valid");
  assert.ok(report.traitPacks.total >= 4, "At least 4 trait packs present");
  assert.equal(report.traitPacks.errors.length, 0, "All trait packs are valid");
  assert.ok(report.directories.presets);
  assert.ok(report.directories.out);

  const formatted = formatDoctorReport(report);
  assert.match(formatted, /SERIES LAB SYSTEM DOCTOR/);
  assert.match(formatted, /Node\.js/);
  assert.match(formatted, /Overall Health/);
});

test("Stability: CLI series doctor executes cleanly and exits with 0", () => {
  const cli = resolve("bin/series.mjs");
  const stdout = execFileSync(process.execPath, [cli, "doctor"], { encoding: "utf8" });
  assert.match(stdout, /Running Series Lab diagnostic checks/);
  assert.match(stdout, /OVERALL HEALTH/i);
});
