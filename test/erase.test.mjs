import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "series-erase-"));
process.env.USERS_DB_PATH = join(dir, "users.db");
process.env.SERIES_DATA_DIR = dir;

const { openDb, closeAll, nowIso } = await import("../src/platform/db.mjs");
const { eraseWalletRecords } = await import("../src/platform/erase.mjs");
const { anonymizeRenderLog } = await import("../src/spend.mjs");

const A = "AAAAwalletAAAA";
const B = "BBBBwalletBBBB";

function seed(db, wallet) {
  const now = nowIso();
  db.prepare("INSERT INTO users (wallet_address, credits_balance, created_at) VALUES (?, 120, ?)").run(wallet, now);
  db.prepare("INSERT INTO payments (tx_id, wallet_address, credits, amount_usd, created_at) VALUES (?, ?, 100, 4.99, ?)").run(`tx-${wallet}`, wallet, now);
  db.prepare("INSERT INTO transactions (wallet_address, kind, credits, engine, note, created_at) VALUES (?, 'debit', 4, 'fal', 'image generation', ?)").run(wallet, now);
  db.prepare("INSERT INTO funnel_events (wallet_address, event, created_at) VALUES (?, 'generate', ?)").run(wallet, now);
  db.prepare("INSERT INTO funnel_events (wallet_address, event, created_at) VALUES (?, 'export', ?)").run(wallet, now);
  db.prepare("INSERT INTO referral_codes (code, wallet_address, created_at) VALUES (?, ?, ?)").run(`code-${wallet}`, wallet, now);
  db.prepare("INSERT INTO wallet_nonces (wallet_address, nonce, created_at) VALUES (?, 'n', ?)").run(wallet, now);
  db.prepare("INSERT INTO freemium_usage (wallet_address, day, count) VALUES (?, '2026-10-01', 2)").run(wallet);
}

const count = (db, table, wallet) => db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE wallet_address = ?`).get(wallet).n;

test("eraseWalletRecords deletes behaviour rows and keeps the financial trail", () => {
  const db = openDb();
  seed(db, A);
  seed(db, B);
  const removed = eraseWalletRecords(A, { db });
  assert.deepEqual(removed, { funnel_events: 2, referral_codes: 1, wallet_nonces: 1, freemium_usage: 1 });
  for (const t of ["funnel_events", "referral_codes", "wallet_nonces", "freemium_usage"]) assert.equal(count(db, t, A), 0, `${t} erased`);
  for (const t of ["users", "payments", "transactions"]) assert.equal(count(db, t, A), 1, `${t} kept for accounting`);
  assert.equal(db.prepare("SELECT credits_balance FROM users WHERE wallet_address = ?").get(A).credits_balance, 120, "balance untouched");
  for (const t of ["users", "payments", "transactions", "funnel_events", "referral_codes", "wallet_nonces", "freemium_usage"]) {
    assert.ok(count(db, t, B) >= 1, `${t} of the other wallet untouched`);
  }
  assert.deepEqual(eraseWalletRecords(A, { db }), { funnel_events: 0, referral_codes: 0, wallet_nonces: 0, freemium_usage: 0 }, "idempotent");
});

test("eraseWalletRecords needs a wallet", () => {
  assert.throws(() => eraseWalletRecords(""), /wallet is required/);
  assert.throws(() => eraseWalletRecords(null), /wallet is required/);
});

test("anonymizeRenderLog keeps cost lines, drops the wallet and the series name, leaves others alone", () => {
  const file = join(dir, "render-log.jsonl");
  const lines = [
    { at: "2026-10-01T00:00:00Z", kind: "gen", engine: "fal", costUsd: 0.025, ok: true, wallet: A, credits: 4, set: "my-secret-series" },
    { at: "2026-10-01T00:01:00Z", kind: "gen", engine: "fal", costUsd: 0.025, ok: true, wallet: B, credits: 4, set: "other-series" },
    { at: "2026-10-01T00:02:00Z", source: "studio", kind: "batch", engine: "fal", costUsd: 0.1, ok: true, set: "no-wallet-line" },
  ];
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");
  assert.equal(anonymizeRenderLog(file, A), 1);
  const out = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(out.length, 3, "no line is removed: it is the operator's cost record");
  assert.equal(out[0].wallet, "erased");
  assert.equal(out[0].set, undefined, "series name dropped");
  assert.equal(out[0].costUsd, 0.025, "cost kept");
  assert.equal(out[1].wallet, B);
  assert.equal(out[1].set, "other-series");
  assert.equal(out[2].set, "no-wallet-line");
  assert.equal(anonymizeRenderLog(file, A), 0, "idempotent");
  assert.equal(anonymizeRenderLog(join(dir, "missing.jsonl"), A), 0);
  assert.equal(anonymizeRenderLog(file, ""), 0);
});

test("cleanup", () => {
  closeAll();
  rmSync(dir, { recursive: true, force: true });
});
