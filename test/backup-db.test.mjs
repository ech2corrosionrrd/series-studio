import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

test("backup-db.mjs copies a live WAL database and checks integrity", () => {
  const dir = mkdtempSync(join(tmpdir(), "series-backup-"));
  const srcPath = join(dir, "users.db");
  const destPath = join(dir, "copy.db");
  const writer = new DatabaseSync(srcPath);
  try {
    writer.exec("PRAGMA journal_mode=WAL");
    writer.exec("CREATE TABLE users (wallet_address TEXT PRIMARY KEY, credits_balance INTEGER)");
    writer.exec("INSERT INTO users VALUES ('abc', 100)");
    const run = spawnSync(process.execPath, [
      join(import.meta.dirname, "..", "scripts", "backup-db.mjs"),
      "--src", srcPath,
      "--dest", destPath,
    ], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /backup ok/);
    writer.exec("UPDATE users SET credits_balance = 1");
    const copy = new DatabaseSync(destPath, { readOnly: true });
    try {
      assert.equal(copy.prepare("SELECT credits_balance FROM users").get().credits_balance, 100);
      assert.equal(copy.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    } finally {
      copy.close();
    }
  } finally {
    writer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
