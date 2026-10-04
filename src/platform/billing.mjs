/**
 * Credits ledger, welcome grant, payments and referrals.
 * Port of Промт `services/payment_service.py` (money path) over the same tables.
 *
 * Invariants kept from Промт:
 *  - every balance change is written together with a `transactions` row in ONE
 *    SQLite transaction;
 *  - a payment is credited exactly once (`payments.tx_id` PRIMARY KEY);
 *  - the welcome grant belongs to the first sign-in with a NON-EMPTY wallet and
 *    is idempotent through the ledger (`kind='welcome'` lookup);
 *  - spending requires a signature-verified wallet;
 *  - debit/refund notes are the exact strings Passport quests count on.
 */
import { createHmac } from "node:crypto";
import { isConstraintError, nowIso, openDb, tx } from "./db.mjs";
import { shortWallet, welcomeBalanceOk, MIN_WELCOME_BALANCE_LAMPORTS, MIN_WELCOME_BALANCE_WEI, welcomeBalanceRequired } from "./wallet.mjs";

export const DEBIT_NOTE = "image generation";
export const FAILURE_NOTE = "refund: generation failed";
export const WELCOME_NOTE = "Вітальні кредити";
export const EARLY_WELCOME_NOTE = "Вітальні кредити (перші користувачі)";

export const PACKAGES = {
  start: { label: "Старт", usd: 4.99, credits: 100, note: "Низький поріг входу — спробувати сервіс", recommended: false },
  creator: { label: "Креатор", usd: 14.99, credits: 400, note: "350 базових + 50 бонусних за обсяг", recommended: true },
  pro: { label: "Профі / Колекція", usd: 29.99, credits: 1000, note: "750 базових + 250 бонусних — для матричних дропів", recommended: false },
};

// ── Pricing ──────────────────────────────────────────────────────────────────
// Промт tariff by engine family: [draft, final, reference, reference+final].
const FAMILY_CREDITS = {
  openai: [4, 8, 6, 10],
  stability: [1, 2, 2, 3],
  flux: [1, 2, 2, 3],
};
const ENGINE_FAMILY = {
  openai: "openai",
  stability: "stability",
  kontext: "flux", fal: "flux", schnell: "flux", runware: "flux", pollinations: "flux",
};
const FREE_ENGINES = new Set(["mock"]);

/** Credits per ComfyUI/A1111 image — Lab support fee (GPU compute is free on user's PC). */
export function localGpuCreditCost(env = process.env) {
  const n = Number.parseInt(env.LOCAL_GPU_CREDIT_COST || "1", 10);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

/**
 * Credits for ONE image. Промт table, with a margin floor: at the cheapest pack
 * price ($0.03/credit) an image must still cover 1.5 × provider cost.
 * Override per engine with env ENGINE_CREDIT_COSTS='{"kontext":3}'.
 * Local GPU (comfyui/a1111): LOCAL_GPU_CREDIT_COST (default 1) — support fee for Lab.
 */
export function creditCost(engine, { reference = false, final = false, costUsd = 0 } = {}) {
  let overrides = {};
  try { overrides = JSON.parse(process.env.ENGINE_CREDIT_COSTS || "{}"); } catch { /* ignore */ }
  if (Number.isInteger(overrides[engine]) && overrides[engine] >= 0) return overrides[engine];
  if (FREE_ENGINES.has(engine)) return 0;
  if (engine === "comfyui" || engine === "a1111") return localGpuCreditCost();
  const row = FAMILY_CREDITS[ENGINE_FAMILY[engine] || "flux"];
  const base = row[(reference ? 2 : 0) + (final ? 1 : 0)];
  const floor = Math.ceil(Number(costUsd || 0) * 50 - 1e-9);
  return Math.max(base, floor, 1);
}

// ── Wallets ──────────────────────────────────────────────────────────────────
const B58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;

/** EVM 0x… → lowercase; Solana base58 as is. Throws on anything else. */
export function normalizeWallet(wallet) {
  const w = String(wallet || "").trim();
  if (w.startsWith("0x")) {
    if (w.length !== 42 || !/^[0-9a-fA-F]{40}$/.test(w.slice(2))) throw new Error("Некоректна EVM-адреса (очікується 0x + 40 hex-символів).");
    return w.toLowerCase();
  }
  if (w.length >= 32 && w.length <= 44 && B58_RE.test(w)) return w;
  throw new Error("Некоректна адреса гаманця.");
}

const envInt = (key, def) => {
  const n = Number.parseInt(process.env[key] || "", 10);
  return Number.isFinite(n) ? Math.max(0, n) : def;
};
export const welcomeCredits = () => envInt("WELCOME_CREDITS", 20);
export const earlyWelcomeCredits = () => envInt("EARLY_WELCOME_CREDITS", 20);
export const earlyWelcomeLimit = () => envInt("EARLY_WELCOME_LIMIT", 0);

function earlyWelcomeUsed(db) {
  return Number(db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE kind = 'welcome' AND note = ?").get(EARLY_WELCOME_NOTE).n);
}

function welcomeGrant(db) {
  const limit = earlyWelcomeLimit();
  const early = earlyWelcomeCredits();
  if (limit > 0 && early > 0 && earlyWelcomeUsed(db) < limit) return { amount: early, note: EARLY_WELCOME_NOTE };
  return { amount: welcomeCredits(), note: WELCOME_NOTE };
}

const hasWelcomeGrant = (db, wallet) =>
  !!db.prepare("SELECT 1 FROM transactions WHERE wallet_address = ? AND kind = 'welcome' LIMIT 1").get(wallet);

export function logTransaction(db, wallet, kind, credits, { engine = "", note = "" } = {}) {
  db.prepare("INSERT INTO transactions (wallet_address, kind, credits, engine, note, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(normalizeWallet(wallet), kind, credits, engine, note, nowIso());
}

/** What the NEXT new wallet gets — shown on the login page before signing. */
export function welcomeOffer(db = openDb()) {
  const limit = earlyWelcomeLimit();
  const early = earlyWelcomeCredits();
  const used = limit > 0 ? earlyWelcomeUsed(db) : 0;
  const remaining = limit > 0 ? Math.max(0, limit - used) : 0;
  const isEarly = remaining > 0 && early > 0;
  return {
    credits: isEarly ? early : welcomeCredits(),
    base_credits: welcomeCredits(),
    early_credits: early,
    is_early: isEarly,
    early_limit: limit,
    early_remaining: remaining,
    requires_balance: welcomeBalanceRequired(),
    min_sol: Number(MIN_WELCOME_BALANCE_LAMPORTS) / 1e9,
    min_eth: Number(MIN_WELCOME_BALANCE_WEI) / 1e18,
  };
}

/** Creates the user row without welcome credits (e.g. payment before sign-in). */
export function ensureUser(db, wallet) {
  wallet = normalizeWallet(wallet);
  const row = db.prepare("SELECT credits_balance FROM users WHERE wallet_address = ?").get(wallet);
  if (row) return { isNew: false, balance: Number(row.credits_balance) };
  db.prepare("INSERT OR IGNORE INTO users (wallet_address, credits_balance, created_at) VALUES (?, 0, ?)").run(wallet, nowIso());
  return { isNew: true, balance: 0 };
}

/**
 * After a verified signature: mark verified and give the welcome grant on the
 * first sign-in with a non-empty wallet. → { welcomed, balance, denied }.
 */
export async function completeWalletSignIn(wallet, { db = openDb(), balanceCheck = welcomeBalanceOk } = {}) {
  wallet = normalizeWallet(wallet);
  const existing = db.prepare("SELECT 1 FROM transactions WHERE wallet_address = ? AND kind = 'welcome' LIMIT 1").get(wallet);
  // The RPC balance check happens only while no grant exists (as in Промт) and
  // outside the SQLite transaction, so a slow RPC never holds the write lock.
  const check = existing ? { ok: false } : await balanceCheck(wallet);
  const now = nowIso();
  const result = tx(db, () => {
    const row = db.prepare("SELECT credits_balance, verified_at FROM users WHERE wallet_address = ?").get(wallet);
    if (row) {
      let balance = Number(row.credits_balance);
      if (!row.verified_at) db.prepare("UPDATE users SET verified_at = ? WHERE wallet_address = ?").run(now, wallet);
      let granted = 0;
      let denied = false;
      if (!hasWelcomeGrant(db, wallet)) {
        denied = !check.ok;
        if (check.ok) {
          const g = welcomeGrant(db);
          granted = g.amount;
          if (granted) {
            db.prepare("UPDATE users SET credits_balance = credits_balance + ? WHERE wallet_address = ?").run(granted, wallet);
            logTransaction(db, wallet, "welcome", granted, { note: g.note });
            balance += granted;
          }
        }
      }
      return { welcomed: granted > 0, balance, denied };
    }
    const g = check.ok ? welcomeGrant(db) : { amount: 0, note: WELCOME_NOTE };
    db.prepare("INSERT INTO users (wallet_address, credits_balance, created_at, verified_at) VALUES (?, ?, ?, ?)").run(wallet, g.amount, now, now);
    if (g.amount) logTransaction(db, wallet, "welcome", g.amount, { note: g.note });
    return { welcomed: true, balance: g.amount, denied: !g.amount };
  });
  if (result.denied) recordFunnelEvent(wallet, "welcome_denied", null, db);
  return result;
}

export function isWalletVerified(wallet, db = openDb()) {
  const row = db.prepare("SELECT verified_at FROM users WHERE wallet_address = ?").get(normalizeWallet(wallet));
  return !!(row && row.verified_at);
}

export function getBalance(wallet, db = openDb()) {
  const row = db.prepare("SELECT credits_balance FROM users WHERE wallet_address = ?").get(normalizeWallet(wallet));
  return row ? Number(row.credits_balance) : 0;
}

export function listTransactions(wallet, limit = 30, db = openDb()) {
  return db.prepare("SELECT kind, credits, engine, note, created_at FROM transactions WHERE wallet_address = ? ORDER BY id DESC LIMIT ?")
    .all(normalizeWallet(wallet), limit)
    .map((r) => ({ kind: r.kind, credits: r.credits, engine: r.engine, note: r.note, created_at: String(r.created_at).slice(0, 19) }));
}

/** Atomic debit (reserve before the paid call). False: unverified or insufficient. */
export function deductCredits(wallet, amount, { engine = "", note = DEBIT_NOTE, db = openDb() } = {}) {
  if (!(amount > 0)) throw new Error("Сума списання має бути додатною.");
  wallet = normalizeWallet(wallet);
  if (!isWalletVerified(wallet, db)) return false;
  return tx(db, () => {
    const r = db.prepare("UPDATE users SET credits_balance = credits_balance - ? WHERE wallet_address = ? AND credits_balance >= ?").run(amount, wallet, amount);
    if (r.changes !== 1) return false;
    logTransaction(db, wallet, "debit", -amount, { engine, note });
    return true;
  });
}

/** Returns reserved credits after a failed generation. → new balance. */
export function refundCredits(wallet, amount, { engine = "", note = FAILURE_NOTE, db = openDb() } = {}) {
  if (!(amount > 0)) throw new Error("Сума повернення має бути додатною.");
  wallet = normalizeWallet(wallet);
  return tx(db, () => {
    db.prepare("UPDATE users SET credits_balance = credits_balance + ? WHERE wallet_address = ?").run(amount, wallet);
    logTransaction(db, wallet, "refund", amount, { engine, note });
    return getBalance(wallet, db);
  });
}

/** Manual operator grant (NOT idempotent by design). → new balance. */
export function grantCredits(wallet, amount, { note = "Ручний грант", db = openDb() } = {}) {
  if (!(amount > 0)) throw new Error("Сума гранту має бути додатною.");
  wallet = normalizeWallet(wallet);
  return tx(db, () => {
    ensureUser(db, wallet);
    db.prepare("UPDATE users SET credits_balance = credits_balance + ? WHERE wallet_address = ?").run(amount, wallet);
    logTransaction(db, wallet, "grant", amount, { note });
    return getBalance(wallet, db);
  });
}

/** Credits a payment exactly once. False → this tx_id was already processed. */
export function recordPayment(txId, wallet, credits, amountUsd, { db = openDb(), notify } = {}) {
  wallet = normalizeWallet(wallet);
  const ok = tx(db, () => {
    ensureUser(db, wallet);
    try {
      db.prepare("INSERT INTO payments (tx_id, wallet_address, credits, amount_usd, created_at) VALUES (?, ?, ?, ?, ?)").run(txId, wallet, credits, amountUsd, nowIso());
    } catch (e) {
      if (isConstraintError(e)) return false;
      throw e;
    }
    db.prepare("UPDATE users SET credits_balance = credits_balance + ? WHERE wallet_address = ?").run(credits, wallet);
    logTransaction(db, wallet, "payment", credits, { note: `$${amountUsd}` });
    return true;
  });
  if (!ok) return false;
  notify?.(`💰 Series Lab · оплата зарахована\n+${credits} кредитів ($${amountUsd})\nГаманець: ${shortWallet(wallet)}\nБаланс: ${getBalance(wallet, db)}`);
  rewardReferral(wallet, { db, notify });
  return true;
}

/** Funnel event (not a credit transaction). Fail-open → boolean. */
export function recordFunnelEvent(wallet, event, payload = null, db = openDb()) {
  const ev = String(event || "").trim();
  if (!String(wallet || "").trim() || !ev) return false;
  try {
    db.prepare("INSERT INTO funnel_events (wallet_address, event, created_at, payload) VALUES (?, ?, ?, ?)")
      .run(normalizeWallet(wallet), ev, nowIso(), payload ? JSON.stringify(payload) : null);
    return true;
  } catch {
    return false;
  }
}

// ── Per-minute generation rate ───────────────────────────────────────────────
// The daily freemium cap was removed: welcome credits are a one-time grant, so a
// per-day counter only rationed that single pile. Welcome credits are the only
// free ceiling. Wallets that have not paid or been granted credits stay limited
// to GENERATION_RATE_LIMIT_PER_MINUTE (default 10). A payment or a manual grant
// lifts that per-minute cap.
function hasTopUp(db, wallet) {
  if (db.prepare("SELECT 1 FROM payments WHERE wallet_address = ? LIMIT 1").get(wallet)) return true;
  return !!db.prepare("SELECT 1 FROM transactions WHERE wallet_address = ? AND kind IN ('grant', 'payment') LIMIT 1").get(wallet);
}

/** Generations per minute for welcome-only wallets; null = paid or granted (no cap). */
export function generationRateLimit(wallet, db = openDb()) {
  const configured = Math.max(1, Number.parseInt(process.env.GENERATION_RATE_LIMIT_PER_MINUTE || "10", 10) || 10);
  try {
    return hasTopUp(db, normalizeWallet(wallet)) ? null : configured;
  } catch {
    return configured;
  }
}

export function checkGenerationRate(wallet, db = openDb()) {
  const limit = generationRateLimit(wallet, db);
  if (limit === null) return true;
  const cutoff = nowIso(new Date(Date.now() - 60_000));
  const n = db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE wallet_address = ? AND kind = 'debit' AND created_at >= ?").get(normalizeWallet(wallet), cutoff).n;
  return Number(n) < limit;
}

// ── Referrals ────────────────────────────────────────────────────────────────
export const referralBonusCredits = () => envInt("REFERRAL_BONUS_CREDITS", 50);

/** Deterministic opaque code (HMAC, base32, 10 chars) — same algorithm as Промт. */
export function referralCodeFor(wallet, db = openDb()) {
  const secret = String(process.env.AUTH_SESSION_SECRET || "").trim();
  if (!secret) return "";
  let w;
  try { w = normalizeWallet(wallet); } catch { return ""; }
  const digest = createHmac("sha256", secret).update(Buffer.concat([Buffer.from("referral:"), Buffer.from(w)])).digest();
  const code = base32(digest).toLowerCase().slice(0, 10);
  db.prepare("INSERT OR IGNORE INTO referral_codes (code, wallet_address, created_at) VALUES (?, ?, ?)").run(code, w, nowIso());
  return code;
}

function base32(buf) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += A[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += A[(value << (5 - bits)) & 31];
  return out;
}

export function resolveReferrer(ref, db = openDb()) {
  const r = String(ref || "").trim();
  if (!r) return "";
  const row = db.prepare("SELECT wallet_address FROM referral_codes WHERE code = ?").get(r.toLowerCase());
  if (row) return row.wallet_address;
  try { return normalizeWallet(r); } catch { return ""; }
}

export function recordReferral(invitee, referrer, db = openDb()) {
  try {
    invitee = normalizeWallet(invitee);
    referrer = normalizeWallet(referrer);
  } catch {
    return false;
  }
  if (invitee === referrer) return false;
  if (db.prepare("SELECT 1 FROM payments WHERE wallet_address = ? LIMIT 1").get(invitee)) return false;
  return db.prepare("INSERT OR IGNORE INTO referrals (invitee_address, referrer_address, created_at) VALUES (?, ?, ?)").run(invitee, referrer, nowIso()).changes === 1;
}

export function rewardReferral(invitee, { db = openDb(), notify } = {}) {
  const bonus = referralBonusCredits();
  if (bonus <= 0) return false;
  try { invitee = normalizeWallet(invitee); } catch { return false; }
  const row = db.prepare("SELECT referrer_address FROM referrals WHERE invitee_address = ? AND rewarded_at IS NULL").get(invitee);
  if (!row) return false;
  const claimed = db.prepare("UPDATE referrals SET rewarded_at = ?, reward_credits = ? WHERE invitee_address = ? AND rewarded_at IS NULL").run(nowIso(), bonus, invitee).changes === 1;
  if (!claimed) return false;
  grantCredits(row.referrer_address, bonus, { note: `Реферальний бонус за ${shortWallet(invitee)}`, db });
  notify?.(`🎁 Series Lab · реферальний бонус\n+${bonus} кредитів рефереру ${shortWallet(row.referrer_address)}\nза першу оплату ${shortWallet(invitee)}`);
  return true;
}

// ── NFT fulfillment ledger (Drop #2 vault transfers) ─────────────────────────
export function claimNftFulfillment(txId, wallet, kind, detail = "", db = openDb()) {
  const t = String(txId || "").trim();
  if (!t) return false;
  const now = nowIso();
  try {
    db.prepare("INSERT INTO nft_fulfillments (tx_id, wallet_address, kind, detail, status, attempts, created_at, updated_at) VALUES (?, ?, ?, ?, 'reserved', 0, ?, ?)").run(t, wallet, kind, detail, now, now);
    return true;
  } catch (e) {
    if (isConstraintError(e)) return false;
    throw e;
  }
}

export function markFulfillment(txId, status, db = openDb()) {
  const t = String(txId || "").trim();
  if (!t) return;
  if (status === "completed") db.prepare("UPDATE nft_fulfillments SET status='completed', updated_at=? WHERE tx_id=?").run(nowIso(), t);
  else db.prepare("UPDATE nft_fulfillments SET status='failed', attempts=attempts+1, updated_at=? WHERE tx_id=?").run(nowIso(), t);
}

export function pendingFulfillments(staleSeconds = 300, maxAttempts = 5, db = openDb()) {
  const cutoff = nowIso(new Date(Date.now() - Math.max(0, staleSeconds) * 1000));
  return db.prepare("SELECT tx_id, wallet_address, kind, detail, status, attempts FROM nft_fulfillments WHERE status IN ('reserved','failed') AND attempts < ? AND updated_at < ? ORDER BY updated_at ASC")
    .all(maxAttempts, cutoff)
    .map((r) => ({ tx_id: r.tx_id, wallet: r.wallet_address, kind: r.kind, detail: r.detail, status: r.status, attempts: r.attempts }));
}
