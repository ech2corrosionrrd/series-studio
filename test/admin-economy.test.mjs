/**
 * Regression: GET /api/admin/economy used to throw ReferenceError because
 * economyReport / funnel were called without imports. Also probes the other
 * operator endpoints so a missing import fails the suite instead of production.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

const dir = mkdtempSync(join(tmpdir(), "series-admin-econ-"));
const PORT = 6100 + Math.floor(Math.random() * 400);
const BLOCKED = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "PINATA_JWT",
  "PINATA_API_KEY",
  "PINATA_SECRET_API_KEY",
  "ALCHEMY_API_KEY",
  "VITE_ALCHEMY_API_KEY",
  "REPLICATE_API_TOKEN",
  "FAL_KEY",
  "FAL_API_KEY",
  "RUNWARE_API_KEY",
  "STABILITY_API_KEY",
  "POLLINATIONS_API_KEY",
  "SERIES_TELEGRAM_BOT_TOKEN",
  "SERIES_TELEGRAM_CHAT_ID",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "SOLANA_PAY_RECIPIENT",
  "SOLANA_PAY_RPC_URL",
  "SOLANA_RPC_URL",
  "VAULT_WALLET_ADDRESS",
];

function evmWallet() {
  const priv = randomBytes(32);
  const pub = secp256k1.getPublicKey(priv, false);
  const address = `0x${Buffer.from(keccak_256(pub.subarray(1)).subarray(-20)).toString("hex")}`;
  const sign = (message) => {
    const msg = Buffer.from(message, "utf8");
    const hash = keccak_256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${msg.length}`), msg]));
    const sig = secp256k1.sign(hash, priv, { prehash: false, format: "recovered" });
    return `0x${Buffer.concat([Buffer.from(sig.subarray(1)), Buffer.from([sig[0] + 27])]).toString("hex")}`;
  };
  return { address, sign };
}

const user = evmWallet();
const admin = evmWallet();

const env = {
  ...process.env,
  ...Object.fromEntries(BLOCKED.map((k) => [k, ""])),
  SERIES_SKIP_DOTENV: "1",
  MODERATION_API_ENABLED: "0",
  SERIES_MODE: "public",
  SERIES_DATA_DIR: dir,
  SERIES_KEYS_FILE: join(dir, "no-keys.env"),
  SERIES_PLATFORM_ENV: "",
  USERS_DB_PATH: join(dir, "users.db"),
  AUTH_SESSION_SECRET: "admin-econ-secret",
  AUTH_COOKIE_INSECURE: "1",
  WELCOME_REQUIRE_BALANCE: "0",
  OFFLINE: "1",
  HOST: "127.0.0.1",
  PORT: String(PORT),
  SERIES_ALLOWED_HOSTS: "",
  SERIES_ALLOWED_WALLETS: `${user.address},${admin.address}`,
  ADMIN_WALLETS: admin.address,
  TEAM_WALLETS: "",
  HOLDER_SYNC_INTERVAL_SECONDS: "0",
  FULFILLMENT_RECONCILE_INTERVAL_SECONDS: "0",
  SERIES_SPEND_CAP_USD: "",
};

let server;
let cookie = "";

function call(method, path, { body } = {}) {
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
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, json, text });
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function signIn(wallet) {
  const n = await call("GET", `/auth/nonce?address=${wallet.address}`);
  assert.equal(n.status, 200, n.text);
  const v = await call("POST", "/auth/verify", {
    body: { address: wallet.address, nonce: n.json.nonce, signature: wallet.sign(n.json.message) },
  });
  assert.equal(v.status, 200, v.text);
  cookie = String(v.headers["set-cookie"][0]).split(";")[0];
  return v.json;
}

function assertNoReferenceError(res, label) {
  assert.notEqual(res.status, 500, `${label} 500: ${res.text}`);
  assert.doesNotMatch(res.text, /ReferenceError|is not defined/, `${label}: ${res.text}`);
}

before(async () => {
  server = spawn(process.execPath, ["server/index.mjs"], { env, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("server did not start")), 15_000);
    let err = "";
    server.stderr.on("data", (d) => { err += d; });
    server.stdout.on("data", (d) => {
      if (String(d).includes("Series Lab Studio")) {
        clearTimeout(t);
        resolve();
      }
    });
    server.on("exit", (c) => reject(new Error(`server exited ${c}: ${err}`)));
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

test("anonymous and non-admin cannot read the economy report", async () => {
  const anon = await call("GET", "/api/admin/economy");
  assert.equal(anon.status, 401);
  await signIn(user);
  const denied = await call("GET", "/api/admin/economy");
  assert.equal(denied.status, 403);
  assertNoReferenceError(denied, "non-admin economy");
});

test("admin GET /api/admin/economy returns the report, not ReferenceError", async () => {
  await signIn(admin);
  const me = await call("GET", "/api/me");
  assert.equal(me.json.admin, true);
  for (const path of ["/api/admin/economy", "/api/admin/economy?days=7", "/api/admin/economy?days=30"]) {
    const res = await call("GET", path);
    assert.equal(res.status, 200, `${path} ${res.text}`);
    assertNoReferenceError(res, path);
    assert.equal(typeof res.json.overview, "object");
    assert.equal(typeof res.json.gross, "object");
    assert.equal(typeof res.json.net, "object");
    assert.equal(typeof res.json.model, "object");
    assert.equal(res.json.funnel_30d?.days, 30);
    assert.equal(typeof res.json.funnel_30d.new_users, "number");
  }
});

test("other operator endpoints do not throw ReferenceError", async () => {
  await signIn(admin);
  const probes = [
    ["GET", "/api/spend"],
    ["GET", "/api/resources"],
    ["GET", "/api/engines/status"],
    ["GET", "/api/trash"],
    ["POST", "/api/notifications/test"],
  ];
  for (const [method, path] of probes) {
    const res = await call(method, path, method === "POST" ? { body: {} } : {});
    assertNoReferenceError(res, `${method} ${path}`);
    assert.ok(res.status >= 200 && res.status < 500, `${method} ${path} → ${res.status} ${res.text.slice(0, 200)}`);
  }
  const spend = await call("GET", "/api/spend");
  assert.equal(spend.status, 200);
  assert.equal(typeof spend.json.spentTodayUsd, "number");
  const note = await call("POST", "/api/notifications/test", { body: {} });
  assert.equal(note.status, 400);
  assert.equal(note.json.error, "not_configured");
});
