import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { DOC_PAGES, publicPaths } from "../scripts/site-pages.mjs";

const root = join(import.meta.dirname, "..");
const site = join(root, "dist", "site");

function htmlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return htmlFiles(p);
    return e.name.endsWith(".html") ? [p] : [];
  });
}

test("creator docs are on the public site, developer docs are not", () => {
  execFileSync(process.execPath, ["scripts/build-site.mjs"], { cwd: root });

  const missing = [];
  for (const p of publicPaths()) {
    const rel = (p === "/" ? "index.html" : `${p.slice(1)}index.html`);
    const file = join(site, rel);
    if (!existsSync(file) || statSync(file).size < 200) missing.push(rel);
  }
  assert.deepEqual(missing, []);

  for (const page of DOC_PAGES) {
    for (const lang of ["uk", "en"]) {
      const copy = page[lang];
      assert.ok(copy.title && copy.desc && copy.nav && copy.card && copy.blocks?.length, `${page.slug} ${lang}`);
    }
  }

  const home = readFileSync(join(site, "index.html"), "utf8");
  const enHome = readFileSync(join(site, "en/index.html"), "utf8");
  for (const slug of ["guide", "docs", "stages", "tabs", "base", "traits", "export", "preset"]) {
    assert.match(home, new RegExp(`href="/${slug}/"`));
    assert.match(enHome, new RegExp(`href="/en/${slug}/"`));
  }
  assert.match(home, /Node\.js 22\.13\+/);
  assert.match(enHome, /Node\.js 22\.13\+/);
  assert.match(home, /navDocs|Документація/);
  assert.match(home, /href="\/docs\/"/);

  const guide = readFileSync(join(site, "guide/index.html"), "utf8");
  const enGuide = readFileSync(join(site, "en/guide/index.html"), "utf8");
  assert.match(guide, /Деплой — набір для вашого гаманця/);
  assert.match(guide, /Маркет — набір для майданчика/);
  assert.match(enGuide, /Deploy — a kit for your wallet/);
  assert.match(enGuide, /Market — a kit for the marketplace/);

  const exp = readFileSync(join(site, "export/index.html"), "utf8");
  const enExp = readFileSync(join(site, "en/export/index.html"), "utf8");
  for (const html of [exp, enExp]) {
    assert.match(html, /Core Candy Machine/);
    assert.match(html, /Irys/);
    assert.match(html, /--keypair/);
    assert.match(html, /127\.0\.0\.1|свого гаманця|your own wallet/);
  }
  assert.match(exp, /свого гаманця/);
  assert.match(enExp, /your own wallet/);

  const preset = readFileSync(join(site, "preset/index.html"), "utf8");
  assert.match(preset, /series-preset\/v0/);
  assert.doesNotMatch(preset, /engineMatrix|changeKeys|promptTemplate/);
  assert.ok(preset.length < 9000, `preset page is a short reference, got ${preset.length} chars`);

  const docs = readFileSync(join(site, "docs/index.html"), "utf8");
  const enDocs = readFileSync(join(site, "en/docs/index.html"), "utf8");
  assert.match(docs, /HTTP-маршрутів/);
  assert.match(docs, /README/);
  assert.match(enDocs, /HTTP route reference/);
  assert.match(enDocs, /README/);

  const sitemap = readFileSync(join(site, "sitemap.xml"), "utf8");
  for (const p of publicPaths()) assert.match(sitemap, new RegExp(p.replaceAll("/", "\\/") ));

  const banned = [/POST \/api/, /GET \/api/, /pinata/i, /\bmother\b/i, /Хвилі 1/, /waves 1–25/i, /engineMatrix/, /docs\/API\.md/, /docs\/ROADMAP\.md/];
  const all = htmlFiles(site).map((f) => readFileSync(f, "utf8")).join("\n");
  for (const re of banned) assert.doesNotMatch(all, re);
});
