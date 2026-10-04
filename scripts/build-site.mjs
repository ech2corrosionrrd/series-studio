#!/usr/bin/env node
/**
 * Builds the public static site for Cloudflare Pages (studio.w3ir.io).
 *
 *   node scripts/build-site.mjs  →  dist/site/
 *
 * Pages (uk and en): landing, the beginner guide (same strings as in-app Help),
 * and creator pages from scripts/site-pages.mjs (stages, tabs, base, traits,
 * export, a short preset note). HTTP API docs and the roadmap stay in the repo.
 * The site is purely static: no API, no keys, no generation.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import uk from "../server/ui/locales/uk.js";
import en from "../server/ui/locales/en.js";
import { DOC_PAGES, publicPaths } from "./site-pages.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist", "site");
const ORIGIN = "https://studio.w3ir.io";
const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const UI = {
  uk: {
    lang: "uk", other: "en", otherLabel: "English", base: "/",
    title: "Series Lab — майстерня NFT-серій на вашому ПК",
    desc: "Локальна майстерня для серій картинок з одним упізнаваним персонажем: рецепти, генерація, відбір і пакування для маркетплейсу. Безкоштовно з локальними рушіями.",
    tagline: "Серія картинок з одним упізнаваним персонажем — від пресету до ZIP для маркетплейсу. На вашому комп'ютері.",
    ctaGuide: "Читати посібник", ctaStart: "Як запустити",
    navHome: "Головна", navGuide: "Посібник", navDocs: "Документація",
    stagesTitle: "7 етапів — від ідеї до випуску",
    docsSection: "Документація для автора",
    docsSectionLead: "Стільки, скільки потрібно, щоб зібрати серію на своєму ПК і випустити її зі свого гаманця. Почніть із посібника.",
    docsTitle: "Документація для автора",
    docsDesc: "Сторінки Series Lab для людини, яка збирає дроп: етапи, вкладки, базова картинка, риси, експорт і короткий пресет.",
    docsLead: "Майстерня працює локально на вашому комп'ютері. Тут — шлях автора: від пресету через Arweave (Irys) і Core Candy Machine до series mint і series reveal на цьому ПК. Продаж лишається на майданчику.",
    docsRepo: "Як запустити — блок «Запуск» на головній (потрібен Node.js 22.13+). Повний перелік змінних середовища і команд лежить у README поруч із кодом. Цей сайт його не замінює.",
    docsScope: "Опис HTTP-маршрутів і внутрішня історія розробки лишаються в репозиторії.",
    runTitle: "Запуск",
    runText: "Потрібен Node.js 22.13+. Майстерня працює лише на вашому ПК (127.0.0.1) — цей сайт лише описує її.",
    privateNote: "Series Lab поки поширюється приватно. Щоб отримати доступ — напишіть W3IR.",
    footer: "Series Lab від W3IR · MIT",
    guideTitle: "Посібник Series Lab",
    guideDesc: "Покроковий посібник простими словами: етапи 1–7, швидкий старт за $0, страховка, словник і часті запитання.",
    toc: "Зміст",
  },
  en: {
    lang: "en", other: "uk", otherLabel: "Українська", base: "/en/",
    title: "Series Lab — an NFT series studio on your PC",
    desc: "A local studio for image series with one recognisable character: recipes, generation, review and marketplace packaging. Free with local engines.",
    tagline: "A series of images with one recognisable character — from preset to a marketplace-ready ZIP. On your own computer.",
    ctaGuide: "Read the guide", ctaStart: "How to run",
    navHome: "Home", navGuide: "Guide", navDocs: "Docs",
    stagesTitle: "7 stages — from idea to release",
    docsSection: "Docs for creators",
    docsSectionLead: "As much as you need to build a series on your own PC and release it from your own wallet. Start with the guide.",
    docsTitle: "Docs for creators",
    docsDesc: "Series Lab pages for the person running a drop: stages, tabs, the base image, traits, export and a short preset note.",
    docsLead: "The studio runs locally on your computer. These pages follow the creator's path: from the preset, through Arweave via Irys and a Core Candy Machine, to series mint and series reveal on this PC. The sale stays on the marketplace.",
    docsRepo: "How to run it is in the Run section on the home page (Node.js 22.13+). The full list of environment variables and commands lives in the README next to the code. This site does not replace it.",
    docsScope: "The HTTP route reference and the internal development history stay in the repository.",
    runTitle: "Run it",
    runText: "Requires Node.js 22.13+. The studio runs only on your PC (127.0.0.1) — this website just describes it.",
    privateNote: "Series Lab is distributed privately for now. Contact W3IR for access.",
    footer: "Series Lab by W3IR · MIT",
    guideTitle: "Series Lab Guide",
    guideDesc: "A plain-language step-by-step guide: stages 1–7, a $0 quick start, the safety net, a glossary and FAQ.",
    toc: "Contents",
  },
};

function list(T, prefix) {
  const out = [];
  for (let i = 1; T[`${prefix}${i}`] !== undefined; i++) out.push(T[`${prefix}${i}`]);
  return out;
}
const ul = (items, tag = "ul") => `<${tag}>${items.map((s) => `<li>${esc(s)}</li>`).join("")}</${tag}>`;

function layout(u, { title, desc, path, altPath, body }) {
  const home = u.base;
  const guide = `${u.base}guide/`;
  const docs = `${u.base}docs/`;
  return `<!doctype html>
<html lang="${u.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${ORIGIN}${path}">
<link rel="alternate" hreflang="${u.lang}" href="${ORIGIN}${path}">
<link rel="alternate" hreflang="${u.other}" href="${ORIGIN}${altPath}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${ORIGIN}${path}">
<meta name="theme-color" content="#110b15">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/site.css">
</head>
<body>
<header class="top">
  <a class="brand" href="${home}"><span class="logo">S</span><span><b>Series Lab</b><small>by W3IR · v${esc(version)}</small></span></a>
  <nav>
    <a href="${home}"${path === home ? ' aria-current="page"' : ""}>${esc(u.navHome)}</a>
    <a href="${guide}"${path === guide ? ' aria-current="page"' : ""}>${esc(u.navGuide)}</a>
    <a href="${docs}"${path === docs ? ' aria-current="page"' : ""}>${esc(u.navDocs)}</a>
    <a class="lang" href="${altPath}" hreflang="${u.other}">${esc(u.otherLabel)}</a>
  </nav>
</header>
<main>
${body}
</main>
<footer>${esc(u.footer)} · <a href="${ORIGIN}${altPath}" hreflang="${u.other}">${esc(u.otherLabel)}</a></footer>
</body>
</html>
`;
}

function landing(T, u) {
  const stages = [1, 2, 3, 4, 5, 6, 7].map((n) => {
    const title = T[`help.s${n}.title`];
    return `<li><b>${esc(title)}</b><span>${esc(T[`help.s${n}.why`])}</span></li>`;
  }).join("");
  const cards = [1, 2, 3].map((n) =>
    `<div class="card"><b>${esc(T[`help.whatis.card${n}.title`])}</b><p>${esc(T[`help.whatis.card${n}.desc`])}</p></div>`).join("");
  const body = `
<section class="hero">
  <h1>Series Lab</h1>
  <p class="lead">${esc(u.tagline)}</p>
  <p>${esc(T["help.whatis.p2"])}</p>
  <div class="cta"><a class="btn primary" href="${u.base}guide/">${esc(u.ctaGuide)}</a><a class="btn" href="#run">${esc(u.ctaStart)}</a></div>
</section>
<section><div class="cards">${cards}</div></section>
<section><h2>${esc(u.stagesTitle)}</h2><ol class="stages">${stages}</ol></section>
<section id="docs">
  <h2>${esc(u.docsSection)}</h2>
  <p class="lead">${esc(u.docsSectionLead)}</p>
  <div class="cards">${docCards(u)}</div>
</section>
<section class="split">
  <div class="card"><h2>${esc(T["help.safety.title"])}</h2><p>${esc(T["help.safety.desc"])}</p>${ul(list(T, "help.safety.li"))}</div>
  <div class="card"><h2>${esc(T["help.zero.title"])}</h2><p>${esc(T["help.zero.desc"])}</p>${ul(list(T, "help.zero.li"))}</div>
</section>
<section id="run" class="card">
  <h2>${esc(u.runTitle)}</h2>
  <p>${esc(u.runText)}</p>
  <pre><code>npm install
npm start          # → http://127.0.0.1:5344/studio/
# Windows: start-lab.bat</code></pre>
  <p class="note">${esc(u.privateNote)}</p>
</section>`;
  return layout(u, { title: u.title, desc: u.desc, path: u.base, altPath: UI[u.other].base, body });
}

function guidePage(T, u) {
  const sections = [];
  const sec = (id, html) => sections.push([id, T[`help.${id}.title`], html]);

  sec("whatis", `<p>${esc(T["help.whatis.p1"])}</p><p>${esc(T["help.whatis.p2"])}</p>`);
  sec("quick", `<p>${esc(T["help.quick.desc"])}</p>${ul(list(T, "help.quick.li"), "ol")}<p class="note">${esc(T["help.quick.tip"])}</p>`);
  // Same order as the in-app Help tab: stages 1–7, Deploy, Market, then Admin.
  const steps = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s9", "s10", "s8"].map((id) => {
    const p = `help.${id}`;
    return `<details class="step"${id === "s1" ? " open" : ""}><summary>${esc(T[`${p}.title`])}</summary>
      <p><b>${esc(T["help.label.why"])}:</b> ${esc(T[`${p}.why`])}</p>
      <h4>${esc(T["help.label.do"])}</h4>${ul(list(T, `${p}.do`), "ol")}
      <p class="get"><b>${esc(T["help.label.get"])}:</b> ${esc(T[`${p}.get`])}</p>
      <h4>${esc(T["help.label.oops"])}</h4>${ul(list(T, `${p}.oops`))}</details>`;
  }).join("");
  sec("steps", `<p>${esc(T["help.steps.desc"])}</p>${steps}`);
  sec("safety", `<p>${esc(T["help.safety.desc"])}</p>${ul(list(T, "help.safety.li"))}`);
  sec("zero", `<p>${esc(T["help.zero.desc"])}</p>${ul(list(T, "help.zero.li"))}`);
  const gl = list(T, "help.gl").map((s) => {
    const [term, ...rest] = s.split(" — ");
    return `<div><dt>${esc(term)}</dt><dd>${esc(rest.join(" — "))}</dd></div>`;
  }).join("");
  sec("glossary", `<p>${esc(T["help.glossary.desc"])}</p><dl class="gl">${gl}</dl>`);
  const faq = list(T, "help.faq.q").map((q, i) =>
    `<details class="faq"><summary>${esc(q)}</summary><p>${esc(T[`help.faq.a${i + 1}`])}</p></details>`).join("");
  sec("faq", faq);
  sec("run", `<p>${esc(T["help.run.desc"])}</p>`);

  const toc = sections.map(([id, title]) => `<a href="#${id}">${esc(title)}</a>`).join("");
  const body = `
<h1>${esc(u.guideTitle)}</h1>
<p class="lead">${esc(u.guideDesc)}</p>
${docNav(u, "guide")}
<div class="guide">
  <nav class="toc" aria-label="${esc(u.toc)}"><b>${esc(u.toc)}</b>${toc}</nav>
  <div>${sections.map(([id, title, html]) => `<section id="${id}" class="card"><h2>${esc(title)}</h2>${html}</section>`).join("")}</div>
</div>`;
  const path = `${u.base}guide/`;
  return layout(u, { title: u.guideTitle, desc: u.guideDesc, path, altPath: `${UI[u.other].base}guide/`, body });
}

function inline(s) {
  return String(s).split(/(`[^`]+`)/g).map((part) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return `<code>${esc(part.slice(1, -1))}</code>`;
    return esc(part);
  }).join("");
}
const richList = (items, tag = "ul") => `<${tag}>${items.map((s) => `<li>${inline(s)}</li>`).join("")}</${tag}>`;

function renderBlocks(blocks) {
  return blocks.map((b) => {
    if (b.h3) return `<h3>${inline(b.h3)}</h3>`;
    if (b.p) return `<p>${inline(b.p)}</p>`;
    if (b.note) return `<p class="note">${inline(b.note)}</p>`;
    if (b.ul) return richList(b.ul);
    if (b.ol) return richList(b.ol, "ol");
    if (b.pre) return `<pre><code>${esc(b.pre)}</code></pre>`;
    if (b.table) {
      const head = b.table.head.map((c) => `<th>${inline(c)}</th>`).join("");
      const rows = b.table.rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("");
      return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    return "";
  }).join("");
}

function docNav(u, current) {
  const links = [
    { slug: "guide", href: `${u.base}guide/`, label: u.navGuide },
    { slug: "docs", href: `${u.base}docs/`, label: u.navDocs },
    ...DOC_PAGES.map((p) => ({ slug: p.slug, href: `${u.base}${p.slug}/`, label: p[u.lang].nav })),
  ];
  return `<nav class="docnav" aria-label="${esc(u.navDocs)}">${links.map((l) => `<a href="${l.href}"${l.slug === current ? ' aria-current="page"' : ""}>${esc(l.label)}</a>`).join("")}</nav>`;
}

function docCards(u) {
  const guide = `<a class="card" href="${u.base}guide/"><b>${esc(u.navGuide)}</b><span>${esc(u.guideDesc)}</span></a>`;
  const rest = DOC_PAGES.map((p) => {
    const t = p[u.lang];
    return `<a class="card" href="${u.base}${p.slug}/"><b>${esc(t.title)}</b><span>${esc(t.card)}</span></a>`;
  }).join("");
  return guide + rest;
}

function chunkByHeading(blocks) {
  const sections = [];
  let cur = null;
  for (const b of blocks) {
    if (b.h2) {
      cur = { title: b.h2, blocks: [] };
      sections.push(cur);
    } else {
      if (!cur) {
        cur = { title: null, blocks: [] };
        sections.push(cur);
      }
      cur.blocks.push(b);
    }
  }
  return sections;
}

function docsHub(u) {
  const body = `
<h1>${esc(u.docsTitle)}</h1>
<p class="lead">${esc(u.docsLead)}</p>
${docNav(u, "docs")}
<div class="cards">${docCards(u)}</div>
<section class="card">
  <p>${esc(u.docsRepo)}</p>
  <p class="note">${esc(u.docsScope)}</p>
</section>`;
  return layout(u, {
    title: u.docsTitle,
    desc: u.docsDesc,
    path: `${u.base}docs/`,
    altPath: `${UI[u.other].base}docs/`,
    body,
  });
}

function creatorPage(page, u) {
  const t = page[u.lang];
  const sections = chunkByHeading(t.blocks).map((s) =>
    `<section class="card">${s.title ? `<h2>${inline(s.title)}</h2>` : ""}${renderBlocks(s.blocks)}</section>`).join("");
  const body = `
<h1>${esc(t.title)}</h1>
<p class="lead">${esc(t.desc)}</p>
${docNav(u, page.slug)}
${sections}`;
  const path = `${u.base}${page.slug}/`;
  return layout(u, {
    title: t.title,
    desc: t.desc,
    path,
    altPath: `${UI[u.other].base}${page.slug}/`,
    body,
  });
}

const CSS = `:root{--bg:#110b15;--panel:#1b1322;--panel2:#251a2e;--line:#2c2136;--text:#f1e9f7;--muted:#ab98bb;--accent2:#7ad7ff;--grad:linear-gradient(135deg,#9b4ddb,#c23d8a)}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;color:var(--text);font:16px/1.6 "Segoe UI Variable","Segoe UI",system-ui,-apple-system,Roboto,sans-serif;background:radial-gradient(1200px 600px at 10% -10%,#2a1438,transparent 60%),var(--bg);-webkit-font-smoothing:antialiased}
a{color:var(--accent2)}
.top{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:12px 20px;background:#0d0811e6;backdrop-filter:blur(6px);border-bottom:1px solid var(--line)}
.brand{display:flex;gap:10px;align-items:center;color:var(--text);text-decoration:none}.brand small{display:block;color:var(--muted);font-size:12px}
.logo{width:34px;height:34px;border-radius:9px;display:grid;place-items:center;font-weight:900;background:var(--grad)}
.top nav{display:flex;gap:4px;flex-wrap:wrap}.top nav a{color:var(--muted);text-decoration:none;padding:6px 10px;border-radius:9px}
.top nav a:hover,.top nav a[aria-current]{color:#fff;background:var(--panel2)}
main{max-width:1100px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:clamp(30px,5vw,48px);line-height:1.1;margin:8px 0 14px;letter-spacing:-.02em}
h2{font-size:22px;margin:0 0 10px}h3{font-size:18px;margin:16px 0 6px}h4{margin:14px 0 4px;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--accent2)}
.lead{font-size:19px;color:#e2d6ec;max-width:780px}
section{margin:0 0 28px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px 20px;box-shadow:0 8px 24px #0006}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}.cards p{margin:6px 0 0;color:var(--muted)}
a.card{display:block;color:inherit;text-decoration:none}a.card:hover{border-color:#7ad7ff55}a.card span{display:block;color:var(--muted);margin-top:6px}
.docnav{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 18px}
.docnav a{color:var(--muted);text-decoration:none;padding:6px 10px;border-radius:999px;border:1px solid var(--line);background:var(--panel);font-size:14px}
.docnav a[aria-current],.docnav a:hover{color:#fff;background:var(--panel2)}
.table-wrap{overflow-x:auto;margin:8px 0 4px}
table{width:100%;border-collapse:collapse;font-size:15px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-size:12px;letter-spacing:.04em;text-transform:uppercase}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.92em}
p code,li code,td code{background:#0b070e;padding:1px 5px;border-radius:5px}
.split{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px}
.cta{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}
.btn{display:inline-block;padding:10px 18px;border-radius:10px;border:1px solid #3a2c46;background:var(--panel2);color:var(--text);text-decoration:none;font-weight:600}
.btn.primary{background:var(--grad);border-color:transparent;color:#fff;box-shadow:0 4px 14px #9b4ddb44}
.stages{list-style:none;counter-reset:s;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}
.stages li{counter-increment:s;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
.stages b{display:block;margin-bottom:4px}.stages span{color:var(--muted);font-size:15px}
pre{background:#0b070e;border:1px solid var(--line);border-radius:10px;padding:12px 14px;overflow-x:auto}
.note{padding:10px 12px;border-radius:10px;background:#7ad7ff10;border:1px solid #7ad7ff33}
.get{padding:8px 10px;border-radius:8px;background:#7be38a10;border:1px solid #7be38a33}
.guide{display:grid;grid-template-columns:220px minmax(0,1fr);gap:20px;align-items:start}
.guide section{margin-bottom:16px;scroll-margin-top:80px}
.toc{position:sticky;top:76px;display:flex;flex-direction:column;gap:2px;padding:12px;background:var(--panel);border:1px solid var(--line);border-radius:14px}
.toc b{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 0 6px 6px}
.toc a{color:var(--text);text-decoration:none;padding:6px 8px;border-radius:8px;font-size:14px}.toc a:hover{background:var(--panel2)}
details.step{background:var(--panel2);border:1px solid var(--line);border-radius:12px;margin:10px 0;padding:0 16px}
details.step summary{cursor:pointer;padding:12px 0;font-weight:600}details.step[open]{padding-bottom:12px}
details.faq{border-bottom:1px solid var(--line)}details.faq summary{cursor:pointer;padding:10px 0;font-weight:600}details.faq p{margin:0 0 12px;color:#e2d6ec}
.gl{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:8px;margin:0}
.gl div{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:10px 12px}.gl dt{font-weight:700}.gl dd{margin:2px 0 0;color:var(--muted);font-size:15px}
footer{text-align:center;color:var(--muted);font-size:14px;padding:24px 16px 40px;border-top:1px solid var(--line)}
a:focus-visible,summary:focus-visible{outline:none;box-shadow:0 0 0 3px #c77dff55;border-radius:6px}
@media(max-width:820px){.guide{grid-template-columns:1fr}.toc{position:static;flex-direction:row;flex-wrap:wrap}.toc b{width:100%}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
`;

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9b4ddb"/><stop offset="1" stop-color="#c23d8a"/></linearGradient></defs><rect width="64" height="64" rx="16" fill="url(#g)"/><text x="32" y="44" font-family="Segoe UI,Arial,sans-serif" font-size="36" font-weight="900" text-anchor="middle" fill="#fff">S</text></svg>`;

// Cloudflare Pages: security headers for every page (static site, no scripts needed)
const HEADERS = `/*
  Content-Security-Policy: default-src 'none'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
  Cross-Origin-Opener-Policy: same-origin

/site.css
  Cache-Control: public, max-age=3600

/favicon.svg
  Cache-Control: public, max-age=86400
`;

const NOT_FOUND = (u) => layout(u, {
  title: "404 · Series Lab", desc: u.desc, path: "/404", altPath: UI[u.other].base,
  body: `<h1>404</h1><p class="lead">${u.lang === "uk" ? "Такої сторінки немає." : "This page doesn't exist."}</p><p><a class="btn primary" href="${u.base}">${esc(u.navHome)}</a></p>`,
});

function write(rel, content) {
  const p = join(OUT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content, "utf8");
}

// Empty the folder instead of removing it: on Windows a process (preview server,
// shell) may hold the directory open and rmSync(OUT) fails with EPERM.
mkdirSync(OUT, { recursive: true });
for (const entry of readdirSync(OUT)) rmSync(join(OUT, entry), { recursive: true, force: true });
for (const [T, u] of [[uk.default ?? uk, UI.uk], [en.default ?? en, UI.en]]) {
  const prefix = u.base.slice(1);
  write(`${prefix}index.html`, landing(T, u));
  write(`${prefix}guide/index.html`, guidePage(T, u));
  write(`${prefix}docs/index.html`, docsHub(u));
  for (const page of DOC_PAGES) write(`${prefix}${page.slug}/index.html`, creatorPage(page, u));
}
write("404.html", NOT_FOUND(UI.uk));
write("site.css", CSS);
write("favicon.svg", FAVICON);
write("_headers", HEADERS);
write("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`);
write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${publicPaths().map((p) => `  <url><loc>${ORIGIN}${p}</loc></url>`).join("\n")}\n</urlset>\n`);
console.log(`Site built → ${OUT}`);
