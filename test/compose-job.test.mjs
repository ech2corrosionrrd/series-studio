// R12 (BETA-REVIEW round 3): the bulk "Compose layers" runs on a worker thread, reports each frame, can be stopped,
// and no longer freezes the server for everybody else.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { createMockPng } from "../src/mock-image.mjs";
import { composeArchive } from "../src/layers.mjs";
import { startLayersJob } from "../src/layers-job.mjs";
import { newSeriesStarter } from "../server/ui/series-starter.js";
import { startStudio } from "./helpers/studio-server.mjs";

const VALUES = ["v1", "v2", "v3", "v4"];
const KEYS = ["body", "hat", "prop"];
const items = KEYS.map((key) => ({ key, type: key, options: VALUES.map((value) => ({ value, weight: 1, prompt: `${key} ${value}` })) }));
const recipes = Array.from({ length: 12 }, (_, i) => {
  const traits = { body: VALUES[i % 4], hat: VALUES[Math.floor(i / 4) % 4], prop: VALUES[(i + 1) % 4] };
  // the DNA is the line plus the values in trait order: composeEdition refuses a recipe whose DNA disagrees with its traits
  return { edition: i + 1, index: i, line: "a", prompt: `p${i}`, dna: ["a", ...KEYS.map((k) => traits[k])].join("|"), traits };
});

function layerFixture(side) {
  const dir = mkdtempSync(join(tmpdir(), "compose-job-"));
  const layers = join(dir, "layers");
  for (const key of KEYS) {
    mkdirSync(join(layers, key), { recursive: true });
    VALUES.forEach((v, i) => writeFileSync(join(layers, key, `${v}.png`), createMockPng({ width: side, height: side, seed: i * 17 + key.length })));
  }
  return { dir, layers, basePng: createMockPng({ width: side, height: side, seed: 3 }) };
}
const filesOf = (d) => readdirSync(d).filter((f) => /^\d+\.png$/.test(f)).sort();

describe("composeArchive with onFrame and shouldStop", () => {
  test("without them it is the plain loop; with them it reports every frame and stops between frames", () => {
    const f = layerFixture(64);
    try {
      const plain = composeArchive({ archive: { recipes }, items, basePng: f.basePng, layerDir: f.layers, outDir: join(f.dir, "a") });
      assert.equal(plain.count, 12);
      assert.equal(plain.stopped, undefined);
      const seen = [];
      let calls = 0;
      const part = composeArchive({
        archive: { recipes }, items, basePng: f.basePng, layerDir: f.layers, outDir: join(f.dir, "b"),
        onFrame: (p) => seen.push(p.done), shouldStop: () => ++calls > 5,
      });
      assert.equal(part.stopped, true);
      assert.equal(part.count, 5);
      assert.equal(part.total, 12);
      assert.deepEqual(seen, [1, 2, 3, 4, 5]);
      assert.equal(filesOf(join(f.dir, "b")).length, 5, "the frames done so far stay on disk");
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  });
});

describe("startLayersJob (worker thread)", () => {
  test("its frames are byte-identical to the ones composeArchive writes", async () => {
    const f = layerFixture(64);
    try {
      composeArchive({ archive: { recipes }, items, basePng: f.basePng, layerDir: f.layers, outDir: join(f.dir, "sync") });
      const progress = [];
      const job = startLayersJob("compose", { archive: { recipes }, items, basePng: f.basePng, layerDir: f.layers, outDir: join(f.dir, "worker") }, { onProgress: (p) => progress.push(p.done) });
      const report = await job.promise;
      assert.equal(report.count, 12);
      assert.equal(progress.at(-1), 12);
      for (const file of filesOf(join(f.dir, "sync"))) {
        assert.equal(Buffer.compare(readFileSync(join(f.dir, "sync", file)), readFileSync(join(f.dir, "worker", file))), 0, `${file} is identical`);
      }
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  });

  test("stop() ends it between frames and keeps the report of what was done", async () => {
    const f = layerFixture(256);
    try {
      const many = Array.from({ length: 200 }, (_, i) => ({ ...recipes[i % 12], edition: i + 1 }));
      let job;
      job = startLayersJob("compose", { archive: { recipes: many }, items, basePng: f.basePng, layerDir: f.layers, outDir: join(f.dir, "out") }, {
        onProgress: (p) => { if (p.done === 3) job.stop(); },
      });
      const report = await job.promise;
      assert.equal(report.stopped, true);
      assert.ok(report.count >= 3 && report.count < 200, `stopped early: ${report.count}`);
      assert.equal(filesOf(join(f.dir, "out")).length, report.count);
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  });

  test("an error inside the worker rejects with its message", async () => {
    const f = layerFixture(64);
    try {
      const job = startLayersJob("compose", { archive: { recipes: [] }, items, basePng: f.basePng, layerDir: f.layers, outDir: join(f.dir, "x") });
      await assert.rejects(job.promise, /archive has no recipes/);
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  });
});

describe("POST /api/compose", () => {
  let studio;
  const SIZE = 40;
  before(async () => {
    studio = await startStudio({ extraEnv: { WELCOME_CREDITS: "100" } });
    await studio.signIn();
    const preset = {
      ...newSeriesStarter({ id: "cmp", name: "Cmp", seed: "cmp", size: SIZE }),
      promptTemplate: { keep: ["Edit this image of a {who}."], changeKeys: KEYS, extraKeys: [], suffix: "No text." },
      traits: { items },
    };
    assert.equal((await studio.call("POST", "/api/preset/save", { body: { preset } })).status, 200);
    assert.equal((await studio.call("POST", "/api/build", { body: { file: "cmp.json" } })).status, 200);
    const base = createMockPng({ width: 384, height: 384, seed: 9 });
    assert.equal((await studio.call("POST", "/api/base/upload", { body: { filename: "primary.png", role: "primary", data: base.toString("base64") } })).status, 200);
    const zip = new JSZip();
    for (const key of KEYS) VALUES.forEach((v, i) => zip.file(`${key}/${v}.png`, createMockPng({ width: 384, height: 384, seed: i * 31 + key.length })));
    const up = await studio.call("POST", "/api/layers/upload", { body: await zip.generateAsync({ type: "nodebuffer" }), raw: true });
    assert.equal(up.status, 200, up.text);
  });
  after(() => studio?.stop());

  const sse = (text) => text.split("\n\n").map((b) => /^data:\s*(.+)$/m.exec(b)?.[1]).filter(Boolean).map((j) => JSON.parse(j));

  test("with Accept: text/event-stream it streams start, progress for every frame, then done", async () => {
    const r = await studio.call("POST", "/api/compose", { body: { archive: "cmp.json" }, headers: { Accept: "text/event-stream" }, raw: true, timeoutMs: 120000 });
    assert.equal(r.status, 200);
    assert.match(r.headers["content-type"], /text\/event-stream/);
    const events = sse(r.text);
    assert.equal(events[0].type, "start");
    assert.equal(events[0].total, SIZE);
    assert.equal(events.filter((e) => e.type === "progress").length, SIZE);
    const done = events.at(-1);
    assert.equal(done.type, "done");
    assert.equal(done.count, SIZE);
    assert.equal(done.dir, "out/layers");
  });

  test("without it the answer is the same JSON as before", async () => {
    const r = await studio.call("POST", "/api/compose", { body: { archive: "cmp.json", limit: 5 }, timeoutMs: 120000 });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.count, 5);
    assert.equal(r.json.dir, "out/layers");
  });

  test("while it composes, /health keeps answering fast and a second compose of the project is refused", async () => {
    const latencies = [];
    let polling = true;
    const poll = (async () => {
      while (polling) {
        const t0 = performance.now();
        const h = await studio.call("GET", "/health", { auth: false });
        if (h.status === 200) latencies.push(performance.now() - t0);
        await new Promise((r) => setTimeout(r, 15));
      }
    })();
    const first = studio.call("POST", "/api/compose", { body: { archive: "cmp.json" }, timeoutMs: 120000 });
    await new Promise((r) => setTimeout(r, 150));
    const second = await studio.call("POST", "/api/compose", { body: { archive: "cmp.json" } });
    const done = await first;
    polling = false;
    await poll;
    assert.equal(done.status, 200);
    assert.equal(second.status, 409);
    assert.equal(second.json.code, "compose_busy");
    assert.ok(latencies.length >= 5, `health was polled while composing: ${latencies.length} times`);
    const worst = Math.max(...latencies);
    assert.ok(worst < 250, `the slowest /health took ${Math.round(worst)} ms while composing`);
  });

  test("closing the connection stops the compose, and the project is free again afterwards", async () => {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no progress arrived")), 60000);
      const req = request({ host: "127.0.0.1", port: studio.port, method: "POST", path: "/api/compose", headers: { "Content-Type": "application/json", Accept: "text/event-stream", Cookie: studio.cookie } }, (res) => {
        let seen = 0;
        res.on("data", (chunk) => {
          seen += (String(chunk).match(/"type":"progress"/g) || []).length;
          if (seen >= 3) { clearTimeout(timer); req.destroy(); resolve(); }
        });
        res.on("error", () => {});
      });
      req.on("error", () => {});
      req.write(JSON.stringify({ archive: "cmp.json" }));
      req.end();
    });
    let ok = false;
    for (let i = 0; i < 40 && !ok; i++) {
      const r = await studio.call("POST", "/api/compose", { body: { archive: "cmp.json", limit: 2 } });
      ok = r.status === 200;
      if (!ok) await new Promise((r2) => setTimeout(r2, 250));
    }
    assert.ok(ok, "the project became free again after the stopped compose");
  });
});
