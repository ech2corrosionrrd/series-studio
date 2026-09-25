/**
 * Operator notifications and wallet classification.
 * Port of Промт `services/notify.py` + Series Lab branding (own Telegram bot).
 */
import { getTelegramConfig, sendTelegramNotification, brandOperatorText } from "../notifications.mjs";
import { normalizeAddr } from "./wallet.mjs";

/** Send plain-text (or Markdown) to the Series Lab operator chat. Never throws. */
export async function notifyOperator(text, { parseMode } = {}) {
  const cfg = getTelegramConfig();
  if (!cfg.configured) return false;
  const body = brandOperatorText(text);
  const r = await sendTelegramNotification({
    botToken: cfg.botToken,
    chatId: cfg.chatId,
    text: body,
    parseMode: parseMode || "Markdown",
  });
  if (!r.ok) {
    // Fallback without Markdown if Telegram rejects entities.
    const plain = await sendTelegramNotification({
      botToken: cfg.botToken,
      chatId: cfg.chatId,
      text: body.replace(/[*_`\[\]]/g, ""),
      parseMode: undefined,
    });
    return plain.ok;
  }
  return true;
}

/** Operator wallet for the admin panel. Public address; extra admins may be added via ADMIN_WALLETS. */
export const ADMIN_WALLET = "63u6SDZckvzcJhC4V5yJn6bZ15qx1iM8c6iB3Z9xD1tn";

// Team wallets that are never "external demand" (same list as Промт wallet_class).
const TEAM_WALLETS = [
  ADMIN_WALLET,
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

export function adminWallets() {
  const out = new Set([normalizeAddr(ADMIN_WALLET)]);
  for (const w of String(process.env.ADMIN_WALLETS || "").split(",")) if (w.trim()) out.add(normalizeAddr(w));
  return out;
}

export const isAdmin = (wallet) => !!wallet && adminWallets().has(normalizeAddr(wallet));

/** SQL tail + params for scope filtering: "all" | "external" | "internal". */
export function scopeSql(scope = "all", column = "wallet_address") {
  if (scope === "all") return { sql: "", params: [] };
  const list = [...internalWallets()];
  if (!list.length) return scope === "external" ? { sql: "", params: [] } : { sql: " AND 1 = 0", params: [] };
  const marks = list.map(() => "?").join(", ");
  return { sql: ` AND ${column} ${scope === "external" ? "NOT IN" : "IN"} (${marks})`, params: list };
}
