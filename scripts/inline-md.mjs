/**
 * Inline Markdown for site text that is not inside `code`: **bold** and [text](https://…|mailto:…).
 * Everything else is HTML-escaped. Only http(s) and mailto links are turned into anchors.
 */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const TOKEN = /(\*\*[^*]+\*\*|\[[^\]]+\]\((?:https?:\/\/|mailto:)[^)\s]+\))/g;

// Cloudflare's Email Address Obfuscation rewrites addresses into "[email protected]" and needs a
// script that our CSP blocks. These comments make it skip the address (docs/DEPLOY.md).
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const keep = (html) => `<!--email_off-->${html}<!--/email_off-->`;

export function richText(text) {
  return String(text).split(TOKEN).map((seg) => {
    let m = seg.match(/^\*\*([^*]+)\*\*$/);
    if (m) return `<strong>${esc(m[1])}</strong>`;
    m = seg.match(/^\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)$/);
    if (m) {
      const a = `<a href="${esc(m[2])}" rel="noopener">${esc(m[1])}</a>`;
      return m[2].startsWith("mailto:") ? keep(a) : a;
    }
    return esc(seg).replace(EMAIL, (e) => keep(e));
  }).join("");
}
