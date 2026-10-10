/**
 * Public, no-login pages: shareable collections `/c/<slug>`, the landing demo
 * gallery, legal documents. File layout: `data/public/<slug>/manifest.json`
 * + `img/<n>.<ext>`.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { referralCodeFor } from "./billing.mjs";
import { shortWallet } from "./wallet.mjs";

const SITE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "server", "site");
export const PUBLIC_IMAGE_LIMIT = 60;
const PUBLIC_BASE = "https://w3ir.io";
const APP_URL = "https://ai.w3ir.io";
const APP_CTA = `${APP_URL}/?utm_source=collection_share&utm_medium=cta&utm_campaign=viral`;
const MEDIA = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

export const publicDir = () => process.env.SERIES_PUBLIC_DIR || resolve(process.env.SERIES_DATA_DIR || "data", "public");
export const siteFile = (name) => join(SITE_DIR, name);

export const escHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" }[c]));

export function slugify(text) {
  const s = String(text || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s.slice(0, 64).replace(/-+$/g, "") || "collection";
}

export const mediaType = (filename) => MEDIA[extname(filename).toLowerCase()] || "application/octet-stream";

export function loadCollection(slug) {
  const p = join(publicDir(), slugify(slug), "manifest.json");
  if (!existsSync(p)) return null;
  try {
    const data = JSON.parse(readFileSync(p, "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

/** Only files listed in the manifest are served (no client path touches the FS). */
export function collectionImagePath(slug, filename) {
  const m = loadCollection(slug);
  if (!m || !(m.images || []).includes(filename)) return null;
  const p = join(publicDir(), slugify(slug), "img", filename);
  return existsSync(p) && statSync(p).isFile() ? p : null;
}

/** Publishes images under a new unique slug. images: [{name, bytes}] → slug. */
export function publishCollection(title, images, { subtitle = "", wallet = "", slug = "" } = {}) {
  const valid = images.filter((i) => i.bytes?.length && MEDIA[extname(i.name).toLowerCase()]).slice(0, PUBLIC_IMAGE_LIMIT);
  if (!valid.length) throw new Error("Немає зображень із підтримуваним розширенням для публікації.");
  const base = slugify(slug || title);
  let final = base;
  for (let n = 2; existsSync(join(publicDir(), final)); n++) final = `${base}-${n}`;
  const imgDir = join(publicDir(), final, "img");
  mkdirSync(imgDir, { recursive: true });
  const names = valid.map((img, i) => {
    const name = `${i + 1}${extname(img.name).toLowerCase()}`;
    writeFileSync(join(imgDir, name), img.bytes);
    return name;
  });
  let refCode = "";
  if (wallet) {
    try { refCode = referralCodeFor(wallet); } catch { refCode = ""; }
  }
  const manifest = {
    slug: final,
    title: (String(title || "").trim() || "Untitled collection").slice(0, 120),
    subtitle: String(subtitle || "").trim().slice(0, 200),
    wallet_short: shortWallet(wallet),
    ref_code: refCode,
    images: names,
    created_at: new Date().toISOString().replace(/\.(\d{3})Z$/, ".$1000+00:00"),
  };
  writeFileSync(join(publicDir(), final, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  return final;
}

const demoWorthy = (m) => (m.images || []).length > 0 && !!String(m.title || "").trim() && !String(m.title).trim().toLowerCase().startsWith("untitled");

export function listCollections(limit = 12) {
  const dir = publicDir();
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    if (!statSync(join(dir, name)).isDirectory()) continue;
    const m = loadCollection(name);
    if (m && demoWorthy(m)) out.push(m);
  }
  return out.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))).slice(0, limit);
}

export function deleteCollection(slug) {
  const dir = join(publicDir(), slugify(slug));
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

export function renderDemoSection(limit = 6) {
  const cols = listCollections(limit);
  if (!cols.length) return "";
  const cards = cols.map((m) => {
    const s = slugify(m.slug);
    const title = escHtml(m.title || "Collection");
    return `<a href="/c/${s}" class="card group block overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">` +
      `<img src="/c/${s}/img/${escHtml(m.images[0])}" alt="${title}" loading="lazy" class="aspect-square w-full object-cover" />` +
      `<div class="p-3"><div class="truncate text-sm font-semibold">${title}</div><div class="text-xs text-[var(--lo)]">${(m.images || []).length} items</div></div></a>`;
  });
  return '<section class="mx-auto max-w-6xl px-6 pb-16">' +
    '<h2 class="text-center text-2xl font-bold tracking-tight sm:text-3xl">Made with w3ir.io</h2>' +
    '<p class="mx-auto mt-2 max-w-xl text-center text-[var(--muted)]">Real collections built in the app. Click any — then make your own.</p>' +
    '<div class="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">' + cards.join("\n") + "</div></section>";
}

export function renderLanding() {
  const p = siteFile("landing.html");
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8").replace("<!-- DEMO_GALLERY -->", renderDemoSection());
}

const SHARED_STYLE = ":root{--bg:#0a0b0f;--surface:#12141a;--border:#232734;--text:#ecedef;--muted:#9ba1ae;--lo:#5a6072;--accent:#6e56cf;--accent-soft:#9e8cfc;}";

export function renderCollectionHtml(slug) {
  const m = loadCollection(slug);
  if (!m) return null;
  const title = escHtml(m.title || "Collection");
  const subtitle = escHtml(m.subtitle || "");
  const walletShort = escHtml(m.wallet_short || "");
  const images = m.images || [];
  const s = slugify(slug);
  const og = images.length ? `${PUBLIC_BASE}/c/${s}/img/${images[0]}` : `${PUBLIC_BASE}/og-card.png`;
  const pageUrl = `${PUBLIC_BASE}/c/${s}`;
  const tiles = images.map((name, i) =>
    `        <img src="/c/${s}/img/${escHtml(name)}" alt="${title} #${i + 1}" loading="lazy" decoding="async" />`).join("\n");
  const by = walletShort ? `<p class="by">by ${walletShort}</p>` : "";
  const sub = subtitle ? `<p class="sub">${subtitle}</p>` : "";
  const cta = APP_CTA + (m.ref_code ? `&ref=${m.ref_code}` : "");
  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} — made with w3ir.io</title>
  <meta name="description" content="An NFT collection of ${images.length} items, made with w3ir.io. Make your own in minutes." />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${title} — Series Lab" />
  <meta property="og:description" content="An NFT collection made with Series Lab. Build your own: preset → recipes → release ZIP." />
  <meta property="og:url" content="${pageUrl}" />
  <meta property="og:image" content="${og}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content="${og}" />
  <link rel="canonical" href="${pageUrl}" />
  <style>
    /* Self-contained: the server CSP allows no third-party scripts, fonts or stylesheets (no Tailwind CDN, no Google Fonts). */
    @font-face{font-family:"Onest";font-weight:400 700;font-display:swap;src:url(/fonts/onest-cyrillic.woff2) format("woff2");unicode-range:U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116}
    @font-face{font-family:"Onest";font-weight:400 700;font-display:swap;src:url(/fonts/onest-latin.woff2) format("woff2");unicode-range:U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD}
    ${SHARED_STYLE}
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;background:var(--bg);color:var(--text);font:16px/1.5 "Onest",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
    a{color:inherit;text-decoration:none}
    .btn-accent{background:linear-gradient(135deg,var(--accent),var(--accent-soft));color:#fff}
    .btn-accent:hover{filter:brightness(1.08)}
    .wrap{max-width:64rem;margin:0 auto;padding:0 24px}
    header.wrap{display:flex;align-items:center;justify-content:space-between;padding-top:20px;padding-bottom:20px;gap:12px}
    .brand{display:flex;align-items:center;gap:8px;font-weight:600;letter-spacing:-.01em}
    .logo{display:grid;place-items:center;width:32px;height:32px;border-radius:8px;font-size:14px;font-weight:800}
    .pill{border-radius:8px;padding:10px 16px;font-size:14px;font-weight:600;min-height:44px;display:inline-flex;align-items:center}
    h1{margin:0;font-size:clamp(1.9rem,4vw,2.4rem);font-weight:800;letter-spacing:-.02em;line-height:1.15}
    .by{margin:4px 0 0;font-size:14px;color:var(--lo)}
    .sub{margin:12px 0 0;color:var(--muted)}
    .meta{margin:8px 0 0;font-size:12px;color:var(--lo)}
    .meta a{color:var(--accent-soft)}
    .meta a:hover{text-decoration:underline}
    .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;padding:32px 0}
    @media(min-width:640px){.grid{grid-template-columns:repeat(3,1fr)}}
    @media(min-width:768px){.grid{grid-template-columns:repeat(4,1fr)}}
    .grid img{display:block;width:100%;aspect-ratio:1;object-fit:cover;border-radius:12px;border:1px solid var(--border)}
    .cta{margin:0 0 64px;padding:32px 24px;border:1px solid var(--border);border-radius:16px;background:var(--surface);text-align:center}
    .cta h2{margin:0;font-size:1.25rem;font-weight:700;letter-spacing:-.01em}
    .cta p{max-width:28rem;margin:8px auto 0;font-size:14px;color:var(--muted)}
    .cta .big{margin-top:20px;border-radius:12px;padding:12px 28px;font-weight:600;display:inline-flex;align-items:center;min-height:44px}
    a:focus-visible{outline:2px solid var(--accent-soft);outline-offset:2px}
  </style>
</head>
<body>
  <header class="wrap">
    <a href="${PUBLIC_BASE}" class="brand">
      <span class="logo btn-accent">S</span>
      <span>Series Lab</span>
    </a>
    <a href="${cta}" class="btn-accent pill">Make your own →</a>
  </header>

  <section class="wrap" style="padding-top:24px">
    <h1>${title}</h1>
    ${by}
    ${sub}
    <p class="meta">${images.length} items · made with <a href="${PUBLIC_BASE}">Series Lab</a></p>
  </section>

  <section class="wrap">
    <div class="grid">
${tiles}
    </div>
  </section>

  <section class="wrap">
    <div class="cta">
      <h2>Make a collection like this</h2>
      <p>Preset → recipes → images → release ZIP. Sign in with a wallet. Pay-as-you-go, non-custodial.</p>
      <a href="${cta}" class="btn-accent big">Open Series Lab →</a>
    </div>
  </section>
</body>
</html>
`;
}

// ── Legal (markdown subset → branded HTML) ───────────────────────────────────
function inline(text) {
  let out = escHtml(text);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    if (href === "LEGAL.md") href = "/legal/en";
    else if (href === "УМОВИ.md" || href === "%D0%A3%D0%9C%D0%9E%D0%92%D0%98.md") href = "/legal";
    if (!/^(https?:\/\/|mailto:|\/|#)/.test(href)) return label;
    return `<a href="${href}" class="text-[var(--accent-soft)] hover:underline">${label}</a>`;
  });
}

export function mdToHtml(md) {
  const parts = [];
  let para = [], ul = [], quote = [];
  const flushPara = () => { if (para.length) { parts.push(`<p>${para.join(" ")}</p>`); para = []; } };
  const flushUl = () => { if (ul.length) { parts.push(`<ul>${ul.map((li) => `<li>${li}</li>`).join("")}</ul>`); ul = []; } };
  const flushQuote = () => { if (quote.length) { parts.push(`<blockquote>${quote.join(" ")}</blockquote>`); quote = []; } };
  const flushAll = () => { flushPara(); flushUl(); flushQuote(); };
  for (const raw of md.replace(/\r\n/g, "\n").split("\n")) {
    const s = raw.trimEnd().trim();
    if (!s) { flushAll(); continue; }
    if (s === "---") { flushAll(); parts.push("<hr/>"); continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(s);
    if (h) { flushAll(); parts.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
    if (s.startsWith("> ")) { flushPara(); flushUl(); quote.push(inline(s.slice(2))); continue; }
    if (s.startsWith("- ")) { flushPara(); flushQuote(); ul.push(inline(s.slice(2))); continue; }
    flushUl(); flushQuote();
    para.push(inline(s));
  }
  flushAll();
  return parts.join("\n");
}

const legalCache = new Map();
export function renderLegalHtml(lang = "uk") {
  const l = lang === "en" ? "en" : "uk";
  if (legalCache.has(l)) return legalCache.get(l);
  const p = siteFile(l === "en" ? "LEGAL.md" : "UMOVY.md");
  if (!existsSync(p)) return null;
  const title = l === "uk" ? "Правові документи" : "Legal";
  const [otherHref, otherLabel] = l === "uk" ? ["/legal/en", "EN"] : ["/legal", "UA"];
  const html = `<!DOCTYPE html>
<html lang="uk" class="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escHtml(title)} — w3ir.io</title>
  <meta name="robots" content="all" />
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;800&display=swap" rel="stylesheet" />
  <style>
    ${SHARED_STYLE}
    *{font-family:'Inter',system-ui,sans-serif}
    body{margin:0;background:var(--bg);color:var(--text)}
    .doc h1{font-size:1.9rem;font-weight:800;margin:0 0 .5rem}
    .doc h2{font-size:1.35rem;font-weight:700;margin:2rem 0 .6rem;padding-top:1rem;border-top:1px solid var(--border)}
    .doc h3{font-size:1.05rem;font-weight:600;margin:1.2rem 0 .4rem;color:var(--accent-soft)}
    .doc p,.doc li{color:var(--muted);line-height:1.65;font-size:.95rem}
    .doc ul{margin:.3rem 0 .8rem 1.1rem}
    .doc li{margin:.25rem 0}
    .doc code{background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:.05rem .35rem;font-size:.85em;color:var(--accent-soft)}
    .doc blockquote{border-left:3px solid var(--accent);background:var(--surface);margin:1rem 0;padding:.7rem 1rem;border-radius:0 8px 8px 0;color:var(--text)}
    .doc hr{border:0;border-top:1px solid var(--border);margin:1.5rem 0}
    .doc strong{color:var(--text)}
  </style>
</head>
<body class="min-h-screen">
  <header class="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
    <a href="${PUBLIC_BASE}" class="flex items-center gap-2">
      <div class="grid h-8 w-8 place-items-center rounded-lg text-sm font-extrabold text-white" style="background:linear-gradient(135deg,var(--accent),var(--accent-soft))">N</div>
      <span class="font-semibold tracking-tight">NFT Prompt Builder</span>
    </a>
    <a href="${otherHref}" class="text-sm text-[var(--accent-soft)] hover:underline">${otherLabel}</a>
  </header>
  <main class="doc mx-auto max-w-3xl px-6 pb-20 pt-4">
${mdToHtml(readFileSync(p, "utf8"))}
  </main>
  <footer class="mx-auto max-w-3xl px-6 py-8 text-xs text-[var(--lo)] border-t border-[var(--border)]">
    <a href="${APP_URL}" class="text-[var(--accent-soft)] hover:underline">Запустити застосунок →</a>
    &nbsp;·&nbsp; <a href="${PUBLIC_BASE}" class="hover:underline">w3ir.io</a>
  </footer>
</body>
</html>`;
  legalCache.set(l, html);
  return html;
}
