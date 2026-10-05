/**
 * Operator notifications and wallet classification.
 * Series Lab branding (own Telegram bot).
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

/**
 * Default operator wallet. Used only when `ADMIN_WALLETS` is unset.
 * A set `ADMIN_WALLETS` (even empty) replaces this list entirely.
 */
export const ADMIN_WALLET = "63u6SDZckvzcJhC4V5yJn6bZ15qx1iM8c6iB3Z9xD1tn";

export const DEFAULT_ADMIN_WALLETS = [ADMIN_WALLET];

/** Team wallets that are never "external demand". */
export const DEFAULT_TEAM_WALLETS = [
  ADMIN_WALLET,
  "DE1gBEaqA11uYdySmF5LRmN8QsvXvnYJYHDVXeAY15Vh",
  "7XTEnenjjLi2Pr8ShUPYo1DXKm3WZRLoD2rQpiq7E6qw",
  "1BWutmTvYPwDtmw9abTkS4Ssr8no61spGAvW1X6NDix",
  "0x25267d871267bf1c2478d47d167aa6237fab1d1c",
];

function splitWallets(value) {
  return String(value || "")
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean);
}

/** `null` when the variable is unset (use defaults). An empty string is an override. */
function envWalletList(env, key) {
  if (env[key] == null) return null;
  return splitWallets(env[key]);
}

export function adminWallets(env = process.env) {
  const override = envWalletList(env, "ADMIN_WALLETS");
  const list = override == null ? DEFAULT_ADMIN_WALLETS : override;
  return new Set(list.map(normalizeAddr));
}

export function internalWallets(env = process.env) {
  const teamOverride = envWalletList(env, "TEAM_WALLETS");
  const team = teamOverride == null ? DEFAULT_TEAM_WALLETS : teamOverride;
  const out = new Set(team.map(normalizeAddr));
  for (const w of adminWallets(env)) out.add(w);
  for (const key of ["OPERATOR_WALLET", "DOGFOOD_WALLETS"]) {
    for (const w of splitWallets(env[key])) out.add(normalizeAddr(w));
  }
  return out;
}

export const isInternal = (wallet) => !!wallet && internalWallets().has(normalizeAddr(wallet));

export const isAdmin = (wallet) => !!wallet && adminWallets().has(normalizeAddr(wallet));

/** SQL tail + params for scope filtering: "all" | "external" | "internal". */
export function scopeSql(scope = "all", column = "wallet_address") {
  if (scope === "all") return { sql: "", params: [] };
  const list = [...internalWallets()];
  if (!list.length) return scope === "external" ? { sql: "", params: [] } : { sql: " AND 1 = 0", params: [] };
  const marks = list.map(() => "?").join(", ");
  return { sql: ` AND ${column} ${scope === "external" ? "NOT IN" : "IN"} (${marks})`, params: list };
}
