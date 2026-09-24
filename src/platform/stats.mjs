/**
 * Funnel metrics and per-wallet activity. Port of Промт `services/stats.py`
 * (`wallet_activity`, `funnel`) — the numbers `ПЛАН_ВИХОДУ.md` measures success by.
 */
import { DEBIT_NOTE, FAILURE_NOTE, normalizeWallet } from "./billing.mjs";
import { nowIso, openDb } from "./db.mjs";
import { scopeSql } from "./ops.mjs";

/**
 * Wallet activity for one UTC day — Passport quest verification.
 * `generated` comes from money (debits minus failure refunds), not from the funnel.
 */
export function walletActivity(wallet, day = null, db = openDb()) {
  const w = normalizeWallet(wallet);
  let d = day;
  if (d == null) d = new Date().toISOString().slice(0, 10);
  else {
    d = String(d).trim();
    const t = Date.parse(`${d}T00:00:00Z`);
    // JS rolls 2026-02-30 over to March; Python (and Promt) rejects it — so do we.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== d) {
      throw new Error("invalid date");
    }
  }
  const next = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const row = db.prepare(
    "SELECT SUM(CASE WHEN kind = 'debit' AND note = ? THEN 1 ELSE 0 END) AS debits," +
      " SUM(CASE WHEN kind = 'refund' AND note = ? THEN 1 ELSE 0 END) AS refunds" +
      " FROM transactions WHERE wallet_address = ? AND created_at >= ? AND created_at < ?",
  ).get(DEBIT_NOTE, FAILURE_NOTE, w, d, next);
  const events = db.prepare("SELECT event FROM funnel_events WHERE wallet_address = ? AND created_at >= ? AND created_at < ?").all(w, d, next);
  let sessions = 0;
  let saved = false;
  let exported = false;
  for (const { event } of events) {
    if (event === "generate") sessions += 1;
    else if (event === "curator_save") saved = true;
    else if (event === "export") exported = true;
  }
  return {
    wallet: w,
    date: d,
    generated: Math.max(0, Number(row.debits || 0) - Number(row.refunds || 0)),
    sessions,
    saved,
    exported,
  };
}

/** Beta funnel over a window: verified → first debit → save/export → paying. */
export function funnel(days = 30, { scope = "all", db = openDb() } = {}) {
  const cutoff = nowIso(new Date(Date.now() - days * 86_400_000));
  const churnCutoff = nowIso(new Date(Date.now() - 30 * 86_400_000));
  const s = scopeSql(scope);
  const us = scopeSql(scope, "u.wallet_address");
  const set = (sql) => new Set(db.prepare(sql + s.sql).all(cutoff, ...s.params).map((r) => r.wallet_address));

  const newUsers = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE created_at >= ?${s.sql}`).get(cutoff, ...s.params).n;
  const verified = set("SELECT wallet_address FROM users WHERE verified_at IS NOT NULL AND verified_at >= ?");
  const payers = set("SELECT DISTINCT wallet_address FROM payments WHERE created_at >= ?");
  const generators = set("SELECT DISTINCT wallet_address FROM transactions WHERE kind = 'debit' AND created_at >= ?");
  const savers = set("SELECT DISTINCT wallet_address FROM funnel_events WHERE event = 'curator_save' AND created_at >= ?");
  const exporters = set("SELECT DISTINCT wallet_address FROM funnel_events WHERE event = 'export' AND created_at >= ?");
  const firstDebit = db.prepare(
    `SELECT COUNT(*) AS n FROM (SELECT wallet_address, MIN(created_at) m FROM transactions WHERE kind = 'debit'${s.sql} GROUP BY wallet_address HAVING m >= ?)`,
  ).get(...s.params, cutoff).n;
  const churn = db.prepare(
    "SELECT COUNT(*) AS n FROM users u WHERE u.verified_at IS NOT NULL AND u.verified_at < ? AND NOT EXISTS (" +
      `SELECT 1 FROM transactions t WHERE t.wallet_address = u.wallet_address AND t.kind = 'debit')${us.sql}`,
  ).get(churnCutoff, ...us.params).n;

  const pct = (num, den) => (den.size ? Math.round((1000 * [...num].filter((x) => den.has(x)).length) / den.size) / 10 : null);
  return {
    days,
    scope,
    new_users: Number(newUsers),
    new_verified: verified.size,
    first_debit_wallets: Number(firstDebit),
    curator_save_wallets: savers.size,
    exported_wallets: exporters.size,
    paying_wallets: payers.size,
    conversion_verified_to_paying_pct: pct(payers, verified),
    conversion_generate_to_save_pct: pct(savers, generators),
    conversion_save_to_export_pct: pct(exporters, savers),
    conversion_generate_to_export_pct: pct(exporters, generators),
    churn_proxy_verified_no_debit: Number(churn),
  };
}
