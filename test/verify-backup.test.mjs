import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { verifySnapshot } from "../scripts/verify-backup.mjs";

function makeDb(path, tables) {
  const db = new DatabaseSync(path);
  for (const t of tables) db.exec(`CREATE TABLE ${t} (id INTEGER PRIMARY KEY, pad TEXT)`);
  db.exec("CREATE TABLE IF NOT EXISTS filler (x TEXT)");
  const ins = db.prepare("INSERT INTO filler VALUES (?)");
  for (let i = 0; i < 300; i++) ins.run("x".repeat(40));
  db.close();
}

test("verifySnapshot accepts a complete ledger copy", () => {
  const dir = mkdtempSync(join(tmpdir(), "series-verify-"));
  try {
    const p = join(dir, "users.db");
    makeDb(p, ["users", "payments", "transactions", "wallet_nonces"]);
    const r = verifySnapshot(p, { maxAgeHours: 24 });
    assert.equal(r.ok, true, r.problems.join(";"));
    assert.equal(r.info.users, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("verifySnapshot flags missing tables, stale and absent files", () => {
  const dir = mkdtempSync(join(tmpdir(), "series-verify-"));
  try {
    const p = join(dir, "users.db");
    makeDb(p, ["users"]);
    const missing = verifySnapshot(p);
    assert.equal(missing.ok, false);
    assert.match(missing.problems.join(" "), /missing tables: payments/);

    const old = new Date(Date.now() - 72 * 3_600_000);
    utimesSync(p, old, old);
    assert.match(verifySnapshot(p, { maxAgeHours: 30 }).problems.join(" "), /old/);

    assert.match(verifySnapshot(join(dir, "none.db")).problems[0], /not found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("verify-backup CLI exits 1 on a bad snapshot and 0 on a good one", () => {
  const dir = mkdtempSync(join(tmpdir(), "series-verify-"));
  try {
    const good = join(dir, "good.db");
    makeDb(good, ["users", "payments", "transactions", "wallet_nonces"]);
    const script = join(import.meta.dirname, "..", "scripts", "verify-backup.mjs");
    assert.equal(spawnSync(process.execPath, [script, "--path", good], { encoding: "utf8" }).status, 0);
    assert.equal(spawnSync(process.execPath, [script, "--path", join(dir, "x.db")], { encoding: "utf8" }).status, 1);
    assert.equal(spawnSync(process.execPath, [script], { encoding: "utf8" }).status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
