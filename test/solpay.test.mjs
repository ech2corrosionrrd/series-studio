import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "series-solpay-"));
process.env.SERIES_DATA_DIR = dir;
process.env.AUTH_SESSION_SECRET = "solpay-secret";

const { openDb, closeAll, nowIso } = await import("../src/platform/db.mjs");
const billing = await import("../src/platform/billing.mjs");
const sp = await import("../src/platform/solpay.mjs");

const RECIPIENT = "63u6SDZckvzcJhC4V5yJn6bZ15qx1iM8c6iB3Z9xD1tn";
const RECIPIENT_ATA = "RecipientUsdcTokenAccount1111111111111111111";
const BUYER = "0xabc0000000000000000000000000000000000001";
const OTHER = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV";
const env = { SOLANA_PAY_RECIPIENT: RECIPIENT, SOLANA_PAY_ORDER_DAYS: "7" };

/** A parsed getTransaction result with one USDC transfer into `destination`. */
const transferTx = ({ amountMicro, destination = RECIPIENT_ATA, source = "SenderUsdcAccount", err = null, blockTime, checked = true, mint = sp.USDC_MINT }) => ({
  blockTime,
  meta: { err, innerInstructions: [] },
  transaction: {
    message: {
      instructions: [{
        program: "spl-token",
        parsed: checked
          ? { type: "transferChecked", info: { source, destination, mint, tokenAmount: { amount: String(amountMicro) } } }
          : { type: "transfer", info: { source, destination, amount: String(amountMicro) } },
      }],
    },
  },
});

/** Fake JSON-RPC: `chain` maps signature → getTransaction result. */
function fakeRpc(chain, { accounts = [RECIPIENT_ATA] } = {}) {
  const calls = [];
  const fn = async (_url, method, params) => {
    calls.push(method);
    if (method === "getTokenAccountsByOwner") return { result: { value: accounts.map((pubkey) => ({ pubkey })) } };
    if (method === "getSignaturesForAddress") {
      return { result: Object.entries(chain).map(([signature, t]) => ({ signature, err: t?.meta?.err || null, blockTime: t?.blockTime })) };
    }
    if (method === "getTransaction") return { result: chain[params[0]] ?? null };
    throw new Error(`unexpected ${method}`);
  };
  fn.calls = calls;
  return fn;
}

let db;
before(() => { db = openDb(); });
after(() => { closeAll(); rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); });

describe("Solana direct USDC orders", () => {
  test("disabled without a valid recipient address", () => {
    assert.equal(sp.solPayInfo({}).enabled, false);
    assert.equal(sp.solPayInfo({ SOLANA_PAY_RECIPIENT: "nope" }).enabled, false);
    assert.throws(() => sp.createSolOrder(BUYER, "start", { db, env: {} }), /не налаштована/);
    assert.deepEqual(sp.solPayInfo(env), { enabled: true, recipient: RECIPIENT, mint: sp.USDC_MINT, decimals: 6 });
  });

  test("order amount = price + unique micro-USDC; same wallet+pack reuses the pending order", () => {
    const a = sp.createSolOrder(BUYER, "start", { db, env });
    assert.equal(a.status, "pending");
    assert.ok(a.amount_micro > 4_990_000 && a.amount_micro <= 4_999_999, String(a.amount_micro));
    assert.match(a.amount, /^4\.99\d{4}$/);
    assert.equal(sp.createSolOrder(BUYER, "start", { db, env }).id, a.id);
    const b = sp.createSolOrder(OTHER, "start", { db, env });
    assert.notEqual(b.amount_micro, a.amount_micro, "two open orders never share an amount");
    assert.match(a.uri, /^solana:63u6SDZckvzcJhC4V5yJn6bZ15qx1iM8c6iB3Z9xD1tn\?amount=4\.99\d{4}&spl-token=EPjFW/);
    assert.throws(() => sp.createSolOrder(BUYER, "nope", { db, env }), /Невідомий пакет/);
  });

  test("the $0.10 test pack exists only for admins with SOLANA_PAY_TEST_PACK=1", () => {
    const on = { ...env, SOLANA_PAY_TEST_PACK: "1" };
    assert.equal(sp.solPayInfo(on).testPack, undefined, "hidden from ordinary users");
    assert.deepEqual(sp.solPayInfo(on, { admin: true }).testPack, sp.TEST_PACK);
    assert.equal(sp.solPayInfo(env, { admin: true }).testPack, undefined, "flag off → no test pack");
    assert.throws(() => sp.createSolOrder(BUYER, "test", { db, env: on }), /Невідомий пакет/);
    assert.throws(() => sp.createSolOrder(BUYER, "test", { db, env, admin: true }), /Невідомий пакет/);
    const o = sp.createSolOrder("0xad00000000000000000000000000000000000009", "test", { db, env: on, admin: true });
    assert.equal(o.credits, 2);
    assert.match(o.amount, /^0\.10\d{4}$/);
  });

  test("credits once for a matching transfer; repeats and other amounts change nothing", async () => {
    const wallet = "0xdef0000000000000000000000000000000000002";
    const o = sp.createSolOrder(wallet, "creator", { db, env });
    const t0 = Math.floor(Date.now() / 1000);
    const chain = {
      sigWrong: transferTx({ amountMicro: 14_990_000, blockTime: t0 + 5 }), // exact price, no unique suffix
      sigOk: transferTx({ amountMicro: o.amount_micro, blockTime: t0 + 10 }),
    };
    const rpc = fakeRpc(chain);
    const before1 = billing.getBalance(wallet, db);
    const r1 = await sp.checkSolOrders({ wallet, db, env, fetchImpl: rpc });
    assert.deepEqual(r1.credited.map((c) => [c.id, c.credits]), [[o.id, 400]]);
    assert.equal(billing.getBalance(wallet, db), before1 + 400);
    const r2 = await sp.checkSolOrders({ wallet, db, env, fetchImpl: rpc });
    assert.equal(r2.credited.length, 0);
    assert.equal(billing.getBalance(wallet, db), before1 + 400, "credited exactly once");
    assert.equal(db.prepare("SELECT status FROM sol_orders WHERE id = ?").get(o.id).status, "paid");
    assert.ok(db.prepare("SELECT 1 FROM payments WHERE tx_id = 'sol:sigOk'").get());
    assert.ok(db.prepare("SELECT 1 FROM transactions WHERE wallet_address = ? AND kind = 'payment'").get(wallet));
  });

  test("a self-transfer (sender = recipient, balance unchanged) still counts; plain `transfer` too", async () => {
    const wallet = "0x1230000000000000000000000000000000000003";
    const o = sp.createSolOrder(wallet, "start", { db, env });
    const t0 = Math.floor(Date.now() / 1000);
    const chain = { selfSig: transferTx({ amountMicro: o.amount_micro, source: RECIPIENT_ATA, destination: RECIPIENT_ATA, blockTime: t0 + 3, checked: false }) };
    const r = await sp.checkSolOrders({ wallet, db, env, fetchImpl: fakeRpc(chain) });
    assert.equal(r.credited.length, 1);
  });

  test("ignores failed transactions, other tokens, other recipients and transfers older than the order", async () => {
    const wallet = "0x4560000000000000000000000000000000000004";
    const o = sp.createSolOrder(wallet, "pro", { db, env });
    const t0 = Math.floor(Date.now() / 1000);
    const chain = {
      failed: transferTx({ amountMicro: o.amount_micro, blockTime: t0 + 1, err: { InstructionError: [0, "x"] } }),
      wrongMint: transferTx({ amountMicro: o.amount_micro, blockTime: t0 + 2, mint: "SomeOtherMint111111111111111111111111111111" }),
      wrongDest: transferTx({ amountMicro: o.amount_micro, blockTime: t0 + 3, destination: "NotTheRecipientAccount1111111111111111111" }),
      tooOld: transferTx({ amountMicro: o.amount_micro, blockTime: t0 - 3600 }),
    };
    const r = await sp.checkSolOrders({ wallet, db, env, fetchImpl: fakeRpc(chain) });
    assert.equal(r.credited.length, 0);
    assert.equal(db.prepare("SELECT status FROM sol_orders WHERE id = ?").get(o.id).status, "pending");
  });

  test("no RPC traffic without pending orders; missing USDC account and RPC errors are reported, not thrown", async () => {
    const rpc = fakeRpc({});
    assert.deepEqual(await sp.checkSolOrders({ wallet: "0xnobody", db, env, fetchImpl: rpc }), { checked: 0, credited: [] });
    assert.equal(rpc.calls.length, 0);
    const wallet = "0x7890000000000000000000000000000000000005";
    sp.createSolOrder(wallet, "start", { db, env });
    const noAta = await sp.checkSolOrders({ wallet, db, env: { ...env, SOLANA_PAY_RECIPIENT: OTHER }, fetchImpl: fakeRpc({}, { accounts: [] }) });
    assert.match(noAta.error || "", /USDC-рахунку|немає/);
    const boom = await sp.checkSolOrders({ wallet, db, env, fetchImpl: async () => { throw new Error("rpc down"); } });
    assert.match(boom.error, /rpc down/);
  });

  test("extractUsdcTransfers reads the amount, handles empty results", () => {
    const parsed = sp.extractUsdcTransfers(transferTx({ amountMicro: 5_000_001, blockTime: 1 }), new Set([RECIPIENT_ATA]));
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].amountMicro, 5_000_001n);
    assert.deepEqual(sp.extractUsdcTransfers(null, new Set([RECIPIENT_ATA])), []);
    assert.ok(nowIso().includes("T"));
  });
});
