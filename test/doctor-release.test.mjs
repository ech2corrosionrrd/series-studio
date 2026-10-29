import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  cacheFileStatus,
  checkReleaseReadiness,
  formatDoctorReport,
  keypairFileStatus,
  nodeMeetsRelease,
} from "../src/doctor.mjs";

test("nodeMeetsRelease follows the package floor of 22.13", () => {
  assert.equal(nodeMeetsRelease("22.13.0"), true);
  assert.equal(nodeMeetsRelease("v24.1.0"), true);
  assert.equal(nodeMeetsRelease("22.12.9"), false);
  assert.equal(nodeMeetsRelease("20.19.0"), false);
});

test("keypairFileStatus never returns file contents", () => {
  const dir = mkdtempSync(join(tmpdir(), "series-doctor-"));
  const file = join(dir, "deployer.json");
  const secret = "SUPERSECRET-KEY-MATERIAL";
  writeFileSync(file, secret);
  const status = keypairFileStatus(file);
  assert.equal(status.checked, true);
  assert.equal(status.exists, true);
  assert.equal(status.read, false);
  assert.equal(status.bytes, Buffer.byteLength(secret));
  assert.equal(JSON.stringify(status).includes(secret), false);

  const missing = keypairFileStatus(join(dir, "nope.json"));
  assert.equal(missing.exists, false);
  assert.equal(missing.read, false);
  assert.deepEqual(cacheFileStatus(""), { checked: false, exists: false, path: "" });
});

test("checkReleaseReadiness is ready only when node, mplx and given paths pass", () => {
  const found = () => ({ status: 0, stdout: "/usr/local/bin/mplx\n" });
  const missing = () => ({ status: 1, stdout: "" });
  const ok = checkReleaseReadiness({ nodeVersion: "22.13.1", runner: found, platform: "linux" });
  assert.equal(ok.ready, true);
  assert.equal(ok.keypair.checked, false);
  assert.equal(ok.mplx.found, true);

  const noMplx = checkReleaseReadiness({ nodeVersion: "22.13.1", runner: missing, platform: "linux" });
  assert.equal(noMplx.ready, false);

  const oldNode = checkReleaseReadiness({ nodeVersion: "22.12.0", runner: found, platform: "linux" });
  assert.equal(oldNode.ready, false);

  const noKey = checkReleaseReadiness({
    nodeVersion: "22.13.1",
    runner: found,
    platform: "linux",
    keypair: join(tmpdir(), "missing-deployer.json"),
  });
  assert.equal(noKey.ready, false);
  assert.equal(noKey.keypair.read, false);
});

test("formatDoctorReport prints the release section without implying the key was opened", () => {
  const text = formatDoctorReport({
    ok: true,
    system: { node: "v22.13.0", nodeOk: true, platform: "linux", arch: "x64" },
    directories: { presets: true },
    presets: { total: 1, valid: 1, errors: [] },
    traitPacks: { total: 1, valid: 1, errors: [] },
    baseImage: { exists: false },
    sharp: { installed: false },
    engines: [],
    release: checkReleaseReadiness({ nodeVersion: "22.13.0", runner: () => ({ status: 1, stdout: "" }), platform: "linux" }),
  });
  assert.match(text, /Release on this PC/);
  assert.match(text, /contents were not read|file is never opened/);
  assert.match(text, /Release ready: ✗ NO/);
});

test("series doctor --release exits 1 when the keypair file is missing and does not print a secret", () => {
  const cli = resolve("bin/series.mjs");
  const dir = mkdtempSync(join(tmpdir(), "series-doctor-cli-"));
  const secretFile = join(dir, "real.json");
  writeFileSync(secretFile, "DO-NOT-PRINT-THIS-KEY");
  let stdout = "";
  let code = 0;
  try {
    stdout = execFileSync(process.execPath, [cli, "doctor", "--release", "--keypair", join(dir, "missing.json")], {
      encoding: "utf8",
    });
  } catch (err) {
    code = err.status;
    stdout = `${err.stdout || ""}${err.stderr || ""}`;
  }
  assert.equal(code, 1);
  assert.match(stdout, /Release on this PC/);
  assert.equal(stdout.includes("DO-NOT-PRINT-THIS-KEY"), false);
});
