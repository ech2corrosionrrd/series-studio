import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "series-funnel-"));
process.env.USERS_DB_PATH = join(dir, "users.db");
process.env.SERIES_DATA_DIR = dir;
process.env.AUTH_SESSION_SECRET = "funnel-test";
process.env.WELCOME_REQUIRE_BALANCE = "0";

const { closeAll, openDb, nowIso } = await import("../src/platform/db.mjs");
const { completeWalletSignIn, recordPayment, recordFunnelEvent } = await import("../src/platform/billing.mjs");
const { funnel } = await import("../src/platform/stats.mjs");

const W = (n) => `0x${String(n).padStart(40, "0")}`;
const OPERATOR = W(1);
const ALICE = W(2); // external: refused, later funded, got welcome, started + paid twice
const BOB = W(3); // external: refused and never got welcome credits
const CAROL = W(4); // external: opened an order, did not pay
const okBalance = async () => ({ ok: true, message: "" });

after(() => {
  closeAll();
  rmSync(dir, { recursive: true, force: true });
});

function order(db, wallet, id) {
  db.prepare("INSERT INTO sol_orders (id, wallet_address, package, credits, price_usd, amount_micro, status, created_at) VALUES (?, ?, 'start', 100, 4.99, ?, 'pending', ?)")
    .run(id, wallet, 4_990_000 + Number(id.replace(/\D/g, "")), nowIso());
}

describe("funnel: sign-up friction, payment start, repeat payers, external scope", () => {
  test("counts refused-for-good wallets, order starts, conversions and repeats", async () => {
    process.env.OPERATOR_WALLET = OPERATOR;
    const db = openDb(join(dir, "users.db"));
    for (const w of [OPERATOR, ALICE, CAROL]) await completeWalletSignIn(w, { db, balanceCheck: okBalance });
    // Alice and Bob were refused first; Alice came back with a funded wallet and got the credits
    assert.equal(recordFunnelEvent(ALICE, "welcome_denied", null, db), true);
    assert.equal(recordFunnelEvent(ALICE, "welcome_denied", null, db), true, "same wallet twice counts once");
    assert.equal(recordFunnelEvent(BOB, "welcome_denied", null, db), true);
    order(db, ALICE, "o1");
    order(db, CAROL, "o2");
    assert.equal(recordPayment("tx-a1", ALICE, 100, 4.99, { db }), true);
    assert.equal(recordPayment("tx-a2", ALICE, 100, 4.99, { db }), true);
    assert.equal(recordPayment("tx-op", OPERATOR, 100, 4.99, { db }), true);

    recordFunnelEvent(ALICE, "project_charge", null, db);
    recordFunnelEvent(CAROL, "project_charge", null, db);
    recordFunnelEvent(ALICE, "project_paid", null, db);
    const all = funnel(30, { db });
    assert.equal(all.welcome_denied_wallets, 2, "Alice (twice) and Bob are 2 unique wallets");
    assert.equal(all.welcome_denied_lost_wallets, 1, "only Bob never got welcome credits");
    assert.equal(all.pay_started_wallets, 2);
    assert.equal(all.project_gate_wallets, 2);
    assert.equal(all.project_paid_wallets, 1);
    assert.equal(all.conversion_project_gate_to_paid_pct, 50);
    assert.equal(all.paying_wallets, 2, "Alice and the operator");
    assert.equal(all.repeat_paying_wallets, 1, "only Alice paid twice");
    assert.equal(all.conversion_started_to_paid_pct, 50, "Alice paid, Carol did not");

    const ext = funnel(30, { scope: "external", db });
    assert.equal(ext.paying_wallets, 1, "the operator's payment is not external");
    assert.equal(ext.repeat_paying_wallets, 1);
    assert.equal(ext.pay_started_wallets, 2);
    assert.equal(ext.welcome_granted_wallets, 2, "Alice and Carol; the operator is internal");
  });

  test("a window that excludes everything gives zeros, not errors", async () => {
    const db = openDb(join(dir, "users.db"));
    const none = funnel(0, { scope: "external", db });
    assert.equal(none.pay_started_wallets, 0);
    assert.equal(none.repeat_paying_wallets, 0);
    assert.equal(none.conversion_started_to_paid_pct, null);
  });
});
