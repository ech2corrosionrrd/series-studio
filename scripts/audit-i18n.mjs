/**
 * Fail when studio/site UI text is hardcoded, or a locale key is missing
 * from uk or en. Server error strings that the UI can show must map in
 * server/ui/api-errors.js (the server text itself stays stable for tests).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import uk from "../server/ui/locales/uk.js";
import en from "../server/ui/locales/en.js";
import tips from "../server/ui/locales/tips.mjs";
import { exactErrorKeys, errorPatternCovers } from "../server/ui/api-errors.js";

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
  "server/site/landing.html",
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

const landing = readFileSync("server/site/landing.html", "utf8");
const ukLanding = dictKeys(landing, "UK");
if (ukLanding) requireDict("server/site/landing.html", stripBlocks(landing), ukLanding, "UK");

const login = readFileSync("server/site/login.html", "utf8");
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

const app = readFileSync("server/ui/app.js", "utf8");
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

if (issues.length) {
  console.error(`i18n audit: ${issues.length} problem(s)`);
  for (const line of issues) console.error(" -", line);
  process.exit(1);
}
console.log(`i18n audit ok (${ukKeys.size} keys, uk/en match)`);
