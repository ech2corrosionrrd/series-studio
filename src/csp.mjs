/**
 * Content-Security-Policy для сервера Lab (docs/HOSTING.md, розділ «Безпека відповідей»).
 *
 * Режими (`SERIES_CSP`): `report` (типово) шле `Content-Security-Policy-Report-Only` і
 * нічого не блокує; `enforce` блокує; `off` вимикає. Порушення приходять на
 * `POST /api/csp-report` і логуються без дублікатів. Спершу збираємо звіти в `report`,
 * і лише коли вони чисті кілька днів, вмикаємо `enforce`.
 *
 * Дві політики:
 * - сторінка входу (`/login`) має вбудований скрипт-модуль, імпорт з esm.sh і шрифти Google,
 *   тому для неї дозволено `'unsafe-inline'` у script-src (відомий недолік, див. документ);
 * - решта: скрипти лише свої та esm.sh (динамічний імпорт @solana/web3.js у студії).
 * Обидві дозволяють Cloudflare Web Analytics (скрипт вставляє сам Cloudflare на проксі-сторінки;
 * перший живий звіт 10.10.2026), інакше `enforce` його б блокував.
 */

export const CSP_REPORT_PATH = "/api/csp-report";
export const CSP_MODES = ["report", "enforce", "off"];

export function cspMode(env = process.env) {
  const v = String(env.SERIES_CSP || "report").trim().toLowerCase();
  return CSP_MODES.includes(v) ? v : "report";
}

const COMMON = [
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'",
  `report-uri ${CSP_REPORT_PATH}`,
];

export function buildCsp(pathname = "/") {
  if (pathname === "/login" || pathname === "/login/") {
    return [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://esm.sh https://static.cloudflareinsights.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https://cloudflareinsights.com",
      ...COMMON,
    ].join("; ");
  }
  return [
    "default-src 'self'",
    "script-src 'self' https://esm.sh https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https://cloudflareinsights.com",
    ...COMMON,
  ].join("; ");
}

/** Ставить заголовок CSP (або нічого, якщо режим `off`). */
export function applyCsp(req, res, env = process.env) {
  const mode = cspMode(env);
  if (mode === "off") return;
  const path = String(req?.url || "/").split("?")[0];
  const name = mode === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";
  res.setHeader(name, buildCsp(path));
}

/** Стислий опис порушення зі звіту браузера; null, якщо звіт порожній чи непридатний. */
export function summarizeReport(body) {
  let json = body;
  if (typeof body === "string") {
    try {
      json = JSON.parse(body);
    } catch {
      return null;
    }
  }
  const r = json?.["csp-report"] || json;
  if (!r || typeof r !== "object") return null;
  const clean = (v) => String(v ?? "").replace(/[\r\n\t]+/g, " ").split("?")[0].slice(0, 200);
  const directive = clean(r["effective-directive"] || r["violated-directive"]);
  if (!directive) return null;
  return {
    directive,
    blocked: clean(r["blocked-uri"] || r.blockedURL || "inline"),
    document: clean(r["document-uri"] || r.documentURL),
    source: clean(r["source-file"] || r.sourceFile),
    disposition: clean(r.disposition),
  };
}

/** Журнал порушень у пам'яті: дублікати рахуємо, а не друкуємо (захист від флуду). */
export function createCspLog({ max = 200, log = (line) => console.warn(line) } = {}) {
  const seen = new Map();
  return {
    record(summary) {
      if (!summary) return false;
      const key = `${summary.directive}|${summary.blocked}|${summary.document}`;
      const n = (seen.get(key) || 0) + 1;
      if (!seen.has(key) && seen.size >= max) return false;
      seen.set(key, n);
      if (n === 1 || n % 100 === 0) log(`[csp] ${summary.directive} blocked=${summary.blocked} doc=${summary.document}${n > 1 ? ` x${n}` : ""}`);
      return true;
    },
    counts: () => Object.fromEntries(seen),
  };
}
