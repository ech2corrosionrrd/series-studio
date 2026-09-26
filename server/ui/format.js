/**
 * Locale-aware numbers and dates for the studio UI.
 * Payment amounts that the user copies (exact USDC) stay as the server sent them.
 */
import { getLocale } from "./i18n.js";

export function localeTag(code = getLocale()) {
  return code === "uk" ? "uk-UA" : "en-GB";
}

export function fmtNum(n, opts = {}) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return new Intl.NumberFormat(localeTag(), opts).format(v);
}

export function fmtDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(localeTag(), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** Display-only USD. Does not format the exact USDC amount a wallet must send. */
export function fmtUsd(n, digits = 2) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return new Intl.NumberFormat(localeTag(), {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(v);
}

export function fmtPct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `${fmtNum(v, { maximumFractionDigits: 2 })}%`;
}
