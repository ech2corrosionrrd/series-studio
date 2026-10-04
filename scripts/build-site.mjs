#!/usr/bin/env node
/**
 * Builds the public static site for Cloudflare Pages (studio.w3ir.io).
 *
 *   node scripts/build-site.mjs  →  dist/site/
 *
 * Pages (uk and en): landing, the beginner guide (same strings as in-app Help),
 * and creator pages from scripts/site-pages.mjs (stages, tabs, base, traits,
 * export, a short preset note). The same pages are served by the local studio
 * at /studio/docs/ (see scripts/site-html.mjs) — reading them does not need a deploy.
 * HTTP API docs and the roadmap stay in the repo.
 * The site is purely static: no API, no keys, no generation.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DOC_PAGES, publicPaths } from "./site-pages.mjs";
import {
  PUBLIC_ORIGIN,
  SITE_CSS,
  SITE_FAVICON,
  SITE_HEADERS,
  renderPublicPage,
} from "./site-html.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist", "site");

function write(rel, content) {
  const p = join(OUT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content, "utf8");
}

// Empty the folder instead of removing it: on Windows a process (preview server,
// shell) may hold the directory open and rmSync(OUT) fails with EPERM.
mkdirSync(OUT, { recursive: true });
for (const entry of readdirSync(OUT)) rmSync(join(OUT, entry), { recursive: true, force: true });
for (const lang of ["uk", "en"]) {
  const prefix = lang === "en" ? "en/" : "";
  write(`${prefix}index.html`, renderPublicPage(lang, "index"));
  write(`${prefix}guide/index.html`, renderPublicPage(lang, "guide"));
  write(`${prefix}docs/index.html`, renderPublicPage(lang, "docs"));
  for (const page of DOC_PAGES) write(`${prefix}${page.slug}/index.html`, renderPublicPage(lang, page.slug));
}
write("404.html", renderPublicPage("uk", "404"));
write("site.css", SITE_CSS);
write("favicon.svg", SITE_FAVICON);
write("_headers", SITE_HEADERS);
write("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${PUBLIC_ORIGIN}/sitemap.xml\n`);
write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${publicPaths().map((p) => `  <url><loc>${PUBLIC_ORIGIN}${p}</loc></url>`).join("\n")}\n</urlset>\n`);
console.log(`Site built → ${OUT}`);
