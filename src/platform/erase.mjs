/**
 * "Delete my data" for one wallet (privacy right, see docs/LEGAL-DRAFT.md §2.7).
 *
 * What is erased: everything that is the user's content or behaviour: usage events, the
 * wallet's own referral code, pending sign-in nonces, the unused freemium counter. The wallet's
 * files (inputs, presets, images, layers) are removed by the server together with its folder.
 *
 * What is KEPT on purpose: the financial trail needed for accounting and refunds: the `users`
 * row (balance), `payments`, `transactions`, `sol_orders`, `referrals` (who was rewarded for
 * whom), `holder_grants`, `nft_fulfillments`. They hold the wallet address, no content.
 * The policy says so; backups keep copies until they rotate.
 */
import { openDb } from "./db.mjs";

const ERASED_TABLES = ["funnel_events", "referral_codes", "wallet_nonces", "freemium_usage"];

/** Delete the wallet's behavioural rows. Returns how many rows went from each table. */
export function eraseWalletRecords(wallet, { db = openDb() } = {}) {
  const addr = String(wallet || "").trim();
  if (!addr) throw new Error("wallet is required");
  const removed = {};
  for (const table of ERASED_TABLES) {
    const r = db.prepare(`DELETE FROM ${table} WHERE wallet_address = ?`).run(addr);
    removed[table] = Number(r.changes || 0);
  }
  return removed;
}
