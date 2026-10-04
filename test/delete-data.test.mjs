import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import JSZip from "jszip";
import { createMockPng } from "../src/mock-image.mjs";

function makeUser() {
  const priv = randomBytes(32);
  const pub = secp256k1.getPublicKey(priv, false);
  const address = `0x${Buffer.from(keccak_256(pub.subarray(1)).subarray(-20)).toString("hex")}`;
  return {
    address,
    cookie: "",
    sign(message) {
      const msg = Buffer.from(message, "utf8");
      const hash = keccak_256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${msg.length}`), msg]));
      const sig = secp256k1.sign(hash, priv, { prehash: false, format: "recovered" });
      return `0x${Buffer.concat([Buffer.from(sig.subarray(1)), Buffer.from([sig[0] + 27])]).toString("hex")}`;
    },
  };
}

describe("POST /api/account/delete-data (public mode)", () => {
  const dir = mkdtempSync(join(tmpdir(), "series-delete-data-"));
  const PORT = 6500 + Math.floor(Math.random() * 300);
  const alice = makeUser();
  const bob = makeUser();
  const env = {
    ...process.env,
    SERIES_MODE: "public",
    SERIES_DATA_DIR: dir,
    SERIES_KEYS_FILE: join(dir, "no-keys.env"),
    SERIES_SKIP_DOTENV: "1",
    SERIES_PLATFORM_ENV: "",
    USERS_DB_PATH: join(dir, "users.db"),
    AUTH_SESSION_SECRET: "delete-data-secret",
    AUTH_COOKIE_INSECURE: "1",
    WELCOME_REQUIRE_BALANCE: "0",
    OFFLINE: "1",
    MOCK_ENABLED: "1",
    HOST: "127.0.0.1",
    PORT: String(PORT),
    HOLDER_SYNC_INTERVAL_SECONDS: "0",
    FULFILLMENT_RECONCILE_INTERVAL_SECONDS: "0",
    SOLANA_PAY_RECIPIENT: "",
    SERIES_SPEND_CAP_USD: "",
    SERIES_ALLOWED_WALLETS: `${alice.address},${bob.address}`,
  };
  let server;
  let stderr = "";

  function call(user, method, path, { body, headers = {}, raw } = {}) {
    return new Promise((resolve, reject) => {
      const data = raw ?? (body === undefined ? null : Buffer.from(JSON.stringify(body)));
      const req = request({
        host: "127.0.0.1",
        port: PORT,
        method,
        path,
        headers: {
          ...(data ? { "Content-Type": raw ? "application/zip" : "application/json", "Content-Length": data.length } : {}),
          ...(user?.cookie ? { Cookie: user.cookie } : {}),
          ...headers,
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

  async function signIn(user) {
    const n = await call(null, "GET", `/auth/nonce?address=${user.address}`);
    const ok = await call(null, "POST", "/auth/verify", {
      body: { address: user.address, nonce: n.json.nonce, signature: user.sign(n.json.message) },
    });
    assert.equal(ok.status, 200, ok.text || stderr);
    user.cookie = String(ok.headers["set-cookie"][0]).split(";")[0];
  }

  const usersDirs = () => (existsSync(join(dir, "users")) ? readdirSync(join(dir, "users")) : []);

  before(async () => {
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
    if (server && server.exitCode === null) {
      const exited = new Promise((r) => server.once("exit", r));
      server.kill();
      await exited;
    }
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  it("refuses without sign-in and without the typed confirmation", async () => {
    const anon = await call(null, "POST", "/api/account/delete-data", { body: { confirm: "DELETE" } });
    assert.equal(anon.status, 401);
    await signIn(alice);
    const noConfirm = await call(alice, "POST", "/api/account/delete-data", { body: {} });
    assert.equal(noConfirm.status, 400);
    assert.equal(noConfirm.json.code, "confirm");
    const wrong = await call(alice, "POST", "/api/account/delete-data", { body: { confirm: "delete" } });
    assert.equal(wrong.status, 400, "the word must be exactly DELETE");
  });

  it("erases one wallet's files and rows and leaves the other wallet and the money trail alone", async () => {
    await signIn(bob);
    const png = createMockPng({ seed: 1, width: 32, height: 32 });
    for (const user of [alice, bob]) {
      const up = await call(user, "POST", "/api/base/upload", {
        body: { data: Buffer.from(png).toString("base64"), filename: "primary.png", role: "primary" },
      });
      assert.equal(up.status, 200, up.text);
      const z = new JSZip();
      z.file("hair/Bob.png", png);
      const lz = await call(user, "POST", "/api/layers/upload", { raw: await z.generateAsync({ type: "nodebuffer" }) });
      assert.equal(lz.status, 200, lz.text);
    }
    assert.equal(usersDirs().length, 2, "two wallet folders exist");

    const del = await call(alice, "POST", "/api/account/delete-data", { body: { confirm: "DELETE" } });
    assert.equal(del.status, 200, del.text || stderr);
    assert.equal(del.json.filesRemoved, true);

    const left = usersDirs();
    assert.equal(left.length, 1, "only Bob's folder is left");
    const bobStatus = await call(bob, "GET", "/api/layers/status");
    assert.equal(bobStatus.json.files, 1, "Bob's layers untouched");

    const db = new DatabaseSync(join(dir, "users.db"), { readOnly: true });
    try {
      const aliceRow = db.prepare("SELECT COUNT(*) AS n FROM users WHERE lower(wallet_address) = ?").get(alice.address.toLowerCase());
      assert.equal(aliceRow.n, 1, "the ledger row (balance) stays for accounting");
      const nonces = db.prepare("SELECT COUNT(*) AS n FROM wallet_nonces WHERE lower(wallet_address) = ?").get(alice.address.toLowerCase());
      assert.equal(nonces.n, 0, "sign-in codes erased");
    } finally {
      db.close();
    }
  });
});
