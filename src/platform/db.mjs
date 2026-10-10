/**
 * Platform database — SQLite (`users.db`): Series Lab's **own** ledger file with
 * its own credit history.
 *
 * Path: explicit → env `USERS_DB_PATH` → `<SERIES_DATA_DIR>/users.db` → `./data/users.db`.
 */
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     wallet_address TEXT PRIMARY KEY,
     credits_balance INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL,
     verified_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS payments (
     tx_id TEXT PRIMARY KEY,
     wallet_address TEXT NOT NULL,
     credits INTEGER NOT NULL,
     amount_usd REAL NOT NULL,
     created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS transactions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     wallet_address TEXT NOT NULL,
     kind TEXT NOT NULL,
     credits INTEGER NOT NULL,
     engine TEXT NOT NULL DEFAULT '',
     note TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS wallet_nonces (
     wallet_address TEXT PRIMARY KEY,
     nonce TEXT NOT NULL,
     created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS nft_fulfillments (
     tx_id TEXT PRIMARY KEY,
     wallet_address TEXT NOT NULL,
     kind TEXT NOT NULL,
     detail TEXT NOT NULL DEFAULT '',
     status TEXT NOT NULL DEFAULT 'reserved',
     attempts INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS referrals (
     invitee_address TEXT PRIMARY KEY,
     referrer_address TEXT NOT NULL,
     created_at TEXT NOT NULL,
     rewarded_at TEXT,
     reward_credits INTEGER NOT NULL DEFAULT 0)`,
  // Manual balances of API providers that have no balance endpoint (Admin → Ресурси).
  `CREATE TABLE IF NOT EXISTS resource_balances (
     provider TEXT PRIMARY KEY,
     balance_usd REAL NOT NULL,
     updated_at TEXT NOT NULL,
     note TEXT NOT NULL DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS referral_codes (
     code TEXT PRIMARY KEY,
     wallet_address TEXT NOT NULL,
     created_at TEXT NOT NULL)`,
  // Unused. The daily freemium cap was removed because the welcome grant is
  // one-time; the product no longer reads or writes this table. Kept so an
  // existing ledger still opens.
  `CREATE TABLE IF NOT EXISTS freemium_usage (
     wallet_address TEXT NOT NULL,
     day TEXT NOT NULL,
     count INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (wallet_address, day))`,
  `CREATE TABLE IF NOT EXISTS funnel_events (
     wallet_address TEXT NOT NULL,
     event TEXT NOT NULL,
     created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS holder_grants (
     wallet_address TEXT NOT NULL,
     period TEXT NOT NULL,
     nft_count INTEGER NOT NULL,
     credits INTEGER NOT NULL,
     granted_at TEXT NOT NULL,
     PRIMARY KEY (wallet_address, period))`,
  `CREATE TABLE IF NOT EXISTS sol_orders (
     id TEXT PRIMARY KEY,
     wallet_address TEXT NOT NULL,
     package TEXT NOT NULL,
     credits INTEGER NOT NULL,
     price_usd REAL NOT NULL,
     amount_micro INTEGER NOT NULL,
     status TEXT NOT NULL DEFAULT 'pending',
     signature TEXT,
     created_at TEXT NOT NULL,
     paid_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_sol_orders_open ON sol_orders (status, amount_micro)`,
  `CREATE TABLE IF NOT EXISTS b2b_keys (
     api_key TEXT PRIMARY KEY,
     client_name TEXT NOT NULL,
     quota INTEGER NOT NULL DEFAULT 0,
     used INTEGER NOT NULL DEFAULT 0,
     active INTEGER NOT NULL DEFAULT 1,
     created_at TEXT NOT NULL)`,
];

function columns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name));
}

/** Additive migrations — idempotent. */
function migrate(db) {
  if (!columns(db, "users").has("verified_at")) {
    db.exec("ALTER TABLE users ADD COLUMN verified_at TEXT");
    db.exec("UPDATE users SET verified_at = created_at WHERE verified_at IS NULL");
  }
  const fe = columns(db, "funnel_events");
  if (fe.size && !fe.has("payload")) db.exec("ALTER TABLE funnel_events ADD COLUMN payload TEXT");
  const nf = columns(db, "nft_fulfillments");
  if (nf.size && !nf.has("status")) {
    db.exec("ALTER TABLE nft_fulfillments ADD COLUMN status TEXT NOT NULL DEFAULT 'reserved'");
    db.exec("ALTER TABLE nft_fulfillments ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0");
    db.exec("ALTER TABLE nft_fulfillments ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");
  }
}

const cache = new Map();

/**
 * Opens (once per path) the platform DB. Path: explicit → env `USERS_DB_PATH`
 * → `<SERIES_DATA_DIR>/users.db` → `./data/users.db`.
 */
export function openDb(path = defaultDbPath()) {
  const abs = resolve(path);
  let db = cache.get(abs);
  if (db) return db;
  mkdirSync(dirname(abs), { recursive: true });
  db = new DatabaseSync(abs, { timeout: 30_000 });
  db.exec("PRAGMA journal_mode=WAL");
  for (const ddl of SCHEMA) db.exec(ddl);
  migrate(db);
  cache.set(abs, db);
  return db;
}

export function defaultDbPath() {
  if (process.env.USERS_DB_PATH) return process.env.USERS_DB_PATH;
  return resolve(process.env.SERIES_DATA_DIR || "data", "users.db");
}

/** Closes and forgets cached handles (tests). */
export function closeAll() {
  for (const db of cache.values()) {
    try { db.close(); } catch { /* ignore */ }
  }
  cache.clear();
}

/** Runs `fn(db)` inside BEGIN IMMEDIATE … COMMIT (rollback on throw). */
export function tx(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn(db);
    db.exec("COMMIT");
    return out;
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
    throw e;
  }
}

export function isConstraintError(e) {
  return /constraint failed/i.test(String(e?.message || e));
}

/**
 * UTC timestamp in the exact shape Python's `datetime.now(timezone.utc).isoformat()`
 * writes (`2026-09-24T10:11:12.123000+00:00`), so string comparisons in SQL order
 * all rows consistently.
 */
export function nowIso(d = new Date()) {
  return d.toISOString().replace(/\.(\d{3})Z$/, ".$1000+00:00");
}
