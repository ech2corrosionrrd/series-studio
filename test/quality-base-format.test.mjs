// A JPEG/WebP primary base must still give a real similarity score; "all good" must never hide a skipped check.
// Also: the estimate must see the "regenerate" switch, otherwise it shows 0 credits for a run that charges.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { createMockPng } from "../src/mock-image.mjs";
import { imagesDirName } from "../src/reference.mjs";

describe("quality and estimate on the studio server", () => {
  const dir = mkdtempSync(join(tmpdir(), "series-qbase-"));
  const PORT = 6300 + Math.floor(Math.random() * 200);
  const env = {
    ...process.env,
    SERIES_MODE: "public",
    SERIES_DATA_DIR: dir,
    SERIES_KEYS_FILE: join(dir, "no-keys.env"),
    SERIES_PLATFORM_ENV: "",
    USERS_DB_PATH: join(dir, "users.db"),
    AUTH_SESSION_SECRET: "qbase-secret",
    AUTH_COOKIE_INSECURE: "1",
    WELCOME_REQUIRE_BALANCE: "0",
    ENGINE_CREDIT_COSTS: '{"mock":2}',
    OFFLINE: "1",
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

  function call(method, path, { body } = {}) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
      const req = request({
        host: "127.0.0.1", port: PORT, method, path,
        headers: { ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          let json = null;
          try { json = JSON.parse(buf.toString("utf8")); } catch { /* text */ }
          resolve({ status: res.statusCode, headers: res.headers, json, text: buf.toString("utf8") });
        });
      });
      req.on("error", reject);
      if (data) req.write(data);
      req.end();
    });
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
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("server did not start")), 15_000);
      server.stdout.on("data", (d) => { if (String(d).includes("Series Lab Studio")) { clearTimeout(t); resolve(); } });
      server.stderr.on("data", () => {});
      server.on("exit", (c) => reject(new Error(`server exited ${c}`)));
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

  it("scores frames against a JPEG base instead of silently skipping the check", async () => {
    const n = await call("GET", `/auth/nonce?address=${user.address}`);
    const ok = await call("POST", "/auth/verify", { body: { address: user.address, nonce: n.json.nonce, signature: user.sign(n.json.message) } });
    assert.equal(ok.status, 200, ok.text);
    cookie = String(ok.headers["set-cookie"][0]).split(";")[0];

    const png = createMockPng({ seed: 7, title: "primary" });
    const jpg = await sharp(png).jpeg({ quality: 90 }).toBuffer();
    const up = await call("POST", "/api/base/upload", { body: { data: jpg.toString("base64"), filename: "primary.jpg", role: "primary" } });
    assert.equal(up.status, 200, up.text);
    assert.equal((await call("POST", "/api/build", { body: { file: "demo-series.json" } })).status, 200);
    const gen = await call("POST", "/api/generate", { body: { engine: "mock", mode: "first", first: 2 } });
    assert.equal(gen.status, 200, gen.text);

    const set = imagesDirName("mock", 0.45);
    const q = await call("GET", `/api/quality?dir=${encodeURIComponent(set)}`);
    assert.equal(q.status, 200, q.text);
    assert.equal(q.json.hasBase, true);
    assert.equal(q.json.baseUnusable, false, "a JPEG base is converted, not given up on");
    assert.ok(q.json.similarity, "similarity is computed against the JPEG base");
    const sim = await call("GET", `/api/similarity?dir=${encodeURIComponent(set)}`);
    assert.equal(sim.status, 200, sim.text);
    assert.ok(sim.json.editions.length >= 1);
    assert.ok(sim.json.editions.every((e) => typeof e.similarity === "number"), "every frame has a score");
  });

  it("the estimate sees the regenerate switch (force), like the real run", async () => {
    const plain = await call("POST", "/api/estimate", { body: { file: "demo-series.json", engine: "mock", strength: 0.45, mode: "first", first: 2 } });
    assert.equal(plain.status, 200, plain.text);
    assert.match(plain.json.text, /Skip existing: 2/);
    const forced = await call("POST", "/api/estimate", { body: { file: "demo-series.json", engine: "mock", strength: 0.45, mode: "first", first: 2, force: true } });
    assert.equal(forced.status, 200, forced.text);
    assert.match(forced.json.text, /FORCE re-render/);
    assert.match(forced.json.text, /To generate: 2/);
  });
});
