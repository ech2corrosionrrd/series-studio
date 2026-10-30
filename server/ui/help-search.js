/**
 * Help search matching, free of the DOM so scripts/audit-help.mjs can run it too.
 * Every word of the query must occur in the text; a long word also matches by its stem
 * (the last three letters dropped), so "поповнити" finds "поповнення" and "ліцензія" finds "ліцензії".
 */
export function helpMatches(text, query) {
  const hay = String(text).toLowerCase();
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((w) => hay.includes(w) || (w.length >= 6 && hay.includes(w.slice(0, -3))));
}
