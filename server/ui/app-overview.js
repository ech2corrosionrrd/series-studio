/**
 * Overview tab and the presets / templates strip.
 * Moved out of app.js without a change in behaviour (docs/QUALITY-REVIEW.md, item 6). The module graph is circular on purpose:
 * every import is a function or a binding that is only used after all modules have loaded.
 */
import { fmtNum } from "./format.js";
import { applyTips, getLocale, t } from "./i18n.js";
import { $, api, showTab, state, tipAttr } from "./app.js";
import { fillConstructor } from "./app-options.js";
import { refreshWaves } from "./app-recipes.js";

/* ---------- Overview ---------- */
export function renderSteps() {
  const el = $("steps");
  if (!el) return;
  const hasBase = !!state.health?.base?.exists || (state.baseFiles && state.baseFiles.length > 0);
  const hasPreset = state.presets.length > 0;
  const hasArchive = state.archives.length > 0 || state.recipes.length > 0;
  const hasCollection =
    Boolean($("o-name")?.value?.trim() && $("o-seed")?.value?.trim() && Number($("o-size")?.value) > 0) ||
    hasPreset;
  const steps = [
    { tab: "home", key: "home", done: hasCollection },
    { tab: "base", key: "base", done: hasBase },
    { tab: "ctor", key: "ctor", done: hasPreset },
    { tab: "recipes", key: "recipes", done: hasArchive },
    { tab: "render", key: "render", done: false },
    { tab: "gallery", key: "gallery", done: false },
    { tab: "export", key: "export", done: hasArchive },
  ];
  let nextSet = false;
  el.innerHTML = "";
  for (const s of steps) {
    const li = document.createElement("li");
    if (s.done) li.classList.add("done");
    else if (!nextSet) {
      li.classList.add("next");
      nextSet = true;
    }
    li.innerHTML = `<b>${escapeHtml(t(`home.step.${s.key}`))}</b><span>${escapeHtml(t(`home.step.${s.key}.desc`))}</span>`;
    li.addEventListener("click", () => showTab(s.tab));
    el.appendChild(li);
  }
}

export function renderFacts() {
  const dl = $("facts");
  if (!dl) return;
  const p = state.presets[0];
  const arch = state.archives[0];
  const liveName = $("o-name")?.value?.trim() || p?.name;
  const liveId = $("o-id")?.value?.trim() || p?.id;
  const liveSize = $("o-size")?.value || p?.size;
  const liveSeed = $("o-seed")?.value?.trim() || p?.seed;
  const rows = [
    [t("home.fact.preset"), liveName || liveId ? `${liveName || "—"} (${liveId || p?.file || "—"})` : t("home.fact.none")],
    [t("home.fact.size"), liveSize ?? t("home.fact.none")],
    [t("home.fact.seed"), liveSeed || t("home.fact.none")],
    [t("home.fact.archive"), arch ? arch.file : state.archiveOut || t("home.fact.none")],
  ];
  dl.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(String(v))}</dd>`).join("");
}

export function renderCtorSummary() {
  const dl = $("ctor-summary");
  if (!dl) return;
  const rows = [
    [t("home.field.name"), $("o-name")?.value?.trim() || $("c-name")?.value?.trim() || "—"],
    [t("home.field.id"), $("o-id")?.value?.trim() || $("c-id")?.value?.trim() || "—"],
    [t("home.field.size"), $("o-size")?.value || $("c-size")?.value || "—"],
    [t("home.field.seed"), $("o-seed")?.value?.trim() || $("c-seed")?.value?.trim() || "—"],
    [t("home.field.engine"), $("o-engine")?.value || $("c-engine")?.value || "—"],
    [t("home.field.strength"), $("o-strength")?.value || $("c-strength")?.value || "—"],
  ];
  dl.innerHTML = rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd>`).join("");
}

export function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- Presets / templates ---------- */
export async function loadPresets() {
  const data = await api("/api/presets");
  state.presets = data.presets || [];
  fillPresetSelects();
}

export function fillPresetSelects() {
  for (const id of ["ctor-file", "r-preset"]) {
    const sel = $(id);
    if (!sel) continue;
    const cur = sel.value;
    sel.innerHTML = state.presets
      .map((p) => `<option value="${escapeHtml(p.file)}">${escapeHtml(p.name || p.id)} (${escapeHtml(p.file)})</option>`)
      .join("");
    if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
  }
  refreshWaves();
}

export async function loadTemplates() {
  const data = await api("/api/templates");
  state.templates = data.templates || [];
  renderTemplates();
}

export function renderTemplates() {
  const grid = $("tpl-grid");
  if (!grid) return;
  grid.innerHTML = "";
  for (const tpl of state.templates) {
    const card = document.createElement("div");
    card.className = "tpl-card";
    const title = tpl.titleUk && getLocale() === "uk" ? tpl.titleUk : tpl.name;
    card.innerHTML = `<b>${escapeHtml(title)}</b>
      <span class="tpl-blurb">${escapeHtml(tpl.blurb || tpl.id)}</span>
      <span class="muted small">${escapeHtml(tpl.id)} · ${escapeHtml(t("base.tpl.size", { n: fmtNum(tpl.size) }))}</span>
      <button type="button" class="btn small" data-id="${escapeHtml(tpl.id)}"${tipAttr("base.use")}>${t("base.use")}</button>`;
    card.querySelector("button").addEventListener("click", () => useTemplate(tpl.id));
    grid.appendChild(card);
  }
  applyTips(grid);
}

async function useTemplate(id) {
  const data = await api(`/api/templates/${encodeURIComponent(id)}`);
  const preset = data.preset;
  state.draftFull = preset;
  state.draftTraits = preset.traits;
  fillConstructor(preset);
  if ($("o-id")) {
    delete $("o-id").dataset.touched;
    delete $("o-seed").dataset.touched;
  }
  showTab("ctor");
  if ($("ctor-msg")) {
    $("ctor-msg").textContent = `${t("ctor.msg.loaded")}: ${preset.id}`;
    $("ctor-msg").className = "small ok-msg";
  }
  renderFacts();
  renderCtorSummary();
  renderSteps();
}
