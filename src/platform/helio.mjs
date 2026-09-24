/**
 * Helio Pay (USDC on Base): paylinks, webhook payload → credits, polling reconcile.
 * Port of the Helio part of Промт `services/payment_service.py` and the signature
 * check in `api_server._verify_helio_signature`.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { PACKAGES, normalizeWallet, recordPayment } from "./billing.mjs";

export const HELIO_PAY_BASE = "https://app.hel.io/pay/";
export const HELIO_TX_URL = "https://api.hel.io/v1/export/payments";
const PAYLINK_ENV = { start: "HELIO_PAYLINK_START", creator: "HELIO_PAYLINK_CREATOR", pro: "HELIO_PAYLINK_PRO" };
const SUCCESS = new Set(["SUCCESS", "PAID", "COMPLETED", "CONFIRMED", "SETTLED"]);
const HEX = /^[0-9a-f]+$/;

/** Trim, lowercase hex, fix the common "T" for "0" typo in .env. */
export function sanitizePaylinkId(raw) {
  // Mirrors Промт exactly: only lowercase-hex results are accepted at each step.
  const s = String(raw || "").trim();
  if (!s) return "";
  if (HEX.test(s)) return s.toLowerCase();
  let fixed = s.replace(/T0/gi, "0");
  if (HEX.test(fixed)) return fixed.toLowerCase();
  fixed = s.replace(/(?<=[0-9a-fA-F])T(?=[0-9a-fA-F])/g, "0");
  if (HEX.test(fixed)) return fixed.toLowerCase();
  return s;
}

export const paylinkIdValid = (id) => !!id && HEX.test(id);

export function helioPaylinkUrl(packageId, env = process.env) {
  const id = sanitizePaylinkId(env[PAYLINK_ENV[packageId]] || "");
  return id && paylinkIdValid(id) ? `${HELIO_PAY_BASE}${id}` : null;
}

export function paylinkToPackageMap(env = process.env) {
  const out = {};
  for (const [pkg, name] of Object.entries(PAYLINK_ENV)) {
    const raw = String(env[name] || "").trim();
    if (!raw) continue;
    out[raw] = pkg;
    const cleaned = sanitizePaylinkId(raw);
    if (cleaned && cleaned !== raw) out[cleaned] = pkg;
  }
  return out;
}

export function packageForPaylink(paylinkId, env = process.env) {
  const pid = String(paylinkId || "").trim();
  if (!pid) return null;
  const m = paylinkToPackageMap(env);
  return m[pid] || m[sanitizePaylinkId(pid)] || null;
}

/** Tolerant parser: [{tx_id, wallet, paylink}] for successful payments only. */
export function extractPayments(raw) {
  const out = [];
  for (const item of raw || []) {
    if (!item || typeof item !== "object") continue;
    const meta = item.meta && typeof item.meta === "object" ? item.meta : {};
    const status = String(item.transactionStatus || item.status || item.paymentStatus || item.state || meta.transactionStatus || meta.status || "").trim().toUpperCase();
    if (!SUCCESS.has(status)) continue;
    const txId = String(item.id || item.transactionId || item.transaction || meta.id || "");
    const wallet = String(item.senderPublicKey || item.from || meta.senderPK || "");
    const paylink = String(item.paymentRequestId || item.paylinkId || item.paylink || meta.paylinkId || "").trim();
    if (txId && wallet) out.push({ tx_id: txId, wallet, paylink });
  }
  return out;
}

/** HMAC-SHA256(raw body) hex compare. Throws when HELIO_WEBHOOK_SECRET is unset (→ 503). */
export function verifyHelioSignature(body, signature, secret = process.env.HELIO_WEBHOOK_SECRET) {
  const s = String(secret || "").trim();
  if (!s) {
    const err = new Error("HELIO_WEBHOOK_SECRET not configured — webhook вимкнено, зарахування лише через polling");
    err.status = 503;
    throw err;
  }
  if (!signature) return false;
  const expected = Buffer.from(createHmac("sha256", s).update(body).digest("hex"));
  const got = Buffer.from(String(signature).trim());
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/** One webhook event → { credited, message }. */
export function processHelioWebhookPayload(payload, { env = process.env, ...deps } = {}) {
  if (!payload || typeof payload !== "object") return { credited: false, message: "Invalid payload" };
  const paylinkId = String(payload.paylinkId || payload.paylink || payload.meta?.paylinkId || "");
  const pkgId = packageForPaylink(paylinkId, env);
  if (!pkgId) return { credited: false, message: `Unknown paylink: ${paylinkId || "(empty)"}` };
  const pkg = PACKAGES[pkgId];
  let any = false;
  for (const p of extractPayments([payload])) {
    let wallet;
    try { wallet = normalizeWallet(p.wallet); } catch { continue; }
    if (recordPayment(p.tx_id, wallet, pkg.credits, pkg.usd, deps)) any = true;
  }
  return any
    ? { credited: true, message: `Credited ${pkg.credits} credits (${pkgId})` }
    : { credited: false, message: "Already processed or no wallet in payload" };
}

export const helioKeys = (env = process.env) =>
  env.HELIO_API_KEY && env.HELIO_API_SECRET ? { apiKey: env.HELIO_API_KEY, secret: env.HELIO_API_SECRET } : null;

async function fetchHelioPayments(paylinkId, { apiKey, secret }, fetchImpl = fetch) {
  const url = `${HELIO_TX_URL}?${new URLSearchParams({ paylinkId, apiKey })}`;
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Helio HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : data.payments || [];
}

/**
 * Polls every configured paylink and credits new payments (idempotent).
 * Never throws — returns { newTx, credited, error? } for the background loop.
 */
export async function reconcilePayments({ env = process.env, fetchImpl, targetWallet, ...deps } = {}) {
  const keys = helioKeys(env);
  if (!keys) return { newTx: 0, credited: 0, error: "HELIO_API_KEY / HELIO_API_SECRET not set" };
  let newTx = 0;
  let credited = 0;
  try {
    const target = targetWallet ? normalizeWallet(targetWallet) : null;
    for (const [pkgId, name] of Object.entries(PAYLINK_ENV)) {
      const raw = String(env[name] || "");
      const id = sanitizePaylinkId(raw);
      if (!id) continue;
      const pkg = PACKAGES[pkgId];
      for (const p of extractPayments(await fetchHelioPayments(raw, keys, fetchImpl))) {
        // The export endpoint returns ALL payments regardless of paylinkId — match explicitly.
        if (p.paylink && p.paylink !== id && p.paylink !== raw.trim()) continue;
        let wallet;
        try { wallet = normalizeWallet(p.wallet); } catch { continue; }
        if (target && wallet !== target) continue;
        if (recordPayment(p.tx_id, wallet, pkg.credits, pkg.usd, deps)) {
          newTx += 1;
          credited += pkg.credits;
        }
      }
    }
    return { newTx, credited };
  } catch (e) {
    return { newTx, credited, error: String(e.message || e) };
  }
}
