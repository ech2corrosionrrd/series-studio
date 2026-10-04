#!/usr/bin/env node
/**
 * Restore drill for a ledger snapshot: the copy must open read-only, pass
 * integrity_check, contain the core tables and (optionally) be fresh.
 * A backup nobody tried to open is not a backup.
 *
 * usage: node scripts/verify-backup.mjs --path <users.db> [--max-age-hours 30]
 *        VERIFY_DB=<users.db> VERIFY_MAX_AGE_HOURS=30 node scripts/verify-backup.mjs
 * exit 0 = ok, 1 = problem (message on stderr), 2 = usage.
 */
import { statSync } from "node:fs";
import { resolve } from "node:path";
// Self-contained on purpose: deploy/series-lab/verify-backup.sh pipes this file into the
// container's node via stdin, where relative project imports do not resolve.
import { DatabaseSync } from "node:sqlite";

export const REQUIRED_TABLES = ["users", "payments", "transactions", "wallet_nonces"];

function arg(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : "";
}

/** @returns {{ok: boolean, problems: string[], info: object}} */
export function verifySnapshot(path, { maxAgeHours = 0, now = Date.now() } = {}) {
  const problems = [];
  const info = {};
  let st;
  try {
    st = statSync(path);
  } catch {
    return { ok: false, problems: [`snapshot not found: ${path}`], info };
  }
  info.bytes = st.size;
  if (st.size < 1024) problems.push(`snapshot too small (${st.size} bytes)`);
  info.ageHours = Math.round(((now - st.mtimeMs) / 3_600_000) * 10) / 10;
  if (maxAgeHours > 0 && info.ageHours > maxAgeHours) {
    problems.push(`snapshot is ${info.ageHours} h old (limit ${maxAgeHours} h) — backups stopped`);
  }
  if (problems.length) return { ok: false, problems, info };

  let db;
  try {
    db = new DatabaseSync(resolve(path), { readOnly: true });
    const integrity = db.prepare("PRAGMA integrity_check").get()?.integrity_check;
    if (integrity !== "ok") problems.push(`integrity_check: ${integrity || "empty"}`);
    const have = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
    const missing = REQUIRED_TABLES.filter((t) => !have.has(t));
    if (missing.length) problems.push(`missing tables: ${missing.join(", ")}`);
    else {
      info.users = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
      info.payments = db.prepare("SELECT COUNT(*) AS n FROM payments").get().n;
    }
  } catch (e) {
    problems.push(`cannot open snapshot: ${e.message}`);
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
  return { ok: problems.length === 0, problems, info };
}

if (process.argv.includes("--path") || process.env.VERIFY_DB || process.argv[1]?.endsWith("verify-backup.mjs")) {
  const path = arg("--path") || process.env.VERIFY_DB || "";
  if (!path) {
    console.error("usage: node scripts/verify-backup.mjs --path <users.db> [--max-age-hours N]");
    process.exit(2);
  }
  const maxAgeHours = Number(arg("--max-age-hours") || process.env.VERIFY_MAX_AGE_HOURS || 0) || 0;
  const r = verifySnapshot(path, { maxAgeHours });
  if (!r.ok) {
    console.error(`verify FAILED: ${r.problems.join("; ")}`);
    process.exit(1);
  }
  console.log(`verify ok bytes=${r.info.bytes} age_h=${r.info.ageHours} users=${r.info.users} payments=${r.info.payments}`);
}
