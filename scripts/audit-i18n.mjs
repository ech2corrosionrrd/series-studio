/**
 * Fail when studio/site UI text is hardcoded, or a locale key is missing
 * from uk or en. Server error strings that the UI can show must map in
 * server/ui/api-errors.js (the server text itself stays stable for tests).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readUiSource } from "./ui-source.mjs";
import uk from "../server/ui/locales/uk.js";
import en from "../server/ui/locales/en.js";
import tips from "../server/ui/locales/tips.mjs";
import { exactErrorKeys, errorPatternCovers } from "../server/ui/api-errors.js";
import { buildLaunchAdvisor } from "../src/launch-advisor.mjs";

const issues = [];
const fail = (msg) => issues.push(msg);

const ukKeys = new Set([...Object.keys(uk), ...Object.keys(tips.uk || {})]);
const enKeys = new Set([...Object.keys(en), ...Object.keys(tips.en || {})]);
for (const k of ukKeys) if (!enKeys.has(k)) fail(`en missing key ${k}`);
for (const k of enKeys) if (!ukKeys.has(k)) fail(`uk missing key ${k}`);
for (const k of Object.keys(tips.uk || {})) {
  if (!(k in (tips.en || {}))) fail(`tips.en missing ${k}`);
}
for (const k of Object.keys(tips.en || {})) {
  if (!(k in (tips.uk || {}))) fail(`tips.uk missing ${k}`);
}

function stripBlocks(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
}

function allowedText(raw) {
  const s = String(raw).replace(/\s+/g, " ").trim();
  if (!s) return true;
  if (!/\p{L}/u.test(s)) return true;
  if (s.length <= 2) return true;
  const brands = new Set([
    "Series Lab", "w3ir", "W3IR", "UK", "EN", "UA", "Studio", "ZIP", "DNA",
    "USDC", "IPFS", "NFT", "API", "GPU", "FAQ", "PNG", "EVM", "SOL", "ETH",
    "BTC", "Pro", "OpenSea", "MetaMask", "Phantom", "SIWE", "EIP-4361",
  ]);
  if (brands.has(s)) return true;
  if (/^[A-Z0-9]{1,8}$/.test(s)) return true;
  if (/^[\d\s,./:+\-–—·#×✕$]+$/u.test(s)) return true;
  if (/^[\w.-]+\.[a-z]{2,}(?:\s*→)?$/i.test(s)) return true;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return true;
  const decoded = s.replace(/&(?:nbsp|amp|lt|gt|#\d+|#x[\da-f]+);/gi, " ");
  if (decoded !== s && allowedText(decoded)) return true;
  return false;
}

function scanHtml(file, html) {
  const src = stripBlocks(html);
  const stack = [];
  const re = /<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|<\/([a-zA-Z0-9]+)>|<([a-zA-Z0-9]+)([^>]*)>|([^<]+)/gi;
  let m;
  while ((m = re.exec(src))) {
    if (m[0].startsWith("</")) {
      const name = m[1].toLowerCase();
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === name) { stack.splice(i, 1); break; }
      }
      continue;
    }
    if (m[2]) {
      const name = m[2].toLowerCase();
      const attrs = m[3] || "";
      const self = /\/>$/.test(m[0]) || ["img", "input", "meta", "br", "hr", "link"].includes(name);
      const has = (attr) => new RegExp(`\\b${attr}\\b`, "i").test(attrs);
      const valOf = (attr) => {
        const mm = attrs.match(new RegExp(`${attr}\\s*=\\s*"([^"]*)"`, "i"))
          || attrs.match(new RegExp(`${attr}\\s*=\\s*'([^']*)'`, "i"));
        return mm ? mm[1] : "";
      };
      const keyed = has("data-i18n") || has("data-i18n-html");
      for (const [attr, hook] of [
        ["placeholder", "data-i18n-placeholder"],
        ["title", "data-i18n-title"],
        ["aria-label", "data-i18n-aria"],
        ["alt", "data-i18n-alt"],
        ["content", "data-i18n-content"],
      ]) {
        if (!has(attr) || has(hook)) continue;
        if (attr === "content" && !/\bname\s*=\s*"description"/i.test(attrs)) continue;
        const value = valOf(attr);
        if (!allowedText(value)) {
          fail(`${file}: hardcoded ${attr} "${value.slice(0, 80)}"`);
        }
      }
      const keyAttrs = ["data-i18n", "data-i18n-html", "data-i18n-title", "data-i18n-placeholder", "data-i18n-aria", "data-i18n-alt", "data-i18n-content", "data-i18n-tip"];
      for (const hook of keyAttrs) {
        if (!has(hook)) continue;
        const key = valOf(hook);
        if (key && !ukKeys.has(key) && file.startsWith("server/ui/")) {
          fail(`${file}: unknown key ${hook}="${key}"`);
        }
      }
      if (!self) stack.push({ name, keyed });
      continue;
    }
    if (m[4] && stack.some((f) => f.keyed)) continue;
    const text = m[4] || "";
    if (!allowedText(text)) {
      const top = stack[stack.length - 1];
      if (top?.keyed) continue;
      fail(`${file}: hardcoded text "${text.replace(/\s+/g, " ").trim().slice(0, 80)}"`);
    }
  }
}

for (const file of [
  "server/ui/index.html",
  "server/site/login.html",
  "server/public/index.html",
]) {
  scanHtml(file, readFileSync(file, "utf8"));
}

function dictKeys(html, varName) {
  const start = html.indexOf(`${varName} = {`);
  if (start < 0) return null;
  const end = html.indexOf("\n};", start);
  const body = html.slice(start, end < 0 ? undefined : end);
  return new Set([...body.matchAll(/^\s*"([^"]+)"\s*:/gm)].map((m) => m[1]));
}

function requireDict(file, html, keys, label) {
  const used = new Set();
  for (const m of html.matchAll(/data-i18n(?:-aria|-title|-alt|-content|-placeholder)?="([^"]+)"/g)) {
    used.add(m[1]);
  }
  for (const key of used) {
    if (!keys.has(key)) fail(`${file}: ${label} missing ${key}`);
  }
}


const login = [readFileSync("server/site/login.html", "utf8"), readFileSync("server/site/login.js", "utf8")].join("\n");
// I18N.uk / I18N.en live inside one object. Slice each branch.
function sliceBranch(src, name) {
  const marker = `${name}: {`;
  const start = src.indexOf(marker);
  if (start < 0) return new Set();
  const from = start + marker.length;
  let depth = 1;
  let i = from;
  while (i < src.length && depth) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }
  const body = src.slice(from, i - 1);
  return new Set([...body.matchAll(/(?:^|[{,])\s*"?([A-Za-z0-9_.]+)"?\s*:/gm)].map((m) => m[1]));
}
const loginUkKeys = sliceBranch(login, "uk");
const loginEnKeys = sliceBranch(login, "en");
for (const k of loginUkKeys) if (!loginEnKeys.has(k)) fail(`login en missing ${k}`);
for (const k of loginEnKeys) if (!loginUkKeys.has(k)) fail(`login uk missing ${k}`);
requireDict("server/site/login.html", stripBlocks(login), loginUkKeys, "I18N.uk");
requireDict("server/site/login.html", stripBlocks(login), loginEnKeys, "I18N.en");

const app = readUiSource();
for (const m of app.matchAll(/\bt\(\s*"([^"]+)"/g)) {
  if (!ukKeys.has(m[1])) fail(`app.js t() missing key ${m[1]}`);
}
for (const m of app.matchAll(/\b(?:hasKey|tipText|tipAttr)\(\s*"([^"]+)"/g)) {
  if (!ukKeys.has(m[1]) && !m[1].endsWith(".tip")) fail(`app.js missing key ${m[1]}`);
}
const code = app
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");
for (const m of code.matchAll(/(['"`])([^'"`\n]*[\u0400-\u04FF][^'"`\n]*)\1/g)) {
  fail(`app.js Cyrillic literal "${m[2].slice(0, 80)}"`);
}
for (const m of code.matchAll(/textContent\s*=\s*"([^"]+)"/g)) {
  if (!allowedText(m[1])) fail(`app.js textContent "${m[1].slice(0, 80)}"`);
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "ui" || name === "site" || name === "public") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (p.endsWith(".mjs")) acc.push(p);
  }
  return acc;
}

const exact = exactErrorKeys();
for (const file of [...walk("server"), ...walk("src")]) {
  const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const lits = [
    ...text.matchAll(/error:\s*"([^"\\]*)"/g),
    ...text.matchAll(/new HttpError\(\s*\d+\s*,\s*"([^"\\]*)"/g),
  ];
  for (const m of lits) {
    if (!exact[m[1]]) fail(`${file}: unmapped error "${m[1].slice(0, 100)}"`);
  }
  const tpls = [
    ...text.matchAll(/error:\s*`([^`]*)`/g),
    ...text.matchAll(/new HttpError\(\s*\d+\s*,\s*`([^`]*)`/g),
  ];
  for (const m of tpls) {
    if (!m[1].includes("${")) {
      if (!exact[m[1]]) fail(`${file}: unmapped error "${m[1].slice(0, 100)}"`);
      continue;
    }
    const sample = m[1].replace(/\$\{[^}]*\}/g, "X");
    if (!errorPatternCovers(sample)) fail(`${file}: unmapped template "${sample.slice(0, 120)}"`);
  }
}

const SCRIPT_ALLOW = new Set(`
series lab opensea magic eden pinata ipfs arweave irys solana ethereum bitcoin ordinals
metaplex phantom metamask solflare tensor thirdweb launchmynft kohya replicate comfyui
automatic1111 a1111 flux kontext schnell openai stability pollinations runware telegram
gremlin midjourney claude sdxl sugar candy machine core mplx fal vision mock nft gpt bfl
unisat okx gamma satflow ordzaar hashlips w3ir zip png json csv html txt jpg jpeg webp
gif svg mp4 pdf yaml yml toml sha cid uri url http https api gpu faq dna usdc sol eth c2pa xmp
btc evm erc eip cli rpc env css wav webm utf ascii llm tma b2b csrf wasm rgb hsl pfp qa
bps devnet mainnet signet sepolia img2img txt2img lora coinbase rainbow ordinalsbot sharp
pro dev comfy genesis sybil deeplink english usd nftstorage irys studio creator hub wallet taproot discord
`.split(/\s+/).filter(Boolean));

const SCRIPT_EXEMPT = new Set(["base.wish.wrapPrefix", "lang.name.uk", "lang.name.en"]);

function latinWordsOutsideGloss(value, { keepCaps = false } = {}) {
  let stripped = String(value)
    .replace(/\{[^}]+\}/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/(?:[\w.-]+\/)+[\w.<>-]*/g, " ")
    .replace(/\b[\w.-]+\.[A-Za-z0-9]{1,8}\b/g, " ");
  if (keepCaps) stripped = stripped.replace(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g, " ");
  else stripped = stripped.replace(/\b[A-Z][A-Z0-9_]{2,}\b/g, " ");
  return [...stripped.matchAll(/[A-Za-z][A-Za-z0-9]*/g)]
    .map((m) => m[0])
    .filter((w) => w.replace(/[0-9]/g, "").length >= 3);
}

function auditLocaleScript(locale, dict) {
  for (const [key, value] of Object.entries(dict)) {
    if (SCRIPT_EXEMPT.has(key) || /\.ph$/.test(key)) continue;
    const text = String(value);
    if (locale === "en") {
      if (/[\u0400-\u04FF]/.test(text)) fail(`en Cyrillic in ${key}`);
      continue;
    }
    const bad = [...new Set(latinWordsOutsideGloss(text, { keepCaps: true }).filter((w) => !SCRIPT_ALLOW.has(w.toLowerCase())))];
    for (const word of bad) fail(`uk Latin "${word}" in ${key}`);
  }
}

auditLocaleScript("uk", { ...uk, ...(tips.uk || {}) });
auditLocaleScript("en", { ...en, ...(tips.en || {}) });

for (const word of ["rug", "unverified"]) {
  if (SCRIPT_ALLOW.has(word)) fail(`allowlist must not include ${word}`);
}

function advisorFields(locale) {
  const rows = [];
  for (const chain of ["solana", "evm", "bitcoin"]) {
    const data = buildLaunchAdvisor({ chain, locale });
    rows.push(["holder", data.holderTemplate]);
    for (const section of data.sections) {
      rows.push([`${section.id}.title`, section.title]);
      rows.push([`${section.id}.lead`, section.lead]);
      for (const [i, para] of (section.paragraphs || []).entries()) rows.push([`${section.id}.p${i}`, para]);
      for (const item of section.checks || []) rows.push([item.id, item.text]);
      for (const [i, item] of (section.links || []).entries()) rows.push([`${section.id}.link${i}`, item.label]);
    }
  }
  return rows;
}

for (const [key, value] of advisorFields("uk")) {
  const bad = [...new Set(latinWordsOutsideGloss(value, { keepCaps: true }).filter((w) => !SCRIPT_ALLOW.has(w.toLowerCase())))];
  for (const word of bad) fail(`uk Latin "${word}" in advisor ${key}`);
}
for (const [key, value] of advisorFields("en")) {
  if (/[\u0400-\u04FF]/.test(String(value))) fail(`en Cyrillic in advisor ${key}`);
}

if (issues.length) {
  console.error(`i18n audit: ${issues.length} problem(s)`);
  for (const line of issues) console.error(" -", line);
  process.exit(1);
}
console.log(`i18n audit ok (${ukKeys.size} keys, uk/en match)`);
