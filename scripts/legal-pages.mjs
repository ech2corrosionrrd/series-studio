/**
 * Legal pages of the public site (/terms/ and /privacy/, plus /en/…), published ONLY from
 * approved texts. Nothing is built from the drafts in docs/LEGAL-DRAFT*.md: they still carry
 * `[placeholders]` for the lawyer.
 *
 * To publish: put the approved Markdown into docs/legal/published/ as
 *   terms.uk.md  terms.en.md  privacy.uk.md  privacy.en.md
 * A slug is published only when BOTH languages exist and neither contains a `[placeholder]`
 * (a square-bracket note in backticks, the draft convention). The footer links appear
 * together with the pages. See docs/legal/published/README.md.
 *
 * Markdown subset: `# title` (page title), `##` / `###` headings, paragraphs, `-` lists,
 * `1.` lists, `>` notes, tables, ``` code ```, `---` ignored; inline `code`, **bold**, [text](https://…).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const LEGAL_DIR = process.env.SERIES_LEGAL_DIR ? resolve(process.env.SERIES_LEGAL_DIR) : join(ROOT, "docs", "legal", "published");
export const LEGAL_SLUGS = ["terms", "privacy"];

/** Draft convention: unresolved items are written as `[something]` inside backticks. */
const PLACEHOLDER = /`\[[^`]+\]`/;

export function hasPlaceholders(md) {
  return PLACEHOLDER.test(String(md));
}

function cells(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

/** Markdown -> `{ title, blocks }` in the block format of scripts/site-pages.mjs. */
export function parseMarkdownBlocks(md) {
  const lines = String(md).replace(/\r/g, "").split("\n");
  const blocks = [];
  let title = "";
  let i = 0;
  let para = [];
  const flush = () => {
    if (para.length) blocks.push({ p: para.join(" ") });
    para = [];
  };
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) { flush(); i++; continue; }
    if (t.startsWith("```")) {
      flush();
      const code = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) code.push(lines[i++]);
      i++;
      blocks.push({ pre: code.join("\n") });
      continue;
    }
    if (/^---+$/.test(t)) { flush(); i++; continue; }
    const h = t.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      flush();
      if (h[1] === "#") { if (!title) title = h[2]; } else blocks.push(h[1] === "##" ? { h2: h[2] } : { h3: h[2] });
      i++;
      continue;
    }
    if (t.startsWith(">")) {
      flush();
      const q = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) q.push(lines[i++].trim().replace(/^>\s?/, ""));
      blocks.push({ note: q.join(" ") });
      continue;
    }
    if (t.startsWith("|") && lines[i + 1] && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      flush();
      const head = cells(t);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]));
      blocks.push({ table: { head, rows } });
      continue;
    }
    const ul = t.match(/^[-*]\s+(.*)$/);
    const ol = t.match(/^\d+\.\s+(.*)$/);
    if (ul || ol) {
      flush();
      const items = [];
      const re = ul ? /^[-*]\s+(.*)$/ : /^\d+\.\s+(.*)$/;
      while (i < lines.length) {
        const m = lines[i].trim().match(re);
        if (m) { items.push(m[1]); i++; continue; }
        // an indented continuation line belongs to the previous item
        if (items.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*[-*]\s|^\s*\d+\.\s/.test(lines[i])) { items[items.length - 1] += ` ${lines[i].trim()}`; i++; continue; }
        break;
      }
      blocks.push(ul ? { ul: items } : { ol: items });
      continue;
    }
    para.push(t);
    i++;
  }
  flush();
  return { title, blocks };
}

function describe(blocks, title) {
  const first = blocks.find((b) => b.p);
  const text = (first?.p || title).replace(/[`*[\]]/g, "").replace(/\(https?:[^)]*\)/g, "");
  return text.length > 170 ? `${text.slice(0, 167).trimEnd()}…` : text;
}

/**
 * Published legal pages found in `dir`: `[{ slug, uk: {nav,title,desc,blocks}, en: {...} }]`.
 * Skips (with a warning) any slug that lacks a language or still has `[placeholders]`.
 */
export function loadLegalPages(dir = LEGAL_DIR, warn = (m) => console.warn(m)) {
  const pages = [];
  for (const slug of LEGAL_SLUGS) {
    const files = { uk: join(dir, `${slug}.uk.md`), en: join(dir, `${slug}.en.md`) };
    const have = Object.entries(files).filter(([, f]) => existsSync(f));
    if (!have.length) continue;
    if (have.length < 2) {
      warn(`[legal] ${slug}: both ${slug}.uk.md and ${slug}.en.md are needed; page not published`);
      continue;
    }
    const page = { slug };
    let ok = true;
    for (const [lang, file] of have) {
      const md = readFileSync(file, "utf8");
      if (hasPlaceholders(md)) {
        warn(`[legal] ${slug}.${lang}.md still has \`[placeholders]\`; page not published`);
        ok = false;
        break;
      }
      const { title, blocks } = parseMarkdownBlocks(md);
      if (!title) { warn(`[legal] ${slug}.${lang}.md has no "# title"; page not published`); ok = false; break; }
      page[lang] = { nav: title, title, desc: describe(blocks, title), blocks };
    }
    if (ok) pages.push(page);
  }
  return pages;
}

export const LEGAL_PAGES = loadLegalPages();
