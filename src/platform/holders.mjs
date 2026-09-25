/**
 * Genesis NFT holders: on-chain ownership count, holder bonus, mint-list sync.
 * Port of Промт `services/holder_rewards.py`. Mint list: `<data>/genesis_mints.json`
 * (same file format — copy Промт's file on migration).
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { grantCredits, normalizeWallet } from "./billing.mjs";
import { isConstraintError, nowIso, openDb } from "./db.mjs";
import { isSolanaWallet, SOLANA_RPC_DEFAULT, resolveSolanaRpcUrl, solanaRpcHeaders } from "./wallet.mjs";

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const CANDY_MACHINE = "BpHBqJAVeSRuEjyeEyuTkjUL9ocarY63rHBzyEVwmGrM";
const DEFAULT_EXCLUDE = [
  "DE1gBEaqA11uYdySmF5LRmN8QsvXvnYJYHDVXeAY15Vh",
  "63u6SDZckvzcJhC4V5yJn6bZ15qx1iM8c6iB3Z9xD1tn",
  "1BWutmTvYPwDtmw9abTkS4Ssr8no61spGAvW1X6NDix",
];

const cfg = () => ({
  collectionMint: process.env.GENESIS_COLLECTION_MINT || "6YRxC2pwqttw11zy4v2cGgV3DztpPX7zSHrFFcA4nmqC",
  bonusCredits: Number(process.env.GENESIS_BONUS_CREDITS || 50),
  bonusPerExtra: Number(process.env.GENESIS_BONUS_PER_EXTRA || 25),
  bonusMax: Number(process.env.GENESIS_BONUS_MAX || 150),
  period: String(process.env.GENESIS_BONUS_PERIOD || "once").trim().toLowerCase(),
  budget: Number(process.env.GENESIS_BONUS_BUDGET || 5000),
  rpcOrigin: String(process.env.GENESIS_RPC_ORIGIN ?? "https://mint.w3ir.io").trim(),
  timeoutMs: Number(process.env.SOLANA_RPC_TIMEOUT || 10) * 1000,
});

export const mintsFile = () =>
  process.env.GENESIS_MINTS_FILE || resolve(process.env.SERIES_DATA_DIR || "data", "genesis_mints.json");

function rpcUrls() {
  const primary = resolveSolanaRpcUrl();
  const list = [primary, ...String(process.env.SOLANA_RPC_FALLBACKS || "").split(",").map((s) => s.trim()), SOLANA_RPC_DEFAULT];
  return [...new Set(list.filter(Boolean))];
}

const rpcHeaders = (url) => solanaRpcHeaders(url);

async function rpcCall(url, method, params, fetchImpl = fetch) {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: rpcHeaders(url),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(cfg().timeoutMs),
  });
  return res.json();
}

let mintsCache = null;
export function genesisMintSet() {
  const file = mintsFile();
  let mtime;
  try { mtime = statSync(file).mtimeMs; } catch { return new Set(); }
  if (mintsCache?.mtime === mtime) return mintsCache.set;
  let set;
  try { set = new Set(JSON.parse(readFileSync(file, "utf8")).mints || []); } catch { set = new Set(); }
  mintsCache = { mtime, set };
  return set;
}

/** Genesis NFTs `wallet` holds now. First RPC that answers without error wins; all fail → 0. */
export async function walletGenesisCount(wallet, { fetchImpl } = {}) {
  if (!isSolanaWallet(wallet)) return 0;
  const mints = genesisMintSet();
  if (!mints.size) return 0;
  for (const url of rpcUrls()) {
    let data;
    try {
      data = await rpcCall(url, "getTokenAccountsByOwner", [wallet, { programId: TOKEN_PROGRAM }, { encoding: "jsonParsed" }], fetchImpl);
    } catch {
      continue;
    }
    if (data?.error) continue;
    let owned = 0;
    for (const r of data?.result?.value || []) {
      const info = r?.account?.data?.parsed?.info;
      const amt = info?.tokenAmount;
      if (amt && amt.decimals === 0 && amt.amount === "1" && mints.has(info.mint)) owned += 1;
    }
    return owned;
  }
  return 0;
}

export const currentPeriod = () => (cfg().period === "monthly" ? new Date().toISOString().slice(0, 7) : "once");

export function bonusAmount(count) {
  const c = cfg();
  return count < 1 ? 0 : Math.min(c.bonusMax, c.bonusCredits + (count - 1) * c.bonusPerExtra);
}

function excluded(wallet) {
  const raw = String(process.env.GENESIS_BONUS_EXCLUDE_WALLETS || "").trim();
  const list = raw ? raw.split(",").map((w) => w.trim()).filter(Boolean) : DEFAULT_EXCLUDE;
  return list.some((w) => { try { return normalizeWallet(w) === wallet; } catch { return w === wallet; } });
}

export async function eligibility(wallet, { db = openDb(), fetchImpl } = {}) {
  const w = normalizeWallet(wallet);
  const period = currentPeriod();
  if (excluded(w)) return { is_solana: isSolanaWallet(w), holds: false, count: 0, period, already: false, claimable_credits: 0, excluded: true };
  if (!isSolanaWallet(w)) return { is_solana: false, holds: false, count: 0, period, already: false, claimable_credits: 0, excluded: false };
  const count = await walletGenesisCount(w, { fetchImpl });
  const already = !!db.prepare("SELECT 1 FROM holder_grants WHERE wallet_address = ? AND period = ?").get(w, period);
  return { is_solana: true, holds: count > 0, count, period, already, claimable_credits: already || count < 1 ? 0 : bonusAmount(count), excluded: false };
}

/** Verify holding → reserve (PK) → grant; reservation rolled back if the grant fails. */
export async function claim(wallet, { db = openDb(), fetchImpl } = {}) {
  const w = normalizeWallet(wallet);
  const period = currentPeriod();
  if (excluded(w)) return { granted: false, reason: "team_excluded", period };
  if (!isSolanaWallet(w)) return { granted: false, reason: "not_solana", period };
  const count = await walletGenesisCount(w, { fetchImpl });
  if (count < 1) return { granted: false, reason: "not_holder", period };
  const credits = bonusAmount(count);
  const total = Number(db.prepare("SELECT COALESCE(SUM(credits), 0) AS n FROM holder_grants").get().n);
  if (total + credits > cfg().budget) return { granted: false, reason: "budget_exhausted", period };
  try {
    db.prepare("INSERT INTO holder_grants (wallet_address, period, nft_count, credits, granted_at) VALUES (?, ?, ?, ?, ?)").run(w, period, count, credits, nowIso());
  } catch (e) {
    if (isConstraintError(e)) return { granted: false, reason: "already", period, count };
    throw e;
  }
  try {
    const balance = grantCredits(w, credits, { note: `Genesis holder bonus ${period} (${count} NFT)`, db });
    return { granted: true, credits, count, period, balance };
  } catch (e) {
    db.prepare("DELETE FROM holder_grants WHERE wallet_address = ? AND period = ?").run(w, period);
    throw e;
  }
}

/** Incremental scan of Candy Machine transactions → updates genesis_mints.json. */
export async function syncGenesisMints({ fetchImpl, rpcUrl } = {}) {
  const url = rpcUrl || rpcUrls()[0];
  const file = mintsFile();
  let mints = new Set();
  let lastSig = null;
  if (existsSync(file)) {
    try {
      const doc = JSON.parse(readFileSync(file, "utf8"));
      mints = new Set(doc.mints || []);
      lastSig = doc.lastSignature || null;
    } catch { /* start fresh */ }
  }
  let sigs;
  try {
    const data = await rpcCall(url, "getSignaturesForAddress", [CANDY_MACHINE, { limit: 100, ...(lastSig ? { until: lastSig } : {}) }], fetchImpl);
    sigs = data.result || [];
  } catch (e) {
    return { success: false, error: `getSignaturesForAddress: ${e.message}` };
  }
  if (!sigs.length) return { success: true, new_mints_count: 0 };
  const newest = sigs.find((s) => !s.err)?.signature || null;
  const found = new Set();
  let scanned = 0;
  const { collectionMint } = cfg();
  for (const item of [...sigs].reverse()) {
    if (item.err) continue;
    scanned += 1;
    try {
      const txData = (await rpcCall(url, "getTransaction", [item.signature, { maxSupportedTransactionVersion: 0, encoding: "jsonParsed" }], fetchImpl)).result;
      for (const b of txData?.meta?.postTokenBalances || []) {
        const amt = b.uiTokenAmount || {};
        if (amt.decimals === 0 && amt.amount === "1" && b.mint !== collectionMint && !mints.has(b.mint)) found.add(b.mint);
      }
    } catch { /* retry next cycle */ }
  }
  for (const m of found) mints.add(m);
  const doc = {
    collection: collectionMint,
    candyMachine: CANDY_MACHINE,
    generatedAt: `${nowIso()}Z`,
    count: mints.size,
    mints: [...mints].sort(),
    ...(newest || lastSig ? { lastSignature: newest || lastSig } : {}),
  };
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(doc, null, 2), "utf8");
  } catch (e) {
    return { success: false, error: `write file: ${e.message}` };
  }
  mintsCache = null;
  return { success: true, scanned_transactions: scanned, new_mints_count: found.size, total_mints_count: mints.size };
}
