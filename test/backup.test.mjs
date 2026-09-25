import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = mkdtempSync(join(tmpdir(), "series-backup-"));
const data = join(root, "data");
const out = join(root, "backups");
const script = new URL("../scripts/backup.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function run(extra = [], env = {}) {
  return spawnSync(process.execPath, [script, ...extra], {
    env: { ...process.env, SERIES_DATA_DIR: data, BACKUP_DIR: out, USERS_DB_PATH: "", ...env },
    encoding: "utf8",
  });
}

before(() => {
  mkdirSync(join(data, "users", "0xabc", "presets"), { recursive: true });
  writeFileSync(join(data, "users", "0xabc", "presets", "s.json"), '{"id":"s"}');
  writeFileSync(join(data, "genesis_mints.json"), "[]");
  const db = new DatabaseSync(join(data, "users.db"));
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("CREATE TABLE users (wallet_address TEXT PRIMARY KEY, credits_balance INTEGER)");
  db.exec("CREATE TABLE payments (tx_id TEXT PRIMARY KEY)");
  db.exec("INSERT INTO users VALUES ('0xabc', 20), ('0xdef', 5)");
  db.exec("INSERT INTO payments VALUES ('sol:1')");
  // the db stays open like a running server: the backup must still be consistent
  globalThis.__db = db;
});

after(() => {
  globalThis.__db?.close();
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

describe("npm run backup", () => {
  test("snapshots the ledger (even while open) and the wallet data, with a manifest", () => {
    const r = run();
    assert.equal(r.status, 0, r.stderr);
    const [snap] = readdirSync(out);
    assert.match(snap, /^lab-\d{8}-\d{6}$/);
    const copy = new DatabaseSync(join(out, snap, "users.db"), { readOnly: true });
    assert.equal(copy.prepare("SELECT COUNT(*) AS n FROM users").get().n, 2);
    copy.close();
    assert.ok(existsSync(join(out, snap, "users", "0xabc", "presets", "s.json")));
    assert.ok(existsSync(join(out, snap, "genesis_mints.json")));
    const manifest = JSON.parse(readFileSync(join(out, snap, "manifest.json"), "utf8"));
    assert.equal(manifest.integrity, "ok");
    assert.equal(manifest.counts.users, 2);
    assert.equal(manifest.counts.payments, 1);
  });

  test("--ledger-only skips wallet data; rotation keeps only the newest N", () => {
    rmSync(out, { recursive: true, force: true });
    for (let i = 0; i < 3; i += 1) {
      mkdirSync(join(out, `lab-2020010${i + 1}-000000`), { recursive: true });
    }
    const r = run(["--ledger-only"], { BACKUP_KEEP: "2" });
    assert.equal(r.status, 0, r.stderr);
    const snaps = readdirSync(out).sort();
    assert.equal(snaps.length, 2, snaps.join(","));
    const fresh = snaps[snaps.length - 1];
    assert.ok(!existsSync(join(out, fresh, "users")), "ledger-only has no users/ dir");
    assert.ok(!snaps.includes("lab-20200101-000000"), "oldest snapshot rotated out");
  });

  test("refuses to run without a ledger", () => {
    const r = run([], { SERIES_DATA_DIR: join(root, "nothing-here"), BACKUP_DIR: join(root, "b2") });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /No ledger/);
  });
});
