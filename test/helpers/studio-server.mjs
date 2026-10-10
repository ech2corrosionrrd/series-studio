// Shared harness: starts the real studio server in public mode (wallet sign-in, mock engine, no keys, offline)
// and returns a small HTTP client. Used by the contract and end-to-end tests.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

export function newEvmWallet() {
  const priv = randomBytes(32);
  const pub = secp256k1.getPublicKey(priv, false);
  const address = `0x${Buffer.from(keccak_256(pub.subarray(1)).subarray(-20)).toString("hex")}`;
  return {
    address,
    sign(message) {
      const msg = Buffer.from(message, "utf8");
      const hash = keccak_256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${msg.length}`), msg]));
      const sig = secp256k1.sign(hash, priv, { prehash: false, format: "recovered" });
      return `0x${Buffer.concat([Buffer.from(sig.subarray(1)), Buffer.from([sig[0] + 27])]).toString("hex")}`;
    },
  };
}

/**
 * @param {{ mode?: "public" | "local", adminWallet?: boolean, extraEnv?: Record<string, string> }} [opts]
 */
export async function startStudio({ mode = "public", adminWallet = false, extraEnv = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "series-harness-"));
  const port = 6600 + Math.floor(Math.random() * 600);
  const user = newEvmWallet();
  const env = {
    ...process.env,
    SERIES_MODE: mode,
    SERIES_DATA_DIR: dir,
    SERIES_KEYS_FILE: join(dir, "no-keys.env"),
    SERIES_PLATFORM_ENV: "",
    USERS_DB_PATH: join(dir, "users.db"),
    AUTH_SESSION_SECRET: "harness-secret",
    AUTH_COOKIE_INSECURE: "1",
    WELCOME_REQUIRE_BALANCE: "0",
    ENGINE_CREDIT_COSTS: '{"mock":2}',
    OFFLINE: "1",
    HOST: "127.0.0.1",
    PORT: String(port),
    HOLDER_SYNC_INTERVAL_SECONDS: "0",
    FULFILLMENT_RECONCILE_INTERVAL_SECONDS: "0",
    SOLANA_PAY_RECIPIENT: "",
    SERIES_SPEND_CAP_USD: "",
    SERIES_ALLOWED_WALLETS: user.address,
    ...(adminWallet ? { ADMIN_WALLETS: user.address } : {}),
    ...extraEnv,
  };
  for (const k of ["OPENAI_API_KEY", "REPLICATE_API_TOKEN", "FAL_KEY", "STABILITY_API_KEY", "RUNWARE_API_KEY", "ANTHROPIC_API_KEY", "IRYS_PRIVATE_KEY"]) delete env[k];

  const server = spawn(process.execPath, ["server/index.mjs"], { env, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("studio server did not start")), 20_000);
    server.stdout.on("data", (d) => {
      if (String(d).includes("Series Lab Studio")) {
        clearTimeout(t);
        resolve();
      }
    });
    server.stderr.on("data", () => {});
    server.on("exit", (c) => reject(new Error(`studio server exited ${c}`)));
  });

  let cookie = "";
  function call(method, path, { body, headers = {}, raw = false, timeoutMs = 20_000, auth = true } = {}) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
      const req = request({
        host: "127.0.0.1", port, method, path,
        headers: { ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}), ...(auth && cookie ? { Cookie: cookie } : {}), ...headers },
        timeout: timeoutMs,
      }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          let json = null;
          if (!raw) { try { json = JSON.parse(buf.toString("utf8")); } catch { /* not json */ } }
          resolve({ status: res.statusCode, headers: res.headers, json, text: buf.toString("utf8"), buf });
        });
      });
      req.on("timeout", () => req.destroy(new Error(`timeout after ${timeoutMs} ms: ${method} ${path}`)));
      req.on("error", reject);
      if (data) req.write(data);
      req.end();
    });
  }

  async function signIn() {
    const n = await call("GET", `/auth/nonce?address=${user.address}`, { auth: false });
    const ok = await call("POST", "/auth/verify", { auth: false, body: { address: user.address, nonce: n.json.nonce, signature: user.sign(n.json.message) } });
    if (ok.status !== 200) throw new Error(`sign-in failed: ${ok.text}`);
    cookie = String(ok.headers["set-cookie"][0]).split(";")[0];
    return cookie;
  }

  async function stop() {
    (await import("../../src/platform/db.mjs")).closeAll();
    if (server.exitCode === null) {
      const exited = new Promise((r) => server.once("exit", r));
      server.kill();
      await exited;
    }
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }

  return { dir, port, user, call, signIn, stop, get cookie() { return cookie; } };
}
