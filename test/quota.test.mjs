// Disk and preset-size quotas: one wallet cannot fill the shared disk or send engines a giant series.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createMockPng } from "../src/mock-image.mjs";
import { diskStatus, forgetUsage, noteWrite, presetLimitIssues, quotaConfig, usedBytes, walkBytes } from "../src/quota.mjs";
import { startStudio } from "./helpers/studio-server.mjs";

describe("quota helpers", () => {
  it("reads limits from the environment, with defaults and 0 = off", () => {
    assert.deepEqual(
      [quotaConfig({}).diskMb, quotaConfig({}).presetSize, quotaConfig({}).presetTraits, quotaConfig({}).presetOptions],
      [2048, 10000, 40, 200],
    );
    const c = quotaConfig({ WALLET_DISK_QUOTA_MB: "0", PRESET_MAX_SIZE: "500", PRESET_MAX_TRAITS: "bad", PRESET_MAX_BYTES: "-1" });
    assert.deepEqual([c.diskMb, c.presetSize, c.presetTraits, c.presetBytes], [0, 500, 40, 1048576]);
  });

  it("counts every file under the wallet folder and sees writes noted in between", () => {
    const root = mkdtempSync(join(tmpdir(), "quota-"));
    mkdirSync(join(root, "a", "b"), { recursive: true });
    writeFileSync(join(root, "one.bin"), Buffer.alloc(1000));
    writeFileSync(join(root, "a", "b", "two.bin"), Buffer.alloc(500));
    assert.equal(walkBytes(root), 1500);
    assert.equal(walkBytes(join(root, "missing")), 0);
    forgetUsage(root);
    assert.equal(usedBytes(root), 1500);
    writeFileSync(join(root, "three.bin"), Buffer.alloc(100));
    assert.equal(usedBytes(root), 1500, "cached for a few seconds");
    noteWrite(root, 100);
    assert.equal(usedBytes(root), 1600, "a noted write is added without a new walk");
    forgetUsage(root);
    assert.equal(usedBytes(root), 1600);
  });

  it("diskStatus: within the limit, over it with the pending write, and no limit at 0", () => {
    const root = mkdtempSync(join(tmpdir(), "quota-"));
    writeFileSync(join(root, "f.bin"), Buffer.alloc(900 * 1024));
    forgetUsage(root);
    const cfg = { ...quotaConfig({}), diskMb: 1 };
    assert.equal(diskStatus(root, 0, cfg).ok, true);
    assert.equal(diskStatus(root, 200 * 1024, cfg).ok, false);
    assert.equal(diskStatus(root, 10 ** 12, { ...cfg, diskMb: 0 }).ok, true);
  });

  it("presetLimitIssues: size, traits, options and bytes", () => {
    const opts = (n) => Array.from({ length: n }, (_, i) => ({ value: `v${i}`, weight: 1 }));
    const preset = { size: 20000, traits: { items: [{ key: "hair", options: opts(3) }, { key: "eyes", options: opts(300) }] } };
    const issues = presetLimitIssues(preset, quotaConfig({}));
    assert.equal(issues.length, 2);
    assert.match(issues[0], /20000.*10000/);
    assert.match(issues[1], /eyes.*300/);
    assert.deepEqual(presetLimitIssues({ size: 12, traits: { items: [{ key: "a", options: opts(2) }] } }, quotaConfig({})), []);
    assert.equal(presetLimitIssues(preset, quotaConfig({ PRESET_MAX_SIZE: "0", PRESET_MAX_OPTIONS: "0" })).length, 0, "0 turns a limit off");
    assert.equal(presetLimitIssues({ size: 1, note: "x".repeat(5000) }, quotaConfig({ PRESET_MAX_BYTES: "1000" })).length, 1);
    assert.deepEqual(presetLimitIssues(null), []);
  });
});

describe("quotas on the hosted studio", () => {
  const demo = JSON.parse(readFileSync("presets/demo-series.json", "utf8"));
  // line quotas must add up to the size, so a different size goes without them
  const withSize = (extra) => { const p = { ...demo, ...extra }; delete p.lines; return p; };
  const png = (seed) => createMockPng({ seed, title: `quota-${seed}` });
  let s;
  const upload = (srv, name, buf, extra = {}) =>
    srv.call("POST", "/api/base/upload", { body: { filename: name, data: Buffer.from(buf).toString("base64"), ...extra } });

  before(async () => {
    s = await startStudio({
      adminWallet: false,
      extraEnv: { WALLET_DISK_QUOTA_MB: "1", PRESET_MAX_SIZE: "50", PRESET_MAX_TRAITS: "20", WELCOME_CREDITS: "100", EARLY_WELCOME_CREDITS: "100" },
    });
    await s.signIn();
  });
  after(async () => {
    await s?.stop();
  });

  it("a preset above the size limit is refused with the reason, within the limit it saves", async () => {
    const big = withSize({ id: "too-big", name: "Too big", size: 51 });
    const r = await s.call("POST", "/api/preset/save", { body: { preset: big } });
    assert.equal(r.status, 400, r.text);
    assert.ok(JSON.stringify(r.json.errors).includes("limit of 50"), r.text);
    const v = await s.call("POST", "/api/validate", { body: { preset: big } });
    assert.equal(v.status, 400, "validate applies the same limit");
    const ok = await s.call("POST", "/api/preset/save", { body: { preset: withSize({ id: "fits", name: "Fits", size: 12 }) } });
    assert.equal(ok.status, 200, ok.text);
  });

  it("the card reports the disk use and limit", async () => {
    const r = await s.call("GET", "/api/projects");
    assert.equal(r.json.storage.limit, 1024 * 1024);
    assert.equal(r.json.storage.exempt, false);
    assert.ok(r.json.storage.used >= 0);
    assert.equal((await s.call("GET", "/api/me")).json.storage.limit, 1024 * 1024);
  });

  it("an upload that would pass the disk quota is refused and nothing is written; a small one still works", async () => {
    const small = await upload(s, "small.png", png(1));
    assert.equal(small.status, 200, small.text);
    const huge = Buffer.concat([Buffer.from(png(2)), Buffer.alloc(1024 * 1024)]); // > 1 MB on its own
    const r = await upload(s, "huge.png", huge, { role: "extra" });
    assert.equal(r.status, 413, r.text);
    assert.equal(r.json.code, "disk_quota");
    assert.ok(r.json.limit > 0 && r.json.used > 0);
    assert.match(r.json.error, /Disk quota reached/);
  });

  it("when the disk is full, generating a frame is refused before anything is paid", async () => {
    // with a 1 MB quota the 6 MB reserve kept for one more frame never fits
    const before = (await s.call("GET", "/api/me")).json.balance;
    const r = await s.call("POST", "/api/base/generate", { body: { wish: "a calm portrait", engine: "mock" } });
    assert.equal(r.status, 413, r.text);
    assert.equal(r.json.code, "disk_quota");
    assert.equal((await s.call("GET", "/api/me")).json.balance, before, "no credits were taken");
  });
});

describe("admin is exempt from the quotas", () => {
  const demo = JSON.parse(readFileSync("presets/demo-series.json", "utf8"));
  const withSize = (extra) => { const p = { ...demo, ...extra }; delete p.lines; return p; };
  let s;
  before(async () => {
    s = await startStudio({ adminWallet: true, extraEnv: { WALLET_DISK_QUOTA_MB: "1", PRESET_MAX_SIZE: "50" } });
    await s.signIn();
  });
  after(async () => {
    await s?.stop();
  });

  it("no disk limit shown and a large series saves", async () => {
    const r = await s.call("GET", "/api/projects");
    assert.deepEqual([r.json.storage.exempt, r.json.storage.limit], [true, 0]);
    const save = await s.call("POST", "/api/preset/save", { body: { preset: withSize({ id: "admin-big", name: "Admin big", size: 200 }) } });
    assert.equal(save.status, 200, save.text);
  });
});
