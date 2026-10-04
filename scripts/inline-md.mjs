/**
 * Inline Markdown for site text that is not inside `code`: **bold** and [text](https://…|mailto:…).
 * Everything else is HTML-escaped. Only http(s) and mailto links are turned into anchors.
 */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const TOKEN = /(\*\*[^*]+\*\*|\[[^\]]+\]\((?:https?:\/\/|mailto:)[^)\s]+\))/g;

export function richText(text) {
  return String(text).split(TOKEN).map((seg) => {
    let m = seg.match(/^\*\*([^*]+)\*\*$/);
    if (m) return `<strong>${esc(m[1])}</strong>`;
    m = seg.match(/^\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)$/);
    if (m) return `<a href="${esc(m[2])}" rel="noopener">${esc(m[1])}</a>`;
    return esc(seg);
  }).join("");
}
