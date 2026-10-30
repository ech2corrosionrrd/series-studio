/**
 * Guards the Help tab against the faults found in the beta review (docs/BETA-REVIEW.md, B8-B10, B15, B20):
 *  - a quoted button name («…» in uk, "…" in en) that does not exist anywhere in the interface;
 *  - an unbalanced backtick (the text would show a stray `);
 *  - a tab of the studio that Help never links to;
 *  - key search queries that find nothing.
 * `auditHelp` is pure so test/audit-help.test.mjs can feed it a made-up button and expect a failure.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { helpMatches } from "../server/ui/help-search.js";

/** Quoted words that are examples or terms, not buttons. Add here only after checking the text really is not a button. */
const NOT_BUTTONS = new Set([
  "без тексту", "no text", "lock", "wl", "mock", "лишити", "keep", "переробити", "redo", "series #",
  "гібрид", "hybrid", "готовий", "ready", "mint", "deploy", "marketplace",
  "руде волосся", "детально руки, симетричне обличчя",
]);

/** Search queries every owner-visible topic must answer, with the section that has to hold the answer. */
export const SEARCH_QUERIES = {
  uk: [
    ["поповнити", "money"], ["phantom", "money"], ["вартість", "money"], ["гібрид", "hybrid"],
    ["genesis", "release"], ["підтримка", "support"], ["ліцензія", "licence"], ["схожість", "quality"],
    ["видалити дані", "faq"], ["не зараховано", "money"], ["шар", "hybrid"],
  ],
  en: [
    ["top up", "money"], ["phantom", "money"], ["price", "money"], ["hybrid", "hybrid"],
    ["genesis", "release"], ["support", "support"], ["licence", "licence"], ["similarity", "quality"],
    ["delete my data", "faq"], ["layer", "hybrid"],
  ],
};

const SECTION_PREFIXES = {
  money: ["help.money."], hybrid: ["help.hybrid."], quality: ["help.quality."], release: ["help.release."],
  licence: ["help.licence."], support: ["help.support."], faq: ["help.faq."], glossary: ["help.gl"],
};

const norm = (s) => String(s)
  .replace(/\{[^}]*\}/g, "")
  .replace(/^[^\p{L}\p{N}]+/u, "")
  .replace(/^\d+\s*[·.:]\s*/u, "")
  .replace(/[…\s.:!?]+$/u, "")
  .trim()
  .toLowerCase();

function labelsIn(value, locale) {
  const re = locale === "uk" ? /«([^»]{2,80})»/gu : /"([^"]{2,80})"/gu;
  return [...String(value).matchAll(re)].map((m) => m[1]);
}

export function auditHelp({ uk, en, html, helpSource }) {
  const errors = [];
  for (const [locale, dict] of [["uk", uk], ["en", en]]) {
    const corpus = Object.entries(dict).filter(([k]) => !k.startsWith("help.") || k.endsWith(".title")).map(([, v]) => norm(v));
    // A button label may also stand in a tab title ("1 · Overview") or in the HTML itself.
    const htmlText = norm(html);
    for (const [key, value] of Object.entries(dict)) {
      if (!key.startsWith("help.") || typeof value !== "string") continue;
      if ((value.match(/`/g) || []).length % 2) errors.push(`${locale} ${key}: unbalanced backtick`);
      if (locale === "en" && /[а-яіїєґ]/i.test(value)) errors.push(`${locale} ${key}: Cyrillic in the English text`);
      if (/^help\.(gl\d+|faq\.a\d+)$/.test(key) && locale === "en") continue;
      for (const label of labelsIn(value, locale)) {
        const n = norm(label);
        if (!n || NOT_BUTTONS.has(n)) continue;
        if (!corpus.some((c) => c.includes(n)) && !htmlText.includes(n)) {
          errors.push(`${locale} ${key}: «${label}» is not a name anywhere in the interface`);
        }
      }
    }
  }

  const linked = new Set([...helpSource.matchAll(/\["s\d+", "(\w+)"\]/g)].map((m) => m[1]));
  for (const m of html.matchAll(/data-tab="(\w+)"/g)) {
    if (m[1] !== "help" && !linked.has(m[1])) errors.push(`tab "${m[1]}" has no step in Help`);
  }

  for (const [locale, dict] of [["uk", uk], ["en", en]]) {
    const section = (id) => {
      const prefixes = SECTION_PREFIXES[id] || [`help.${id}.`];
      return Object.entries(dict).filter(([k]) => prefixes.some((p) => k.startsWith(p))).map(([, v]) => v).join(" ");
    };
    for (const [query, id] of SEARCH_QUERIES[locale]) {
      const text = `${dict[`help.${id}.title`] || ""} ${section(id)}`;
      if (!helpMatches(text, query)) errors.push(`${locale} search "${query}" finds nothing in section ${id}`);
    }
  }
  return errors;
}

export async function loadInputs() {
  const [{ default: uk }, { default: en }] = await Promise.all([
    import("../server/ui/locales/uk.js"), import("../server/ui/locales/en.js"),
  ]);
  const read = (p) => readFileSync(new URL(`../server/ui/${p}`, import.meta.url), "utf8");
  return { uk, en, html: read("index.html"), helpSource: read("app-help.js") };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = auditHelp(await loadInputs());
  if (errors.length) {
    console.error(`audit:help: ${errors.length} problem(s)\n${errors.map((e) => `  ✗ ${e}`).join("\n")}`);
    process.exit(1);
  }
  console.log("audit:help: ok");
}
