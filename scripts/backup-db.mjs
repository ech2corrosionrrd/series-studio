#!/usr/bin/env node
/**
 * Consistent SQLite snapshot (online backup API, safe while the ledger is open).
 * usage: node scripts/backup-db.mjs --src users.db --dest copy.db
 *        BACKUP_SRC=... BACKUP_DEST=... node scripts/backup-db.mjs
 */
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { backupDatabase, DatabaseSync } from "../src/platform/sqlite-backup.mjs";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : "";
}

const srcPath = arg("--src") || process.env.BACKUP_SRC || "";
const destPath = arg("--dest") || process.env.BACKUP_DEST || "";
if (!srcPath || !destPath) {
  console.error("usage: node scripts/backup-db.mjs --src <users.db> --dest <copy.db>");
  process.exit(2);
}

const srcAbs = resolve(srcPath);
const destAbs = resolve(destPath);
mkdirSync(dirname(destAbs), { recursive: true });

const src = new DatabaseSync(srcAbs, { readOnly: true, timeout: 30_000 });
let pages = 0;
try {
  pages = await backupDatabase(src, destAbs);
} finally {
  src.close();
}

const copy = new DatabaseSync(destAbs, { readOnly: true });
let integrity = "";
try {
  integrity = copy.prepare("PRAGMA integrity_check").get()?.integrity_check || "";
} finally {
  copy.close();
}
if (integrity !== "ok") {
  console.error(`integrity_check failed: ${integrity || "empty"}`);
  process.exit(1);
}
console.log(`backup ok pages=${pages} dest=${destAbs}`);
