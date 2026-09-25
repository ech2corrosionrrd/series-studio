#!/usr/bin/env node
/**
 * Series Lab's own backup — ledger + per-wallet data, nothing from any other project.
 *
 *   npm run backup                 # → backups/lab-YYYYMMDD-HHMMSS/
 *   npm run backup -- --ledger-only
 *
 * Env: SERIES_DATA_DIR (default ./data) · USERS_DB_PATH · BACKUP_DIR (default ./backups)
 *      BACKUP_KEEP (how many newest snapshots to keep, default 14)
 *
 * Restore: stop the server, copy `backups/<snapshot>/users.db` over `data/users.db`
 * (delete the `-wal`/`-shm` files next to it) and, if needed, `users/` back into `data/`.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

const dataDir = resolve(process.env.SERIES_DATA_DIR || "data");
const dbPath = resolve(process.env.USERS_DB_PATH || join(dataDir, "users.db"));
const root = resolve(process.env.BACKUP_DIR || "backups");
const keep = Math.max(1, Number.parseInt(process.env.BACKUP_KEEP || "14", 10) || 14);
const ledgerOnly = process.argv.includes("--ledger-only");

if (!existsSync(dbPath)) {
  console.error(`No ledger at ${dbPath} — nothing to back up (start the server once to create it).`);
  process.exit(1);
}

const pad = (n) => String(n).padStart(2, "0");
const d = new Date();
const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const dest = join(root, `lab-${stamp}`);
mkdirSync(dest, { recursive: true });

// 1. Ledger: SQLite online backup — consistent even while the server has the file open (WAL).
const copyPath = join(dest, "users.db");
const src = new DatabaseSync(dbPath, { readOnly: true, timeout: 30_000 });
let pages = 0;
try {
  pages = await backup(src, copyPath);
} finally {
  src.close();
}
const copy = new DatabaseSync(copyPath, { readOnly: true });
let integrity = "";
const counts = {};
try {
  integrity = copy.prepare("PRAGMA integrity_check").get()?.integrity_check || "";
  for (const t of ["users", "transactions", "payments", "sol_orders"]) {
    try { counts[t] = Number(copy.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n); } catch { /* table absent */ }
  }
} finally {
  copy.close();
}
if (integrity !== "ok") {
  rmSync(dest, { recursive: true, force: true });
  console.error(`integrity_check failed: ${integrity || "empty"} — backup discarded`);
  process.exit(1);
}

// 2. Everything else the server keeps on disk (per-wallet series data, small JSON sidecars).
const included = ["users.db"];
if (!ledgerOnly) {
  for (const name of readdirSync(dataDir)) {
    if (name.startsWith("users.db") || name.startsWith("backup")) continue;
    cpSync(join(dataDir, name), join(dest, name), { recursive: true });
    included.push(statSync(join(dataDir, name)).isDirectory() ? `${name}/` : name);
  }
}

writeFileSync(join(dest, "manifest.json"), JSON.stringify({ created_at: d.toISOString(), source: { dataDir, dbPath }, ledger_only: ledgerOnly, sqlite_pages: pages, integrity, counts, included }, null, 2));

// 3. Rotation: keep the newest `keep` snapshots (names sort chronologically).
const snapshots = readdirSync(root).filter((n) => /^lab-\d{8}-\d{6}$/.test(n)).sort();
for (const old of snapshots.slice(0, Math.max(0, snapshots.length - keep))) rmSync(join(root, old), { recursive: true, force: true });

console.log(`backup ok → ${dest}`);
console.log(`  ledger: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" ")} · integrity ${integrity}`);
console.log(`  included: ${included.join(", ")} · kept ${Math.min(snapshots.length, keep)}/${keep} snapshots`);
