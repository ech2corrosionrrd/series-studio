/**
 * Wallet addresses, EIP-4361 (SIWE) sign-in messages and signature verification.
 * Message texts are fixed: the login page signs exactly what the server rebuilds.
 */
import { createPublicKey, randomBytes, verify as cryptoVerify } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B58_INDEX = new Map([...B58].map((c, i) => [c, i]));

export const BASE_RPC_DEFAULT = "https://mainnet.base.org";
export const SOLANA_RPC_DEFAULT = "https://api.mainnet-beta.solana.com";
export const MIN_WELCOME_BALANCE_WEI = 200_000_000_000_000n; // 0.0002 ETH
export const MIN_WELCOME_BALANCE_LAMPORTS = 3_000_000n; // 0.003 SOL

/**
 * Solana JSON-RPC URL for payments, holders, vault, balance checks.
 * Order: SOLANA_PAY_RPC_URL (only if opts.pay) → SOLANA_RPC_URL → Alchemy key → fallback → public.
 */
export function resolveSolanaRpcUrl(env = process.env, { pay = false } = {}) {
  if (pay) {
    const payUrl = String(env.SOLANA_PAY_RPC_URL || "").trim();
    if (payUrl) return payUrl;
  }
  const explicit = String(env.SOLANA_RPC_URL || "").trim();
  if (explicit) return explicit;
  const alchemy = String(env.ALCHEMY_API_KEY || env.VITE_ALCHEMY_API_KEY || "").trim();
  if (alchemy) return `https://solana-mainnet.g.alchemy.com/v2/${alchemy}`;
  const fallback = String(env.SOLANA_RPC_FALLBACK || "").trim();
  if (fallback) return fallback;
  return SOLANA_RPC_DEFAULT;
}

/** Headers for Solana JSON-RPC (Alchemy often requires a whitelisted Origin). */
export function solanaRpcHeaders(url, env = process.env) {
  const headers = { "Content-Type": "application/json" };
  if (String(url || "").includes("alchemy.com")) {
    // Whitelist in Alchemy dashboard currently includes mint.w3ir.io (mint site).
    const origin = String(env.GENESIS_RPC_ORIGIN || "https://mint.w3ir.io").trim();
    if (origin) headers.Origin = origin;
  }
  return headers;
}

export function b58decode(s) {
  let num = 0n;
  for (const ch of s) {
    const idx = B58_INDEX.get(ch);
    if (idx === undefined) throw new Error(`invalid base58 character: ${ch}`);
    num = num * 58n + BigInt(idx);
  }
  const bytes = [];
  while (num > 0n) {
    bytes.unshift(Number(num & 0xffn));
    num >>= 8n;
  }
  const pad = s.length - s.replace(/^1+/, "").length;
  return Uint8Array.from([...new Array(pad).fill(0), ...bytes]);
}

export function isEvmWallet(w) {
  return typeof w === "string" && w.startsWith("0x") && w.length === 42;
}

export function isSolanaWallet(w) {
  const s = String(w || "").trim();
  if (!s || isEvmWallet(s)) return false;
  try {
    return b58decode(s).length === 32;
  } catch {
    return false;
  }
}

/** EVM → lowercase; Solana base58 as is (case-sensitive). = auth_gateway.normalize_addr */
export function normalizeAddr(address) {
  const a = String(address || "").trim();
  return a.startsWith("0x") ? a.toLowerCase() : a;
}

export function shortWallet(w) {
  const s = String(w || "").trim();
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}

export const newNonce = () => randomBytes(16).toString("hex");

const utcStamp = (d = new Date()) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

export const SIWE_STATEMENT =
  "Sign in to Series Lab. This request will not trigger an on-chain transaction or cost gas.";

/** EIP-4361 message. */
export function buildSiweMessage(address, nonce, { domain, uri, chainId, issuedAt } = {}) {
  domain ??= process.env.AUTH_DOMAIN || "localhost";
  uri ??= process.env.AUTH_URI || `http://${domain}`;
  chainId ??= Number(process.env.AUTH_CHAIN_ID || 8453);
  const issued = issuedAt || utcStamp();
  return (
    `${domain} wants you to sign in with your Ethereum account:\n` +
    `${address}\n\n` +
    `${SIWE_STATEMENT}\n\n` +
    `URI: ${uri}\n` +
    `Version: 1\n` +
    `Chain ID: ${chainId}\n` +
    `Nonce: ${nonce}\n` +
    `Issued At: ${issued}`
  );
}

/** Phantom sign-in message. */
export function buildSolanaMessage(wallet, nonce, issuedAt) {
  return `Series Lab — Sign-In\nWallet: ${wallet}\nNonce: ${nonce}\nIssued: ${issuedAt || utcStamp()}`;
}

const hexToBytes = (hex) => Uint8Array.from(Buffer.from(hex, "hex"));

/** personal_sign (EIP-191) verification: recover the signer and compare. */
export function verifyEvmSignature(wallet, message, signature) {
  let sig = String(signature || "").trim();
  if (!sig.startsWith("0x")) sig = `0x${sig}`;
  if (sig.length !== 132 || !/^[0-9a-fA-F]+$/.test(sig.slice(2))) return false;
  try {
    const raw = hexToBytes(sig.slice(2));
    let v = raw[64];
    if (v >= 27) v -= 27;
    if (v !== 0 && v !== 1) return false;
    // noble "recovered" format = [recovery, r(32), s(32)]; Ethereum = [r, s, v].
    const recoveredSig = new Uint8Array(65);
    recoveredSig[0] = v;
    recoveredSig.set(raw.subarray(0, 64), 1);
    const msg = Buffer.from(message, "utf8");
    const prefixed = Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${msg.length}`, "utf8"), msg]);
    const hash = keccak_256(prefixed);
    const pub = secp256k1.recoverPublicKey(recoveredSig, hash, { prehash: false });
    const uncompressed = secp256k1.Point.fromBytes(pub).toBytes(false);
    const addr = Buffer.from(keccak_256(uncompressed.subarray(1)).subarray(-20)).toString("hex");
    return `0x${addr}` === String(wallet).toLowerCase();
  } catch {
    return false;
  }
}

function decodeSolanaSignature(signature) {
  let sig = String(signature || "").trim();
  if (!sig) return null;
  if (sig.startsWith("0x")) sig = sig.slice(2);
  try {
    if (sig.length === 128 && /^[0-9a-fA-F]+$/.test(sig)) return hexToBytes(sig);
    return b58decode(sig);
  } catch {
    return null;
  }
}

/** ed25519 verification of a Phantom signMessage signature (hex or base58). */
export function verifySolanaSignature(wallet, message, signature) {
  let pub;
  try {
    pub = b58decode(String(wallet || "").trim());
  } catch {
    return false;
  }
  if (pub.length !== 32) return false;
  const sig = decodeSolanaSignature(signature);
  if (!sig || sig.length !== 64) return false;
  try {
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(pub).toString("base64url") }, format: "jwk" });
    return cryptoVerify(null, Buffer.from(message, "utf8"), key, sig);
  } catch {
    return false;
  }
}

async function rpc(url, method, params, timeoutMs = 15_000) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return res.json();
}

/** Native Base balance in wei; any error → 0n (fail-closed). `welcomeBalanceOk` tells an empty wallet from a failed lookup via `strict`. */
export async function ethBalanceWei(wallet, { fetchImpl, strict = false } = {}) {
  try {
    const url = process.env.BASE_RPC_URL || BASE_RPC_DEFAULT;
    const data = fetchImpl ? await fetchImpl(url, "eth_getBalance", [wallet, "latest"]) : await rpc(url, "eth_getBalance", [wallet, "latest"]);
    return BigInt(data.result);
  } catch (e) {
    if (strict) throw e;
    return 0n;
  }
}

/** Native SOL balance in lamports; any error → 0n (fail-closed). */
export async function solBalanceLamports(wallet, { fetchImpl, strict = false } = {}) {
  try {
    const url = resolveSolanaRpcUrl();
    const data = fetchImpl ? await fetchImpl(url, "getBalance", [wallet]) : await rpc(url, "getBalance", [wallet]);
    return BigInt(data.result.value);
  } catch (e) {
    if (strict) throw e;
    return 0n;
  }
}

export const welcomeBalanceRequired = () => process.env.WELCOME_REQUIRE_BALANCE !== "0";

/** Sybil guard for welcome credits: non-empty native balance. → {ok, message}. */
export async function welcomeBalanceOk(wallet, deps = {}) {
  if (!welcomeBalanceRequired()) return { ok: true, message: "" };
  // A failed lookup (RPC down, timeout) is not an empty wallet: it is reported as `unknown`, so the funnel does not count it as a refusal
  // and the next sign-in tries again.
  const unknown = { ok: false, unknown: true, message: "The wallet balance could not be checked; sign in again in a minute." };
  if (isEvmWallet(wallet)) {
    let bal;
    try {
      bal = await ethBalanceWei(wallet, { ...deps, strict: true });
    } catch {
      return unknown;
    }
    if (bal >= MIN_WELCOME_BALANCE_WEI) return { ok: true, message: "" };
    return {
      ok: false,
      message: `Для вітальних кредитів потрібен мінімальний баланс ETH на Base (≈0.0002 ETH). Поточний: ${(Number(bal) / 1e18).toFixed(6)} ETH.`,
    };
  }
  if (isSolanaWallet(wallet)) {
    let bal;
    try {
      bal = await solBalanceLamports(wallet, { ...deps, strict: true });
    } catch {
      return unknown;
    }
    if (bal >= MIN_WELCOME_BALANCE_LAMPORTS) return { ok: true, message: "" };
    return {
      ok: false,
      message: `Для вітальних кредитів потрібен мінімальний баланс SOL (≈0.003 SOL). Поточний: ${(Number(bal) / 1e9).toFixed(6)} SOL.`,
    };
  }
  return { ok: true, message: "" };
}
