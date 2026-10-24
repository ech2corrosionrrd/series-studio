import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import assert from "node:assert/strict";

const dir = mkdtempSync(join(tmpdir(), "series-holders-"));
process.env.SERIES_DATA_DIR = dir;
process.env.GENESIS_MINTS_FILE = join(dir, "genesis_mints.json");
process.env.GENESIS_COLLECTION_MINT = "COLLECTION1111111111111111111111111111111111";
process.env.SOLANA_RPC_URL = "https://rpc.test";
process.env.SOLANA_RPC_FALLBACKS = "";
process.env.GENESIS_BONUS_PERIOD = "once";
for (const k of ["GENESIS_BONUS_CREDITS", "GENESIS_BONUS_PER_EXTRA", "GENESIS_BONUS_MAX", "GENESIS_BONUS_BUDGET", "GENESIS_BONUS_EXCLUDE_WALLETS"]) delete process.env[k];

const { closeAll, openDb } = await import("../src/platform/db.mjs");
const holders = await import("../src/platform/holders.mjs");
const billing = await import("../src/platform/billing.mjs");

after(() => closeAll());

const HOLDER = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV";
const OTHER = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const EVM = "0xabc0000000000000000000000000000000000001";
const MINT_A = "MintA1111111111111111111111111111111111111";
const MINT_B = "MintB1111111111111111111111111111111111111";

const writeMints = (mints, extra = {}) => writeFileSync(process.env.GENESIS_MINTS_FILE, JSON.stringify({ mints, ...extra }));
const account = (mint, amount = "1", decimals = 0) => ({ account: { data: { parsed: { info: { mint, tokenAmount: { amount, decimals } } } } } });
const rpc = (result, error) => async () => ({ json: async () => (error ? { error } : { result }) });

test("walletGenesisCount: counts only whole genesis NFTs, ignores other tokens and non-Solana wallets", async () => {
  writeMints([MINT_A, MINT_B]);
  const fetchImpl = rpc({ value: [account(MINT_A), account(MINT_B), account("Other"), account(MINT_A, "2"), account(MINT_B, "1", 6)] });
  assert.equal(await holders.walletGenesisCount(HOLDER, { fetchImpl }), 2);
  assert.equal(await holders.walletGenesisCount(EVM, { fetchImpl }), 0);
});

test("walletGenesisCount: empty mint list makes no request; RPC errors fall through to 0", async () => {
  writeMints([]);
  const never = async () => { throw new Error("no request expected"); };
  assert.equal(await holders.walletGenesisCount(HOLDER, { fetchImpl: never }), 0);
  writeMints([MINT_A]);
  assert.equal(await holders.walletGenesisCount(HOLDER, { fetchImpl: rpc(null, { code: -1 }) }), 0);
  assert.equal(await holders.walletGenesisCount(HOLDER, { fetchImpl: async () => { throw new Error("offline"); } }), 0);
});

test("walletGenesisCount: a failing RPC is skipped, the next one answers", async () => {
  writeMints([MINT_A]);
  process.env.SOLANA_RPC_FALLBACKS = "https://rpc2.test";
  try {
    const urls = [];
    const fetchImpl = async (url) => {
      urls.push(url);
      if (url === "https://rpc.test") throw new Error("down");
      return { json: async () => ({ result: { value: [account(MINT_A)] } }) };
    };
    assert.equal(await holders.walletGenesisCount(HOLDER, { fetchImpl }), 1);
    assert.deepEqual(urls.slice(0, 2), ["https://rpc.test", "https://rpc2.test"]);
  } finally {
    process.env.SOLANA_RPC_FALLBACKS = "";
  }
});

test("bonusAmount: first NFT, extras, cap", () => {
  assert.deepEqual([0, 1, 2, 3, 10].map(holders.bonusAmount), [0, 50, 75, 100, 150]);
});

test("eligibility: holder, non-holder, EVM and excluded team wallet", async () => {
  writeMints([MINT_A]);
  const db = openDb();
  const hold = await holders.eligibility(HOLDER, { db, fetchImpl: rpc({ value: [account(MINT_A)] }) });
  assert.deepEqual([hold.holds, hold.count, hold.already, hold.claimable_credits], [true, 1, false, 50]);
  const none = await holders.eligibility(OTHER, { db, fetchImpl: rpc({ value: [] }) });
  assert.deepEqual([none.holds, none.claimable_credits], [false, 0]);
  assert.equal((await holders.eligibility(EVM, { db })).is_solana, false);
  process.env.GENESIS_BONUS_EXCLUDE_WALLETS = OTHER;
  try {
    assert.equal((await holders.eligibility(OTHER, { db })).excluded, true);
  } finally {
    delete process.env.GENESIS_BONUS_EXCLUDE_WALLETS;
  }
});

test("claim: grants once, then 'already'; refusals for non-holder, EVM, excluded and budget", async () => {
  writeMints([MINT_A, MINT_B]);
  const db = openDb();
  const two = rpc({ value: [account(MINT_A), account(MINT_B)] });
  const first = await holders.claim(HOLDER, { db, fetchImpl: two });
  assert.deepEqual([first.granted, first.credits, first.count], [true, 75, 2]);
  assert.equal(billing.getBalance(HOLDER), first.balance);
  const again = await holders.claim(HOLDER, { db, fetchImpl: two });
  assert.deepEqual([again.granted, again.reason], [false, "already"]);
  assert.equal((await holders.eligibility(HOLDER, { db, fetchImpl: two })).claimable_credits, 0);

  assert.equal((await holders.claim(OTHER, { db, fetchImpl: rpc({ value: [] }) })).reason, "not_holder");
  assert.equal((await holders.claim(EVM, { db })).reason, "not_solana");

  process.env.GENESIS_BONUS_EXCLUDE_WALLETS = OTHER;
  try {
    assert.equal((await holders.claim(OTHER, { db })).reason, "team_excluded");
  } finally {
    delete process.env.GENESIS_BONUS_EXCLUDE_WALLETS;
  }

  process.env.GENESIS_BONUS_BUDGET = "10";
  try {
    const third = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
    assert.equal((await holders.claim(third, { db, fetchImpl: two })).reason, "budget_exhausted");
  } finally {
    delete process.env.GENESIS_BONUS_BUDGET;
  }
});

test("syncGenesisMints: collects new mints, skips the collection mint and failed transactions, remembers the last signature", async () => {
  writeFileSync(process.env.GENESIS_MINTS_FILE, JSON.stringify({ mints: [MINT_A] }));
  const txs = {
    sigNew: { meta: { postTokenBalances: [
      { mint: MINT_B, uiTokenAmount: { decimals: 0, amount: "1" } },
      { mint: process.env.GENESIS_COLLECTION_MINT, uiTokenAmount: { decimals: 0, amount: "1" } },
      { mint: MINT_A, uiTokenAmount: { decimals: 0, amount: "1" } },
      { mint: "Fungible", uiTokenAmount: { decimals: 6, amount: "1000" } },
    ] } },
  };
  const fetchImpl = async (url, init) => {
    const { method, params } = JSON.parse(init.body);
    if (method === "getSignaturesForAddress") {
      return { json: async () => ({ result: [{ signature: "sigNew", err: null }, { signature: "sigFailed", err: {} }] }) };
    }
    return { json: async () => ({ result: txs[params[0]] }) };
  };
  const r = await holders.syncGenesisMints({ fetchImpl, rpcUrl: "https://rpc.test" });
  assert.deepEqual([r.success, r.scanned_transactions, r.new_mints_count, r.total_mints_count], [true, 1, 1, 2]);
  const doc = JSON.parse(readFileSync(process.env.GENESIS_MINTS_FILE, "utf8"));
  assert.deepEqual(doc.mints, [MINT_A, MINT_B].sort());
  assert.equal(doc.lastSignature, "sigNew");
  assert.equal(holders.genesisMintSet().has(MINT_B), true, "cache is refreshed after a sync");
});

test("syncGenesisMints: nothing new and RPC failure", async () => {
  const empty = async () => ({ json: async () => ({ result: [] }) });
  assert.deepEqual(await holders.syncGenesisMints({ fetchImpl: empty, rpcUrl: "https://rpc.test" }), { success: true, new_mints_count: 0 });
  const down = async () => { throw new Error("offline"); };
  const r = await holders.syncGenesisMints({ fetchImpl: down, rpcUrl: "https://rpc.test" });
  assert.equal(r.success, false);
  assert.match(r.error, /getSignaturesForAddress/);
});
