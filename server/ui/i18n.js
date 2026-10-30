/**
 * Series Lab UI i18n — flat key → string.
 * Default: uk. Persist: localStorage series-lab-locale.
 * Add a locale: drop server/ui/locales/<code>.js and register in LOCALES.
 */
import uk from "./locales/uk.js";
import en from "./locales/en.js";
import tips from "./locales/tips.mjs";

const LOCALES = {
  uk: { ...uk, ...(tips.uk || {}) },
  en: { ...en, ...(tips.en || {}) },
};
const STORAGE_KEY = "series-lab-locale";
const DEFAULT = "uk";

/** Elements that show a hover tip (purpose / how it works). */
const TIP_SELECTOR = [
  "button",
  "a.btn",
  "a[data-i18n]",
  "label",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "summary",
  "[data-tab]",
  "[data-admin]",
  ".lang-btn",
  ".hints-toggle",
  "[data-i18n-tip]",
].join(",");

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

/**
 * Show a message that is repainted when the language changes (BETA-REVIEW R10): `parts` is a list of plain strings and
 * `{ key, vars }` entries, stored with the element instead of only the finished text. A message somebody else has since
 * written over is left alone.
 */
export function setMessage(el, parts) {
  if (!el) return;
  const list = Array.isArray(parts) ? parts : [parts];
  const text = list.map((p) => (typeof p === "string" ? p : t(p.key, p.vars))).join("");
  el.textContent = text;
  el.dataset.msgLive = "1";
  msgs.set(el, { list, text });
}
const msgs = new WeakMap();
function repaintMessages() {
  document.querySelectorAll("[data-msg-live]").forEach((el) => {
    const m = msgs.get(el);
    if (!m || el.textContent !== m.text) return;
    m.text = m.list.map((p) => (typeof p === "string" ? p : t(p.key, p.vars))).join("");
    el.textContent = m.text;
  });
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
  repaintMessages();
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

/** Resolve tip text for a logical i18n key (button label, field name, …). */
export function tipText(key) {
  if (!key) return "";
  if (key.endsWith(".tip") && hasKey(key)) return t(key);
  if (hasKey(`${key}.tip`)) return t(`${key}.tip`);
  if (hasKey(`${key}.explain`)) return t(`${key}.explain`);
  if (hasKey(key) && /\.(title|hint)$/.test(key)) return t(key);
  return "";
}

function setTipAttrs(el, text) {
  if (!el || !text) return;
  el.setAttribute("data-tip", text);
  // Buttons/labels get the CSS bubble; form fields keep native title (no ::after on replaced elements).
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
    el.setAttribute("title", text);
  } else {
    el.removeAttribute("title");
  }
}

/**
 * Attach hover tips (title + data-tip) to interactive controls under `root`.
 * Call after building dynamic HTML (gallery tiles, trash rows, …).
 */
export function applyTips(root = document) {
  const scope = root.querySelectorAll ? root : document;
  const nodes = scope.matches?.(TIP_SELECTOR)
    ? [scope, ...scope.querySelectorAll(TIP_SELECTOR)]
    : [...scope.querySelectorAll(TIP_SELECTOR)];

  for (const el of nodes) {
    if (el.closest?.("[aria-hidden=true]")) continue;

    let text = "";
    const tipKey = el.getAttribute("data-i18n-tip");
    if (tipKey) text = tipText(tipKey) || (hasKey(tipKey) ? t(tipKey) : "");

    if (!text) {
      const titleKey = el.getAttribute("data-i18n-title");
      if (titleKey) text = hasKey(titleKey) ? t(titleKey) : tipText(titleKey);
    }

    if (!text) {
      const i18n = el.getAttribute("data-i18n");
      if (i18n) text = tipText(i18n);
    }

    if (!text) {
      const span = el.querySelector?.(":scope > span[data-i18n]");
      if (span) text = tipText(span.getAttribute("data-i18n"));
    }

    if (!text && el.id) text = tipText(`ctrl.${el.id}`);

    // Filter <option> tips → put on the parent <select> if it still has none
    if (!text && el.tagName === "SELECT") {
      const opt = el.selectedOptions?.[0] || el.options?.[0];
      const ok = opt?.getAttribute("data-i18n");
      if (ok) text = tipText(ok);
    }

    if (text) {
      setTipAttrs(el, text);
      if (el.tagName === "LABEL") {
        el.querySelectorAll("input, select, textarea").forEach((c) => {
          if (!c.getAttribute("data-i18n-title") && !c.getAttribute("data-i18n-tip")) {
            setTipAttrs(c, text);
          }
        });
      }
    }
  }

  // Labels that wrap a tipped control (no own text) inherit the child tip for hover.
  const labelRoot = scope.querySelectorAll ? scope : document;
  labelRoot.querySelectorAll("label").forEach((label) => {
    if (label.closest?.("[aria-hidden=true]")) return;
    // A tip that the label has of its own is left alone; one it only borrowed from its control is borrowed again, so it follows a language switch.
    if (label.getAttribute("data-tip") && label.dataset.tipInherited !== "1") return;
    const child = label.querySelector("[data-tip]");
    if (child?.getAttribute("data-tip")) {
      setTipAttrs(label, child.getAttribute("data-tip"));
      label.dataset.tipInherited = "1";
    }
  });
}

/**
 * Apply translations:
 * - [data-i18n="key"] → textContent
 * - [data-i18n-html="key"] → innerHTML (rare)
 * - [data-i18n-title="key"] → title
 * - [data-i18n-tip="key"] → title + data-tip (via applyTips)
 * - [data-i18n-placeholder="key"] → placeholder
 * - [data-i18n-aria="key"] → aria-label
 * Interactive controls also get a hover tip from `<key>.tip` / `.explain` / `ctrl.<id>.tip`.
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
  root.querySelectorAll("[data-i18n-alt]").forEach((el) => {
    const key = el.getAttribute("data-i18n-alt");
    if (key) el.setAttribute("alt", t(key));
  });
  applyTips(root);
}

export { LOCALES, STORAGE_KEY, DEFAULT };
