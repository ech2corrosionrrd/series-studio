// Economy review: a failed balance lookup is not an empty wallet. The sign-in tells them apart, the funnel does not count a failed
// lookup as a refusal, and the next sign-in tries again.
import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "series-welcome-"));
process.env.USERS_DB_PATH = join(dir, "users.db");
process.env.SERIES_DATA_DIR = dir;
process.env.AUTH_SESSION_SECRET = "welcome-test";
delete process.env.WELCOME_REQUIRE_BALANCE;

const { closeAll, openDb } = await import("../src/platform/db.mjs");
const { completeWalletSignIn, getBalance, hasWelcomeGrant } = await import("../src/platform/billing.mjs");
const { welcomeBalanceOk } = await import("../src/platform/wallet.mjs");

const EVM = (n) => `0x${String(n).padStart(40, "0")}`;
after(() => {
  closeAll();
  rmSync(dir, { recursive: true, force: true });
});
const events = (db, wallet) => db.prepare("SELECT event FROM funnel_events WHERE wallet_address = ?").all(wallet.toLowerCase()).map((r) => r.event);

describe("welcomeBalanceOk", () => {
  test("an empty wallet is refused, a funded one passes, a failed lookup is `unknown`", async () => {
    const reply = (hex) => async () => ({ result: hex });
    const empty = await welcomeBalanceOk(EVM(5), { fetchImpl: reply("0x0") });
    assert.equal(empty.ok, false);
    assert.equal(empty.unknown, undefined);
    assert.equal((await welcomeBalanceOk(EVM(5), { fetchImpl: reply("0x16345785d8a0000") })).ok, true);
    const down = await welcomeBalanceOk(EVM(5), { fetchImpl: async () => { throw new Error("rpc down"); } });
    assert.equal(down.ok, false);
    assert.equal(down.unknown, true);
    const garbage = await welcomeBalanceOk(EVM(5), { fetchImpl: async () => ({ error: "nope" }) });
    assert.equal(garbage.unknown, true);
  });
});

describe("sign-in", () => {
  test("a failed lookup is not a refusal: nothing is counted as denied, and the next sign-in grants the credits", async () => {
    const db = openDb();
    const w = EVM(7);
    const first = await completeWalletSignIn(w, { db, balanceCheck: async () => ({ ok: false, unknown: true, message: "x" }) });
    assert.equal(first.denied, false);
    assert.equal(hasWelcomeGrant(db, w), false);
    assert.deepEqual(events(db, w), ["welcome_check_failed"]);
    const second = await completeWalletSignIn(w, { db, balanceCheck: async () => ({ ok: true, message: "" }) });
    assert.equal(second.welcomed, true);
    assert.ok(getBalance(w) > 0);
    assert.equal(hasWelcomeGrant(db, w), true);
  });

  test("an empty wallet is still refused and counted", async () => {
    const db = openDb();
    const w = EVM(8);
    const r = await completeWalletSignIn(w, { db, balanceCheck: async () => ({ ok: false, message: "empty" }) });
    assert.equal(r.denied, true);
    assert.deepEqual(events(db, w), ["welcome_denied"]);
  });
});
