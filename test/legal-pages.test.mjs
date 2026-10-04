import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LEGAL_PAGES, hasPlaceholders, loadLegalPages, parseMarkdownBlocks } from "../scripts/legal-pages.mjs";
import { richText } from "../scripts/inline-md.mjs";

const bt = "`";

test("the published beta texts are complete: terms and privacy, both languages, no placeholders", () => {
  assert.deepEqual(LEGAL_PAGES.map((p) => p.slug), ["terms", "privacy"]);
  for (const page of LEGAL_PAGES) {
    for (const lang of ["uk", "en"]) {
      assert.ok(page[lang].title.length > 5, `${page.slug}.${lang} has a title`);
      assert.ok(page[lang].blocks.filter((b) => b.h2).length >= 8, `${page.slug}.${lang} has its sections`);
    }
  }
  const joined = JSON.stringify(LEGAL_PAGES);
  assert.doesNotMatch(joined, /Pinata|Helio|ai\.w3ir\.io/, "no leftovers from the Промт texts");
  for (const lang of ["uk", "en"]) {
    const note = LEGAL_PAGES[0][lang].blocks.find((b) => b.note)?.note || "";
    assert.match(note, /\*\*/, "the beta notice opens the terms");
  }
});

test("the beta status is stated in both documents and both languages", () => {
  for (const page of LEGAL_PAGES) {
    assert.match(page.uk.blocks.find((b) => b.note).note, /розробки й тестування/);
    assert.match(page.en.blocks.find((b) => b.note).note, /development and testing/);
  }
});

test("parseMarkdownBlocks: title, headings, paragraphs, lists, notes, tables, code", () => {
  const md = [
    "# Умови користування",
    "",
    "Перший абзац",
    "у два рядки.",
    "",
    "## 1. Розділ",
    "### 1.1. Підрозділ",
    "- пункт **один**",
    "- пункт два",
    "  продовження",
    "",
    "1. крок",
    "2. крок два",
    "",
    "> примітка",
    "> друга",
    "",
    "| Дані | Навіщо |",
    "|---|---|",
    "| адреса | вхід |",
    "",
    "```",
    "a < b",
    "```",
    "---",
    "Кінець",
  ].join("\n");
  const { title, blocks } = parseMarkdownBlocks(md);
  assert.equal(title, "Умови користування");
  assert.deepEqual(blocks, [
    { p: "Перший абзац у два рядки." },
    { h2: "1. Розділ" },
    { h3: "1.1. Підрозділ" },
    { ul: ["пункт **один**", "пункт два продовження"] },
    { ol: ["крок", "крок два"] },
    { note: "примітка друга" },
    { table: { head: ["Дані", "Навіщо"], rows: [["адреса", "вхід"]] } },
    { pre: "a < b" },
    { p: "Кінець" },
  ]);
});

test("richText: bold and safe links only; everything else is escaped", () => {
  assert.equal(richText("a **b** c"), "a <strong>b</strong> c");
  assert.equal(richText("[сайт](https://example.com/x)"), '<a href="https://example.com/x" rel="noopener">сайт</a>');
  assert.equal(richText("[пошта](mailto:a@b.co)"), '<a href="mailto:a@b.co" rel="noopener">пошта</a>');
  assert.equal(richText("[x](javascript:alert(1))"), "[x](javascript:alert(1))", "javascript: is never a link");
  assert.equal(richText("<script>alert(1)</script> & \"q\""), "&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot;");
});

test("hasPlaceholders finds the draft convention only", () => {
  assert.equal(hasPlaceholders(`Оператор: ${bt}[ім'я]${bt}`), true);
  assert.equal(hasPlaceholders("Оператор: ТОВ Приклад, [посилання](https://example.com)"), false);
  assert.equal(hasPlaceholders("Чинний від 2026-10-05"), false);
});

test("loadLegalPages: both languages and no placeholders, or the page is skipped with a warning", () => {
  const dir = mkdtempSync(join(tmpdir(), "series-legal-"));
  try {
    const warns = [];
    const warn = (m) => warns.push(m);
    assert.deepEqual(loadLegalPages(dir, warn), [], "empty folder: nothing");
    writeFileSync(join(dir, "terms.uk.md"), "# Умови\n\nТекст.\n");
    assert.deepEqual(loadLegalPages(dir, warn), [], "one language only");
    assert.match(warns.join(" "), /both terms\.uk\.md and terms\.en\.md/);
    writeFileSync(join(dir, "terms.en.md"), `# Terms\n\nOperator ${bt}[name]${bt}.\n`);
    assert.deepEqual(loadLegalPages(dir, warn), [], "placeholders block publishing");
    assert.match(warns.join(" "), /placeholders/);
    writeFileSync(join(dir, "terms.en.md"), "# Terms\n\nPlain text.\n");
    writeFileSync(join(dir, "privacy.uk.md"), "без заголовка\n");
    writeFileSync(join(dir, "privacy.en.md"), "no title\n");
    const pages = loadLegalPages(dir, warn);
    assert.equal(pages.length, 1, "privacy has no title, so only terms is published");
    assert.equal(pages[0].slug, "terms");
    assert.equal(pages[0].uk.title, "Умови");
    assert.equal(pages[0].en.desc, "Plain text.");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a published page renders with its footer links on every page, without the docs nav (fixture folder)", () => {
  const dir = mkdtempSync(join(tmpdir(), "series-legal-"));
  try {
    writeFileSync(join(dir, "terms.uk.md"), "# Умови користування\n\n**Важливо:** текст [тут](https://example.com).\n\n## Розділ\n- пункт\n");
    writeFileSync(join(dir, "terms.en.md"), "# Terms of Service\n\nPlain.\n");
    const run = (lang, kind) => {
      const r = spawnSync(process.execPath, ["--input-type=module", "-e",
        `import { renderPublicPage } from "./scripts/site-html.mjs"; process.stdout.write(renderPublicPage(${JSON.stringify(lang)}, ${JSON.stringify(kind)}));`,
      ], { env: { ...process.env, SERIES_LEGAL_DIR: dir }, encoding: "utf8", cwd: join(import.meta.dirname, "..") });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout;
    };
    const terms = run("uk", "terms");
    assert.match(terms, /<h1>Умови користування<\/h1>/);
    assert.match(terms, /<strong>Важливо:<\/strong>/);
    assert.match(terms, /<a href="https:\/\/example\.com" rel="noopener">тут<\/a>/);
    assert.doesNotMatch(terms, /class="docnav"/, "legal pages have no creator-docs nav");
    assert.match(terms, /<footer>[^]*<a href="\/terms\/">Умови користування<\/a>/);
    assert.match(run("en", "terms"), /<footer>[^]*<a href="\/en\/terms\/">Terms of Service<\/a>/);
    assert.match(run("uk", "index"), /<footer>[^]*href="\/terms\/"/, "the landing footer links to it too");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("without published texts the footer has no legal links (empty folder)", () => {
  const empty = mkdtempSync(join(tmpdir(), "series-legal-empty-"));
  try {
    const r = spawnSync(process.execPath, ["--input-type=module", "-e",
      'import { renderPublicPage } from "./scripts/site-html.mjs"; process.stdout.write(renderPublicPage("uk", "index"));',
    ], { env: { ...process.env, SERIES_LEGAL_DIR: empty }, encoding: "utf8", cwd: join(import.meta.dirname, "..") });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /\/terms\/|\/privacy\//);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test("the real site footer links to both published pages", () => {
  const r = spawnSync(process.execPath, ["--input-type=module", "-e",
    'import { renderPublicPage } from "./scripts/site-html.mjs"; process.stdout.write(renderPublicPage("en", "index"));',
  ], { encoding: "utf8", cwd: join(import.meta.dirname, "..") });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /<footer>[^]*href="\/en\/terms\/"[^]*href="\/en\/privacy\/"/);
});
