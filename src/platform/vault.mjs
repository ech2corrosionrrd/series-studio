/**
 * Drop #2 vault: catalog index → mint, guards before a transfer, and the
 * fulfillment runner that calls Sugar's `scripts/transfer-nft.mjs`.
 * Fail-closed everywhere: a doubtful catalog or RPC answer means NO transfer.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { markFulfillment, pendingFulfillments } from "./billing.mjs";
import { resolveSolanaRpcUrl, solanaRpcHeaders } from "./wallet.mjs";

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const PROTOCOL_ENV = ["VAULT_WALLET_ADDRESS", "GENESIS_COLLECTION_MINT", "GENESIS_CANDY_MACHINE", "GENESIS_CANDY_GUARD", "GENESIS_TREASURY_WALLET", "GENESIS_DEPLOYER_WALLET", "SOLANA_TREASURY_ADDRESS"];
const BUILTIN_PROTOCOL = [
  "6YRxC2pwqttw11zy4v2cGgV3DztpPX7zSHrFFcA4nmqC",
  "BpHBqJAVeSRuEjyeEyuTkjUL9ocarY63rHBzyEVwmGrM",
  "ZnP8QYCD3yD7n3sCNLu1FrjG7operQ1tTK8z6pGKUNj",
  "63u6SDZckvzcJhC4V5yJn6bZ15qx1iM8c6iB3Z9xD1tn",
  "DE1gBEaqA11uYdySmF5LRmN8QsvXvnYJYHDVXeAY15Vh",
];

export class VaultError extends Error {}

export function protocolAddresses() {
  const out = new Set(BUILTIN_PROTOCOL);
  for (const n of PROTOCOL_ENV) if (String(process.env[n] || "").trim()) out.add(String(process.env[n]).trim());
  for (const a of String(process.env.VAULT_MINT_DENYLIST || "").split(",")) if (a.trim()) out.add(a.trim());
  return out;
}

export const vaultCatalogPath = () =>
  String(process.env.VAULT_CATALOG_PATH || "").trim() || resolve(process.env.SERIES_DATA_DIR || "data", "vault_catalog.json");

export function loadCatalog(path = vaultCatalogPath()) {
  if (!existsSync(path)) throw new VaultError(`vault catalog not found: ${path}`);
  let raw;
  try { raw = JSON.parse(readFileSync(path, "utf8")); } catch (e) { throw new VaultError(`vault catalog unreadable: ${e.message}`); }
  if (!Array.isArray(raw)) throw new VaultError("vault catalog must be a JSON array");
  const denied = protocolAddresses();
  const seenIdx = new Set();
  const seenMint = new Set();
  return raw.map((item, pos) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new VaultError(`catalog entry #${pos} is not an object`);
    const { index, mint } = item;
    if (!Number.isInteger(index) || index < 0) throw new VaultError(`catalog entry #${pos}: index must be a non-negative int`);
    if (typeof mint !== "string" || !BASE58_RE.test(mint)) throw new VaultError(`catalog entry #${pos}: mint is not a base58 Solana address`);
    if (seenIdx.has(index)) throw new VaultError(`catalog has duplicate index ${index}`);
    if (seenMint.has(mint)) throw new VaultError(`catalog has duplicate mint ${mint}`);
    if (denied.has(mint)) throw new VaultError(`catalog entry #${index} points at a protocol address (${mint}) — refusing to treat it as an item`);
    seenIdx.add(index);
    seenMint.add(mint);
    return { index, mint };
  });
}

export function resolveMint(catalog, index) {
  const hit = catalog.find((i) => i.index === index);
  if (!hit) throw new VaultError(`index ${index} is not in the vault catalog`);
  return hit.mint;
}

export function vaultRpcUrl(env = process.env) {
  return resolveSolanaRpcUrl(env);
}

/** Drop #2 vault is dormant until VAULT_WALLET_ADDRESS (+ catalog) are set. */
export function vaultConfigured(env = process.env) {
  return Boolean(String(env.VAULT_WALLET_ADDRESS || "").trim());
}

/** Mints currently held by the vault (balance ≥ 1). Not cached on purpose. */
export async function vaultTokenMints(rpcUrl, vaultAddress, { fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  let res;
  try {
    res = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: solanaRpcHeaders(rpcUrl),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner", params: [vaultAddress, { programId: TOKEN_PROGRAM }, { encoding: "jsonParsed" }] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new VaultError(`vault RPC request failed: ${e.message}`);
  }
  if (res.status !== 200) throw new VaultError(`vault RPC returned HTTP ${res.status}`);
  const data = await res.json();
  // Fail-closed: only a bare list is accepted. NOTE: the
  // standard getTokenAccountsByOwner answer is {context, value: [...]}, so this
  // check would reject every real RPC reply (latent: the vault is not configured in
  // production as of 2026-09-24) — see docs/DEPLOY-PLATFORM.md.
  // Accepting `result.value` here would silently ENABLE vault transfers; that is
  // an owner decision, not something a port should change.
  const result = Array.isArray(data?.result) ? data.result : null;
  if (!result) throw new VaultError("vault RPC returned an unexpected payload");
  const mints = new Set();
  for (const acc of result) {
    try {
      const info = acc.account.data.parsed.info;
      if (Number.parseInt(info.tokenAmount.amount, 10) >= 1) mints.add(info.mint);
    } catch { /* skip foreign accounts */ }
  }
  return mints;
}

let running = 0;
const queue = [];
const MAX_PARALLEL = Math.max(1, Number(process.env.FULFILLMENT_MAX_CONCURRENCY || 4));

/** Runs Sugar transfer-nft.mjs for one reserved fulfillment; marks done/failed. */
export async function runFulfillment(txId, wallet, kind, detail, { log = console } = {}) {
  if (kind !== "transfer") {
    markFulfillment(txId, "failed");
    log.error?.(`NFT vault: unsupported fulfillment kind ${JSON.stringify(kind)} (transfer only)`);
    return;
  }
  if (running >= MAX_PARALLEL) await new Promise((r) => queue.push(r));
  running += 1;
  try {
    const sugarRoot = process.env.SUGAR_PROJECT_PATH || resolve("..", "Sugar");
    const code = await new Promise((done) => {
      const child = spawn(process.execPath, [join(sugarRoot, "scripts", "transfer-nft.mjs"), wallet, detail], { stdio: ["ignore", "pipe", "pipe"] });
      let err = "";
      child.stderr.on("data", (d) => { err += d; });
      child.on("error", (e) => { err += e.message; done(-1); });
      child.on("close", (c) => { if (c !== 0) log.error?.(`NFT vault transfer failed (rc=${c}) for ${wallet}\n${err}`); done(c); });
    });
    markFulfillment(txId, code === 0 ? "completed" : "failed");
  } catch (e) {
    markFulfillment(txId, "failed");
    log.error?.(`NFT vault transfer exception for ${wallet}: ${e.message}`);
  } finally {
    running -= 1;
    queue.shift()?.();
  }
}

/** Background retry of stale reserved/failed transfers . */
export async function reconcileFulfillments({ staleSeconds = Number(process.env.FULFILLMENT_STALE_SECONDS || 300), maxAttempts = Number(process.env.FULFILLMENT_MAX_ATTEMPTS || 5), log = console } = {}) {
  for (const row of pendingFulfillments(staleSeconds, maxAttempts)) {
    const autoRetry = row.status === "failed" || row.kind === "transfer" || process.env.FULFILLMENT_AUTORETRY_RESERVED_MINT === "1";
    if (!autoRetry) {
      log.warn?.(`Reconcile: stale reserved ${row.kind} ${row.tx_id} needs MANUAL review`);
      continue;
    }
    await runFulfillment(row.tx_id, row.wallet, row.kind, row.detail, { log });
  }
}
