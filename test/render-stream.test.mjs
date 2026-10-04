import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { createMockPng } from "../src/mock-image.mjs";
import { withTimeout } from "../src/engines.mjs";
import { imagesDirName } from "../src/reference.mjs";
import { parseSseBuffer, settleGenerateStream } from "../server/ui/render-stream.js";

const EMPTY_MESSAGE = "Nothing to generate (all exist or empty selection). Enable force or pick other editions.";

describe("generate stream settle", () => {
  it("treats a finished JSON body with nothing to draw as done, not an open 0% stream", () => {
    const bodyText = JSON.stringify({
      ok: true,
      stream: false,
      engine: "pollinations",
      set: "pollinations-s0.45",
      count: 0,
      results: [],
      message: EMPTY_MESSAGE,
    });
    const settled = settleGenerateStream({
      contentType: "application/json; charset=utf-8",
      bodyText,
    });
    assert.equal(settled.state, "empty");
    assert.equal(settled.percent, 100);
    assert.equal(settled.payload.count, 0);
    assert.equal(settled.payload.engine, "pollinations");
  });

  it("errors when a live stream starts and ends with no progress and no done", () => {
    const raw = `data: ${JSON.stringify({ type: "start", total: 12, engine: "pollinations", set: "pollinations-s0.45" })}\n\n`;
    const { events, rest } = parseSseBuffer(raw);
    assert.equal(rest, "");
    assert.equal(events.length, 1);
    const settled = settleGenerateStream({
      contentType: "text/event-stream; charset=utf-8",
      events,
    });
    assert.equal(settled.state, "error");
    assert.equal(settled.messageKey, "render.streamEnded");
    assert.equal(settled.started, true);
    assert.equal(settled.progressed, false);
  });

  it("finishes immediately when the stream opens with total 0", () => {
    const settled = settleGenerateStream({
      contentType: "text/event-stream",
      events: [{ type: "start", total: 0, set: "pollinations-s0.45" }],
    });
    assert.equal(settled.state, "empty");
    assert.equal(settled.percent, 100);
  });

  it("keeps a normal start/progress/done stream as done", () => {
    const raw = [
      `data: ${JSON.stringify({ type: "start", total: 1 })}\n\n`,
      `data: ${JSON.stringify({ type: "progress", completed: 1, total: 1, result: { ok: true } })}\n\n`,
      `data: ${JSON.stringify({ type: "done", ok: true, count: 1, set: "mock-s0.45" })}\n\n`,
    ].join("");
    const { events } = parseSseBuffer(raw);
    const settled = settleGenerateStream({ contentType: "text/event-stream", events });
    assert.equal(settled.state, "done");
    assert.equal(settled.payload.count, 1);
  });

  it("withTimeout still aborts when the caller stops the request", async () => {
    const ac = new AbortController();
    const wrapped = withTimeout((_url, init) => new Promise((_resolve, reject) => {
      const fail = () => {
        const err = new Error("stopped");
        err.name = "AbortError";
        reject(err);
      };
      if (init.signal?.aborted) fail();
      else init.signal?.addEventListener("abort", fail, { once: true });
    }), 200);
    const pending = wrapped("https://example.test/image", { signal: ac.signal });
    ac.abort();
    await assert.rejects(pending, (err) => err.name === "AbortError");
  });
});

describe("POST /api/generate stream when nothing is left", () => {
  const dir = mkdtempSync(join(tmpdir(), "series-render-stream-"));
  const PORT = 6100 + Math.floor(Math.random() * 300);
  const env = {
    ...process.env,
    SERIES_MODE: "public",
    SERIES_DATA_DIR: dir,
    SERIES_KEYS_FILE: join(dir, "no-keys.env"),
    SERIES_SKIP_DOTENV: "1",
    SERIES_PLATFORM_ENV: "",
    USERS_DB_PATH: join(dir, "users.db"),
    AUTH_SESSION_SECRET: "render-stream-secret",
    AUTH_COOKIE_INSECURE: "1",
    WELCOME_REQUIRE_BALANCE: "0",
    OFFLINE: "1",
    MOCK_ENABLED: "1",
    POLLINATIONS_API_KEY: "test-not-a-real-key",
    SERIES_MOCK_HOLD_MS: "800",
    HOST: "127.0.0.1",
    PORT: String(PORT),
    HOLDER_SYNC_INTERVAL_SECONDS: "0",
    FULFILLMENT_RECONCILE_INTERVAL_SECONDS: "0",
    SOLANA_PAY_RECIPIENT: "",
    SERIES_SPEND_CAP_USD: "",
  };
  let server;
  let cookie = "";
  let user;
  let stderr = "";

  function call(method, path, { body, headers = {}, onResponse } = {}) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
      const req = request({
        host: "127.0.0.1",
        port: PORT,
        method,
        path,
        headers: {
          ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...headers,
        },
      }, (res) => {
        if (onResponse) onResponse(req, res);
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const text = buf.toString("utf8");
          let json = null;
          try { json = JSON.parse(text); } catch { /* sse or empty */ }
          resolve({ status: res.statusCode, headers: res.headers, json, text, aborted: false });
        });
        res.on("error", () => resolve({ status: res.statusCode, headers: res.headers, json: null, text: "", aborted: true }));
      });
      req.on("error", (err) => {
        if (err.code === "ECONNRESET" || err.code === "EPIPE") {
          resolve({ status: 0, headers: {}, json: null, text: "", aborted: true });
          return;
        }
        reject(err);
      });
      if (data) req.write(data);
      req.end();
    });
  }

  function deadline(promise, ms, label) {
    let timer;
    return Promise.race([
      promise.finally(() => clearTimeout(timer)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} still open after ${ms}ms\n${stderr}`)), ms);
      }),
    ]);
  }

  before(async () => {
    const priv = randomBytes(32);
    const pub = secp256k1.getPublicKey(priv, false);
    const address = `0x${Buffer.from(keccak_256(pub.subarray(1)).subarray(-20)).toString("hex")}`;
    user = {
      address,
      sign(message) {
        const msg = Buffer.from(message, "utf8");
        const hash = keccak_256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${msg.length}`), msg]));
        const sig = secp256k1.sign(hash, priv, { prehash: false, format: "recovered" });
        return `0x${Buffer.concat([Buffer.from(sig.subarray(1)), Buffer.from([sig[0] + 27])]).toString("hex")}`;
      },
    };
    env.SERIES_ALLOWED_WALLETS = address;
    server = spawn(process.execPath, ["server/index.mjs"], { env, stdio: ["ignore", "pipe", "pipe"] });
    server.stderr.on("data", (d) => { stderr += d; });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`server did not start\n${stderr}`)), 15_000);
      server.stdout.on("data", (d) => {
        if (String(d).includes("Series Lab Studio")) {
          clearTimeout(t);
          resolve();
        }
      });
      server.on("exit", (c) => reject(new Error(`server exited ${c}\n${stderr}`)));
    });
  });

  after(async () => {
    (await import("../src/platform/db.mjs")).closeAll();
    if (server && server.exitCode === null) {
      const exited = new Promise((r) => server.once("exit", r));
      server.kill();
      await exited;
    }
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  it("does not open a stream when pollinations has nothing left to generate", async () => {
    const n = await call("GET", `/auth/nonce?address=${user.address}`);
    const ok = await call("POST", "/auth/verify", {
      body: { address: user.address, nonce: n.json.nonce, signature: user.sign(n.json.message) },
    });
    assert.equal(ok.status, 200, ok.text || stderr);
    cookie = String(ok.headers["set-cookie"][0]).split(";")[0];
    const png = createMockPng({ seed: 7, title: "primary" });
    const up = await call("POST", "/api/base/upload", {
      body: { data: Buffer.from(png).toString("base64"), filename: "primary.png", role: "primary" },
    });
    assert.equal(up.status, 200, up.text);
    const build = await call("POST", "/api/build", { body: { file: "demo-series.json" } });
    assert.equal(build.status, 200, build.text);
    const editions = build.json.recipes.slice(0, 12).map((r) => r.edition);
    const safe = readdirSync(join(dir, "users"))[0];
    const setDir = join(dir, "users", safe, "out", imagesDirName("pollinations", 0.45));
    mkdirSync(setDir, { recursive: true });
    const existing = createMockPng({ seed: 3, title: "already" });
    for (const ed of editions) writeFileSync(join(setDir, `${ed}.png`), existing);

    const started = Date.now();
    const gen = await deadline(call("POST", "/api/generate", {
      body: {
        file: "demo-series.json",
        engine: "pollinations",
        strength: 0.45,
        mode: "pilot",
        pilot: 12,
        stream: true,
      },
      headers: { Accept: "text/event-stream" },
    }), 3000, "empty pollinations generate");
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 3000, `empty generate took ${elapsed}ms`);
    assert.equal(gen.status, 200, gen.text || stderr);
    assert.match(String(gen.headers["content-type"]), /application\/json/);
    assert.doesNotMatch(String(gen.headers["content-type"]), /text\/event-stream/);
    assert.equal(gen.json.ok, true);
    assert.equal(gen.json.stream, false);
    assert.equal(gen.json.count, 0);
    assert.equal(gen.json.engine, "pollinations");
    assert.equal(gen.json.message, EMPTY_MESSAGE);
    const settled = settleGenerateStream({
      contentType: gen.headers["content-type"],
      bodyText: gen.text,
    });
    assert.equal(settled.state, "empty");
    assert.equal(settled.percent, 100);
    assert.ok(readFileSync(join(setDir, `${editions[0]}.png`)).equals(existing));
  });

  it("still writes a file when the stream runs to done", async () => {
    const build = await call("POST", "/api/build", { body: { file: "demo-series.json" } });
    const edition = build.json.recipes[0].edition;
    const gen = await deadline(call("POST", "/api/generate", {
      body: {
        file: "demo-series.json",
        engine: "mock",
        strength: 0.45,
        mode: "only",
        only: String(edition),
        force: true,
        concurrency: 1,
        stream: true,
      },
      headers: { Accept: "text/event-stream" },
    }), 5000, "mock generate");
    assert.equal(gen.status, 200, gen.text || stderr);
    assert.match(String(gen.headers["content-type"]), /text\/event-stream/);
    assert.match(gen.text, /"type":"done"/);
    const safe = readdirSync(join(dir, "users"))[0];
    const file = join(dir, "users", safe, "out", imagesDirName("mock", 0.45), `${edition}.png`);
    assert.ok(existsSync(file), "completed frame should stay on disk");
    assert.ok(readFileSync(file).length > 32);
  });

  it("stop aborts the live stream and leaves the file already on disk", async () => {
    const build = await call("POST", "/api/build", { body: { file: "demo-series.json" } });
    const first = build.json.recipes[0].edition;
    const second = build.json.recipes[1].edition;
    const safe = readdirSync(join(dir, "users"))[0];
    const setDir = join(dir, "users", safe, "out", imagesDirName("mock", 0.45));
    mkdirSync(setDir, { recursive: true });
    const marker = Buffer.from("already-written-frame-not-a-png");
    writeFileSync(join(setDir, `${first}.png`), marker);
    rmSync(join(setDir, `${second}.png`), { force: true });

    const started = Date.now();
    const gen = await deadline(call("POST", "/api/generate", {
      body: {
        file: "demo-series.json",
        engine: "mock",
        strength: 0.45,
        mode: "first",
        first: 2,
        force: true,
        concurrency: 1,
        stream: true,
      },
      headers: { Accept: "text/event-stream" },
      onResponse(req, res) {
        res.once("data", () => req.destroy());
      },
    }), 3000, "stopped generate");
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 3000, `stop did not end the stream (${elapsed}ms)`);
    assert.equal(gen.aborted, true);
    // The in-flight frame is held for 800ms. Wait past that so a missed abort
    // would already have replaced the file and started the next one.
    await new Promise((r) => setTimeout(r, 1200));
    assert.ok(readFileSync(join(setDir, `${first}.png`)).equals(marker), "existing frame was replaced after stop");
    assert.equal(existsSync(join(setDir, `${second}.png`)), false, "the next frame was written after stop");
  });
});
