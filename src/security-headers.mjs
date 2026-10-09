/**
 * Заголовки безпеки для відповідей сервера (Lab).
 *
 * Ставимо через `res.setHeader` на початку обробки запиту: `writeHead` з власними
 * заголовками їх доповнює, а не стирає. Свідомо БЕЗ Content-Security-Policy: UI має
 * вбудовані скрипти й вхід гаманцем (розширення браузера), і CSP без перевірки в
 * браузері міг би їх зламати. HSTS додаємо лише коли запит прийшов по HTTPS
 * (Caddy: X-Forwarded-Proto, Cloudflare: CF-Visitor), щоб не ламати локальний http.
 */
export const SECURITY_HEADERS = Object.freeze({
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
});

export const HSTS_VALUE = "max-age=31536000";

export function isHttpsRequest(headers = {}) {
  const proto = String(headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  if (proto === "https") return true;
  return /"scheme"\s*:\s*"https"/i.test(String(headers["cf-visitor"] || ""));
}

export function applySecurityHeaders(req, res) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
  if (isHttpsRequest(req?.headers)) res.setHeader("Strict-Transport-Security", HSTS_VALUE);
}
