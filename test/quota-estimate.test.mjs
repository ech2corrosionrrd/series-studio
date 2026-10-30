// R13 (BETA-REVIEW round 3): a job that cannot fit the wallet's disk is refused up front, with the numbers, not half way through.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createMockPng } from "../src/mock-image.mjs";
import { diskMessage } from "../src/quota.mjs";
import { newSeriesStarter } from "../server/ui/series-starter.js";
import { startStudio } from "./helpers/studio-server.mjs";

const VALUES = ["v1", "v2", "v3", "v4"];
const KEYS = ["body", "hat", "prop"];
const SIZE = 60;

describe("diskMessage", () => {
  const s = { used: 1 * 1024 * 1024, limit: 10 * 1024 * 1024 };
  test("with nothing to add: how much is used; with a job: what it needs and what is free", () => {
    assert.match(diskMessage(s), /1 of 10 MB used/);
    const big = diskMessage(s, 30 * 1024 * 1024);
    assert.match(big, /Disk quota reached/);
    assert.match(big, /needs about 30 MB, only 9 MB of 10 MB are free/);
  });
});

describe("compose and export on a small disk quota", () => {
  let studio;
  before(async () => {
    studio = await startStudio({ adminWallet: false, extraEnv: { WELCOME_CREDITS: "100", WALLET_DISK_QUOTA_MB: "2" } });
    await studio.signIn();
    const items = KEYS.map((key) => ({ key, type: key, options: VALUES.map((value) => ({ value, weight: 1, prompt: `${key} ${value}` })) }));
    const preset = {
      ...newSeriesStarter({ id: "qe", name: "Qe", seed: "qe", size: SIZE }),
      promptTemplate: { keep: ["Edit this image of a {who}."], changeKeys: KEYS, extraKeys: [], suffix: "No text." },
      traits: { items },
    };
    assert.equal((await studio.call("POST", "/api/preset/save", { body: { preset } })).status, 200);
    const built = await studio.call("POST", "/api/build", { body: { file: "qe.json" } });
    assert.equal(built.status, 200, built.text);
    const base = createMockPng({ width: 512, height: 512, seed: 9 });
    const up = await studio.call("POST", "/api/base/upload", { body: { filename: "primary.png", role: "primary", data: base.toString("base64") } });
    assert.equal(up.status, 200, up.text);
    const zip = new JSZip();
    for (const key of KEYS) VALUES.forEach((v, i) => zip.file(`${key}/${v}.png`, createMockPng({ width: 64, height: 64, seed: i * 31 + key.length })));
    assert.equal((await studio.call("POST", "/api/layers/upload", { body: await zip.generateAsync({ type: "nodebuffer" }), raw: true })).status, 200);
  });
  after(() => studio?.stop());

  test("composing every frame is refused before it starts when the frames would not fit; a short run still works", async () => {
    const all = await studio.call("POST", "/api/compose", { body: { archive: "qe.json" } });
    assert.equal(all.status, 413, all.text.slice(0, 300));
    assert.equal(all.json.code, "disk_quota");
    assert.match(all.json.error, /needs about .* MB, only .* MB/);
    const few = await studio.call("POST", "/api/compose", { body: { archive: "qe.json", limit: 2 } });
    assert.equal(few.status, 200, few.text.slice(0, 300));
    assert.equal(few.json.count, 2);
  });

  test("the export ZIP is refused before it is built when the frames would not fit again", async () => {
    const compose = await studio.call("POST", "/api/compose", { body: { archive: "qe.json", limit: 10 } });
    assert.equal(compose.status, 200, compose.text.slice(0, 300));
    // pad the set with big frames of their own (the folder is the wallet's own, under the harness data dir)
    const find = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      return e.isDirectory() ? (p.replaceAll("\\", "/").endsWith("out/layers") ? [p] : find(p)) : [];
    });
    const [setDir] = find(studio.dir);
    for (let i = 0; i < 6; i++) writeFileSync(join(setDir, `${100 + i}.png`), Buffer.concat([createMockPng({ width: 64, height: 64, seed: i }), randomBytes(200 * 1024)]));
    const r = await studio.call("POST", "/api/export/bundle", { body: { archive: "qe.json", set: "layers", format: "erc721", onlyKeep: false } });
    assert.equal(r.status, 413, r.text.slice(0, 300));
    assert.equal(r.json.code, "disk_quota");
    assert.match(r.json.error, /needs about .* MB, only .* MB/);
  });
});
