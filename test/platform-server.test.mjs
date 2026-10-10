/**
 * End-to-end: the real server in public mode (SERIES_MODE=public) on a temp data
 * dir. Walks a user through wallet sign-in → welcome credits → paid batch →
 * insufficient credits → on-chain top-up → Passport quest → publish.
 * Uses the free `mock` engine priced at 2 credits via ENGINE_CREDIT_COSTS.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { createMockPng } from "../src/mock-image.mjs";

const dir = mkdtempSync(join(tmpdir(), "series-public-"));
const PORT = 5600 + Math.floor(Math.random() * 300);
const env = {
  ...process.env,
  SERIES_MODE: "public",
  SERIES_DATA_DIR: dir,
  SERIES_KEYS_FILE: join(dir, "no-keys.env"),
  SERIES_PLATFORM_ENV: "",
  USERS_DB_PATH: join(dir, "users.db"),
  AUTH_SESSION_SECRET: "e2e-secret",
  AUTH_COOKIE_INSECURE: "1",
  WELCOME_REQUIRE_BALANCE: "0",
  ENGINE_CREDIT_COSTS: '{"mock":2}',
  OFFLINE: "1",
  HOST: "127.0.0.1",
  PORT: String(PORT),
  GREMLIN_API_KEY: "gremlin-key",
  HOLDER_SYNC_INTERVAL_SECONDS: "0",
  FULFILLMENT_RECONCILE_INTERVAL_SECONDS: "0",
  SERIES_SPEND_CAP_USD: "",
};
let server;
let cookie = "";

function call(method, path, { body, headers = {}, raw = false } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
    const req = request({
      host: "127.0.0.1", port: PORT, method, path,
      headers: { ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        let json = null;
        if (!raw) { try { json = JSON.parse(buf.toString("utf8")); } catch { /* not json */ } }
        resolve({ status: res.statusCode, headers: res.headers, json, text: buf.toString("utf8") });
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function evmWallet() {
  const priv = randomBytes(32);
  const pub = secp256k1.getPublicKey(priv, false);
  const address = `0x${Buffer.from(keccak_256(pub.subarray(1)).subarray(-20)).toString("hex")}`;
  const sign = (message) => {
    const msg = Buffer.from(message, "utf8");
    const hash = keccak_256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${msg.length}`), msg]));
    const sig = secp256k1.sign(hash, priv, { prehash: false, format: "recovered" }); // [rec, r, s]
    return `0x${Buffer.concat([Buffer.from(sig.subarray(1)), Buffer.from([sig[0] + 27])]).toString("hex")}`;
  };
  return { address, sign };
}

const user = evmWallet();
env.SERIES_ALLOWED_WALLETS = user.address;

before(async () => {
  server = spawn(process.execPath, ["server/index.mjs"], { env, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("server did not start")), 15_000);
    server.stdout.on("data", (d) => { if (String(d).includes("Series Lab Studio")) { clearTimeout(t); resolve(); } });
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
  // Windows releases the SQLite file handle a moment after the process exits.
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

describe("public mode end-to-end", () => {

  test("anonymous visitors are sent to /login; API answers 401", async () => {
    const page = await call("GET", "/studio/");
    assert.equal(page.status, 302);
    assert.equal(page.headers.location, "/login");
    assert.equal((await call("GET", "/api/me")).status, 401);
    assert.equal((await call("GET", "/login")).status, 200);
    assert.equal((await call("HEAD", "/login")).status, 200, "uptime monitors probe /login with HEAD");
    const html = await call("GET", "/login", { raw: true });
    assert.doesNotMatch(String(html.body ?? html.text ?? ""), /<script(?![^>]*src=)[^>]*>/, "login page has no inline script");
    const js = await call("GET", "/login.js", { raw: true });
    assert.doesNotMatch(String(html.text), /googleapis|gstatic/, "login page loads no third-party fonts");
    assert.doesNotMatch(String(html.text), /\{\{/, "no template placeholder is left in the login page");
    assert.match(String(html.text), /data-usd="4\.99" data-credits="100"/, "entry price comes from the real pack table");
    // Only pictures made with Series Lab itself: every image on the login page is a local /img/ file, none is a stock or old-brand card.
    const pics = [...String(html.text).matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]).concat([...String(html.text).matchAll(/(?:og|twitter):image"? content="([^"]+)"/g)].map((m) => m[1]));
    assert.ok(pics.length >= 3);
    for (const src of pics) assert.match(src, /^(https:\/\/lab\.w3ir\.io)?\/img\/[a-z0-9-]+\.jpg$/, `login picture ${src} must be a local Series Lab image`);
    assert.doesNotMatch(String(html.text), /og-card\.png/);
    assert.notEqual((await call("GET", "/og-card.png", { raw: true })).status, 200, "the previous product card is gone");
    assert.equal((await call("GET", "/img/og-series-lab.jpg", { raw: true })).status, 200);
    const shot = await call("GET", "/img/showcase-lion.jpg", { raw: true });
    assert.equal(shot.status, 200);
    assert.equal(shot.headers["content-type"], "image/jpeg");
    const font = await call("GET", "/fonts/onest-cyrillic.woff2", { raw: true });
    assert.equal(font.status, 200);
    assert.equal(font.headers["content-type"], "font/woff2");
    assert.notEqual((await call("GET", "/fonts/..%2Flogin.html", { raw: true })).status, 200, "font route is a whitelist");
    assert.equal(js.status, 200);
    assert.match(String(js.headers["content-type"]), /javascript/);
    const code = String(js.body ?? js.text ?? "");
    assert.match(code, /\/studio\/vendor\/evm-address\.js/, "viem import is self-hosted");
    assert.doesNotMatch(code, /ai\.w3ir\.io';|esm\.sh/);
    assert.equal((await call("HEAD", "/auth/nonce?address=0x0")).status, 404, "HEAD must not issue nonces");
    const health = await call("GET", "/health");
    assert.deepEqual(health.json, { status: "ok", service: "series-lab" });
  });

  test("invite-only mode refuses wallets that are not listed", async () => {
    const stranger = evmWallet();
    const n = await call("GET", `/auth/nonce?address=${stranger.address}`);
    const r = await call("POST", "/auth/verify", { body: { address: stranger.address, nonce: n.json.nonce, signature: stranger.sign(n.json.message) } });
    assert.equal(r.status, 403);
    assert.match(r.json.detail, /invitation/);
  });

  test("wallet sign-in sets the session and grants welcome credits", async () => {
    const offer = await call("GET", "/auth/welcome-offer");
    assert.equal(offer.json.credits, 20);
    const n = await call("GET", `/auth/nonce?address=${user.address}`);
    assert.equal(n.status, 200);
    const bad = await call("POST", "/auth/verify", { body: { address: user.address, nonce: n.json.nonce, signature: `0x${"11".repeat(65)}` } });
    assert.equal(bad.status, 401);
    const n2 = await call("GET", `/auth/nonce?address=${user.address}`);
    const ok = await call("POST", "/auth/verify", { body: { address: user.address, nonce: n2.json.nonce, signature: user.sign(n2.json.message) } });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.welcomed, true);
    assert.equal(ok.json.balance, 20);
    cookie = String(ok.headers["set-cookie"][0]).split(";")[0];
    const me = await call("GET", "/api/me");
    assert.equal(me.json.mode, "public");
    assert.equal(me.json.admin, false);
    assert.equal(me.json.wallet, user.address);
    assert.equal(me.json.balance, 20);
    assert.equal((await call("GET", "/api/resources")).status, 403, "operator view is admin-only");
  });

  test("paid batch debits credits per image; refusal when credits run short", async () => {
    const png = createMockPng({ seed: 1, title: "base" });
    const up = await call("POST", "/api/base/upload", { body: { data: Buffer.from(png).toString("base64"), filename: "primary.png", role: "primary" } });
    assert.equal(up.status, 200, up.text);
    const build = await call("POST", "/api/build", { body: { file: "demo-series.json" } });
    assert.equal(build.status, 200, build.text);
    const est = await call("POST", "/api/estimate", { body: { engine: "mock", mode: "first", first: 3 } });
    assert.equal(est.json.creditsNeeded, 6);
    const gen = await call("POST", "/api/generate", { body: { engine: "mock", mode: "first", first: 3 } });
    assert.equal(gen.status, 200, gen.text);
    assert.equal(gen.json.count, 3);
    assert.equal((await call("GET", "/api/me")).json.balance, 14);
    const tooMuch = await call("POST", "/api/generate", { body: { engine: "mock", mode: "first", first: 20, force: true } });
    assert.equal(tooMuch.status, 402);
    assert.equal(tooMuch.json.code, "credits");
    assert.equal((await call("GET", "/api/me")).json.balance, 14, "nothing charged for a refused batch");
    const local = await call("POST", "/api/generate", { body: { engine: "comfyui", mode: "first", first: 1 } });
    // Loopback public Studio allows local GPU but charges support credits / needs a live Comfy.
    // Without a live Comfy the batch answers 200 with per-image errors — then nothing may be charged.
    const failedBatch = local.status === 200 && local.json.count === 0;
    assert.ok(failedBatch || [400, 402, 502, 503].includes(local.status), `unexpected ${local.status}: ${local.text}`);
    assert.equal((await call("GET", "/api/me")).json.balance, 14, "failed local-GPU batch is refunded");
    assert.notEqual(local.json?.code, "local_gpu", "policy should allow Comfy on loopback public Studio");
  });

  test("Passport quest sees the generated images (API-key protected)", async () => {
    const day = new Date().toISOString().slice(0, 10);
    const noKey = await call("GET", `/gremlin/activity?wallet=${user.address}&date=${day}`);
    assert.equal(noKey.status, 401);
    const act = await call("GET", `/gremlin/activity?wallet=${user.address}&date=${day}`, { headers: { "X-Gremlin-Key": "gremlin-key" } });
    assert.equal(act.status, 200);
    assert.equal(act.json.generated, 3);
    assert.equal(act.json.generated_total, 3, "lifetime count does not depend on the date");
    assert.equal(act.json.credits_purchased_usd, 0, "no real payments yet; grants never count");
    const bad = await call("GET", `/gremlin/activity?wallet=${user.address}&date=2026-02-30`, { headers: { "X-Gremlin-Key": "gremlin-key" } });
    assert.equal(bad.status, 400);
  });

  test("the old Helio webhook route is gone; a payment credits once", async () => {
    const saved = cookie;
    cookie = "";
    assert.equal((await call("POST", "/webhooks/helio", { body: "{}" })).status, 404);
    cookie = saved;
    // Credit exactly as the Solana payment check does (same ledger file, idempotent per signature).
    const { openDb } = await import("../src/platform/db.mjs");
    const { recordPayment } = await import("../src/platform/billing.mjs");
    const db = openDb(join(dir, "users.db"));
    assert.equal(recordPayment("sol:e2e-signature-1", user.address, 100, 4.99, { db }), true);
    assert.equal(recordPayment("sol:e2e-signature-1", user.address, 100, 4.99, { db }), false);
    assert.equal((await call("GET", "/api/me")).json.balance, 114);
  });

  test("publish a set as a public collection page", async () => {
    const sets = await call("GET", "/api/sets");
    const setDir = sets.json.sets[0].dir;
    const pub = await call("POST", "/api/publish", { body: { dir: setDir, title: "E2E Gremlins" } });
    assert.equal(pub.status, 200, pub.text);
    assert.equal(pub.json.slug, "e2e-gremlins");
    cookie = "";
    const page = await call("GET", "/c/e2e-gremlins");
    assert.equal(page.status, 200);
    assert.match(page.text, /E2E Gremlins/);
    assert.equal((await call("GET", "/c/e2e-gremlins/img/1.png", { raw: true })).status, 200);
    const legal = await call("GET", "/legal/en");
    assert.equal(legal.status, 302, "the old legal page redirects to Series Lab's own terms");
    assert.match(String(legal.headers.location), /\/en\/terms\/$/);
    assert.equal((await call("GET", "/legal")).headers.location.endsWith("/terms/"), true);
  });
});
