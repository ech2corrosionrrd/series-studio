// Compose layers is priced by the frame (stage `compose`): the wallet must be able to pay before it starts, the charge is for the frames
// really composed (frames kept by a resume are free), and a wallet without credits is refused with a 402 before any work.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { createMockPng } from "../src/mock-image.mjs";
import { newSeriesStarter } from "../server/ui/series-starter.js";
import { startStudio } from "./helpers/studio-server.mjs";

const VALUES = ["v1", "v2", "v3", "v4"];
const KEYS = ["body", "hat", "prop"];
const SIZE = 40;

async function prepare(studio, id) {
  const items = KEYS.map((key) => ({ key, type: key, options: VALUES.map((value) => ({ value, weight: 1, prompt: `${key} ${value}` })) }));
  const preset = {
    ...newSeriesStarter({ id, name: id, seed: id, size: SIZE }),
    promptTemplate: { keep: ["Edit this image of a {who}."], changeKeys: KEYS, extraKeys: [], suffix: "No text." },
    traits: { items },
  };
  assert.equal((await studio.call("POST", "/api/preset/save", { body: { preset } })).status, 200);
  assert.equal((await studio.call("POST", "/api/build", { body: { file: `${id}.json` } })).status, 200);
  const base = createMockPng({ width: 128, height: 128, seed: 9 });
  assert.equal((await studio.call("POST", "/api/base/upload", { body: { filename: "primary.png", role: "primary", data: base.toString("base64") } })).status, 200);
  const zip = new JSZip();
  for (const key of KEYS) VALUES.forEach((v, i) => zip.file(`${key}/${v}.png`, createMockPng({ width: 128, height: 128, seed: i * 31 + key.length })));
  assert.equal((await studio.call("POST", "/api/layers/upload", { body: await zip.generateAsync({ type: "nodebuffer" }), raw: true })).status, 200);
}
const balance = async (studio) => (await studio.call("GET", "/api/me")).json.balance;

describe("compose is charged by the frame", () => {
  let studio;
  before(async () => {
    studio = await startStudio({ adminWallet: false, extraEnv: { WELCOME_CREDITS: "100" } });
    await studio.signIn();
    await prepare(studio, "pr");
  });
  after(() => studio?.stop());

  test("the quote says what it costs; composing charges once, and composing the same frames again is free", async () => {
    const q = await studio.call("GET", "/api/stages/quote?stage=compose&count=1000");
    assert.equal(q.json.quote.credits, 3);
    const before = await balance(studio);
    const first = await studio.call("POST", "/api/compose", { body: { archive: "pr.json" }, timeoutMs: 120000 });
    assert.equal(first.status, 200, first.text.slice(0, 300));
    assert.equal(first.json.count, SIZE);
    assert.equal(first.json.charged, 1, "40 frames: one credit");
    assert.equal(await balance(studio), before - 1);
    const again = await studio.call("POST", "/api/compose", { body: { archive: "pr.json" }, timeoutMs: 120000 });
    assert.equal(again.json.resumed, SIZE);
    assert.equal(again.json.charged, undefined, "nothing was composed: nothing is charged");
    assert.equal(await balance(studio), before - 1);
  });

  test("a single-frame preview is free", async () => {
    const before = await balance(studio);
    const r = await studio.call("POST", "/api/compose", { body: { archive: "pr.json", preview: 3 } });
    assert.equal(r.status, 200, r.text.slice(0, 200));
    assert.equal(await balance(studio), before);
  });
});

describe("compose without credits", () => {
  let studio;
  before(async () => {
    studio = await startStudio({ adminWallet: false, extraEnv: { WELCOME_CREDITS: "0" } });
    await studio.signIn();
    await prepare(studio, "np");
  });
  after(() => studio?.stop());

  test("is refused with 402 before any frame is written", async () => {
    const r = await studio.call("POST", "/api/compose", { body: { archive: "np.json" } });
    assert.equal(r.status, 402, r.text.slice(0, 300));
    assert.equal(r.json.code, "credits");
    assert.ok(r.json.needed >= 1);
  });
});
