/**
 * Operator notifications and wallet classification.
 * Port of Промт `services/notify.py` (plain-text Telegram, silent on failure)
 * and `services/wallet_class.py` (internal vs external wallets for metrics).
 */
import { normalizeAddr } from "./wallet.mjs";

/** Plain-text Telegram message to the operator chat. Never throws. */
export function notifyOperator(text) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = String(process.env.TELEGRAM_CHAT_ID || "").trim();
  if (!token || !chatId) return Promise.resolve(false);
  return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
    signal: AbortSignal.timeout(10_000),
  }).then(() => true, () => false);
}

// Team wallets that are never "external demand" (same list as Промт wallet_class).
const TEAM_WALLETS = [
  "63u6SDZckvzcJhC4V5yJn6bZ15qx1iM8c6iB3Z9xD1tn",
  "DE1gBEaqA11uYdySmF5LRmN8QsvXvnYJYHDVXeAY15Vh",
  "7XTEnenjjLi2Pr8ShUPYo1DXKm3WZRLoD2rQpiq7E6qw",
  "1BWutmTvYPwDtmw9abTkS4Ssr8no61spGAvW1X6NDix",
  "0x25267d871267bf1c2478d47d167aa6237fab1d1c",
];

export function internalWallets() {
  const out = new Set(TEAM_WALLETS.map(normalizeAddr));
  for (const key of ["ADMIN_WALLETS", "OPERATOR_WALLET", "DOGFOOD_WALLETS"]) {
    for (const w of String(process.env[key] || "").split(",")) if (w.trim()) out.add(normalizeAddr(w));
  }
  return out;
}

export const isInternal = (wallet) => !!wallet && internalWallets().has(normalizeAddr(wallet));
export const isAdmin = (wallet) =>
  !!wallet && String(process.env.ADMIN_WALLETS || "").split(",").map((w) => normalizeAddr(w)).filter(Boolean).includes(normalizeAddr(wallet));

/** SQL tail + params for scope filtering: "all" | "external" | "internal". */
export function scopeSql(scope = "all", column = "wallet_address") {
  if (scope === "all") return { sql: "", params: [] };
  const list = [...internalWallets()];
  if (!list.length) return scope === "external" ? { sql: "", params: [] } : { sql: " AND 1 = 0", params: [] };
  const marks = list.map(() => "?").join(", ");
  return { sql: ` AND ${column} ${scope === "external" ? "NOT IN" : "IN"} (${marks})`, params: list };
}
