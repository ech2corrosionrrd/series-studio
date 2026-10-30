/**
 * Help tab: built from locale keys, works offline.
 * Moved out of app.js without a change in behaviour (docs/QUALITY-REVIEW.md, item 6). The module graph is circular on purpose:
 * every import is a function or a binding that is only used after all modules have loaded.
 */
import { getLocale, t } from "./i18n.js";
import { $, showTab, state } from "./app.js";
import { escapeHtml } from "./app-overview.js";
import { helpMatches } from "./help-search.js";

/* ---------- Help (built from locale keys, works offline) ---------- */
const HELP_STEPS = [
  ["s1", "home"], ["s2", "base"], ["s3", "ctor"], ["s4", "recipes"],
  ["s5", "render"], ["s6", "gallery"], ["s7", "export"],
  ["s9", "deploy"], ["s10", "market"], ["s8", "admin"],
];
const HELP_CLI = [
  ["doctor", "doctor"],
  ["engines", "engines"],
  ["validate", "validate presets/demo-series.json"],
  ["build", "build presets/demo-series.json -o out/demo-archive.json"],
  ["render", "render presets/demo-series.json --engine mock --limit 5"],
  ["triage", "triage out/mock-s0.45 --provider heuristic --apply"],
  ["upscale", "upscale out/fal-s0.45"],
  ["repairPng", "repair-png out/pollinations-s0.45 --dry-run"],
  ["c2pa", "c2pa out/fal-s0.45 --cert signer-chain.pem --key signer-key.pem"],
  ["pin", "pin out/fal-s0.45 --name my-series"],
  ["manifest", "manifest out/demo-archive.json --profile opensea"],
  ["showcase", "showcase out/demo-archive.json -o out/showcase.html"],
  ["provenance", "provenance out/fal-s0.45 -o out/provenance.json"],
  ["dataset", "dataset out/demo-archive.json --images out/fal-s0.45 --trigger my_hero -o out/dataset.zip"],
  ["release", "release-config out/demo-archive.json --profile magiceden -o out/cm-config.json"],
  ["guards", "guards release.json --allowlist wallets.txt"],
  ["hidden", "hidden <bundle-dir> --uri <hidden.json-link>"],
  ["mint", "mint release.json --keypair minter.json"],
  ["reveal", "reveal <bundle-dir> --keypair creator.json"],
  ["compose", "compose out/demo-archive.json --layers layers --base input/primary.png"],
  ["diffSeed", "diff-seed presets/demo-series.json"],
  ["upload", "upload <bundle-dir> --keypair deployer.json"],
  ["releaseInit", "release-init out/demo-archive.json -o release.json"],
  ["verify", "verify release.json"],
  ["notify", "notify \"Done\""],
];
const HELP_DOC_PAGES = [
  ["guide", "help.doc.guide.title", "help.doc.guide"],
  ["stages", "help.doc.stages.title", "help.doc.stages"],
  ["tabs", "help.doc.tabs.title", "help.doc.tabs"],
  ["base", "help.doc.base.title", "help.doc.base"],
  ["traits", "help.doc.traits.title", "help.doc.traits"],
  ["export", "help.doc.export.title", "help.doc.export"],
  ["preset", "help.doc.preset.title", "help.doc.preset"],
];

function studioDocHref(slug) {
  return `/studio/docs/${getLocale() === "en" ? "en/" : ""}${slug}/`;
}

/** Strings for `${prefix}1`, `${prefix}2`, … while the locale defines them. */
export function tList(prefix) {
  const out = [];
  for (let i = 1; i < 100; i++) {
    const key = `${prefix}${i}`;
    const s = t(key);
    if (s === key) break;
    out.push(s);
  }
  return out;
}

/** The public support address (also on the Terms page). One place, so a change is one line. */
export const SUPPORT_EMAIL = "w3ir@pm.me";

/** Escapes a help text and turns `inline code` into <code>: the texts quote commands in backticks. */
export const rich = (s) => escapeHtml(s).replace(/`([^`]+)`/g, "<code>$1</code>");
const esc = (key) => rich(t(key));
const helpList = (prefix, tag = "ul") =>
  `<${tag}>${tList(prefix).map((s) => `<li>${rich(s)}</li>`).join("")}</${tag}>`;

/** Where to write and where the legal pages are. The legal paths are served by the Lab host (a redirect to the public site). */
function supportSection() {
  const mail = `<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>`;
  const en = getLocale() === "en" ? "/en" : "";
  return `<div class="help-item"><p>${esc("help.support.desc").replace("{email}", mail)}</p></div>
    <div class="help-item"><p>${esc("help.support.legalDesc")}</p>
      <ul class="help-docs">
        <li><a href="${en}/terms/" target="_blank" rel="noopener">${esc("help.support.terms")}</a></li>
        <li><a href="${en}/privacy/" target="_blank" rel="noopener">${esc("help.support.privacy")}</a></li>
      </ul></div>`;
}

function helpSections() {
  const isAdmin = Boolean(state.account?.admin);
  const stepDefs = isAdmin ? HELP_STEPS : HELP_STEPS.filter(([id]) => id !== "s8");
  const steps = stepDefs.map(([id, tab], i) => `
    <details class="help-step help-item" ${i === 0 ? "open" : ""}>
      <summary><span class="help-step-n">${id === "s8" ? "⚙" : (i + 1)}</span>${escapeHtml(t(`help.${id}.title`).replace(/^(\d+\s*·|💰|⚙)\s*/u, ""))}</summary>
      <div class="help-step-body">
        ${id === "s9" ? `<p class="help-note">${esc("help.s9.intro")}</p>` : ""}
        <p class="help-why"><b>${esc("help.label.why")}:</b> ${esc(`help.${id}.why`)}</p>
        <h4>${esc("help.label.do")}</h4>${helpList(`help.${id}.do`, "ol")}
        <p class="help-get"><b>${esc("help.label.get")}:</b> ${esc(`help.${id}.get`)}</p>
        <h4>${esc("help.label.oops")}</h4>${helpList(`help.${id}.oops`)}
        <button type="button" class="btn small" data-goto="${tab}">${esc("help.open")}</button>
      </div>
    </details>`).join("");

  const glossary = tList("help.gl").map((s) => {
    const [term, ...rest] = s.split(" — ");
    return `<div class="help-item gl-row"><dt>${rich(term)}</dt><dd>${rich(rest.join(" — "))}</dd></div>`;
  }).join("");

  const faq = tList("help.faq.q").map((q, i) => `
    <details class="help-item faq-item"><summary>${rich(q)}</summary><p>${esc(`help.faq.a${i + 1}`)}</p></details>`).join("");

  const cli = HELP_CLI.map(([k, cmd]) =>
    `<div class="help-item cli-row"><code>node bin/series.mjs ${escapeHtml(cmd)}</code><span>${esc(`help.cli.${k}`)}</span></div>`).join("");

  const docs = HELP_DOC_PAGES.map(([slug, titleKey, descKey]) =>
    `<li><a href="${studioDocHref(slug)}" target="_blank" rel="noopener">${esc(titleKey)}</a> — ${esc(descKey)}</li>`).join("");

  const localGpuEnv = isAdmin
    ? `<h4>${esc("help.localgpu.envTitle")}</h4>${helpList("help.localgpu.env.li")}`
    : "";

  const sections = [
    ["whatis", `<p>${esc("help.whatis.p1")}</p><p>${esc("help.whatis.p2")}</p>
      <div class="help-cards">${[1, 2, 3].map((n) => `<div class="help-card"><b>${esc(`help.whatis.card${n}.title`)}</b><span>${esc(`help.whatis.card${n}.desc`)}</span></div>`).join("")}</div>`],
    ["quick", `<p>${esc("help.quick.desc")}</p>${helpList("help.quick.li", "ol")}<p class="help-note">${esc("help.quick.tip")}</p>`],
    ["money", `<p>${esc("help.money.desc")}</p>${helpList("help.money.li")}`],
    ["steps", `<p>${esc("help.steps.desc")}</p>${steps}`],
    ["hybrid", `<p>${esc("help.hybrid.desc")}</p>${helpList("help.hybrid.li", "ol")}`],
    ["quality", `<p>${esc("help.quality.desc")}</p>${helpList("help.quality.li")}`],
    ["release", `<p>${esc("help.release.desc")}</p>${helpList("help.release.li", "ol")}`],
    ["licence", `<p>${esc("help.licence.desc")}</p>${helpList("help.licence.li")}`],
    ["safety", `<p>${esc("help.safety.desc")}</p>${helpList("help.safety.li")}`],
    ["zero", `<p>${esc("help.zero.desc")}</p>${helpList("help.zero.li")}`],
    ["localgpu", `<p>${esc("help.localgpu.desc")}</p>
      <h4>${esc("help.localgpu.whyTitle")}</h4><p>${esc("help.localgpu.why")}</p>
      <h4>${esc("help.localgpu.webTitle")}</h4>${helpList("help.localgpu.web.li")}
      <h4>${esc("help.localgpu.pcTitle")}</h4>${helpList("help.localgpu.pc.li", "ol")}
      ${localGpuEnv}
      <p class="help-note">${esc("help.localgpu.note")}</p>`],
    ["glossary", `<p>${esc("help.glossary.desc")}</p><dl class="help-gl">${glossary}</dl>`],
    ["faq", `<p>${esc("help.faq.desc")}</p>${faq}`],
    ["support", supportSection()],
  ];
  sections.push(["docs", `<div class="help-item"><p>${esc("help.docs.desc")}</p><ul class="help-docs">${docs}</ul></div>`]);
  if (isAdmin) {
    sections.push(
      ["cli", `<p>${esc("help.cli.desc")}</p><div class="help-cli">${cli}</div>`],
      ["run", `<p>${esc("help.run.desc")}</p>`],
    );
  }
  return sections;
}

export function renderHelp() {
  const body = $("help-body");
  const toc = $("help-toc");
  if (!body || !toc) return;
  const sections = helpSections();
  if (!sections.some(([id]) => id === state.helpActive)) state.helpActive = sections[0]?.[0] || "";
  body.innerHTML = sections.map(([id, html]) =>
    `<section class="help-sec card" id="help-${id}" data-help-id="${id}" data-keys="${escapeHtml(sectionKeys(id))}"><h2>${esc(`help.${id}.title`)}</h2>${html}</section>`).join("");
  toc.innerHTML = `<b>${esc("help.toc.title")}</b>` + sections.map(([id]) =>
    `<a href="#help-${id}" data-sec="${id}">${esc(`help.${id}.title`)}</a>`).join("");
  body.querySelectorAll("[data-goto]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.goto)));
  toc.querySelectorAll("a").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    state.helpActive = a.dataset.sec;
    filterHelp($("help-search")?.value || "");
    $(`help-${a.dataset.sec}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  filterHelp($("help-search")?.value || "");
}

/** Search-only words of a section (synonyms the text itself does not use); empty when the section has none. */
function sectionKeys(id) {
  const key = `help.${id}.keys`;
  const s = t(key);
  return s === key ? "" : s;
}

function filterHelp(query) {
  const q = query.trim().toLowerCase();
  let shown = 0;
  // Without a search the help is one section at a time (the whole text is over ten thousand characters); "show all" and the search lift that.
  const single = !q && !state.helpAll;
  document.querySelectorAll("#help-toc a").forEach((a) => a.classList.toggle("active", single && a.dataset.sec === state.helpActive));
  const toggle = $("help-all");
  if (toggle) {
    toggle.setAttribute("aria-pressed", state.helpAll ? "true" : "false");
    toggle.textContent = t(state.helpAll ? "help.all.off" : "help.all.on");
  }
  document.querySelectorAll("#help-body .help-sec").forEach((sec) => {
    const items = sec.querySelectorAll(".help-item");
    let secHit = !q || helpMatches(`${sec.querySelector("h2").textContent} ${sec.dataset.keys || ""}`, q);
    let itemHits = 0;
    items.forEach((it) => {
      const hit = !q || helpMatches(it.textContent, q);
      it.hidden = Boolean(q) && !hit && !secHit;
      if (q && hit) {
        itemHits++;
        if (it.tagName === "DETAILS") it.open = true;
      }
    });
    const visible = !q || secHit || itemHits > 0 || helpMatches(sec.textContent, q);
    sec.hidden = !visible || (single && sec.dataset.helpId !== state.helpActive);
    if (visible) shown++;
  });
  const count = $("help-search-count");
  if (count) count.textContent = q ? (shown ? t("help.search.count", { n: shown }) : t("help.search.none", { email: SUPPORT_EMAIL })) : "";
}

export function setupHelp() {
  renderHelp();
  $("help-search")?.addEventListener("input", (e) => filterHelp(e.target.value));
  $("help-all")?.addEventListener("click", () => {
    state.helpAll = !state.helpAll;
    filterHelp($("help-search")?.value || "");
  });
}
