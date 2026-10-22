#!/usr/bin/env node
/**
 * Offsite copy of the ledger WITHOUT cloud keys: run on the operator's PC, it pulls the
 * newest hourly snapshot from the VPS over SSH, proves it opens (integrity_check, core
 * tables) and keeps the last N copies.
 *
 *   npm run backup:pull
 *   node scripts/pull-backup.mjs --host user@vps-host --remote /opt/series-lab/backups \
 *        --dest backups/offsite --keep 14
 * Env: BACKUP_PULL_HOST, BACKUP_PULL_REMOTE, BACKUP_PULL_DEST, BACKUP_PULL_KEEP.
 * Needs a working non-interactive `ssh` / `scp` (key login). Exit 1 = nothing usable pulled.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { verifySnapshot } from "./verify-backup.mjs";

function arg(name, env, fallback) {
  const i = process.argv.indexOf(name);
  return (i !== -1 && process.argv[i + 1]) || process.env[env] || fallback;
}

/** Newest slot name from `ls -1` output (slots are named YYYYMMDD-HHMM, so sort is chronological). */
export function newestSlot(listing) {
  return String(listing).split(/\r?\n/).map((s) => s.trim().replace(/\/$/, "")).filter((s) => /^\d{8}-\d{4}$/.test(s)).sort().at(-1) || "";
}

/** Names to delete so that only the `keep` newest pulled copies remain. */
export function pruneList(files, keep) {
  const mine = files.filter((f) => /^users-\d{8}-\d{4}\.db$/.test(f)).sort();
  return mine.slice(0, Math.max(0, mine.length - keep));
}

function main() {
  const host = arg("--host", "BACKUP_PULL_HOST", "user@vps-host");
  const remote = arg("--remote", "BACKUP_PULL_REMOTE", "/opt/series-lab/backups").replace(/\/$/, "");
  const dest = resolve(arg("--dest", "BACKUP_PULL_DEST", "backups/offsite"));
  const keep = Number(arg("--keep", "BACKUP_PULL_KEEP", "14")) || 14;
  const ssh = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=20"];

  const listing = execFileSync("ssh", [...ssh, host, `ls -1 ${remote}/hourly`], { encoding: "utf8" });
  const slot = newestSlot(listing);
  if (!slot) throw new Error(`no hourly snapshot under ${host}:${remote}/hourly`);

  mkdirSync(dest, { recursive: true });
  const out = join(dest, `users-${slot}.db`);
  if (!existsSync(out)) execFileSync("scp", [...ssh, "-q", `${host}:${remote}/hourly/${slot}/users.db`, out], { stdio: "inherit" });

  const r = verifySnapshot(out, { maxAgeHours: 6 });
  if (!r.ok) {
    rmSync(out, { force: true });
    throw new Error(`pulled copy ${slot} is not usable: ${r.problems.join("; ")}`);
  }
  // Opening a WAL-mode copy read-only leaves -shm/-wal sidecars: drop them with the copy.
  for (const f of pruneList(readdirSync(dest), keep)) for (const ext of ["", "-shm", "-wal"]) rmSync(join(dest, f + ext), { force: true });
  for (const ext of ["-shm", "-wal"]) rmSync(out + ext, { force: true });
  console.log(`pull ok slot=${slot} users=${r.info.users} payments=${r.info.payments} -> ${out}`);
}

if (process.argv[1]?.endsWith("pull-backup.mjs")) {
  try {
    main();
  } catch (e) {
    console.error(`pull FAILED: ${e.message}`);
    process.exit(1);
  }
}
