// R15 (BETA-REVIEW round 3): "Check quality" streams its progress, and the old JSON answer stays for callers that do not ask for a stream.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import JSZip from "jszip";
import { createMockPng } from "../src/mock-image.mjs";
import { newSeriesStarter } from "../server/ui/series-starter.js";
import { startStudio } from "./helpers/studio-server.mjs";

const VALUES = ["v1", "v2", "v3", "v4"];
const KEYS = ["body", "hat"];
const SIZE = 12;

describe("GET /api/quality", () => {
  let studio;
  before(async () => {
    studio = await startStudio({ extraEnv: { WELCOME_CREDITS: "100" } });
    await studio.signIn();
    const items = KEYS.map((key) => ({ key, type: key, options: VALUES.map((value) => ({ value, weight: 1, prompt: `${key} ${value}` })) }));
    const preset = {
      ...newSeriesStarter({ id: "q", name: "Q", seed: "q", size: SIZE }),
      promptTemplate: { keep: ["Edit this image of a {who}."], changeKeys: KEYS, extraKeys: [], suffix: "No text." },
      traits: { items },
    };
    assert.equal((await studio.call("POST", "/api/preset/save", { body: { preset } })).status, 200);
    assert.equal((await studio.call("POST", "/api/build", { body: { file: "q.json" } })).status, 200);
    const base = createMockPng({ width: 128, height: 128, seed: 9 });
    await studio.call("POST", "/api/base/upload", { body: { filename: "primary.png", role: "primary", data: base.toString("base64") } });
    const zip = new JSZip();
    for (const key of KEYS) VALUES.forEach((v, i) => zip.file(`${key}/${v}.png`, createMockPng({ width: 128, height: 128, seed: i * 31 + key.length })));
    assert.equal((await studio.call("POST", "/api/layers/upload", { body: await zip.generateAsync({ type: "nodebuffer" }), raw: true })).status, 200);
    assert.equal((await studio.call("POST", "/api/compose", { body: { archive: "q.json" }, timeoutMs: 120000 })).status, 200);
  });
  after(() => studio?.stop());

  const sse = (text) => text.split("\n\n").map((b) => /^data:\s*(.+)$/m.exec(b)?.[1]).filter(Boolean).map((j) => JSON.parse(j));

  test("with Accept: text/event-stream it sends progress for every frame, then the report", async () => {
    const r = await studio.call("GET", "/api/quality?dir=layers", { headers: { Accept: "text/event-stream" }, raw: true });
    assert.equal(r.status, 200);
    assert.match(r.headers["content-type"], /text\/event-stream/);
    const events = sse(r.text);
    assert.equal(events.filter((e) => e.type === "progress").length, SIZE);
    assert.deepEqual(events.filter((e) => e.type === "progress").at(-1), { type: "progress", done: SIZE, total: SIZE });
    const done = events.at(-1);
    assert.equal(done.type, "done");
    assert.equal(done.total, SIZE);
  });

  test("without it the answer is the same JSON as before", async () => {
    const r = await studio.call("GET", "/api/quality?dir=layers");
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.total, SIZE);
  });

  test("closing the connection mid-walk leaves the server healthy", async () => {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no progress arrived")), 30000);
      const req = request({ host: "127.0.0.1", port: studio.port, method: "GET", path: "/api/quality?dir=layers", headers: { Accept: "text/event-stream", Cookie: studio.cookie } }, (res) => {
        res.once("data", () => { clearTimeout(timer); req.destroy(); resolve(); });
        res.on("error", () => {});
      });
      req.on("error", () => {});
      req.end();
    });
    const r = await studio.call("GET", "/api/quality?dir=layers");
    assert.equal(r.status, 200);
    assert.equal(r.json.total, SIZE);
  });
});
