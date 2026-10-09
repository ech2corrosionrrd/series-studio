/**
 * Кешування статичних файлів студії (server/ui/*): ETag + `Cache-Control: private, no-cache`.
 *
 * Браузер і проксі кожного разу питають сервер, чи файл змінився (`If-None-Match`), і при збігу
 * отримують `304` без тіла, тож `app.js`, стилі й переклади не качаються заново, а після деплою
 * нова версія підхоплюється одразу (на відміну від `max-age`). `private` потрібен через Cloudflare:
 * без нього він кешує файл на краю й підміняє `Cache-Control` на `max-age=14400`, тож після деплою
 * користувачі до 4 годин бачили б стару студію (виявлено на живому хості 10.10.2026). Лише для файлів інтерфейсу:
 * картинки користувача (`/out/`, `/input/`) і API лишаються `no-store`.
 */
import { createHash } from "node:crypto";

export function etagFor(buf) {
  return `"${createHash("sha1").update(buf).digest("hex").slice(0, 24)}"`;
}

/** Чи збігається `If-None-Match` із нашим ETag (враховує список і слабкі валідатори `W/`). */
export function etagMatches(header, etag) {
  if (!header) return false;
  const value = String(header).trim();
  if (value === "*") return true;
  return value.split(",").some((t) => t.trim().replace(/^W\//, "") === etag);
}

/** Повертає { status: 200|304, headers } для тіла файлу й заголовків запиту. */
export function staticResponse(buf, reqHeaders = {}) {
  const etag = etagFor(buf);
  const headers = { ETag: etag, "Cache-Control": "private, no-cache" };
  return { status: etagMatches(reqHeaders["if-none-match"], etag) ? 304 : 200, headers };
}
