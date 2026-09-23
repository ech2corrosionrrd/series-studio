/**
 * Series Lab UI i18n — flat key → string.
 * Default: uk. Persist: localStorage series-lab-locale.
 * Add a locale: drop server/ui/locales/<code>.js and register in LOCALES.
 */
import uk from "./locales/uk.js";
import en from "./locales/en.js";

const LOCALES = { uk, en };
const STORAGE_KEY = "series-lab-locale";
const DEFAULT = "uk";

let current = DEFAULT;
let dict = LOCALES[DEFAULT];

export function availableLocales() {
  return Object.keys(LOCALES);
}

export function getLocale() {
  return current;
}

export function t(key, vars) {
  let s = dict[key] ?? LOCALES[DEFAULT]?.[key] ?? key;
  if (vars && typeof s === "string") {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

/** True when the current (or default) locale defines `key`. */
export function hasKey(key) {
  return key in dict || key in (LOCALES[DEFAULT] || {});
}

/** Keys `${prefix}1`, `${prefix}2`, … that exist, in order. */
export function listKeys(prefix) {
  const keys = [];
  for (let i = 1; hasKey(`${prefix}${i}`); i++) keys.push(`${prefix}${i}`);
  return keys;
}

export function setLocale(code) {
  const next = LOCALES[code] ? code : DEFAULT;
  current = next;
  dict = LOCALES[next];
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
  applyI18n(document);
  document.documentElement.lang = next === "uk" ? "uk" : next;
  document.title = t("meta.title");
  window.dispatchEvent(new CustomEvent("series-lab:locale", { detail: { locale: next } }));
  return next;
}

export function initI18n() {
  let saved = DEFAULT;
  try {
    saved = localStorage.getItem(STORAGE_KEY) || DEFAULT;
  } catch {
    saved = DEFAULT;
  }
  if (!LOCALES[saved]) saved = DEFAULT;
  current = saved;
  dict = LOCALES[saved];
  document.documentElement.lang = saved === "uk" ? "uk" : saved;
  applyI18n(document);
  document.title = t("meta.title");
  return saved;
}

/**
 * Apply translations:
 * - [data-i18n="key"] → textContent
 * - [data-i18n-html="key"] → innerHTML (rare)
 * - [data-i18n-title="key"] → title
 * - [data-i18n-placeholder="key"] → placeholder
 * - [data-i18n-aria="key"] → aria-label
 */
export function applyI18n(root = document) {
  // [data-i18n-list="render.hint.li"] → <li> for render.hint.li1, li2, … (as many as the locale defines)
  root.querySelectorAll("[data-i18n-list]").forEach((el) => {
    const prefix = el.getAttribute("data-i18n-list");
    el.replaceChildren(...listKeys(prefix).map((key) => {
      const li = document.createElement("li");
      li.textContent = t(key);
      return li;
    }));
  });
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key) el.textContent = t(key);
  });
  root.querySelectorAll("[data-i18n-html]").forEach((el) => {
    const key = el.getAttribute("data-i18n-html");
    if (key) el.innerHTML = t(key);
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    if (key) el.setAttribute("title", t(key));
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (key) el.setAttribute("placeholder", t(key));
  });
  root.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    const key = el.getAttribute("data-i18n-aria");
    if (key) el.setAttribute("aria-label", t(key));
  });
}

export { LOCALES, STORAGE_KEY, DEFAULT };
