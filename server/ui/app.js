/**
 * Series Lab Studio UI — tabs, Lab APIs, i18n (uk/en).
 * Prompts/recipe content stay English for generators.
 */
import { initI18n, setLocale, getLocale, t, applyI18n, applyTips, tipText, hasKey } from "./i18n.js";
import { parseSseBuffer, settleGenerateStream } from "./render-stream.js";
import { presentApiError } from "./api-errors.js";
import { fmtNum, fmtDate, fmtUsd as fmtUsdLocale, fmtPct as fmtPctLocale } from "./format.js";

function tipAttr(key) {
  const s = tipText(key);
  return s ? ` title="${escapeHtml(s)}" data-tip="${escapeHtml(s)}"` : "";
}

const state = {
  presets: [],
  templates: [],
  packs: [],
  recipes: [],
  traitMeta: [],
  archiveFile: null,
  archiveOut: null,
  archives: [],
  editingIndex: null,
  draftTraits: null,
  draftFull: null,
  activePackId: null,
  selectedTraitKey: null,
  baseFile: null,
  health: null,
  marks: loadMarks(), // legacy flat; gallery prefers per-set disk marks
  galleryDir: null,
  galleryDir2: null,
  galleryImages: [],
  galleryImages2: [],
  galleryMarks: {},
  galleryTriage: {},
  gallerySets: [],
  galleryShelved: [],
  galleryTrash: [],
  renderPlan: null,
  lastSet: null,
  rarity: null,
};

function loadMarks() {
  try {
    return JSON.parse(localStorage.getItem("series-lab-marks") || "{}");
  } catch {
    return {};
  }
}
function saveMarks() {
  localStorage.setItem("series-lab-marks", JSON.stringify(state.marks));
}

function playCompletionChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    [659.25, 987.77].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + i * 0.12);
      gain.gain.setValueAtTime(0.12, now + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.4);
    });
  } catch {}
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": getLocale(),
      ...(opts.headers || {}),
    },
    ...opts,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    if (res.status === 401 && data.code === "auth") {
      location.href = `/login${location.search}`;
      throw new Error(presentApiError(data.error ? data : { ...data, error: data.error || "Sign in required" }, t));
    }
    if (data.code === "credits" || data.code === "rate") refreshAccount();
    if (data.code === "credits") openTopup({ needed: data.needed, balance: data.balance });
    if (data.code === "lint" && Array.isArray(data.hits) && data.hits.length) {
      throw new Error(t("lint.blocked", { hits: data.hits.join(", ") }));
    }
    if (Array.isArray(data.conflicts) && data.conflicts.length) {
      const detail = data.conflicts
        .map((c) => `${c.a} ↔ ${c.b}${c.note ? ` (${c.note})` : ""}`)
        .join("; ");
      throw new Error(t("recipes.conflict", { detail }));
    }
    const fallback = data.error || data.detail || data.errors || res.statusText;
    const payload = { ...data, error: typeof fallback === "string" ? fallback : JSON.stringify(fallback ?? "") };
    const error = new Error(presentApiError(payload, t));
    error.payload = data;
    throw error;
  }
  return data;
}

function $(id) {
  return document.getElementById(id);
}

function showTab(name) {
  let adminPane = null;
  if (name === "res") {
    adminPane = "res";
    name = "admin";
  }
  if (name === "admin" && state.account && !state.account.admin) name = "home";
  document.querySelectorAll(".tab").forEach((el) => el.classList.toggle("on", el.id === `tab-${name}`));
  document.querySelectorAll("#tabs button").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.tab === name);
  });
  if (name === "export") {
    fillExportSets();
    fillArchiveSelect();
    showStagePrice("archive", "x-price", { zip: true });
  }
  if (name === "deploy" || name === "market") {
    fillExportSets().then(() => fillKitSets()).catch(() => {});
    showStagePrice(name === "deploy" ? "deploy_kit" : "marketplace_kit", name === "deploy" ? "d-price" : "m-price");
  }
  if (name === "gallery") showCurationPrice();
  renderPath(name);
  try {
    history.replaceState(null, "", `#${name}`);
  } catch {
    /* ignore */
  }
  if (name === "recipes") ensureRecipesLoaded();
  if (name === "gallery") ensureGalleryLoaded();
  if (name === "render") {
    lockGenerate(true);
    refreshLayersStatus();
  }
  if (name === "admin") {
    const current = document.querySelector(".admin-pane.on")?.id?.replace(/^admin-/, "");
    showAdminPane(adminPane || current || "res");
  }
}

function lockGenerate(locked) {
  const run = $("g-run");
  if (!run) return;
  run.disabled = Boolean(locked);
  run.classList.toggle("primary", !locked);
}

async function ensureGalleryLoaded() {
  await loadGallerySets();
  if (state.galleryDir) await loadGalleryDir(state.galleryDir);
  else {
    await loadSetTrash();
    renderGallery();
  }
}

async function ensureRecipesLoaded() {
  if (state.recipes?.length) {
    renderRecipeTable();
    return;
  }
  try {
    if (!state.archives?.length) await loadArchives();
  } catch {
    return;
  }
  const file = state.archiveFile || state.archives[0]?.file;
  if (!file) return;
  try {
    await loadRecipesArchive(file);
  } catch {
    /* the recipes tab still opens; build stays available */
  }
}

function setupTabs() {
  document.querySelectorAll("#tabs button").forEach((btn) => {
    btn.addEventListener("click", () => showTab(btn.dataset.tab));
  });
  document.querySelectorAll("[data-admin]").forEach((btn) => {
    btn.addEventListener("click", () => showAdminPane(btn.dataset.admin));
  });
  const hash = (location.hash || "").replace(/^#/, "");
  if (hash === "admin" || hash === "res") {
    state.pendingTab = hash;
    return;
  }
  if (hash && $(`tab-${hash}`)) showTab(hash);
}

function showAdminPane(name) {
  const pane = name || "res";
  document.querySelectorAll(".admin-pane").forEach((el) => el.classList.toggle("on", el.id === `admin-${pane}`));
  document.querySelectorAll("[data-admin]").forEach((btn) => btn.classList.toggle("on", btn.dataset.admin === pane));
  if (pane === "res") renderResources();
  else if (pane === "econ") renderEconomy();
  else renderSpend();
}

function applyAdminNav() {
  const admin = Boolean(state.account?.admin);
  const btn = $("nav-admin");
  if (btn) btn.hidden = !admin;
  if (!admin) {
    if ($("tab-admin")?.classList.contains("on")) showTab("home");
    return;
  }
  if (state.pendingTab) {
    const pending = state.pendingTab;
    state.pendingTab = null;
    showTab(pending);
  }
}

function setupHints() {
  const box = $("hints-on");
  const saved = localStorage.getItem("series-lab-hints");
  if (saved === "0") {
    box.checked = false;
    document.body.classList.add("no-hints");
  }
  box.addEventListener("change", () => {
    document.body.classList.toggle("no-hints", !box.checked);
    localStorage.setItem("series-lab-hints", box.checked ? "1" : "0");
  });
}

function setupLang() {
  const sync = () => {
    document.querySelectorAll(".lang-btn").forEach((b) => {
      b.classList.toggle("on", b.dataset.locale === getLocale());
    });
  };
  document.querySelectorAll(".lang-btn").forEach((b) => {
    b.addEventListener("click", () => {
      setLocale(b.dataset.locale);
      sync();
      refreshDynamicCopy();
    });
  });
  sync();
  window.addEventListener("series-lab:locale", () => {
    sync();
    refreshDynamicCopy();
    renderHelp();
  });
}

function refreshDynamicCopy() {
  loadLaunchAdvisor();
  renderSteps();
  renderFacts();
  renderCtorSummary();
  renderTemplates();
  renderPacks();
  renderTraitChecklist();
  renderPackSummary();
  renderOptionsEditor();
  renderRecipeTable();
  renderResources();
  syncCompareSelect();
  renderGallery();
  fillPresetSelects();
  fillArchiveSelect();
  relabelEngineSelects();
  const stub = $("g-plan-out");
  if (stub && !stub.dataset.dirty) stub.textContent = t("render.stub");
  const allOpt = $("r-line")?.querySelector('option[value=""]');
  if (allOpt) allOpt.textContent = t("recipes.allLines");
  const active = document.querySelector(".tab.on")?.id?.replace(/^tab-/, "") || "home";
  renderPath(active);
  if (active === "export") showStagePrice("archive", "x-price", { zip: true });
  if (active === "deploy") showStagePrice("deploy_kit", "d-price");
  if (active === "market") showStagePrice("marketplace_kit", "m-price");
  if (active === "gallery") showCurationPrice();
  if (active === "export") updateReleaseHub();
  if ($("topup-overlay") && !$("topup-overlay").hidden && typeof renderTopup === "function") renderTopup();
  if ($("admin-econ")?.classList.contains("on")) renderEconomy();
  const me = $("me");
  if (me?.dataset.mode === "port") me.textContent = t("ui.labPort", { port: me.dataset.port || "" });
  else if (me?.dataset.mode === "offline") me.textContent = t("ui.offline");
  applyTips(document);
}

/* ---------- Overview ---------- */
function renderSteps() {
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
    li.innerHTML = `<b>${t(`home.step.${s.key}`)}</b><span>${t(`home.step.${s.key}.desc`)}</span>`;
    li.addEventListener("click", () => showTab(s.tab));
    el.appendChild(li);
  }
}

function renderFacts() {
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


function renderCtorSummary() {
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

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- Presets / templates ---------- */
async function loadPresets() {
  const data = await api("/api/presets");
  state.presets = data.presets || [];
  fillPresetSelects();
}

function fillPresetSelects() {
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

async function loadTemplates() {
  const data = await api("/api/templates");
  state.templates = data.templates || [];
  renderTemplates();
}

function renderTemplates() {
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


/* ---------- Trait packs (library → snapshot) ---------- */
function deepCopyTraits(items) {
  return JSON.parse(JSON.stringify(Array.isArray(items) ? items : []));
}

function splitKeyField(s) {
  return String(s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function setKeyFields(changeKeys, extraKeys) {
  if ($("c-change")) $("c-change").value = (changeKeys || []).join(", ");
  if ($("c-extra")) $("c-extra").value = (extraKeys || []).join(", ");
}

function countOptions(items) {
  return (items || []).reduce((n, t) => n + (Array.isArray(t?.options) ? t.options.length : 0), 0);
}

async function loadTraitPacks() {
  const data = await api("/api/trait-packs");
  state.packs = data.packs || [];
  renderPacks();
  renderPackSummary();
  renderTraitChecklist();
  renderOptionsEditor();
}

function renderPacks() {
  const grid = $("pack-grid");
  if (!grid) return;
  grid.innerHTML = "";
  if (!state.packs.length) {
    const empty = document.createElement("p");
    empty.className = "muted small";
    empty.textContent = t("ctor.packs.empty");
    grid.appendChild(empty);
    return;
  }
  for (const pack of state.packs) {
    const card = document.createElement("div");
    card.className = "tpl-card pack-card";
    if (state.activePackId === pack.id) card.classList.add("on");
    const keysN = pack.keys?.length ?? 0;
    const optsN = pack.optionsTotal ?? Object.values(pack.optionCounts || {}).reduce((a, b) => a + b, 0);
    const tags = (pack.tags || []).join(", ");
    card.innerHTML = `<b>${escapeHtml(pack.name || pack.id)}</b>
      <span class="tpl-blurb">${escapeHtml(pack.description || "")}</span>
      <span class="muted small">${escapeHtml(pack.id)} · ${keysN} ${t("ctor.packs.keys")} · ${optsN} ${t("ctor.packs.options")}${tags ? ` · ${escapeHtml(tags)}` : ""}</span>
      <button type="button" class="btn small" data-id="${escapeHtml(pack.id)}"${tipAttr("ctor.packs.apply")}>${t("ctor.packs.apply")}</button>`;
    card.querySelector("button").addEventListener("click", () => applyTraitPack(pack.id));
    grid.appendChild(card);
  }
  applyTips(grid);
}

function renderPackSummary() {
  const el = $("pack-summary");
  if (!el) return;
  const items = state.draftTraits?.items || [];
  const n = items.length;
  const m = countOptions(items);
  if (!n) {
    el.textContent = t("ctor.packs.summaryEmpty");
    return;
  }
  el.textContent = t("ctor.packs.summary", { n: String(n), m: String(m) });
}

function renderTraitChecklist() {
  const wrap = $("pack-checklist-wrap");
  const box = $("pack-checklist");
  if (!wrap || !box) return;
  const items = state.draftTraits?.items || [];
  if (!items.length) {
    wrap.hidden = true;
    box.innerHTML = "";
    return;
  }
  wrap.hidden = false;
  const change = new Set(splitKeyField($("c-change")?.value));
  const extra = new Set(splitKeyField($("c-extra")?.value));
  box.innerHTML = "";
  for (const trait of items) {
    const key = trait.key;
    if (!key) continue;
    const opts = Array.isArray(trait.options) ? trait.options.length : 0;
    const inChange = change.has(key);
    const inExtra = extra.has(key);
    const enabled = inChange || inExtra;
    const selected = state.selectedTraitKey === key;
    const row = document.createElement("div");
    row.className = `pack-key${enabled ? "" : " off"}${selected ? " selected" : ""}`;
    const role = inExtra && !inChange ? t("ctor.packs.roleExtra") : inChange ? t("ctor.packs.roleChange") : t("ctor.packs.roleUnused");
    row.innerHTML = `<label style="display:flex;align-items:center;gap:6px;flex:1;cursor:pointer;min-width:0">
      <input type="checkbox" data-key="${escapeHtml(key)}" ${enabled ? "checked" : ""}>
      <span class="pack-key-name">${escapeHtml(key)}</span>
      <span class="muted small">${escapeHtml(trait.type || "")} · ${opts} ${t("ctor.packs.options")} · ${escapeHtml(role)}</span>
    </label>
    <button type="button" class="btn small pack-key-edit" data-edit-key="${escapeHtml(key)}"${tipAttr("ctor.options.editKey")}>${escapeHtml(t("ctor.options.editKey"))}</button>`;
    row.querySelector("input").addEventListener("change", (ev) => toggleTraitKey(key, ev.target.checked));
    row.querySelector("button[data-edit-key]").addEventListener("click", () => {
      selectTraitKey(key);
      $("ctor-options-card")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    box.appendChild(row);
  }
}

function toggleTraitKey(key, enabled) {
  let change = splitKeyField($("c-change")?.value);
  let extra = splitKeyField($("c-extra")?.value);
  if (enabled) {
    extra = extra.filter((k) => k !== key);
    if (!change.includes(key)) change.push(key);
  } else {
    change = change.filter((k) => k !== key);
    extra = extra.filter((k) => k !== key);
  }
  setKeyFields(change, extra);
  // keep items; only membership changes
  renderTraitChecklist();
  renderPackSummary();
  renderOptionsEditor();
}

async function applyTraitPack(id) {
  try {
    const data = await api(`/api/trait-packs/${encodeURIComponent(id)}`);
    const pack = data.pack;
    if (!pack?.items) throw new Error(t("ctor.packs.bad"));
    // Snapshot: deep-copy items into draft — not a live link to the library
    state.draftTraits = { items: deepCopyTraits(pack.items) };
    const packRules = pack.rules && typeof pack.rules === "object"
      ? structuredClone(pack.rules)
      : { conflicts: [] };
    if (state.draftFull) {
      state.draftFull = {
        ...state.draftFull,
        traits: state.draftTraits,
        rules: packRules,
      };
    } else {
      state.draftFull = {
        schema: "series-preset/v0",
        base: { path: "input/primary.png" },
        lines: { a: { who: "series subject", base: "input/primary.png", quota: 1 } },
        traits: state.draftTraits,
        rules: packRules,
        waves: null,
      };
    }
    state.activePackId = pack.id || id;
    const defs = pack.defaults || {};
    const allKeys = (pack.items || []).map((t) => t.key).filter(Boolean);
    const changeKeys = Array.isArray(defs.changeKeys) && defs.changeKeys.length ? defs.changeKeys : allKeys;
    const extraKeys = Array.isArray(defs.extraKeys) ? defs.extraKeys : [];
    // Do NOT overwrite Overview identity (c-* mirrors / o-*)
    setKeyFields(changeKeys, extraKeys);
    if (!state.selectedTraitKey || !allKeys.includes(state.selectedTraitKey)) {
      state.selectedTraitKey = allKeys[0] || null;
    }
    renderPacks();
    renderPackSummary();
    renderTraitChecklist();
    renderOptionsEditor();
    if ($("ctor-msg")) {
      $("ctor-msg").textContent = `${t("ctor.packs.applied")}: ${pack.name || pack.id}`;
      $("ctor-msg").className = "small ok-msg";
    }
  } catch (e) {
    if ($("ctor-msg")) {
      $("ctor-msg").textContent = e.message;
      $("ctor-msg").className = "small err-msg";
    }
  }
}

/* ---------- Wave 3 · options editor (series snapshot only) ---------- */
function normalizeOptionClient(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  const value = String(o.value ?? "").trim();
  let weight = Number(o.weight);
  if (!Number.isFinite(weight)) weight = 1;
  const prompt = String(o.prompt ?? "");
  const out = { value, weight, prompt };
  if (o.exact != null && o.exact !== "") {
    const exact = Number(o.exact);
    if (Number.isFinite(exact)) out.exact = exact;
  }
  if (Array.isArray(o.lines) && o.lines.length) out.lines = o.lines.map((x) => String(x));
  if (typeof o.since === "number" && o.since >= 1) out.since = o.since;
  return out;
}

function validateOptionsClient(list) {
  const errors = [];
  const warnings = [];
  const options = Array.isArray(list) ? list : [];
  if (!options.length) {
    errors.push(t("ctor.options.err.none"));
    return { ok: false, errors, warnings };
  }
  const seen = new Map();
  options.forEach((raw, i) => {
    const o = normalizeOptionClient(raw);
    if (!o.value) errors.push(t("ctor.options.err.value", { i: String(i + 1) }));
    if (!Number.isFinite(o.weight) || o.weight <= 0) {
      errors.push(t("ctor.options.err.weight", { i: String(i + 1) }));
    }
    if (raw.exact != null && raw.exact !== "" && (!Number.isInteger(Number(raw.exact)) || Number(raw.exact) < 0)) {
      errors.push(t("ctor.options.err.exact", { i: String(i + 1) }));
    }
    if (!String(o.prompt ?? "").trim()) {
      warnings.push(t("ctor.options.warn.prompt", { i: String(i + 1) }));
    }
    if (o.value) {
      if (seen.has(o.value)) {
        errors.push(t("ctor.options.err.dup", { value: o.value }));
      } else {
        seen.set(o.value, i);
      }
    }
  });
  return { ok: errors.length === 0, errors, warnings };
}

function ensureDraftTraits() {
  if (!state.draftTraits || !Array.isArray(state.draftTraits.items)) {
    state.draftTraits = { items: [] };
  }
  if (state.draftFull) state.draftFull.traits = state.draftTraits;
  return state.draftTraits;
}

function findTrait(key) {
  const items = state.draftTraits?.items || [];
  return items.find((t) => t.key === key) || null;
}

function selectTraitKey(key) {
  state.selectedTraitKey = key || null;
  renderTraitChecklist();
  renderOptionsEditor();
}

function renderOptionsEditor() {
  const sel = $("opt-trait-key");
  const wrap = $("opt-editor-wrap");
  const empty = $("opt-empty");
  const countEl = $("opt-count");
  const tbody = $("opt-tbody");
  const msg = $("opt-msg");
  if (!sel || !wrap || !tbody) return;

  const items = state.draftTraits?.items || [];
  const keys = items.map((t) => t.key).filter(Boolean);
  const prev = state.selectedTraitKey;
  sel.innerHTML = "";
  if (!keys.length) {
    state.selectedTraitKey = null;
    wrap.hidden = true;
    if (empty) empty.hidden = false;
    if (countEl) countEl.textContent = "";
    if (msg) msg.textContent = "";
    return;
  }
  if (empty) empty.hidden = true;
  if (!prev || !keys.includes(prev)) state.selectedTraitKey = keys[0];
  for (const key of keys) {
    const trait = findTrait(key);
    const n = Array.isArray(trait?.options) ? trait.options.length : 0;
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = `${key} (${n})`;
    if (key === state.selectedTraitKey) opt.selected = true;
    sel.appendChild(opt);
  }

  const trait = findTrait(state.selectedTraitKey);
  if (!trait) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  const skip = $("opt-skip-dna");
  if (skip) skip.checked = trait.skipDna === true;
  if (!Array.isArray(trait.options)) trait.options = [];
  const n = trait.options.length;
  if (countEl) countEl.textContent = t("ctor.options.count", { n: String(n), key: state.selectedTraitKey });

  tbody.innerHTML = "";
  trait.options.forEach((raw, idx) => {
    const o = normalizeOptionClient(raw);
    // keep normalized shape in draft
    trait.options[idx] = { ...raw, ...o };
    const tr = document.createElement("tr");
    const promptWarn = !String(o.prompt || "").trim();
    tr.innerHTML = `
      <td><input type="text" data-field="value" data-idx="${idx}" value="${escapeHtml(o.value)}" autocomplete="off"></td>
      <td class="opt-weight-cell">
        <input class="opt-weight" type="number" min="0.01" step="any" data-field="weight" data-idx="${idx}" value="${escapeHtml(String(o.weight))}">
        <span class="opt-pct" data-idx="${idx}">${escapeHtml(t("ctor.options.pct", { pct: optionPct(o.weight, trait.options) }))}</span>
      </td>
      <td><input class="opt-exact" type="number" min="0" step="1" data-field="exact" data-idx="${idx}" value="${o.exact == null ? "" : escapeHtml(String(o.exact))}"></td>
      <td>
        <textarea data-field="prompt" data-idx="${idx}" rows="2">${escapeHtml(o.prompt)}</textarea>
        ${promptWarn ? `<span class="muted small opt-warn">${escapeHtml(t("ctor.options.warn.promptShort"))}</span>` : ""}
      </td>
      <td class="opt-actions">
        <button type="button" class="btn small${Number(o.exact) === 1 ? " primary" : ""}" data-act="one" data-idx="${idx}"${tipAttr("ctor.options.oneOfOne")}>${escapeHtml(t("ctor.options.oneOfOne"))}</button>
        <button type="button" class="btn small" data-act="dup" data-idx="${idx}"${tipAttr("ctor.options.dup")}>${escapeHtml(t("ctor.options.dup"))}</button>
        <button type="button" class="btn small" data-act="rm" data-idx="${idx}"${tipAttr("ctor.options.rm")}>${escapeHtml(t("ctor.options.rm"))}</button>
      </td>`;
    tbody.appendChild(tr);
  });

  renderTierSummary(trait);
  const check = validateOptionsClient(trait.options);
  if (msg) {
    if (!check.ok) {
      msg.textContent = check.errors.join(" · ");
      msg.className = "small err-msg";
    } else if (check.warnings.length) {
      msg.textContent = check.warnings.join(" · ");
      msg.className = "small opt-warn";
    } else {
      msg.textContent = t("ctor.options.ok");
      msg.className = "small ok-msg";
    }
  }
}

/** Fixed-count options ("exactly N") are the series' rarity tiers: 1/1 and rare "grails". */
function renderTierSummary(trait) {
  const el = $("opt-tier-summary");
  if (!el) return;
  const size = Number($("o-size")?.value) || 0;
  const fixed = (trait.options || []).map((o) => Number(o.exact)).filter((n) => Number.isInteger(n) && n > 0);
  if (!fixed.length) {
    el.textContent = t("ctor.tier.none");
    return;
  }
  const one = fixed.filter((n) => n === 1).length;
  const rare = fixed.filter((n) => n > 1).length;
  const sum = fixed.reduce((a, b) => a + b, 0);
  el.textContent = size && sum > size
    ? t("ctor.tier.over", { fixed: sum, size })
    : t("ctor.tier.summary", { key: state.selectedTraitKey, one, rare, fixed: sum, size: size || "?", rest: size ? size - sum : "?" });
}

function updateOptionField(idx, field, value) {
  ensureDraftTraits();
  const trait = findTrait(state.selectedTraitKey);
  if (!trait || !Array.isArray(trait.options) || !trait.options[idx]) return;
  const cur = { ...normalizeOptionClient(trait.options[idx]) };
  if (field === "weight") {
    const n = Number(value);
    cur.weight = Number.isFinite(n) ? n : 0;
  } else if (field === "exact") {
    if (value === "" || value == null) delete cur.exact;
    else cur.exact = Number(value);
  } else if (field === "value") {
    cur.value = String(value ?? "").trim();
  } else if (field === "prompt") {
    cur.prompt = String(value ?? "");
  }
  trait.options[idx] = cur;
  if (state.draftFull) state.draftFull.traits = state.draftTraits;
  renderPackSummary();
  // refresh validation + count without full rebuild of focused field when typing prompt
  renderOptionsEditor();
}

function addOptionRow() {
  ensureDraftTraits();
  const trait = findTrait(state.selectedTraitKey);
  if (!trait) return;
  if (!Array.isArray(trait.options)) trait.options = [];
  const taken = new Set(trait.options.map((o) => String(o?.value || "")));
  let value = t("ctor.opt.new");
  let n = 2;
  while (taken.has(value)) {
    value = `New option ${n}`;
    n += 1;
  }
  trait.options.push({ value, weight: 1, prompt: "" });
  if (state.draftFull) state.draftFull.traits = state.draftTraits;
  renderPackSummary();
  renderTraitChecklist();
  renderOptionsEditor();
}

function removeOptionRow(idx) {
  ensureDraftTraits();
  const trait = findTrait(state.selectedTraitKey);
  if (!trait?.options?.[idx]) return;
  trait.options.splice(idx, 1);
  if (state.draftFull) state.draftFull.traits = state.draftTraits;
  renderPackSummary();
  renderTraitChecklist();
  renderOptionsEditor();
}

function duplicateOptionRow(idx) {
  ensureDraftTraits();
  const trait = findTrait(state.selectedTraitKey);
  if (!trait?.options?.[idx]) return;
  const base = normalizeOptionClient(trait.options[idx]);
  const taken = new Set(trait.options.map((o) => String(o?.value || "")));
  let value = base.value ? `${base.value} copy` : "option copy";
  let n = 2;
  while (taken.has(value)) {
    value = `${base.value || "option"} copy ${n}`;
    n += 1;
  }
  trait.options.splice(idx + 1, 0, { ...base, value });
  if (state.draftFull) state.draftFull.traits = state.draftTraits;
  renderPackSummary();
  renderTraitChecklist();
  renderOptionsEditor();
}

function optionPct(weight, options) {
  const sum = (options || []).reduce((s, o) => s + (Number(o?.weight) || 0), 0);
  const w = Number(weight) || 0;
  if (!(sum > 0)) return "0.0";
  return ((w / sum) * 100).toFixed(1);
}

function refreshWeightPcts() {
  const trait = findTrait(state.selectedTraitKey);
  if (!trait) return;
  document.querySelectorAll("#opt-tbody .opt-pct").forEach((el) => {
    const idx = Number(el.dataset.idx);
    el.textContent = t("ctor.options.pct", { pct: optionPct(trait.options?.[idx]?.weight, trait.options) });
  });
}

function setupOptionsEditor() {
  const sel = $("opt-trait-key");
  if (!sel) return;
  sel.addEventListener("change", () => {
    selectTraitKey(sel.value || null);
  });
  $("opt-add")?.addEventListener("click", () => addOptionRow());
  $("opt-tbody")?.addEventListener("change", (ev) => {
    const el = ev.target;
    if (!el || !el.dataset || el.dataset.idx == null) return;
    if (!["value", "weight", "prompt", "exact"].includes(el.dataset.field)) return;
    updateOptionField(Number(el.dataset.idx), el.dataset.field, el.value);
  });
  $("opt-skip-dna")?.addEventListener("change", () => {
    ensureDraftTraits();
    const trait = findTrait(state.selectedTraitKey);
    if (!trait) return;
    trait.skipDna = Boolean($("opt-skip-dna")?.checked);
    if (state.draftFull) state.draftFull.traits = state.draftTraits;
  });
  $("opt-tbody")?.addEventListener("input", (ev) => {
    const el = ev.target;
    if (!el || el.dataset?.field !== "prompt" && el.dataset?.field !== "weight") return;
    if (el.dataset.field === "weight") {
      ensureDraftTraits();
      const trait = findTrait(state.selectedTraitKey);
      const idx = Number(el.dataset.idx);
      if (!trait?.options?.[idx]) return;
      const n = Number(el.value);
      trait.options[idx] = { ...normalizeOptionClient(trait.options[idx]), weight: Number.isFinite(n) ? n : 0 };
      if (state.draftFull) state.draftFull.traits = state.draftTraits;
      refreshWeightPcts();
      return;
    }
    // live-update draft without full re-render (keep caret)
    ensureDraftTraits();
    const trait = findTrait(state.selectedTraitKey);
    const idx = Number(el.dataset.idx);
    if (!trait?.options?.[idx]) return;
    trait.options[idx] = { ...normalizeOptionClient(trait.options[idx]), prompt: el.value };
    if (state.draftFull) state.draftFull.traits = state.draftTraits;
  });
  $("opt-tbody")?.addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-act]");
    if (!btn) return;
    const idx = Number(btn.dataset.idx);
    if (btn.dataset.act === "rm") removeOptionRow(idx);
    if (btn.dataset.act === "dup") duplicateOptionRow(idx);
    if (btn.dataset.act === "one") {
      const cur = findTrait(state.selectedTraitKey)?.options?.[idx];
      if (cur) updateOptionField(idx, "exact", Number(cur.exact) === 1 ? "" : "1");
    }
  });
}

function setupMatrixPreview() {
  const preview = $("ctor-matrix-preview");
  const buttons = document.querySelectorAll(".matrix-btn");
  if (!preview || !buttons.length) return;

  buttons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      buttons.forEach((b) => {
        b.classList.remove("primary");
      });
      btn.classList.add("primary");
      const engine = btn.dataset.engine || "flux";
      const preset = readConstructor() || {};
      const sampleRecipe = state.recipes?.[0] || {
        edition: 1,
        who: preset?.lines && Object.values(preset.lines)[0]?.who ? Object.values(preset.lines)[0].who : "cyber character",
        prompt: "A detailed portrait with cybernetic features, cinematic lighting",
        traits: { outfit: "Neon Armor", hairstyle: "Buzz Cut", mood: "Determined" },
      };
      try {
        preview.textContent = t("ctor.matrix.formatting", { engine });
        const res = await api("/api/matrix/preview", {
          method: "POST",
          body: JSON.stringify({ recipe: sampleRecipe, engine, preset }),
        });
        if (res?.prompt) {
          preview.textContent = res.prompt;
        }
      } catch (err) {
        preview.textContent = t("ui.error", { msg: err.message });
      }
    });
  });
}

function fillOverview(preset) {
  if (!$("o-id")) return;
  $("o-id").value = preset.id || "";
  $("o-name").value = preset.name || "";
  $("o-seed").value = preset.seed || "";
  $("o-size").value = preset.size || 1;
  if ($("o-genesis")) $("o-genesis").checked = preset.genesis === true || preset.genesis?.enabled === true;
  const eng = preset.engine?.default || "kontext";
  $("o-engine").value = eng;
  const str = Number(preset.engine?.strength ?? 0.45);
  $("o-strength").value = str;
  $("o-strength-v").textContent = String(str);
}

function syncOverviewFromCtor() {
  if (!$("o-id") || !$("c-id")) return;
  $("o-id").value = $("c-id").value;
  $("o-name").value = $("c-name").value;
  $("o-seed").value = $("c-seed").value;
  $("o-size").value = $("c-size").value;
  $("o-engine").value = $("c-engine").value;
  $("o-strength").value = $("c-strength").value;
  $("o-strength-v").textContent = $("c-strength-v").textContent;
}

function syncCtorFromOverview() {
  if (!$("o-id") || !$("c-id")) return;
  $("c-id").value = $("o-id").value;
  $("c-name").value = $("o-name").value;
  $("c-seed").value = $("o-seed").value;
  $("c-size").value = $("o-size").value;
  $("c-engine").value = $("o-engine").value;
  $("c-strength").value = $("o-strength").value;
  $("c-strength-v").textContent = String($("o-strength").value);
}

function renderBaseLines(preset) {
  const el = $("base-lines");
  if (!el) return;
  if (state.baseFiles?.some((f) => f.role === "line")) return;
  const lines = preset?.lines && typeof preset.lines === "object" ? Object.keys(preset.lines) : [];
  el.textContent = lines.length ? `${t("base.lines")}: ${lines.join(", ")}` : "";
}

function fillConstructor(preset) {
  $("c-id").value = preset.id || "";
  $("c-name").value = preset.name || "";
  $("c-seed").value = preset.seed || "";
  $("c-size").value = preset.size || 1;
  const eng = preset.engine?.default || "kontext";
  $("c-engine").value = eng;
  const str = Number(preset.engine?.strength ?? 0.45);
  $("c-strength").value = str;
  $("c-strength-v").textContent = String(str);
  fillOverview(preset);
  const keep = preset.promptTemplate?.keep;
  $("c-keep").value = Array.isArray(keep) ? keep.join("\n") : keep || "";
  $("c-change").value = (preset.promptTemplate?.changeKeys || []).join(", ");
  $("c-extra").value = (preset.promptTemplate?.extraKeys || []).join(", ");
  $("c-suffix").value = preset.promptTemplate?.suffix || "";
  fillStyleLock(preset.styleLock);
  state.draftTraits = preset.traits;
  state.draftFull = preset;
  renderBaseLines(preset);
  renderCtorSummary();
  renderPackSummary();
  renderTraitChecklist();
  if (!state.selectedTraitKey && state.draftTraits?.items?.length) {
    state.selectedTraitKey = state.draftTraits.items[0]?.key || null;
  }
  renderOptionsEditor();
}

function readConstructor() {
  syncCtorFromOverview();
  const base = state.draftFull || {
    schema: "series-preset/v0",
    base: { path: "input/primary.png" },
    lines: {
      a: { who: "series subject", base: "input/primary.png", quota: 1 },
    },
    traits: state.draftTraits || { items: [] },
    rules: { forbiddenPairs: [] },
    waves: null,
  };
  const hasWaves = Array.isArray(base.waves) && base.waves.length > 0;
  let size = Number($("c-size").value) || 1;
  const id = $("c-id").value.trim();
  const keepLines = $("c-keep").value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const splitKeys = (s) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  const lines = base.lines ? { ...base.lines } : { a: { who: "series subject", quota: size } };
  if (hasWaves) {
    size = base.size;
  } else {
    const ids = Object.keys(lines);
    if (ids.length) {
      const baseQ = Math.floor(size / ids.length);
      let rem = size - baseQ * ids.length;
      for (const lid of ids) {
        const q = baseQ + (rem > 0 ? 1 : 0);
        if (rem > 0) rem--;
        lines[lid] = { ...lines[lid], quota: q };
      }
    }
  }
  return {
    ...base,
    schema: "series-preset/v0",
    id,
    name: $("c-name").value.trim() || id,
    seed: $("c-seed").value.trim() || id,
    size,
    genesis: Boolean($("o-genesis")?.checked),
    lines,
    promptTemplate: {
      ...(base.promptTemplate || {}),
      keep: keepLines.length ? keepLines : ["Edit this image of a {who}."],
      changeKeys: splitKeys($("c-change").value),
      extraKeys: splitKeys($("c-extra").value),
      suffix: $("c-suffix").value,
    },
    styleLock: readStyleLock(),
    traits: state.draftTraits || base.traits,
    rules: base.rules || { conflicts: [] },
    engine: {
      default: $("c-engine").value,
      strength: Number($("c-strength").value),
    },
  };
}

function fillStyleLock(lock) {
  const sl = lock && typeof lock === "object" ? lock : {};
  if ($("c-sl-angle")) $("c-sl-angle").value = sl.angle || "";
  if ($("c-sl-light")) $("c-sl-light").value = sl.light || "";
  if ($("c-sl-mood")) $("c-sl-mood").value = sl.mood || "";
  if ($("c-sl-framing")) $("c-sl-framing").value = sl.framing || "";
  if ($("c-sl-extra")) {
    const extra = Array.isArray(sl.extraKeep) ? sl.extraKeep : [];
    $("c-sl-extra").value = extra.join("\n");
  }
}

function readStyleLock() {
  const angle = ($("c-sl-angle")?.value || "").trim();
  const light = ($("c-sl-light")?.value || "").trim();
  const mood = ($("c-sl-mood")?.value || "").trim();
  const framing = ($("c-sl-framing")?.value || "").trim();
  const extraKeep = ($("c-sl-extra")?.value || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!angle && !light && !mood && !framing && !extraKeep.length) {
    return undefined;
  }
  return { angle, light, mood, framing, extraKeep };
}


function slugifyId(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function setupOverview() {
  if (!$("o-name")) return;
  $("o-strength").addEventListener("input", () => {
    $("o-strength-v").textContent = $("o-strength").value;
    syncCtorFromOverview();
  });
  $("o-name").addEventListener("input", () => {
    const name = $("o-name").value.trim();
    if (!$("o-id").dataset.touched) {
      const slug = slugifyId(name);
      if (slug) $("o-id").value = slug;
      if (slug && !$("o-seed").dataset.touched) $("o-seed").value = `${slug}-v1`;
    }
    syncCtorFromOverview();
    renderFacts();
    renderCtorSummary();
    renderSteps();
  });
  $("o-id").addEventListener("input", () => {
    $("o-id").dataset.touched = "1";
    syncCtorFromOverview();
    renderFacts();
    renderCtorSummary();
    renderSteps();
  });
  $("o-seed").addEventListener("input", () => {
    $("o-seed").dataset.touched = "1";
    syncCtorFromOverview();
    renderFacts();
    renderCtorSummary();
    renderSteps();
  });
  for (const id of ["o-size", "o-engine"]) {
    $(id).addEventListener("input", () => {
      syncCtorFromOverview();
      renderFacts();
      renderCtorSummary();
      renderSteps();
    });
  }
  $("o-engine")?.addEventListener("change", () => paintStrengthNote("o-strength-note", $("o-engine").value));
  paintStrengthNote("o-strength-note", $("o-engine")?.value);
  async function saveOverviewPreset() {
    syncCtorFromOverview();
    const name = $("o-name").value.trim();
    const id = $("o-id").value.trim() || slugifyId(name);
    if (!id && !name) throw new Error(t("home.msg.need"));
    if (!$("o-id").value.trim()) $("o-id").value = id;
    syncCtorFromOverview();
    const preset = readConstructor();
    if (!preset.id) throw new Error(t("home.msg.need"));
    const data = await api("/api/preset/save", {
      method: "POST",
      body: JSON.stringify({ preset }),
    });
    $("o-msg").textContent = `${t("home.msg.saved")}: ${data.file}`;
    $("o-msg").className = "small ok-msg";
    await loadPresets();
    if (data.file) {
      if ($("ctor-file")) $("ctor-file").value = data.file;
      if ($("r-preset")) $("r-preset").value = data.file;
    }
    renderFacts();
    renderCtorSummary();
    renderSteps();
    scheduleWorkspaceSave();
    return data;
  }
  $("o-save").addEventListener("click", async () => {
    try {
      await saveOverviewPreset();
    } catch (e) {
      $("o-msg").textContent = e.message;
      $("o-msg").className = "small err-msg";
    }
  });
  $("o-start")?.addEventListener("click", async () => {
    try {
      await saveOverviewPreset();
      showTab("base");
    } catch (e) {
      $("o-msg").textContent = e.message;
      $("o-msg").className = "small err-msg";
    }
  });
  $("o-spin")?.addEventListener("click", async () => {
    try {
      const file = $("r-preset")?.value || ($("o-id")?.value.trim() ? `${$("o-id").value.trim()}.json` : "");
      if (!file) throw new Error(t("home.msg.need"));
      const data = await api("/api/preset/spinoff", { method: "POST", body: JSON.stringify({ file }) });
      await loadPresets();
      fillConstructor(data.preset);
      if ($("r-preset")) $("r-preset").value = data.file;
      $("o-msg").textContent = t("home.spin.done", { file: data.file });
      $("o-msg").className = "small ok-msg";
      showTab("base");
    } catch (e) {
      $("o-msg").textContent = e.message;
      $("o-msg").className = "small err-msg";
    }
  });
  $("o-next")?.addEventListener("click", () => {
    syncCtorFromOverview();
    showTab("base");
  });
}

function setupConstructor() {
  $("ctor-goto-home")?.addEventListener("click", () => showTab("home"));
  $("ctor-next")?.addEventListener("click", () => {
    syncCtorFromOverview();
    showTab("recipes");
  });
  $("c-strength")?.addEventListener("input", () => {
    if ($("c-strength-v")) $("c-strength-v").textContent = $("c-strength").value;
  });
  for (const id of ["c-change", "c-extra"]) {
    $(id)?.addEventListener("input", () => renderTraitChecklist());
  }
  setupOptionsEditor();
  setupMatrixPreview();

  $("ctor-load")?.addEventListener("click", async () => {
    try {
      const file = $("ctor-file").value;
      const data = await api(`/api/preset?file=${encodeURIComponent(file)}`);
      fillConstructor(data.preset);
      $("ctor-msg").textContent = `${t("ctor.msg.loaded")}: ${file}`;
      $("ctor-msg").className = "small ok-msg";
    } catch (e) {
      $("ctor-msg").textContent = e.message;
      $("ctor-msg").className = "small err-msg";
    }
  });
  $("ctor-validate")?.addEventListener("click", async () => {
    try {
      const preset = readConstructor();
      const items = preset.traits?.items || [];
      const optIssues = [];
      for (const trait of items) {
        const v = validateOptionsClient(trait.options || []);
        if (!v.ok) optIssues.push(`${trait.key}: ${v.errors.join("; ")}`);
      }
      if (optIssues.length) {
        $("ctor-msg").textContent = `${t("ctor.msg.invalid")}: ${optIssues.join(" · ")}`;
        $("ctor-msg").className = "small err-msg";
        renderOptionsEditor();
        return;
      }
      const data = await api("/api/validate", { method: "POST", body: JSON.stringify({ preset }) });
      $("ctor-msg").textContent = `${t("ctor.msg.ok")} · ${data.id} · size=${data.size}`;
      $("ctor-msg").className = "small ok-msg";
    } catch (e) {
      $("ctor-msg").textContent = `${t("ctor.msg.invalid")}: ${e.message}`;
      $("ctor-msg").className = "small err-msg";
    }
  });
  $("ctor-save")?.addEventListener("click", async () => {
    try {
      const preset = readConstructor();
      if (!preset.id) throw new Error(t("ctor.msg.needId"));
      const items = preset.traits?.items || [];
      for (const trait of items) {
        const v = validateOptionsClient(trait.options || []);
        if (!v.ok) throw new Error(`${trait.key}: ${v.errors.join("; ")}`);
      }
      const data = await api("/api/preset/save", { method: "POST", body: JSON.stringify({ preset }) });
      $("ctor-msg").textContent = `${t("ctor.msg.saved")}: ${data.file}`;
      $("ctor-msg").className = "small ok-msg";
      await loadPresets();
      if ($("r-preset")) $("r-preset").value = data.file;
      if ($("ctor-file")) $("ctor-file").value = data.file;
      renderFacts();
      renderSteps();
      scheduleWorkspaceSave();
    } catch (e) {
      $("ctor-msg").textContent = e.message;
      $("ctor-msg").className = "small err-msg";
    }
  });
  $("ctor-save-pack-lib")?.addEventListener("click", async () => {
    const msg = $("ctor-pack-msg");
    try {
      const curId = $("c-id")?.value?.trim() || "custom-pack";
      const id = prompt(t("ctor.pack.prompt_id") || "Enter ID for pack:", slugifyId(curId));
      if (!id) return;
      const preset = readConstructor();
      const data = await api("/api/trait-packs/export-from-preset", {
        method: "POST",
        body: JSON.stringify({ preset, id, name: $("c-name")?.value || id }),
      });
      if (msg) {
        msg.textContent = t("ctor.pack.exported", { id: data.id }) || `Pack saved: ${data.id}`;
        msg.className = "small ok-msg";
      }
      await loadTraitPacks();
    } catch (e) {
      if (msg) {
        msg.textContent = e.message;
        msg.className = "small err-msg";
      }
    }
  });
}

/* ---------- Base ---------- */
function fileToB64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = String(fr.result || "");
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    fr.onerror = () => reject(fr.error || new Error("read failed"));
    fr.readAsDataURL(file);
  });
}

function renderBaseGallery(files) {
  const grid = $("base-gallery");
  if (!grid) return;
  grid.innerHTML = "";
  if (!files?.length) {
    grid.innerHTML = `<p class="muted small">${t("base.gallery.empty")}</p>`;
    return;
  }
  for (const f of files) {
    const tile = document.createElement("div");
    tile.className = `base-tile${f.primary ? " primary" : ""}`;
    const roleLabel = t(`base.role.${f.role}`) || f.role;
    tile.innerHTML = `
      <img src="/input/${encodeURIComponent(f.file)}?t=${Date.now()}" alt="">
      <div class="meta"><b>${escapeHtml(f.file)}</b> ${escapeHtml(roleLabel)}${f.line ? ` · ${escapeHtml(f.line)}` : ""}</div>
      <div class="btns">
        ${f.primary ? "" : `<button type="button" class="btn small" data-act="primary" data-file="${escapeHtml(f.file)}"${tipAttr("base.setPrimary")}>${t("base.setPrimary")}</button>`}
        <button type="button" class="btn small" data-act="del" data-file="${escapeHtml(f.file)}"${tipAttr("base.delete")}>${t("base.delete")}</button>
      </div>`;
    tile.querySelector('[data-act="primary"]')?.addEventListener("click", async () => {
      await api("/api/base/primary", { method: "POST", body: JSON.stringify({ file: f.file }) });
      await refreshBaseStatus();
    });
    tile.querySelector('[data-act="del"]')?.addEventListener("click", async () => {
      await api("/api/base/delete", { method: "POST", body: JSON.stringify({ file: f.file }) });
      await refreshBaseStatus();
    });
    grid.appendChild(tile);
  }
  applyTips(grid);
}

async function refreshBaseStatus() {
  try {
    const data = await api("/api/base/list");
    state.baseFiles = data.files || [];
    renderBaseGallery(state.baseFiles);
    const linesEl = $("base-lines");
    if (linesEl) {
      const lines = state.baseFiles.filter((f) => f.role === "line");
      linesEl.textContent = lines.length
        ? `${t("base.lines")}: ${lines.map((f) => f.line || f.file).join(", ")}`
        : "";
    }
    if (state.health) {
      state.health.base = {
        exists: state.baseFiles.some((f) => f.primary) || state.baseFiles.length > 0,
        file: state.baseFiles.find((f) => f.primary)?.file || state.baseFiles[0]?.file,
        count: state.baseFiles.length,
      };
    }
    renderSteps();
    syncWishControls();
  } catch {
    /* ignore */
  }
}

function setupBase() {
  const syncBasePick = () => {
    const input = $("base-file");
    const btn = $("base-upload");
    const list = $("base-pick-list");
    const files = [...(input?.files || [])];
    if (btn) btn.disabled = files.length === 0;
    if (list) {
      list.textContent = files.length
        ? files.map((f) => f.name).join(", ")
        : "";
    }
  };

  $("base-role")?.addEventListener("change", () => {
    const role = $("base-role").value;
    if ($("base-line-wrap")) $("base-line-wrap").hidden = role !== "line";
  });
  $("base-file")?.addEventListener("change", syncBasePick);
  syncBasePick();

  $("base-upload")?.addEventListener("click", async () => {
    const btn = $("base-upload");
    try {
      const input = $("base-file");
      const files = [...(input?.files || [])];
      if (!files.length) throw new Error(t("base.msg.needFile"));
      if (btn) btn.disabled = true;
      let last = null;
      for (const file of files) {
        const data = await fileToB64(file);
        last = await api("/api/base/upload", {
          method: "POST",
          body: JSON.stringify({
            filename: file.name,
            data,
            role: $("base-role")?.value || "primary",
            line: $("base-line-id")?.value || "a",
          }),
        });
      }
      if (input) input.value = "";
      syncBasePick();
      const asExtra = last?.role === "extra" && ($("base-role")?.value || "primary") === "primary";
      $("base-msg").textContent = asExtra
        ? t("base.msg.asExtra", { file: last?.file || "" })
        : t("base.msg.saved");
      $("base-msg").className = "small ok-msg";
      await refreshBaseStatus();
    } catch (e) {
      $("base-msg").textContent = e.message;
      $("base-msg").className = "small err-msg";
      syncBasePick();
    }
  });
  $("base-wish-save")?.addEventListener("click", async () => {
    try {
      await api("/api/base/wish", {
        method: "POST",
        body: JSON.stringify({ wish: $("base-wish")?.value || "" }),
      });
      $("base-msg").textContent = t("base.wish.saved");
      $("base-msg").className = "small ok-msg";
    } catch (e) {
      $("base-msg").textContent = e.message;
      $("base-msg").className = "small err-msg";
    }
  });
  $("base-wish-str")?.addEventListener("input", () => {
    if ($("base-wish-str-v")) $("base-wish-str-v").textContent = $("base-wish-str").value;
  });
  $("base-wish-ref")?.addEventListener("change", () => relabelEngineSelects());
  $("base-wish-engine")?.addEventListener("change", () => syncWishControls());
  $("base-wish")?.addEventListener("input", () => paintWishPrompt());
  syncWishControls();
  $("base-wish-gen")?.addEventListener("click", async () => {
    const useRef = Boolean($("base-wish-ref")?.checked);
    const hasPrimary = (state.baseFiles || []).some((f) => f.primary);
    if (useRef && !hasPrimary) {
      syncWishControls();
      return;
    }
    try {
      $("base-wish-gen").dataset.busy = "1";
      $("base-wish-gen").disabled = true;
      const data = await api("/api/base/generate", {
        method: "POST",
        body: JSON.stringify({
          wish: $("base-wish")?.value || "",
          engine: $("base-wish-engine")?.value,
          strength: Number($("base-wish-str")?.value),
          useRef: Boolean($("base-wish-ref")?.checked),
          makePrimary: Boolean($("base-wish-primary")?.checked),
        }),
      });
      if ($("base-wish-out")) {
        $("base-wish-out").hidden = false;
        $("base-wish-out").textContent = JSON.stringify(data, null, 2);
      }
      $("base-msg").textContent = data.ok ? t("base.wish.done") : (data.message || t("base.wish.fail"));
      $("base-msg").className = data.ok ? "small ok-msg" : "small err-msg";
      await refreshBaseStatus();
    } catch (e) {
      $("base-msg").textContent = e.message;
      $("base-msg").className = "small err-msg";
    } finally {
      if ($("base-wish-gen")) delete $("base-wish-gen").dataset.busy;
      syncWishControls();
    }
  });

  $("base-vision-analyze")?.addEventListener("click", async () => {
    const btn = $("base-vision-analyze");
    const status = $("base-vision-status");
    const box = $("base-vision-box");
    try {
      if (btn) btn.disabled = true;
      if (status) status.textContent = t("base.vision.analyzing");
      const data = await api("/api/base/analyze", { method: "POST", body: JSON.stringify({}) });
      state.lastVisionResult = data.data;
      if (status) status.textContent = t("base.vision.provider", { provider: data.provider || "AI" });
      if ($("base-vision-summary")) $("base-vision-summary").textContent = data.data.summary || "";
      if ($("base-vision-out")) $("base-vision-out").textContent = JSON.stringify(data.data, null, 2);
      if (box) box.hidden = false;
    } catch (e) {
      if (status) status.textContent = e.message;
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $("base-vision-apply")?.addEventListener("click", () => {
    const v = state.lastVisionResult;
    if (!v) return;
    if (v.styleLock) {
      fillStyleLock(v.styleLock);
      if (state.draftFull) state.draftFull.styleLock = v.styleLock;
    }
    if (Array.isArray(v.suggestedTraits) && v.suggestedTraits.length) {
      ensureDraftTraits();
      const existingKeys = new Set((state.draftTraits.items || []).map((t) => t.key));
      for (const st of v.suggestedTraits) {
        if (!existingKeys.has(st.key)) {
          state.draftTraits.items.push(st);
        }
      }
      if (state.draftFull) state.draftFull.traits = state.draftTraits;
    }
    renderTraitChecklist();
    renderPackSummary();
    renderOptionsEditor();
    renderFacts();
    renderSteps();
    const status = $("base-vision-status");
    if (status) status.textContent = t("base.vision.done");
    showTab("ctor");
  });

  $("base-next")?.addEventListener("click", () => showTab("ctor"));
}

/* ---------- Recipes ---------- */
function renderRarity(rarity) {
  const box = $("r-rarity-table");
  if (!box) return;
  if (!rarity?.traits?.length) {
    box.innerHTML = "";
    return;
  }
  let html = `<table class="table"><thead><tr>
    <th>${t("recipes.rarity.th.trait")}</th><th>${t("recipes.rarity.th.value")}</th>
    <th>${t("recipes.rarity.th.count")}</th><th>${t("recipes.rarity.th.actual")}</th>
    <th>${t("recipes.rarity.th.expected")}</th></tr></thead><tbody>`;
  for (const trait of rarity.traits) {
    for (const opt of trait.options || []) {
      html += `<tr><td>${escapeHtml(trait.key)}</td><td>${escapeHtml(opt.value)}</td>
        <td>${opt.count}</td><td>${opt.actual}%</td><td>${opt.expected}%</td></tr>`;
    }
  }
  html += "</tbody></table>";
  box.innerHTML = html;
}

function renderRecipeTable() {
  const table = $("r-table");
  if (!table) return;
  const q = ($("r-search")?.value || "").toLowerCase();
  const line = $("r-line")?.value || "";
  let rows = state.recipes || [];
  if (line) rows = rows.filter((r) => r.line === line);
  if (q) rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
  if ($("r-count")) $("r-count").textContent = String(rows.length);
  const showWave = rows.some((r) => r.wave != null);
  table.innerHTML = `<thead><tr><th scope="col">#</th>${showWave ? `<th scope="col">${t("waves.col")}</th>` : ""}<th scope="col">${t("recipes.col.line")}</th><th scope="col">${t("recipes.col.dna")}</th><th scope="col"></th></tr></thead><tbody>` +
    rows.map((r) => `<tr data-i="${r.index}">
      <td>${r.edition}</td>${showWave ? `<td>${r.wave ?? ""}</td>` : ""}<td>${escapeHtml(r.line)}</td>
      <td class="mono small">${escapeHtml(r.dna || "")}</td>
      <td><button type="button" class="btn small" data-ed="${r.index}"${tipAttr("recipes.edit")}>${t("recipes.edit") || "Edit"}</button></td>
    </tr>`).join("") + "</tbody>";
  table.querySelectorAll("button[data-ed]").forEach((btn) => {
    btn.addEventListener("click", () => openRecipeEditor(Number(btn.dataset.ed)));
  });
  applyTips(table);
}

function openRecipeEditor(index) {
  const recipe = state.recipes.find((r) => r.index === index);
  if (!recipe) return;
  state.editingIndex = index;
  if ($("r-editor")) $("r-editor").hidden = false;
  if ($("r-ed-title")) $("r-ed-title").textContent = `#${recipe.edition}`;
  if ($("r-prompt")) {
    $("r-prompt").hidden = false;
    $("r-prompt").textContent = recipe.prompt || "";
  }
  if ($("r-ed-note")) $("r-ed-note").value = recipe.note || "";
  const fields = $("r-ed-fields");
  if (fields) {
    fields.innerHTML = Object.entries(recipe.traits || {})
      .map(([k, v]) => `<label class="small">${escapeHtml(k)}<input data-k="${escapeHtml(k)}" value="${escapeHtml(v)}" /></label>`)
      .join("");
  }
}

async function loadRecipesArchive(file) {
  if (!file) return;
  const data = await api(`/api/recipes?file=${encodeURIComponent(file)}`);
  state.recipes = data.recipes || data.archive?.recipes || [];
  state.archiveFile = file;
  state.archiveOut = `out/${file}`;
  refreshLayersStatus();
  renderRecipeTable();
  if (data.rarity) renderRarity(data.rarity);
  else {
    try {
      const rar = await api(`/api/rarity?file=${encodeURIComponent(file)}`);
      renderRarity(rar.rarity || rar);
    } catch { /* ignore */ }
  }
  fillArchiveSelect();
  loadTraitCooccurrence(file);
}

async function loadTraitCooccurrence(file) {
  const wrap = $("r-cooccurrence-wrap");
  const list = $("r-cooccurrence-list");
  if (!wrap || !list) return;
  try {
    const res = await api(`/api/traits/matrix?file=${encodeURIComponent(file)}`);
    if (res?.topPairs?.length) {
      list.innerHTML = res.topPairs.slice(0, 24).map((p) => `
        <div class="card" style="padding:6px 10px; margin:0; border:1px solid var(--border)">
          <div style="font-weight:600; font-size:12px; word-break:break-all">${escapeHtml(p.pair)}</div>
          <div class="muted small" style="margin-top:2px">${p.count}x (${p.percentage}%)</div>
        </div>
      `).join("");
      wrap.hidden = false;
    } else {
      wrap.hidden = true;
    }
  } catch {
    wrap.hidden = true;
  }
}

async function loadArchives() {
  const data = await api("/api/archive/list");
  state.archives = data.archives || [];
  fillArchiveSelect();
  const sel = $("r-preset");
  if (sel && state.presets?.length) {
    /* keep */
  }
  refreshLayersStatus(); // coverage needs the archive: it is only known once the list is loaded
  return state.archives;
}

function fillArchiveSelect() {
  const sel = $("x-file");
  if (!sel) return;
  const cur = sel.value;
  if (!state.archives.length) {
    sel.innerHTML = `<option value="">${t("export.none")}</option>`;
    updateJsonLink();
    return;
  }
  sel.innerHTML = state.archives
    .map((a) => `<option value="${escapeHtml(a.file)}">${escapeHtml(a.file)} (${a.size ?? "?"})</option>`)
    .join("");
  if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
  for (const id of ["r-diff-a", "r-diff-b"]) {
    const box = $(id);
    if (!box) continue;
    const prev = box.value;
    box.innerHTML = sel.innerHTML;
    if (prev && [...box.options].some((o) => o.value === prev)) box.value = prev;
  }
  const b = $("r-diff-b");
  if (b && state.archives.length > 1 && b.value === $("r-diff-a")?.value) b.selectedIndex = 1;
  updateJsonLink();
}

function updateJsonLink() {
  const a = $("x-json");
  const file = $("x-file")?.value;
  if (!a) return;
  if (!file) {
    a.removeAttribute("href");
    return;
  }
  a.href = `/api/archive/file?file=${encodeURIComponent(file)}`;
  a.setAttribute("download", file);
}

async function refreshWaves() {
  const list = $("r-waves-list");
  const file = $("r-preset")?.value;
  if (!list) return;
  if (!file) {
    list.textContent = "";
    return;
  }
  try {
    const data = await api(`/api/waves?file=${encodeURIComponent(file)}`);
    const waves = data.waves || [];
    list.innerHTML = waves.map((w) =>
      `<div>${escapeHtml(t("waves.row", { n: w.n, from: w.from, to: w.to, size: w.size, seed: w.seed }))}</div>`
    ).join("");
    const seedInput = $("r-wave-seed");
    if (seedInput && !seedInput.dataset.touched) {
      const base = waves[0]?.seed || "series";
      seedInput.value = `${base}-w${waves.length + 1}`;
    }
  } catch (e) {
    list.textContent = e.message;
  }
}

function setupRecipes() {
  $("r-build")?.addEventListener("click", async () => {
    try {
      const file = $("r-preset")?.value;
      const data = await api("/api/build", { method: "POST", body: JSON.stringify({ file }) });
      state.archiveOut = data.out;
      const outFile = String(data.out || "").replace(/^out\//, "");
      await loadArchives();
      await loadRecipesArchive(outFile || null);
      renderFacts();
      renderSteps();
      if ($("r-count")) $("r-count").textContent = t("recipes.built", { n: data.size, out: data.out });
      const dup = $("r-dupes");
      if (dup) {
        if (data.duplicates?.length) {
          dup.hidden = false;
          dup.textContent = t("recipes.dupes", { n: data.duplicates.length });
        } else {
          dup.hidden = true;
        }
      }
      if (data.rarity) renderRarity(data.rarity);
      scheduleWorkspaceSave({ lastArchive: outFile });
    } catch (e) {
      alert(e.message);
    }
  });
  $("r-simulate")?.addEventListener("click", async () => {
    const msg = $("r-simulate-msg");
    try {
      if (msg) msg.textContent = t("recipes.simulate.running");
      const file = $("r-preset")?.value;
      const data = await api("/api/simulate", { method: "POST", body: JSON.stringify({ file }) });
      if (data.rarity) renderRarity(data.rarity);
      const bits = [t("recipes.simulate.done", { size: data.size, rejected: data.rejectedConflicts ?? 0 })];
      const pairs = (data.conflictExamples || []).map((h) => `${h.a} / ${h.b}`);
      if (pairs.length) bits.push(t("recipes.simulate.conflicts", { list: pairs.join("; ") }));
      if (msg) msg.textContent = bits.join(" ");
    } catch (e) {
      if (msg) msg.textContent = e.message;
    }
  });
  $("r-archive-diff")?.addEventListener("click", async () => {
    const msg = $("r-archive-diff-msg");
    const list = $("r-archive-diff-list");
    try {
      const a = $("r-diff-a")?.value;
      const b = $("r-diff-b")?.value;
      if (!a || !b) throw new Error(t("archive.diff.need"));
      const data = await api("/api/archive/diff", { method: "POST", body: JSON.stringify({ a, b }) });
      if (msg) msg.textContent = t("archive.diff.summary", { same: data.same, changed: data.changed.length });
      if (list) {
        const rows = data.changed.slice(0, 20).map((row) =>
          `<div class="err-row"><b>#${row.edition}</b> <span class="muted">${escapeHtml(row.dnaA)} → ${escapeHtml(row.dnaB)}</span><div>${escapeHtml(row.promptB)}</div></div>`);
        list.innerHTML = rows.join("") || `<p class="muted">${escapeHtml(t("archive.diff.same"))}</p>`;
      }
    } catch (e) {
      if (msg) msg.textContent = e.message;
    }
  });
  $("r-diff")?.addEventListener("click", async () => {
    try {
      const file = $("r-preset")?.value;
      const data = await api("/api/diff-seed", { method: "POST", body: JSON.stringify({ file }) });
      alert(JSON.stringify(data, null, 2));
    } catch (e) {
      alert(e.message);
    }
  });
  $("r-preset")?.addEventListener("change", () => { refreshWaves(); });
  $("r-wave-seed")?.addEventListener("input", (e) => { e.target.dataset.touched = "1"; });
  $("r-wave-add")?.addEventListener("click", async () => {
    const msg = $("r-wave-msg");
    const file = $("r-preset")?.value;
    try {
      const data = await api("/api/waves/append", {
        method: "POST",
        body: JSON.stringify({
          file,
          size: Number($("r-wave-size")?.value),
          seed: $("r-wave-seed")?.value || "",
        }),
      });
      if (data.preset) {
        state.draftFull = data.preset;
        fillOverview(data.preset);
        fillConstructor(data.preset);
      }
      if ($("r-wave-seed")) delete $("r-wave-seed").dataset.touched;
      await refreshWaves();
      if (msg) {
        msg.className = "small ok-msg";
        msg.textContent = t("waves.added", { size: data.size });
      }
    } catch (e) {
      if (msg) {
        msg.className = "small err-msg";
        msg.textContent = e.message;
      }
    }
  });
  refreshWaves();
  $("r-search")?.addEventListener("input", renderRecipeTable);
  $("r-line")?.addEventListener("change", renderRecipeTable);
  $("r-ed-save")?.addEventListener("click", async () => {
    try {
      if (state.editingIndex == null) return;
      const traits = {};
      $("r-ed-fields")?.querySelectorAll("input[data-k]")?.forEach((inp) => {
        traits[inp.dataset.k] = inp.value;
      });
      const body = {
        file: state.archiveFile,
        index: state.editingIndex,
        traits,
        note: $("r-ed-note")?.value || "",
      };
      await api("/api/recipe", { method: "POST", body: JSON.stringify(body) });
      await loadRecipesArchive(state.archiveFile);
      openRecipeEditor(state.editingIndex);
      if ($("r-ed-msg")) $("r-ed-msg").textContent = t("recipes.saved") || "Saved";
    } catch (e) {
      if ($("r-ed-msg")) $("r-ed-msg").textContent = e.message;
    }
  });
  $("r-ed-redo")?.addEventListener("click", async () => {
    try {
      if (state.editingIndex == null) return;
      const recipe = state.recipes.find((r) => r.index === state.editingIndex);
      const edition = recipe?.edition;
      if (edition == null) throw new Error(t("recipes.noEdition") || "No edition number");
      const traits = {};
      $("r-ed-fields")?.querySelectorAll("input[data-k]")?.forEach((inp) => {
        traits[inp.dataset.k] = inp.value;
      });
      await api("/api/recipe", {
        method: "POST",
        body: JSON.stringify({
          file: state.archiveFile,
          index: state.editingIndex,
          traits,
          note: $("r-ed-note")?.value || "",
        }),
      });
      await loadRecipesArchive(state.archiveFile);
      const only = document.querySelector('input[name="g-sel"][value="only"]');
      if (only) only.checked = true;
      if ($("g-only")) $("g-only").value = String(edition);
      if ($("g-force")) $("g-force").checked = true;
      showTab("render");
      lockGenerate(true);
      if ($("g-plan-out")) $("g-plan-out").textContent = t("render.redoHint", { n: edition });
      if ($("r-ed-msg")) $("r-ed-msg").textContent = t("recipes.saved") || "Saved";
    } catch (e) {
      if ($("r-ed-msg")) $("r-ed-msg").textContent = e.message;
    }
  });
  $("r-ed-reset")?.addEventListener("click", async () => {
    try {
      if (state.editingIndex == null) return;
      await api("/api/recipe", {
        method: "POST",
        body: JSON.stringify({
          file: state.archiveFile,
          index: state.editingIndex,
          reset: true,
        }),
      });
      await loadRecipesArchive(state.archiveFile);
      openRecipeEditor(state.editingIndex);
      if ($("r-ed-msg")) $("r-ed-msg").textContent = t("recipes.resetOk") || "Reset";
    } catch (e) {
      if ($("r-ed-msg")) $("r-ed-msg").textContent = e.message;
    }
  });
}

function licenseApplies() {
  const engine = $("g-engine")?.value || "";
  if (engine === "fal") return true;
  if ((engine === "comfyui" || engine === "a1111") && $("g-flux-dev")?.checked) return true;
  return false;
}

function paintLicenseWarning() {
  const box = $("g-license");
  const wrap = $("g-flux-dev-wrap");
  const engine = $("g-engine")?.value || "";
  if (wrap) wrap.hidden = engine !== "comfyui" && engine !== "a1111";
  if (box) box.hidden = !licenseApplies();
}

/* ---------- Render / Generate ---------- */
let renderAbort = null;

function setRenderStop(on) {
  const stop = $("g-stop");
  if (!stop) return;
  stop.hidden = !on;
  stop.disabled = !on;
}

function paintGenerateEvent(ev, ui) {
  const { progressBar, progressPct, progressText, thumbs } = ui;
  if (ev.type === "start") {
    if (progressText) progressText.textContent = `${fmtNum(0)} / ${fmtNum(ev.total)}`;
  } else if (ev.type === "progress") {
    const total = Number(ev.total) || 0;
    const pct = total > 0 ? Math.round((ev.completed / total) * 100) : 0;
    if (progressBar) progressBar.style.width = `${pct}%`;
    if (progressPct) progressPct.textContent = `${pct}%`;
    if (progressText) progressText.textContent = `${fmtNum(ev.completed)} / ${fmtNum(total)}`;
    if (ev.result?.url && thumbs) {
      const a = document.createElement("a");
      a.href = ev.result.url;
      a.target = "_blank";
      a.innerHTML = `<img src="${ev.result.url}" alt="#${ev.result.edition}" />`;
      thumbs.appendChild(a);
    }
  } else if (ev.type === "error" && progressText) {
    progressText.textContent = String(ev.error || t("render.streamEnded"));
  }
}

async function applyGenerateOutcome(settled, ui) {
  const { progressBar, progressPct, progressText } = ui;
  if (!settled || settled.state === "stopped") {
    if (progressText) progressText.textContent = t("render.stoppedByUser");
    return;
  }
  if (settled.state === "empty") {
    if (progressText) progressText.textContent = t("render.nothing");
    if (progressBar) progressBar.style.width = "100%";
    if (progressPct) progressPct.textContent = "100%";
    return;
  }
  if (settled.state === "error") {
    const msg = settled.message || t(settled.messageKey || "render.streamEnded");
    if (progressText) progressText.textContent = msg;
    return;
  }
  if (settled.state !== "done" || !settled.payload) {
    if (progressText) progressText.textContent = t("render.streamEnded");
    return;
  }
  const lastDone = settled.payload;
  if (Number(lastDone.count) > 0) playCompletionChime();
  if ("Notification" in window && Notification.permission === "granted" && Number(lastDone.count) > 0) {
    new Notification(t("render.notify.title"), {
      body: t("render.notify.body", { count: fmtNum(lastDone.count), set: lastDone.set }),
    });
  }
  if (lastDone.set) {
    state.lastSet = lastDone.set;
    scheduleWorkspaceSave({ lastSet: lastDone.set });
    await loadGallerySets();
  }
  if (progressText) progressText.textContent = t("render.done", { n: lastDone.count, set: lastDone.set }) || `Done: ${lastDone.count}`;
  refreshAccount();
  if (progressText && lastDone.stopped) {
    if (lastDone.stopped === "stopped") {
      progressText.textContent = t("render.stoppedByUser");
    } else {
      progressText.textContent += ` · ⛔ ${t("render.stopped", { reason: lastDone.stopped, skipped: lastDone.skipped })}`;
    }
  }
  if (progressBar) progressBar.style.width = "100%";
  if (progressPct) progressPct.textContent = "100%";
}

const mbText = (bytes) => fmtNum(Math.round((Number(bytes) || 0) / 104857.6) / 10);

function renderLayersStatus(st) {
  const el = $("g-layers-status");
  if (!el) return;
  el.textContent = "";
  const line = (text, cls = "") => {
    const d = document.createElement("div");
    if (cls) d.className = cls;
    d.textContent = text;
    el.appendChild(d);
  };
  if (!st?.exists) {
    line(t("render.layers.empty"), "muted");
    return;
  }
  line(t("render.layers.status", { files: fmtNum(st.files), keys: fmtNum(st.keys?.length || 0), mb: mbText(st.bytes) }));
  const cov = st.coverage;
  if (cov) {
    line(t("render.layers.coverage", { present: fmtNum(cov.present), expected: fmtNum(cov.expected) }), cov.missingCount > 0 ? "warn" : "ok");
    if (cov.missingCount > 0) {
      const shown = cov.missing.slice(0, 6).join(", ");
      const more = cov.missingCount > 6 ? ` … +${fmtNum(cov.missingCount - 6)}` : "";
      line(t("render.layers.missing", { list: shown, more }), "muted");
    }
  }
}

async function refreshLayersStatus() {
  if (!$("g-layers-status")) return;
  try {
    const archive = kitArchive();
    const st = await api(`/api/layers/status${archive ? `?archive=${encodeURIComponent(archive)}` : ""}`);
    renderLayersStatus(st);
  } catch (e) {
    $("g-layers-status").textContent = e.message;
  }
}

function setupLayersUpload() {
  const file = $("g-layers-file");
  const upload = $("g-layers-upload");
  const picked = $("g-layers-picked");
  if (!file || !upload) return;
  const sync = () => {
    const f = file.files?.[0];
    upload.disabled = !f;
    if (picked) picked.textContent = f ? t("render.layers.picked", { name: f.name, mb: mbText(f.size) }) : "";
  };
  $("g-layers-pick")?.addEventListener("click", () => file.click());
  $("x-file")?.addEventListener("change", refreshLayersStatus);
  file.addEventListener("change", sync);
  upload.addEventListener("click", async () => {
    const f = file.files?.[0];
    const msg = $("g-compose-msg");
    if (!f) {
      if (msg) msg.textContent = t("render.layers.pickFirst");
      return;
    }
    try {
      setBusy(upload, true);
      if (msg) msg.textContent = t("ui.working");
      const archive = kitArchive();
      const qs = new URLSearchParams();
      if ($("g-layers-replace")?.checked) qs.set("clear", "1");
      if (archive) qs.set("archive", archive);
      const q = qs.toString();
      const data = await api(`/api/layers/upload${q ? `?${q}` : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/zip", "Accept-Language": getLocale() },
        body: f,
      });
      const skipped = data.skipped?.length ? t("render.layers.skipped", { n: fmtNum(data.skipped.length) }) : "";
      if (msg) msg.textContent = t("render.layers.uploaded", { files: fmtNum(data.files), mb: mbText(data.bytes), skipped });
      renderLayersStatus(data.status);
      file.value = "";
      sync();
    } catch (e) {
      if (msg) msg.textContent = e.message;
    } finally {
      setBusy(upload, false);
      sync();
    }
  });
  $("g-layers-clear")?.addEventListener("click", async () => {
    const msg = $("g-compose-msg");
    try {
      const data = await api("/api/layers/clear", { method: "POST", body: "{}" });
      if (msg) msg.textContent = t("render.layers.cleared", { n: fmtNum(data.removed) });
      await refreshLayersStatus();
    } catch (e) {
      if (msg) msg.textContent = e.message;
    }
  });
}

function setupRender() {
  setupLayersUpload();
  $("g-compose")?.addEventListener("click", async () => {
    const msg = $("g-compose-msg");
    const btn = $("g-compose");
    try {
      const archive = kitArchive();
      if (!archive) throw new Error(t("export.none"));
      setBusy(btn, true);
      if (msg) msg.textContent = t("ui.working");
      const data = await api("/api/compose", {
        method: "POST",
        body: JSON.stringify({ archive }),
      });
      if (msg) msg.textContent = t("render.layers.ok", { count: data.count, dir: data.dir });
    } catch (e) {
      if (msg) msg.textContent = e.message;
    } finally {
      setBusy(btn, false);
    }
  });
  const reLockPlan = () => lockGenerate(true);
  $("g-strength")?.addEventListener("input", () => {
    if ($("g-strength-v")) $("g-strength-v").textContent = $("g-strength").value;
    reLockPlan();
  });
  $("g-engine")?.addEventListener("change", () => {
    reLockPlan();
    state.licenseAck = false;
    paintStrengthNote("g-strength-note", $("g-engine")?.value);
    paintLicenseWarning();
  });
  $("g-flux-dev")?.addEventListener("change", () => {
    state.licenseAck = false;
    paintLicenseWarning();
  });
  $("g-license-proceed")?.addEventListener("click", () => {
    state.licenseAck = true;
    $("g-run")?.click();
  });
  paintStrengthNote("g-strength-note", $("g-engine")?.value);
  paintLicenseWarning();
  $("g-pilot")?.addEventListener("input", reLockPlan);
  $("g-first")?.addEventListener("input", reLockPlan);
  $("g-only")?.addEventListener("input", reLockPlan);
  $("g-force")?.addEventListener("change", reLockPlan);
  document.querySelectorAll('input[name="g-sel"]').forEach((el) => {
    el.addEventListener("change", reLockPlan);
  });
  $("g-pilots")?.addEventListener("click", () => {
    const radio = document.querySelector('input[name="g-sel"][value="pilot"]');
    if (radio) radio.checked = true;
    if ($("g-pilot")) $("g-pilot").value = "12";
    $("g-estimate")?.click();
  });
  $("g-estimate")?.addEventListener("click", async () => {
    try {
      const data = await api("/api/estimate", {
        method: "POST",
        body: JSON.stringify({
          file: state.archiveFile || $("x-file")?.value,
          engine: $("g-engine")?.value,
          strength: Number($("g-strength")?.value),
          mode: document.querySelector('input[name="g-sel"]:checked')?.value || "pilot",
          pilot: Number($("g-pilot")?.value),
          first: Number($("g-first")?.value),
          only: $("g-only")?.value,
        }),
      });
      if ($("g-plan-out")) {
        $("g-plan-out").dataset.dirty = "1";
        $("g-plan-out").textContent = data.text || JSON.stringify(data, null, 2);
      }
      lockGenerate(false);
    } catch (e) {
      if ($("g-plan-out")) $("g-plan-out").textContent = e.message;
      lockGenerate(true);
    }
  });
  $("g-stop")?.addEventListener("click", () => {
    renderAbort?.abort();
  });
  $("g-run")?.addEventListener("click", async () => {
    const progressWrap = $("g-progress-wrap");
    const progressBar = $("g-progress-bar");
    const progressText = $("g-progress-text");
    const progressPct = $("g-progress-pct");
    const thumbs = $("g-thumbs");
    const ui = { progressBar, progressPct, progressText, thumbs };

    try {
      if (licenseApplies() && !state.licenseAck) {
        paintLicenseWarning();
        return;
      }
      renderAbort?.abort();
      renderAbort = new AbortController();
      const signal = renderAbort.signal;
      $("g-run").disabled = true;
      setRenderStop(true);
      if (progressWrap) progressWrap.hidden = false;
      if (progressBar) progressBar.style.width = "0%";
      if (progressPct) progressPct.textContent = "0%";
      if (progressText) progressText.textContent = t("render.working");
      if ($("g-result")) $("g-result").hidden = false;
      if (thumbs) thumbs.innerHTML = "";

      const payload = {
        file: state.archiveFile || $("x-file")?.value,
        engine: $("g-engine")?.value,
        strength: Number($("g-strength")?.value),
        mode: document.querySelector('input[name="g-sel"]:checked')?.value || "pilot",
        pilot: Number($("g-pilot")?.value),
        first: Number($("g-first")?.value),
        only: $("g-only")?.value,
        force: Boolean($("g-force")?.checked),
        concurrency: Number($("g-concurrency")?.value || 2),
        stream: true,
        ackLicense: Boolean(state.licenseAck),
        fluxDevWeights: Boolean($("g-flux-dev")?.checked),
      };

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(payload),
        signal,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || errJson.errors || `HTTP ${res.status}`);
      }

      const ctype = res.headers.get("content-type") || "";
      if (!ctype.includes("text/event-stream")) {
        const bodyText = await res.text();
        await applyGenerateOutcome(settleGenerateStream({ contentType: ctype, bodyText }), ui);
        return;
      }

      if (progressText) progressText.textContent = t("render.streaming");
      if (!res.body) {
        await applyGenerateOutcome(settleGenerateStream({ contentType: ctype, events: [] }), ui);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      const events = [];
      let zeroTotal = false;

      while (!zeroTotal) {
        const { value, done } = await reader.read();
        if (done) break;
        const parsed = parseSseBuffer(buffer + decoder.decode(value, { stream: true }));
        buffer = parsed.rest;
        for (const ev of parsed.events) {
          events.push(ev);
          paintGenerateEvent(ev, ui);
          if (ev.type === "start" && Number(ev.total) === 0) {
            zeroTotal = true;
            try { await reader.cancel(); } catch { /* already closed */ }
            break;
          }
        }
      }

      if (signal.aborted) {
        if (progressText) progressText.textContent = t("render.stoppedByUser");
        return;
      }
      await applyGenerateOutcome(settleGenerateStream({ contentType: ctype, events }), ui);
    } catch (e) {
      if (e.name === "AbortError") {
        if (progressText) progressText.textContent = t("render.stoppedByUser");
      } else if (progressText) {
        progressText.textContent = e.message;
      }
    } finally {
      setRenderStop(false);
      renderAbort = null;
      // Plan may be stale after a run — require Estimate again.
      lockGenerate(true);
    }
  });
  $("g-open-gallery")?.addEventListener("click", () => showTab("gallery"));
}

/* ---------- Gallery ---------- */
/** Merge two image lists by edition (Wave 5). Mirrors src/gallery.mjs. */
function mergeEditions(a, b) {
  const map = new Map();
  const ingest = (list, side) => {
    if (!Array.isArray(list)) return;
    for (const img of list) {
      if (img == null || img.edition == null || img.edition === "") continue;
      const ed = Number(img.edition);
      if (!Number.isFinite(ed)) continue;
      let row = map.get(ed);
      if (!row) {
        row = { edition: ed, a: null, b: null };
        map.set(ed, row);
      }
      row[side] = img;
    }
  };
  ingest(a, "a");
  ingest(b, "b");
  return [...map.values()].sort((x, y) => x.edition - y.edition);
}

function syncCompareSelect() {
  const wrap = $("v-dir2-wrap");
  const sel2 = $("v-dir2");
  const sets = state.gallerySets || [];
  if (!wrap || !sel2) return;
  const canCompare = sets.length >= 2;
  wrap.hidden = !canCompare;
  if (!canCompare) {
    sel2.innerHTML = `<option value="">${t("gallery.compare.none")}</option>`;
    sel2.value = "";
    state.galleryDir2 = null;
    state.galleryImages2 = [];
    return;
  }
  const primary = state.galleryDir || $("v-dir")?.value || "";
  const keep2 = state.galleryDir2 || sel2.value || "";
  const opts = sets
    .filter((s) => s.dir !== primary)
    .map((s) => `<option value="${escapeHtml(s.dir)}">${escapeHtml(s.dir)} (${s.count})</option>`)
    .join("");
  sel2.innerHTML = `<option value="">${t("gallery.compare.none")}</option>${opts}`;
  if (keep2 && keep2 !== primary && [...sel2.options].some((o) => o.value === keep2)) {
    sel2.value = keep2;
    state.galleryDir2 = keep2;
  } else {
    sel2.value = "";
    state.galleryDir2 = null;
    state.galleryImages2 = [];
  }
}

async function loadGallerySets() {
  try {
    const data = await api("/api/sets");
    const sel = $("v-dir");
    if (!sel) return;
    const sets = data.sets || [];
    state.gallerySets = sets;
    const keep = state.galleryDir || sel.value;
    if (!sets.length) {
      sel.innerHTML = `<option value="">${t("gallery.noSets")}</option>`;
      state.galleryDir = null;
      syncCompareSelect();
      return;
    }
    sel.innerHTML = sets.map((s) =>
      `<option value="${escapeHtml(s.dir)}">${escapeHtml(s.dir)} (${s.count})</option>`
    ).join("");
    if (keep && [...sel.options].some((o) => o.value === keep)) sel.value = keep;
    else if (sets[0]) sel.value = sets[0].dir;
    state.galleryDir = sel.value;
    syncCompareSelect();
  } catch (e) {
    console.warn(e);
  }
}

async function loadGalleryDir2(dir2) {
  if (!dir2 || dir2 === state.galleryDir) {
    state.galleryDir2 = null;
    state.galleryImages2 = [];
    return;
  }
  try {
    const data = await api(`/api/set?dir=${encodeURIComponent(dir2)}`);
    state.galleryDir2 = data.dir;
    state.galleryImages2 = data.images || [];
  } catch (e) {
    console.warn(e);
    state.galleryDir2 = dir2;
    state.galleryImages2 = [];
  }
}

async function loadGalleryDir(dir) {
  const empty = $("v-empty");
  const grid = $("v-grid");
  if (!dir) {
    if (empty) {
      empty.hidden = false;
      empty.textContent = t("gallery.empty");
    }
    if (grid) grid.innerHTML = "";
    if ($("v-stats")) $("v-stats").textContent = "";
    state.galleryImages = [];
    state.galleryMarks = {};
    state.galleryShelved = [];
    state.galleryImages2 = [];
    await loadSetTrash();
    renderAside();
    renderSetTrash();
    return;
  }
  try {
    const data = await api(`/api/set?dir=${encodeURIComponent(dir)}`);
    state.galleryDir = data.dir;
    state.galleryImages = data.images || [];
    state.galleryMarks = data.marks || {};
    state.galleryShelved = data.shelved || [];
    await loadGalleryDir2($("v-dir2")?.value || state.galleryDir2);
    await loadSetTrash();
    renderGallery();
  } catch (e) {
    if (empty) {
      empty.hidden = false;
      empty.textContent = e.message;
    }
    if (grid) grid.innerHTML = "";
  }
}

function sideHtml(img, dirLabel) {
  if (!img?.url) {
    return `<div class="missing">${escapeHtml(t("gallery.missing", { dir: dirLabel || "—" }))}</div>`;
  }
  const qa = img.qa?.ok === false
    ? `<span class="qa-badge" title="${escapeHtml((img.qa.issues || []).join(", "))}">${t("gallery.qa.badge")}</span>`
    : "";
  return `<div class="side"><img src="${escapeHtml(img.url)}" alt="${escapeHtml(t("gallery.zoom.alt"))}" data-url="${escapeHtml(img.url)}" /><span class="side-lab">${escapeHtml(dirLabel || "")}${qa}</span></div>`;
}

function renderGallery() {
  const empty = $("v-empty");
  const grid = $("v-grid");
  if (!grid) return;
  const images = state.galleryImages || [];
  const images2 = state.galleryImages2 || [];
  const marks = state.galleryMarks || {};
  const dir = state.galleryDir || "";
  const dir2 = state.galleryDir2 || "";
  const comparing = Boolean(dir2 && dir2 !== dir);

  const rows = comparing
    ? mergeEditions(images, images2)
    : images.map((img) => ({ edition: Number(img.edition), a: img, b: null }));
  const shelved = state.galleryShelved || [];

  if (!rows.length) {
    if (empty) {
      empty.hidden = shelved.length > 0;
      empty.textContent = t("gallery.empty");
    }
    grid.innerHTML = "";
    grid.classList.remove("pair");
    if ($("v-stats")) $("v-stats").textContent = "";
    renderAside();
    renderSetTrash();
    return;
  }
  if (empty) empty.hidden = true;

  let keep = 0, redo = 0, none = 0;
  for (const img of images) {
    if (Number(img.edition) === 0) continue; // genesis lot (base image) has no keep/redo
    const m = marks[String(img.edition)] || "";
    if (m === "keep") keep++;
    else if (m === "redo") redo++;
    else none++;
  }

  const filter = $("v-filter")?.value || "";
  grid.classList.toggle("pair", comparing);
  grid.innerHTML = "";

  for (const row of rows) {
    const key = String(row.edition);
    const mark = marks[key] || "";
    if (filter === "keep" && mark !== "keep") continue;
    if (filter === "redo" && mark !== "redo") continue;
    if (filter === "none" && mark) continue;

    const tile = document.createElement("div");
    tile.className = `tile ${mark}`;
    tile.dataset.edition = key;
    if (state.galleryDupeEditions?.has(key)) tile.classList.add("dupe");
    if (row.a?.qa?.ok === false) tile.classList.add("qa-bad");

    const triage = state.galleryTriage[key];
    let triageBadge = "";
    if (triage) {
      const bg = triage.verdict === "keep" ? "#10b981" : triage.verdict === "redo" ? "#ef4444" : "#f59e0b";
      const tooltip = escapeHtml(`${triage.reason}\n${t("gallery.triage.issues", { list: (triage.issues || []).join(", ") })}`);
      triageBadge = `<span class="triage-badge" title="${tooltip}" style="cursor:help; margin-left:6px; font-size:10px; padding:2px 6px; border-radius:8px; font-weight:bold; background:${bg}; color:#fff">${triage.score}/10 ${triage.verdict.toUpperCase()}</span>`;
    }

    if (comparing) {
      tile.innerHTML = `
        <div class="imgs">${sideHtml(row.a, dir)}${sideHtml(row.b, dir2)}</div>
        <div class="meta"><b>#${row.edition}</b>${triageBadge}</div>
        ${frameActionButtons(Boolean(row.a))}`;
      tile.querySelectorAll("img").forEach((el) => {
        el.addEventListener("click", () => openLightbox(el.dataset.url || el.src));
      });
    } else {
      const img = row.a;
      const qa = img?.qa?.ok === false
        ? `<span class="qa-badge">${t("gallery.qa.badge")}</span>`
        : "";
      const ver = img.versions > 1
        ? `<button type="button" class="ver-badge" title="${escapeHtml(t("ver.badge.title", { n: img.versions }))}" data-tip="${escapeHtml(t("ver.badge.title", { n: img.versions }))}">v·${img.versions}</button>`
        : "";
      const sim = state.gallerySimilarity?.[key];
      const simBadge = $("v-similarity")?.checked && sim && sim.similarity != null
        ? `<span class="sim-badge${sim.warn ? " warn" : ""}" title="${sim.warn ? escapeHtml(t("gallery.similarity.warn")) : ""}">${escapeHtml(t("gallery.similarity.value", { n: sim.similarity }))}</span>`
        : "";
      const thumb = $("v-thumb64")?.checked
        ? `<img class="thumb64" width="64" height="64" src="${escapeHtml(img.url)}" alt="${escapeHtml(t("gallery.thumb64.alt"))}">`
        : "";
      tile.innerHTML = `
        <div class="shot">
          <img src="${escapeHtml(img.url)}" alt="${escapeHtml(t("gallery.zoom.alt"))} #${img.edition}" />
          ${thumb}
        </div>
        <div class="meta">${Number(img.edition) === 0 ? `<b>${t("gallery.genesis.label")}</b>` : `#${img.edition}`} ${ver}${qa}${triageBadge}${simBadge}</div>
        ${Number(img.edition) === 0 ? `<div class="btns"><span class="muted small">${t("gallery.genesis.note")}</span></div>` : frameActionButtons(true)}`;
      tile.querySelectorAll(".shot img").forEach((el) => {
        el.addEventListener("click", () => openLightbox(img.url));
      });
      tile.querySelector(".ver-badge")?.addEventListener("click", () => openVersions(img.edition));
    }

    tile.querySelector(".b-keep")?.addEventListener("click", () => toggleMark(row.edition, "keep"));
    tile.querySelector(".b-redo")?.addEventListener("click", () => toggleMark(row.edition, "redo"));
    tile.querySelector(".b-drop")?.addEventListener("click", () => dropFrame(row.edition));
    tile.querySelector(".b-delete")?.addEventListener("click", () => deleteFrame(row.edition));
    grid.appendChild(tile);
  }
  if ($("v-stats")) $("v-stats").textContent = t("gallery.stats", { keep, redo, none });
  applyTips(grid);
  renderAside();
  renderSetTrash();
}

function frameActionButtons(canFile) {
  const fileBtns = canFile
    ? `<button type="button" class="btn small b-drop"${tipAttr("gallery.drop")}>${t("gallery.drop")}</button>
       <button type="button" class="btn small b-delete"${tipAttr("gallery.delete")}>${t("gallery.delete")}</button>`
    : "";
  return `<div class="btns">
    <button type="button" class="btn small b-keep"${tipAttr("gallery.keep")}>${t("gallery.keep")}</button>
    <button type="button" class="btn small b-redo"${tipAttr("gallery.redo")}>${t("gallery.redo")}</button>
    ${fileBtns}
  </div>`;
}

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
function tList(prefix) {
  const out = [];
  for (let i = 1; i < 100; i++) {
    const key = `${prefix}${i}`;
    const s = t(key);
    if (s === key) break;
    out.push(s);
  }
  return out;
}

const esc = (key) => escapeHtml(t(key));
const helpList = (prefix, tag = "ul") =>
  `<${tag}>${tList(prefix).map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</${tag}>`;

function helpSections() {
  const isAdmin = Boolean(state.account?.admin);
  const stepDefs = isAdmin ? HELP_STEPS : HELP_STEPS.filter(([id]) => id !== "s8");
  const steps = stepDefs.map(([id, tab], i) => `
    <details class="help-step help-item" ${i === 0 ? "open" : ""}>
      <summary><span class="help-step-n">${id === "s8" ? "⚙" : (i + 1)}</span>${escapeHtml(t(`help.${id}.title`).replace(/^(\d+\s*·|💰|⚙)\s*/u, ""))}</summary>
      <div class="help-step-body">
        <p class="help-why"><b>${esc("help.label.why")}:</b> ${esc(`help.${id}.why`)}</p>
        <h4>${esc("help.label.do")}</h4>${helpList(`help.${id}.do`, "ol")}
        <p class="help-get"><b>${esc("help.label.get")}:</b> ${esc(`help.${id}.get`)}</p>
        <h4>${esc("help.label.oops")}</h4>${helpList(`help.${id}.oops`)}
        <button type="button" class="btn small" data-goto="${tab}">${esc("help.open")}</button>
      </div>
    </details>`).join("");

  const glossary = tList("help.gl").map((s) => {
    const [term, ...rest] = s.split(" — ");
    return `<div class="help-item gl-row"><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(rest.join(" — "))}</dd></div>`;
  }).join("");

  const faq = tList("help.faq.q").map((q, i) => `
    <details class="help-item faq-item"><summary>${escapeHtml(q)}</summary><p>${esc(`help.faq.a${i + 1}`)}</p></details>`).join("");

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
    ["steps", `<p>${esc("help.steps.desc")}</p>${steps}`],
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

function renderHelp() {
  const body = $("help-body");
  const toc = $("help-toc");
  if (!body || !toc) return;
  const sections = helpSections();
  body.innerHTML = sections.map(([id, html]) =>
    `<section class="help-sec card" id="help-${id}" data-help-id="${id}"><h2>${esc(`help.${id}.title`)}</h2>${html}</section>`).join("");
  toc.innerHTML = `<b>${esc("help.toc.title")}</b>` + sections.map(([id]) =>
    `<a href="#help-${id}" data-sec="${id}">${esc(`help.${id}.title`)}</a>`).join("");
  body.querySelectorAll("[data-goto]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.goto)));
  toc.querySelectorAll("a").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    $(`help-${a.dataset.sec}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  filterHelp($("help-search")?.value || "");
}

function filterHelp(query) {
  const q = query.trim().toLowerCase();
  let shown = 0;
  document.querySelectorAll("#help-body .help-sec").forEach((sec) => {
    const items = sec.querySelectorAll(".help-item");
    let secHit = !q || sec.querySelector("h2").textContent.toLowerCase().includes(q);
    let itemHits = 0;
    items.forEach((it) => {
      const hit = !q || it.textContent.toLowerCase().includes(q);
      it.hidden = Boolean(q) && !hit && !secHit;
      if (q && hit) {
        itemHits++;
        if (it.tagName === "DETAILS") it.open = true;
      }
    });
    const visible = !q || secHit || itemHits > 0 || sec.textContent.toLowerCase().includes(q);
    sec.hidden = !visible;
    if (visible) shown++;
  });
  const count = $("help-search-count");
  if (count) count.textContent = q ? (shown ? t("help.search.count", { n: shown }) : t("help.search.none")) : "";
}

function setupHelp() {
  renderHelp();
  $("help-search")?.addEventListener("input", (e) => filterHelp(e.target.value));
}

/* ---------- Account (public mode: wallet, credits, top-up) ---------- */
state.account = null;

function shortWallet(w) {
  const s = String(w || "");
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}

function packageTitle(label) {
  return String(label || "").replace(/^[\p{Extended_Pictographic}\s🟢🟡🔵]+\s*/u, "").trim() || label;
}

function engineBaseLabel(id, mode) {
  if (mode) {
    const specific = `engine.${id}.${mode}`;
    if (hasKey(specific)) return t(specific);
  }
  const key = `engine.${id}`;
  return hasKey(key) ? t(key) : String(id || "");
}

function selectEngineMode(sel) {
  if (!sel) return null;
  if (sel.id === "base-wish-engine") return $("base-wish-ref")?.checked ? "edit" : "txt";
  if (sel.id === "o-engine" || sel.id === "g-engine" || sel.id === "c-engine") return "edit";
  return null;
}

const STRENGTH_KIND = {
  kontext: "words",
  openai: "words",
  pollinations: "words",
  stability: "denoise",
  comfyui: "denoise",
  a1111: "denoise",
  runware: "runware",
  fal: "fal",
  mock: "ignored",
  schnell: "ignored",
};

function strengthNote(engineId) {
  const kind = STRENGTH_KIND[engineId] || "ignored";
  return t(`strength.note.${kind}`);
}

function paintStrengthNote(noteId, engineId) {
  const el = $(noteId);
  if (el) el.textContent = strengthNote(engineId);
}

/** User-facing price: credits in public mode; plain name otherwise (no fake $). */
function engineOptionLabel(id, mode) {
  const base = engineBaseLabel(id, mode);
  const me = state.account;
  const gpu = me?.localGpu;
  const localOn = !!gpu?.enabled;
  if ((id === "comfyui" || id === "a1111") && localOn) {
    const st = state.localGpuStatus?.[id];
    const fee = Number(gpu.creditPerImage ?? 1);
    const feeLbl = gpu.monetized
      ? t("engine.localFee", { n: fee })
      : t("engine.localReady");
    if (st?.online === true) return `${base} · ${t("engine.localOnline")} · ${feeLbl}`;
    if (st?.online === false) return `${base} · ${t("engine.localOffline")}`;
    return `${base} · ${feeLbl}`;
  }
  if (!me || me.mode !== "public") return base;
  if (id === "comfyui" || id === "a1111") return `${base} · ${t("engine.offline")}`;
  const c = me.creditCosts?.[id];
  if (c === 0 || id === "mock") return `${base} · ${t("engine.free")}`;
  if (typeof c === "number" && c > 0) return `${base} · ${t("engine.perImage", { n: c })}`;
  return base;
}

function relabelEngineSelects() {
  const localOn = !!state.account?.localGpu?.enabled;
  document.body.classList.toggle("local-gpu-on", localOn);
  for (const sel of document.querySelectorAll("select")) {
    let any = false;
    const mode = selectEngineMode(sel);
    for (const opt of sel.options) {
      const isLocalGpu = opt.hasAttribute("data-local-gpu") || opt.value === "comfyui" || opt.value === "a1111";
      if (isLocalGpu) {
        opt.hidden = !localOn;
        opt.disabled = !localOn;
        if (!localOn && sel.value === opt.value) {
          const fallback = [...sel.options].find((o) => !o.disabled && o.value === "kontext")
            || [...sel.options].find((o) => !o.disabled && o.value === "mock")
            || [...sel.options].find((o) => !o.disabled);
          if (fallback) sel.value = fallback.value;
        }
      }
      if (!hasKey(`engine.${opt.value}`) && !(mode && hasKey(`engine.${opt.value}.${mode}`))) continue;
      any = true;
      opt.textContent = engineOptionLabel(opt.value, mode);
    }
    if (!any) continue;
  }
  renderLocalGpuPanel();
  syncWishControls();
  paintStrengthNote("o-strength-note", $("o-engine")?.value);
  paintStrengthNote("g-strength-note", $("g-engine")?.value);
}

function paintWishPrompt() {
  const el = $("base-wish-prompt");
  if (!el) return;
  const wish = ($("base-wish")?.value || "").trim();
  const useRef = Boolean($("base-wish-ref")?.checked);
  el.textContent = useRef
    ? `${t("base.wish.promptEdit")}\n${wish}`
    : `${t("base.wish.promptTxt")}\n${t("base.wish.wrapPrefix")}${wish}`;
}

function syncWishControls() {
  const sel = $("base-wish-engine");
  const useRef = Boolean($("base-wish-ref")?.checked);
  const hasPrimary = (state.baseFiles || []).some((f) => f.primary);
  const mode = useRef ? "edit" : "txt";
  const ready = useRef ? state.health?.engines?.readyEdit : state.health?.engines?.readyTxt2img;
  const gpuOn = !!state.account?.localGpu?.enabled;
  if (sel) {
    for (const opt of sel.options) {
      const where = opt.dataset.mode || "both";
      const inMode = where === "both" || where === mode;
      const gpuOff = (opt.value === "comfyui" || opt.value === "a1111") && !gpuOn;
      const listed = !Array.isArray(ready) || ready.includes(opt.value);
      const show = inMode && !gpuOff;
      opt.hidden = !show;
      opt.disabled = !show || !listed;
      if (show) opt.textContent = engineOptionLabel(opt.value, mode);
    }
    const current = sel.selectedOptions[0];
    if (!current || current.disabled || current.hidden) {
      const next = [...sel.options].find((o) => !o.disabled && !o.hidden);
      if (next) sel.value = next.value;
    }
  }
  const active = useRef && hasPrimary;
  const slider = $("base-wish-str");
  if (slider) slider.disabled = !active;
  const strengthLabel = $("base-wish-str-label");
  if (strengthLabel) strengthLabel.classList.toggle("strength-off", !active);
  const scale = $("base-wish-scale");
  if (scale) scale.hidden = !active;
  const note = $("base-wish-str-note");
  if (note) {
    if (!useRef) note.textContent = t("strength.note.needRef");
    else if (!hasPrimary) note.textContent = t("strength.note.needPrimary");
    else note.textContent = strengthNote(sel?.value);
  }
  const gen = $("base-wish-gen");
  if (gen && gen.dataset.busy !== "1") gen.disabled = useRef && !hasPrimary;
  paintWishPrompt();
}

function localGpuDotClass(online) {
  if (online === true) return "on";
  if (online === false) return "off";
  return "unk";
}

function renderLocalGpuPanel() {
  const box = $("local-gpu-panel");
  if (!box) return;
  const me = state.account;
  const gpu = me?.localGpu;
  box.hidden = false;
  if (!gpu) {
    box.hidden = true;
    return;
  }
  if (!gpu.enabled) {
    box.className = "local-gpu-panel off";
    box.innerHTML = `
      <h4>${escapeHtml(t("localGpu.title"))}</h4>
      <p class="muted small">${escapeHtml(t("localGpu.public.p1"))}</p>
      <p class="muted small">${escapeHtml(t("localGpu.public.p2"))}</p>
      <p class="muted small">${escapeHtml(t("localGpu.public.revenue"))}</p>
      <ol class="local-gpu-steps">
        ${tList("localGpu.public.li").map((s) => `<li>${escapeHtml(s)}</li>`).join("")}
      </ol>
      <div class="local-gpu-row">
        <button type="button" class="btn small" data-goto-help="localgpu">${escapeHtml(t("localGpu.openHelp"))}</button>
      </div>`;
    box.querySelector("[data-goto-help]")?.addEventListener("click", () => {
      showTab("help");
      const sec = document.querySelector('#help-body [data-help-id="localgpu"]');
      if (sec) {
        sec.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
    return;
  }
  const st = state.localGpuStatus || {};
  const c = st.comfyui || {};
  const a = st.a1111 || {};
  box.className = "local-gpu-panel on";
  const fee = Number(gpu.creditPerImage ?? 1);
  const feeLine = gpu.monetized
    ? escapeHtml(t("localGpu.local.fee", { n: fee }))
    : escapeHtml(t("localGpu.local.freeDev"));
  box.innerHTML = `
    <h4>${escapeHtml(t("localGpu.title"))}</h4>
    <p class="muted small">${escapeHtml(t("localGpu.local.p1"))}</p>
    <p class="muted small"><b>${feeLine}</b></p>
    <div class="local-gpu-row">
      <span><span class="local-gpu-dot ${localGpuDotClass(c.online)}"></span>ComfyUI · ${escapeHtml(c.online === true ? t("localGpu.online") : c.online === false ? t("localGpu.offline") : t("localGpu.unchecked"))}</span>
      <span class="muted small">${escapeHtml(gpu.urls?.comfyui || "")}</span>
    </div>
    <div class="local-gpu-row">
      <span><span class="local-gpu-dot ${localGpuDotClass(a.online)}"></span>A1111 · ${escapeHtml(a.online === true ? t("localGpu.online") : a.online === false ? t("localGpu.offline") : t("localGpu.unchecked"))}</span>
      <span class="muted small">${escapeHtml(gpu.urls?.a1111 || "")}</span>
    </div>
    <ol class="local-gpu-steps">
      ${tList("localGpu.local.li").map((s) => `<li>${escapeHtml(s)}</li>`).join("")}
    </ol>
    <div class="local-gpu-row">
      <button type="button" id="local-gpu-probe" class="btn small primary">${escapeHtml(t("localGpu.probe"))}</button>
      <button type="button" class="btn small" data-goto-help="localgpu">${escapeHtml(t("localGpu.openHelp"))}</button>
      <span id="local-gpu-msg" class="muted small"></span>
    </div>`;
  box.querySelector("#local-gpu-probe")?.addEventListener("click", () => probeLocalGpu());
  box.querySelector("[data-goto-help]")?.addEventListener("click", () => {
    showTab("help");
    const sec = document.querySelector('#help-body [data-help-id="localgpu"]');
    if (sec) {
      sec.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
}

async function probeLocalGpu() {
  const btn = $("local-gpu-probe");
  const msg = $("local-gpu-msg");
  if (btn) {
    btn.disabled = true;
    btn.textContent = t("localGpu.probing");
  }
  try {
    const data = await api("/api/local-gpu?probe=1");
    state.localGpuStatus = {
      comfyui: data.comfyui,
      a1111: data.a1111,
    };
    if (msg) {
      const ok = data.comfyui?.online || data.a1111?.online;
      msg.textContent = ok ? t("localGpu.probeOk") : t("localGpu.probeNone");
    }
    relabelEngineSelects();
  } catch (e) {
    if (msg) msg.textContent = e.message || t("localGpu.probeFail");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = t("localGpu.probe");
    }
  }
}

function perCreditUsd(usd, credits) {
  const c = Number(credits) || 0;
  if (!c) return "";
  return `≈ ${fmtUsdLocale(Number(usd) / c, 3)}/${t("acct.creditsShort")}`;
}

async function refreshAccount() {
  let me;
  try {
    me = await api("/api/me");
  } catch {
    return;
  }
  state.account = me;
  applyAdminNav();
  renderHelp();
  const box = $("acct");
  const isPublic = me.mode === "public";
  if (box) box.hidden = !isPublic;
  document.body.classList.toggle("public-mode", isPublic);
  document.querySelectorAll(".public-only").forEach((el) => { el.hidden = !isPublic; });
  relabelEngineSelects();
  if (!isPublic) return;
  const w = $("acct-wallet");
  if (w) {
    w.textContent = shortWallet(me.wallet);
    w.title = me.wallet;
  }
  if ($("acct-balance")) $("acct-balance").textContent = fmtNum(me.balance);
  if ($("topup-balance")) $("topup-balance").textContent = fmtNum(me.balance);
  $("acct-topup")?.classList.toggle("low", Number(me.balance) < LOW_BALANCE);
  const topupBtn = $("acct-topup");
  if (topupBtn) topupBtn.setAttribute("aria-label", `${t("acct.topup")} · ${me.balance} ${t("acct.credits")}`);
}

function renderTopup() {
  const me = state.account;
  if (!me) return;
  if ($("topup-balance")) $("topup-balance").textContent = fmtNum(me.balance);
  const grid = $("topup-packages");
  if (grid) {
    grid.innerHTML = (me.packages || []).map((p) => {
      const title = packageTitle(p.label);
      const unit = perCreditUsd(p.usd, p.credits);
      return `
      <article class="topup-card topup-card--${escapeHtml(p.id)}${p.recommended ? " rec" : ""}">
        ${p.recommended ? `<span class="topup-card-badge">${escapeHtml(t("topup.recommended"))}</span>` : ""}
        <div class="topup-card-name">${escapeHtml(title)}</div>
        <div class="topup-credits"><b>${fmtNum(p.credits)}</b> <span class="muted small">${escapeHtml(t("acct.credits"))}</span></div>
        <div class="topup-price">
          <span class="topup-usd">${escapeHtml(fmtUsdLocale(p.usd, 2))}</span>
          ${unit ? `<span class="topup-unit">${escapeHtml(unit)}</span>` : ""}
        </div>
        <p class="topup-note">${escapeHtml(p.note || "")}</p>
        ${me.solPay?.enabled
          ? `<button type="button" class="btn primary topup-buy" data-pack="${escapeHtml(p.id)}" data-tip="${escapeHtml(tipText("topup.buy.tip") || t("topup.buy"))}">${escapeHtml(t("topup.buy"))}</button>`
          : `<span class="topup-unavailable">${escapeHtml(t("topup.unavailable"))}</span>`}
      </article>`;
    }).join("");
    applyTips(grid);
  }
  renderSolSection();
  const ref = me.referral?.link || "";
  if ($("ref-link")) $("ref-link").textContent = ref || "—";
  const copyBtn = $("ref-copy");
  if (copyBtn) copyBtn.disabled = !ref;
  api("/api/credits/history").then((d) => {
    const box = $("credit-history");
    if (!box) return;
    const rows = d.transactions || [];
    box.innerHTML = rows.length
      ? rows.map((tx) =>
        `<div class="hist-row"><span>${escapeHtml(fmtDate(tx.created_at))}</span><span title="${escapeHtml(tx.note || tx.kind)}">${escapeHtml(tx.note || tx.kind)}</span><b class="${tx.credits < 0 ? "bad" : "ok"}">${tx.credits > 0 ? "+" : ""}${fmtNum(tx.credits)}</b></div>`)
        .join("")
      : `<p class="muted hist-empty">${escapeHtml(t("history.empty"))}</p>`;
  }).catch(() => {});
}

function setSyncStatus(el, text, kind) {
  if (!el) return;
  el.textContent = text;
  el.classList.remove("ok", "bad", "busy");
  if (kind) el.classList.add(kind);
}

const LOW_BALANCE = 10;

function showToast(text) {
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

/** Opens the top-up window; `needed`/`balance` explain why (refused generation). */
function openTopup({ needed, balance } = {}) {
  const overlay = $("topup-overlay");
  if (!overlay) return;
  renderTopup();
  const reason = $("topup-reason");
  if (reason) {
    reason.hidden = !needed;
    reason.textContent = needed ? t("topup.reason", { needed, balance: balance ?? state.account?.balance ?? 0 }) : "";
  }
  overlay.hidden = false;
  $("topup-close")?.focus();
  if (state.account?.solPay?.enabled) solCheck(); // shows an open order / credits a payment that arrived meanwhile
}

// ── Direct USDC (Solana): prepare tx → Phantom confirm → server finds it on-chain ──
const SOL_POLL_MS = 8_000;
let solPollTimer = null;
let solShownId = "";
let solBusy = false;

function getSolanaProvider() {
  const p = window.phantom?.solana || (window.solana?.isPhantom ? window.solana : null) || window.solana;
  return p?.isPhantom || p?.publicKey || typeof p?.connect === "function" ? p : null;
}

async function ensureSolanaPayer() {
  const provider = getSolanaProvider();
  if (!provider) throw new Error(t("sol.noWallet"));
  if (!provider.publicKey) {
    const res = await provider.connect();
    if (!provider.publicKey && res?.publicKey) provider.publicKey = res.publicKey;
  }
  const pk = provider.publicKey?.toString?.() || String(provider.publicKey || "");
  if (!pk) throw new Error(t("sol.noWallet"));
  return { provider, payer: pk };
}

async function loadSolanaWeb3() {
  if (window.__seriesWeb3) return window.__seriesWeb3;
  const mod = await import("https://esm.sh/@solana/web3.js@1.98.4");
  window.__seriesWeb3 = mod;
  return mod;
}

async function signAndSendUsdcPayment(transactionBase64) {
  const { provider } = await ensureSolanaPayer();
  const { Transaction } = await loadSolanaWeb3();
  const raw = Uint8Array.from(atob(transactionBase64), (c) => c.charCodeAt(0));
  const tx = Transaction.from(raw);
  const sent = await provider.signAndSendTransaction(tx);
  return sent?.signature || sent;
}

function renderSolSection() {
  const sp = state.account?.solPay;
  const section = $("sol-section");
  if (!section) return;
  const box = $("sol-packs");
  if (box) box.innerHTML = sp?.testPack
    ? `<button type="button" class="btn small sol-pack" data-pack="${escapeHtml(sp.testPack.id)}">${escapeHtml(packageTitle(sp.testPack.label))} · ${escapeHtml(fmtUsdLocale(sp.testPack.usd, 2))} → ${fmtNum(sp.testPack.credits)} ${escapeHtml(t("acct.credits"))}</button>`
    : "";
  section.hidden = !(sp?.enabled && (sp.testPack || solShownId));
}

function showSolOrder(o) {
  const panel = $("sol-order");
  if (!panel || !o) return;
  solShownId = o.id;
  panel.hidden = false;
  $("sol-amount").textContent = o.amount;
  $("sol-address").textContent = o.recipient;
  const open = $("sol-open");
  if (open) open.href = o.uri || "#";
  panel.dataset.credits = String(o.credits);
  panel.dataset.pack = o.package || "";
  $("sol-section").hidden = false;
  setSolStatus(t("sol.waiting", { credits: o.credits }), "busy");
  document.querySelectorAll(".sol-pack").forEach((b) => b.classList.toggle("on", b.dataset.pack === o.package));
  document.querySelectorAll(".topup-card").forEach((c) => c.classList.toggle("selected", c.classList.contains(`topup-card--${o.package}`)));
  panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function setSolStatus(text, kind) {
  const el = $("sol-status");
  if (el) setSyncStatus(el, text, kind);
}

function stopSolPoll() {
  clearInterval(solPollTimer);
  solPollTimer = null;
}

async function solCheck() {
  let r;
  try {
    r = await api("/api/credits/sol/check", { method: "POST", body: "{}" });
  } catch {
    return;
  }
  if (r.credited > 0) {
    stopSolPoll();
    $("sol-order").hidden = true;
    solShownId = "";
    document.querySelectorAll(".topup-card.selected").forEach((c) => c.classList.remove("selected"));
    showToast(t("topup.toast", { n: r.credited, balance: r.balance }));
    await refreshAccount();
    renderTopup();
    return;
  }
  const pending = (r.orders || []).find((o) => o.status === "pending");
  if (!pending) {
    stopSolPoll();
    return;
  }
  if (solShownId !== pending.id) showSolOrder(pending);
  if (r.error) setSolStatus(r.error, "bad");
  startSolPoll();
}

function startSolPoll() {
  if (solPollTimer) return;
  solPollTimer = setInterval(() => {
    if ($("topup-overlay")?.hidden) { stopSolPoll(); return; }
    solCheck();
  }, SOL_POLL_MS);
}

/** Prefer in-wallet confirm; fall back to order + manual/deeplink. */
async function solCreate(packageId) {
  if (solBusy) return;
  solBusy = true;
  const btn = $("sol-confirm");
  try {
    if (getSolanaProvider()) {
      setSolStatus(t("sol.confirming"), "busy");
      if (btn) btn.disabled = true;
      const { payer } = await ensureSolanaPayer();
      const r = await api("/api/credits/sol/prepare", {
        method: "POST",
        body: JSON.stringify({ package: packageId, payer }),
      });
      showSolOrder(r.order);
      setSolStatus(t("sol.confirming"), "busy");
      await signAndSendUsdcPayment(r.transaction);
      setSolStatus(t("sol.sent"), "busy");
      startSolPoll();
      solCheck();
      return;
    }
    const r = await api("/api/credits/sol/order", { method: "POST", body: JSON.stringify({ package: packageId }) });
    showSolOrder(r.order);
    setSolStatus(t("sol.noWallet"), "bad");
    startSolPoll();
    solCheck();
  } catch (err) {
    const msg = String(err?.message || err);
    if (/User rejected|rejected the request|denied/i.test(msg)) {
      setSolStatus(msg, "bad");
    } else {
      try {
        const r = await api("/api/credits/sol/order", { method: "POST", body: JSON.stringify({ package: packageId }) });
        showSolOrder(r.order);
      } catch {
        $("sol-order").hidden = false;
      }
      setSolStatus(msg, "bad");
      startSolPoll();
    }
  } finally {
    solBusy = false;
    if (btn) btn.disabled = false;
  }
}

async function solConfirmClick() {
  const pack = $("sol-order")?.dataset.pack;
  if (pack) return solCreate(pack);
}

async function copyText(text, btn) {
  const label = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = t("sol.copied");
  } catch {
    btn.textContent = text;
  }
  setTimeout(() => { btn.textContent = label; }, 1500);
}

function setupSolPay() {
  const onPack = (e) => {
    const b = e.target.closest?.(".topup-buy, .sol-pack");
    if (b) solCreate(b.dataset.pack);
  };
  $("topup-packages")?.addEventListener("click", onPack);
  $("sol-packs")?.addEventListener("click", onPack);
  $("sol-confirm")?.addEventListener("click", () => solConfirmClick());
  $("sol-copy-amount")?.addEventListener("click", (e) => copyText($("sol-amount").textContent, e.currentTarget));
  $("sol-copy-address")?.addEventListener("click", (e) => copyText($("sol-address").textContent, e.currentTarget));
}

function setupAccount() {
  setupSolPay();
  const overlay = $("topup-overlay");
  $("acct-topup")?.addEventListener("click", () => openTopup());
  $("acct-buy")?.addEventListener("click", () => openTopup());
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && solShownId) solCheck(); // back from the wallet app
  });
  $("topup-close")?.addEventListener("click", () => { overlay.hidden = true; refreshAccount(); });
  overlay?.addEventListener("click", (e) => { if (e.target === overlay) { overlay.hidden = true; refreshAccount(); } });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const light = $("v-lightbox");
    if (light && !light.hidden) {
      light.hidden = true;
      return;
    }
    if (overlay && !overlay.hidden) {
      overlay.hidden = true;
      refreshAccount();
    }
  });
  $("ref-copy")?.addEventListener("click", async () => {
    const link = state.account?.referral?.link;
    const status = $("ref-copy-status");
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      if (status) {
        status.hidden = false;
        status.textContent = t("ref.copied");
        setTimeout(() => { status.hidden = true; }, 2000);
      }
    } catch {
      if (status) {
        status.hidden = false;
        status.textContent = t("ref.copyFail");
      }
    }
  });
  const dataOverlay = $("data-overlay");
  const dataConfirm = $("data-confirm");
  const dataRun = $("data-run");
  $("acct-data")?.addEventListener("click", () => {
    if (!dataOverlay) return;
    dataOverlay.hidden = false;
    if (dataConfirm) dataConfirm.value = "";
    if (dataRun) dataRun.disabled = true;
    if ($("data-msg")) $("data-msg").textContent = "";
    dataConfirm?.focus();
  });
  $("data-close")?.addEventListener("click", () => { if (dataOverlay) dataOverlay.hidden = true; });
  dataConfirm?.addEventListener("input", () => {
    if (dataRun) dataRun.disabled = dataConfirm.value.trim() !== "DELETE";
  });
  dataRun?.addEventListener("click", async () => {
    const msg = $("data-msg");
    try {
      setBusy(dataRun, true);
      if (msg) msg.textContent = t("ui.working");
      await api("/api/account/delete-data", { method: "POST", body: JSON.stringify({ confirm: dataConfirm.value.trim() }) });
      if (msg) msg.textContent = t("data.done");
      await fetch("/auth/logout", { method: "POST" }).catch(() => {});
      setTimeout(() => { location.href = "/login"; }, 1500);
    } catch (e) {
      if (msg) msg.textContent = e.message;
      setBusy(dataRun, false);
    }
  });
  $("acct-logout")?.addEventListener("click", async () => {
    await fetch("/auth/logout", { method: "POST" }).catch(() => {});
    location.href = "/login";
  });
  $("holder-check")?.addEventListener("click", async () => {
    const out = $("holder-status");
    try {
      const e = await api("/api/holder");
      if (!e.claimable_credits) {
        out.textContent = e.already ? t("holder.already") : e.excluded ? t("holder.excluded") : !e.is_solana ? t("holder.notSolana") : t("holder.none");
        return;
      }
      const r = await api("/api/holder/claim", { method: "POST", body: "{}" });
      out.textContent = r.granted ? t("holder.granted", { n: r.credits }) : t("holder.none");
      refreshAccount();
    } catch (err) {
      out.textContent = err.message;
    }
  });
  $("v-publish")?.addEventListener("click", async () => {
    const out = $("v-publish-status");
    if (!state.galleryDir) return;
    try {
      const r = await api("/api/publish", { method: "POST", body: JSON.stringify({ dir: state.galleryDir, title: state.galleryDir }) });
      out.innerHTML = `${escapeHtml(t("publish.done"))} <a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.url)}</a>`;
    } catch (err) {
      out.textContent = err.message;
    }
  });
}

/* ---------- Versions (re-renders never overwrite) ---------- */
async function openVersions(edition) {
  const overlay = $("ver-overlay");
  if (!overlay || !state.galleryDir) return;
  try {
    const data = await api(`/api/versions?dir=${encodeURIComponent(state.galleryDir)}&edition=${edition}`);
    renderVersions(data);
    overlay.hidden = false;
  } catch (e) {
    galleryStatus(e.message);
  }
}

function renderVersions(data) {
  const list = $("ver-list");
  if ($("ver-title")) $("ver-title").textContent = t("ver.title", { edition: data.edition });
  if (!list) return;
  list.innerHTML = "";
  for (const v of [...data.versions].reverse()) {
    const item = document.createElement("div");
    item.className = `ver-item${v.current ? " current" : ""}`;
    const when = v.at ? fmtDate(v.at) : "—";
    item.innerHTML = `
      <img src="${escapeHtml(v.url)}" alt="v${v.v}" />
      <div class="small"><b>v${v.v}</b> ${v.current ? `· ${escapeHtml(t("ver.current"))}` : ""}<br>
        <span class="muted">${escapeHtml(when)}${v.engine ? ` · ${escapeHtml(v.engine)}` : ""}</span></div>
      <div class="btns">${v.current ? "" : `
        <button type="button" class="btn small primary b-cur"${tipAttr("ver.makeCurrent")}>${escapeHtml(t("ver.makeCurrent"))}</button>
        <button type="button" class="btn small b-drop"${tipAttr("ver.drop")}>${escapeHtml(t("ver.drop"))}</button>`}
      </div>`;
    item.querySelector("img").addEventListener("click", () => openLightbox(v.url));
    item.querySelector(".b-cur")?.addEventListener("click", () => versionAction("/api/versions/current", data.edition, v.v));
    item.querySelector(".b-drop")?.addEventListener("click", () => versionAction("/api/versions/drop", data.edition, v.v));
    list.appendChild(item);
  }
  applyTips(list);
}

async function versionAction(path, edition, v) {
  try {
    const data = await api(path, {
      method: "POST",
      body: JSON.stringify({ dir: state.galleryDir, edition, v }),
    });
    renderVersions(data);
    await loadGalleryDir(state.galleryDir);
  } catch (e) {
    galleryStatus(e.message);
  }
}

function galleryStatus(msg) {
  const el = $("v-triage-status");
  if (el) el.textContent = msg;
}

function manageStatus(msg) {
  const el = $("v-manage-status");
  if (el) el.textContent = msg || "";
}

function applyFramePayload(data) {
  if (!data) return;
  if (Array.isArray(data.images)) state.galleryImages = data.images;
  if (data.marks) state.galleryMarks = data.marks;
  if (Array.isArray(data.shelved)) state.galleryShelved = data.shelved;
}

async function dropFrame(edition) {
  if (!state.galleryDir) return;
  try {
    const data = await api("/api/set/drop", {
      method: "POST",
      body: JSON.stringify({ dir: state.galleryDir, edition }),
    });
    applyFramePayload(data);
    delete state.galleryTriage[String(edition)];
    manageStatus(t("gallery.dropped", { edition }));
    renderGallery();
    await loadGallerySets();
  } catch (e) {
    manageStatus(e.message);
  }
}

async function deleteFrame(edition) {
  if (!state.galleryDir) return;
  try {
    const data = await api("/api/set/delete", {
      method: "POST",
      body: JSON.stringify({ dir: state.galleryDir, edition }),
    });
    applyFramePayload(data);
    delete state.galleryTriage[String(edition)];
    manageStatus(t("gallery.deleted", { edition }));
    renderGallery();
    await loadGallerySets();
    await loadSetTrash();
  } catch (e) {
    manageStatus(e.message);
  }
}

async function returnFrame(edition, v) {
  if (!state.galleryDir) return;
  try {
    await api("/api/versions/current", {
      method: "POST",
      body: JSON.stringify({ dir: state.galleryDir, edition, v }),
    });
    manageStatus(t("gallery.returned", { edition }));
    await loadGallerySets();
    await loadGalleryDir(state.galleryDir);
  } catch (e) {
    manageStatus(e.message);
  }
}

function frameTrashMatch(from, dir) {
  const p = String(from || "");
  const rest = dir && p.startsWith(`out/${dir}/`) ? p.slice(`out/${dir}/`.length) : "";
  const body = dir ? rest : p.replace(/^out\/(?!trash\/)[^/]+\//, "");
  if (dir && !p.startsWith(`out/${dir}/`)) return false;
  if (!dir && !/^out\/(?!trash\/)[^/]+\//.test(p)) return false;
  return /^\d+\.(png|jpe?g|webp)$/i.test(body)
    || /^versions\/\d+\//.test(body)
    || /^creation\/\d+\.json$/i.test(body);
}

function trashEdition(item) {
  for (const f of item.files || []) {
    const m = String(f.from || "").match(/\/(\d+)\.(?:png|jpe?g|webp)$/i)
      || String(f.from || "").match(/\/versions\/(\d+)\//)
      || String(f.from || "").match(/\/creation\/(\d+)\.json$/i);
    if (m) return m[1];
  }
  return "";
}

async function loadSetTrash() {
  try {
    const data = await api("/api/trash");
    const dir = state.galleryDir;
    state.galleryTrash = (data.items || []).filter((it) =>
      (it.files || []).some((f) => frameTrashMatch(f.from, dir)));
  } catch {
    state.galleryTrash = [];
  }
  renderSetTrash();
}

function renderAside() {
  const box = $("v-aside");
  const list = $("v-aside-list");
  if (!box || !list) return;
  const rows = state.galleryShelved || [];
  box.hidden = rows.length === 0;
  list.innerHTML = "";
  for (const row of rows) {
    const item = document.createElement("div");
    item.className = "aside-row";
    item.innerHTML = `
      <img src="${escapeHtml(row.url)}" alt="${escapeHtml(t("gallery.zoom.alt"))} #${row.edition}" />
      <div class="small"><b>#${row.edition}</b> <span class="muted">v${row.v}</span></div>
      <div class="btns">
        <button type="button" class="btn small b-return"${tipAttr("gallery.return")}>${escapeHtml(t("gallery.return"))}</button>
        <button type="button" class="btn small b-delete"${tipAttr("gallery.delete")}>${escapeHtml(t("gallery.delete"))}</button>
      </div>`;
    item.querySelector("img").addEventListener("click", () => openLightbox(row.url));
    item.querySelector(".b-return").addEventListener("click", () => returnFrame(row.edition, row.v));
    item.querySelector(".b-delete").addEventListener("click", () => deleteFrame(row.edition));
    list.appendChild(item);
  }
  applyTips(list);
}

function renderSetTrash() {
  const box = $("v-set-trash");
  const list = $("v-set-trash-list");
  if (!box || !list) return;
  const items = state.galleryTrash || [];
  box.hidden = items.length === 0;
  list.innerHTML = "";
  for (const it of items) {
    const edition = trashEdition(it);
    const row = document.createElement("div");
    row.className = "trash-row";
    const label = edition ? `#${edition}` : (it.files || []).map((f) => f.from).join(", ");
    row.innerHTML = `
      <div><b>${escapeHtml(label)}</b> · ${escapeHtml(it.reason || "")}
        <div class="muted">${escapeHtml(fmtDate(it.at))}</div></div>
      <div class="btns">
        <button type="button" class="btn small b-restore"${tipAttr("trash.restore")}>${escapeHtml(t("trash.restore"))}</button>
      </div>`;
    row.querySelector(".b-restore").addEventListener("click", () => restoreFrame(it.id));
    list.appendChild(row);
  }
  applyTips(list);
}

async function restoreFrame(id) {
  try {
    await api("/api/trash/restore", { method: "POST", body: JSON.stringify({ id }) });
    manageStatus(t("gallery.restored"));
    await loadGallerySets();
    if (state.galleryDir) await loadGalleryDir(state.galleryDir);
    else await loadSetTrash();
  } catch (e) {
    manageStatus(e.message);
  }
}

function setupVersions() {
  const overlay = $("ver-overlay");
  $("ver-close")?.addEventListener("click", () => { overlay.hidden = true; });
  overlay?.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.hidden = true;
  });
}

/** Series quality panel: one report for a set (format, duplicates, similarity to the base). */
const QUALITY_KINDS = ["bad_format", "tiny", "duplicate", "low_similarity"];

function renderQuality(data) {
  const out = $("v-quality-out");
  if (!out) return;
  const kindLabel = (k) => t(`gallery.quality.kind.${k}`);
  const parts = [];
  if (!data.problemFrames) {
    parts.push(`<p><b>${escapeHtml(t("gallery.quality.allGood", { total: data.total }))}</b></p>`);
  } else {
    parts.push(`<p><b>${escapeHtml(t("gallery.quality.summary", { problem: data.problemFrames, total: data.total }))}</b></p>`);
    const chips = QUALITY_KINDS.filter((k) => data.counts[k]).map((k) => `<span class="qa-badge">${escapeHtml(kindLabel(k))}: ${data.counts[k]}</span>`);
    parts.push(`<p>${chips.join(" ")}</p>`);
    const todo = QUALITY_KINDS.filter((k) => data.counts[k]).map((k) => `<li>${escapeHtml(t(`gallery.quality.todo.${k}`))}</li>`);
    parts.push(`<ul class="guide">${todo.join("")}</ul>`);
    const rows = data.weakest.map((f) => {
      const issues = f.issues.filter((i) => i.kind !== "marked_redo").map((i) => `${kindLabel(i.kind)}${i.detail ? ` (${escapeHtml(i.detail)})` : ""}`).join(", ");
      const sim = f.similarity != null ? ` · ${escapeHtml(t("gallery.similarity.value", { n: f.similarity }))}` : "";
      return `<li><b>#${f.edition}</b>${sim} · ${issues}</li>`;
    });
    parts.push(`<ul class="guide">${rows.join("")}</ul>`);
    if (data.problemFrames > data.weakest.length) {
      parts.push(`<p class="muted">${escapeHtml(t("gallery.quality.more", { shown: data.weakest.length, total: data.problemFrames }))}</p>`);
    }
    parts.push(`<p><button type="button" id="v-quality-mark" class="btn small"${tipAttr("gallery.quality.markAll")}>${escapeHtml(t("gallery.quality.markAll", { n: data.problemFrames }))}</button> <span id="v-quality-marked" class="muted"></span></p>`);
  }
  if (data.similarity) {
    parts.push(`<p class="muted">${escapeHtml(t("gallery.quality.sim", { mean: data.similarity.mean, min: data.similarity.min, warn: data.similarity.warnBelow }))}</p>`);
  } else if (!data.hasBase) {
    parts.push(`<p class="muted">${escapeHtml(t("gallery.quality.noBase"))}</p>`);
  }
  out.innerHTML = parts.join("");
  out.hidden = false;
  $("v-quality-mark")?.addEventListener("click", async () => {
    const marks = { ...state.galleryMarks };
    let kept = 0;
    let n = 0;
    for (const ed of data.problemEditions) {
      if (marks[String(ed)] === "keep") {
        kept++;
        continue;
      }
      marks[String(ed)] = "redo";
      n++;
    }
    try {
      const res = await api("/api/marks", { method: "POST", body: JSON.stringify({ dir: state.galleryDir, marks }) });
      state.galleryMarks = res.marks || marks;
      renderGallery();
      scheduleWorkspaceSave({ lastSet: state.galleryDir });
      const note = $("v-quality-marked");
      if (note) note.textContent = t("gallery.quality.marked", { n, kept });
    } catch (e) {
      alert(e.message);
    }
  });
}

/** The verifier speaks English so the standalone script needs no locale files; show it in the UI language. */
function provMessage(text) {
  const rules = [
    [/^Editions #(\d+) and #(\d+) are the same image/, "same", (m) => ({ a: m[1], b: m[2] })],
    [/^Hash mismatch for edition #(\d+)/, "mismatch", (m) => ({ ed: m[1] })],
    [/^File missing: (.+)$/, "missing", (m) => ({ file: m[1] })],
    [/^The record is inconsistent/, "inconsistent", () => ({})],
    [/^Unsafe or empty file name for edition #(\d+)/, "unsafe", (m) => ({ ed: m[1] })],
    [/^Edition #(\d+) is listed twice/, "dupEdition", (m) => ({ ed: m[1] })],
    [/^count says/, "count", () => ({})],
    [/^Provenance hash mismatch/, "total", () => ({})],
    [/^(.+) is named \.png but the bytes are not a PNG/, "notPng", (m) => ({ file: m[1] })],
    [/^Edition numbers skip (\d+) value/, "gaps", (m) => ({ n: m[1] })],
    [/^(\d+) image file\(s\) in the folder are not in the record/, "extra", (m) => ({ n: m[1] })],
  ];
  for (const [re, key, params] of rules) {
    const m = re.exec(text);
    if (m) return t(`export.provenance.m.${key}`, params(m));
  }
  return text;
}

function fmtBytes(n) {
  const v = Number(n) || 0;
  return v >= 1048576 ? `${(v / 1048576).toFixed(2)} ${t("export.size.mb")}` : `${Math.round(v / 1024)} ${t("export.size.kb")}`;
}

function setupSizeTools() {
  const msg = $("x-size-msg");
  const run = async (dryRun) => {
    const set = $("x-set")?.value;
    if (!set) {
      if (msg) {
        msg.textContent = t("export.bundle.noSets");
        msg.className = "small err-msg";
      }
      return;
    }
    if (msg) {
      msg.textContent = t(dryRun ? "export.size.scanning" : "export.size.running");
      msg.className = "small muted";
    }
    try {
      const r = await api("/api/set/compress", { method: "POST", body: JSON.stringify({ dir: set, dryRun }) });
      if (dryRun) {
        if (!r.over.length) {
          msg.textContent = t("export.size.none", { n: r.scanned });
          msg.className = "small ok-msg";
        } else {
          const max = Math.max(...r.over.map((o) => o.bytes));
          msg.textContent = t("export.size.found", { over: r.over.length, n: r.scanned, max: fmtBytes(max) });
          msg.className = "small";
        }
      } else {
        msg.textContent = t("export.size.done", { done: r.compressed.length, saved: fmtBytes(r.savedBytes), failed: r.failed.length });
        msg.className = r.failed.length ? "small err-msg" : "small ok-msg";
      }
    } catch (e) {
      msg.textContent = e.message;
      msg.className = "small err-msg";
    }
  };
  $("x-size-scan")?.addEventListener("click", () => run(true));
  $("x-size-run")?.addEventListener("click", () => run(false));
}

/** Optional human-contribution statement for the export. Remembered per browser only. */
const AUTH_KEY = "series-lab-authorship";

function authorshipFromForm() {
  const a = {
    baseOrigin: $("x-auth-base")?.value || "",
    handEdited: Boolean($("x-auth-edited")?.checked),
    handLayers: Boolean($("x-auth-layers")?.checked),
    note: $("x-auth-note")?.value?.trim() || "",
  };
  return a.baseOrigin || a.handEdited || a.handLayers || a.note ? a : null;
}

function setupAuthorship() {
  try {
    const saved = JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
    if (saved) {
      if ($("x-auth-base")) $("x-auth-base").value = saved.baseOrigin || "";
      if ($("x-auth-edited")) $("x-auth-edited").checked = Boolean(saved.handEdited);
      if ($("x-auth-layers")) $("x-auth-layers").checked = Boolean(saved.handLayers);
      if ($("x-auth-note")) $("x-auth-note").value = saved.note || "";
    }
  } catch { /* a blank form is fine */ }
  for (const id of ["x-auth-base", "x-auth-edited", "x-auth-layers", "x-auth-note"]) {
    $(id)?.addEventListener("change", () => {
      try {
        localStorage.setItem(AUTH_KEY, JSON.stringify(authorshipFromForm() || {}));
      } catch { /* storage is optional */ }
    });
  }
}

function setupQuality() {
  $("v-quality-run")?.addEventListener("click", async () => {
    const status = $("v-quality-status");
    const dir = state.galleryDir;
    if (!dir) {
      if (status) status.textContent = t("gallery.quality.noSet");
      return;
    }
    if (status) status.textContent = t("gallery.quality.running");
    try {
      const data = await api(`/api/quality?dir=${encodeURIComponent(dir)}`);
      renderQuality(data);
      if (status) status.textContent = "";
    } catch (e) {
      if (status) status.textContent = e.message;
    }
  });
}

async function toggleMark(edition, kind) {
  if (!state.galleryDir) return;
  const key = String(edition);
  const cur = state.galleryMarks[key] || "";
  const next = cur === kind ? "" : kind;
  try {
    const data = await api("/api/marks", {
      method: "POST",
      body: JSON.stringify({ dir: state.galleryDir, edition, mark: next || null }),
    });
    state.galleryMarks = data.marks || {};
    renderGallery();
    scheduleWorkspaceSave({ lastSet: state.galleryDir });
  } catch (e) {
    alert(e.message);
  }
}

function openLightbox(url) {
  const box = $("v-lightbox");
  const img = $("v-lightbox-img");
  if (!box || !img) return;
  img.src = url;
  img.alt = t("gallery.zoom.alt");
  box.hidden = false;
}

function editionFromFile(name) {
  const m = String(name || "").match(/^(\d+)/);
  return m ? m[1] : "";
}

async function loadSimilarity() {
  const dir = state.galleryDir || $("v-dir")?.value;
  if (!dir || !$("v-similarity")?.checked) {
    state.gallerySimilarity = {};
    renderGallery();
    return;
  }
  const data = await api(`/api/similarity?dir=${encodeURIComponent(dir)}`);
  const map = {};
  for (const row of data.editions || []) map[String(row.edition)] = row;
  state.gallerySimilarity = map;
  renderGallery();
}

function setupGallery() {
  $("v-filter")?.addEventListener("change", renderGallery);
  $("v-thumb64")?.addEventListener("change", renderGallery);
  $("v-similarity")?.addEventListener("change", () => {
    loadSimilarity().catch((e) => {
      const status = $("v-triage-status");
      if (status) status.textContent = e.message;
    });
  });
  $("v-dupes")?.addEventListener("click", async () => {
    const status = $("v-dupes-status");
    const box = $("v-dupes-list");
    const dir = state.galleryDir || $("v-dir")?.value;
    if (!dir) return;
    if (status) status.textContent = t("gallery.dupes.running");
    try {
      const data = await api("/api/gallery/dupes", {
        method: "POST",
        body: JSON.stringify({ dir, maxDistance: 8 }),
      });
      const editions = new Set();
      for (const pair of data.pairs || []) {
        const a = editionFromFile(pair.a);
        const b = editionFromFile(pair.b);
        if (a) editions.add(a);
        if (b) editions.add(b);
      }
      state.galleryDupeEditions = editions;
      if (box) {
        if (!data.pairs?.length) {
          box.hidden = false;
          box.textContent = t("gallery.dupes.none", { n: data.hashed || 0 });
        } else {
          box.hidden = false;
          box.innerHTML = `<div>${escapeHtml(t("gallery.dupes.found", { n: data.pairs.length }))}</div>` +
            data.pairs.slice(0, 40).map((pair) => {
              const a = editionFromFile(pair.a);
              const b = editionFromFile(pair.b);
              return `<button type="button" class="btn small" data-a="${a}" data-b="${b}" style="margin:4px 4px 0 0">#${a} ~ #${b} (${pair.distance})</button>`;
            }).join("");
          box.querySelectorAll("button[data-a]").forEach((btn) => {
            btn.addEventListener("click", () => {
              const el = document.querySelector(`.gallery .tile[data-edition="${btn.dataset.a}"]`);
              el?.scrollIntoView({ behavior: "smooth", block: "center" });
            });
          });
        }
      }
      if (status) status.textContent = "";
      renderGallery();
    } catch (e) {
      if (status) status.textContent = e.message;
    }
  });
  $("v-dir")?.addEventListener("change", () => {
    state.galleryDir = $("v-dir").value;
    syncCompareSelect();
    loadGalleryDir(state.galleryDir);
  });
  $("v-dir2")?.addEventListener("change", async () => {
    const v = $("v-dir2").value || "";
    state.galleryDir2 = v || null;
    await loadGalleryDir2(v);
    renderGallery();
  });
  $("v-lightbox-close")?.addEventListener("click", () => {
    if ($("v-lightbox")) $("v-lightbox").hidden = true;
  });
  $("v-redo")?.addEventListener("click", () => {
    const marks = state.galleryMarks || {};
    const eds = Object.entries(marks)
      .filter(([, v]) => v === "redo")
      .map(([k]) => k);
    const only = document.querySelector('input[name="g-sel"][value="only"]');
    if (only) only.checked = true;
    if ($("g-only")) $("g-only").value = eds.join(",");
    if ($("g-force")) $("g-force").checked = true;
    showTab("render");
    lockGenerate(true);
    if ($("g-plan-out")) $("g-plan-out").textContent = t("render.redoList", { list: eds.join(", ") });
  });
  $("v-quick-redo")?.addEventListener("click", async () => {
    const btn = $("v-quick-redo");
    const status = $("v-redo-status");
    const marks = state.galleryMarks || {};
    const eds = Object.entries(marks)
      .filter(([, v]) => v === "redo")
      .map(([k]) => Number(k))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (!eds.length) {
      if (status) status.textContent = t("gallery.redo.none");
      return;
    }
    try {
      if (btn) btn.disabled = true;
      if (status) status.textContent = t("gallery.redo.running");
      const data = await api("/api/generate", {
        method: "POST",
        body: JSON.stringify({
          mode: "only",
          only: eds.join(","),
          engine: $("g-engine")?.value || $("o-engine")?.value || "kontext",
          strength: Number($("g-strength")?.value || $("o-strength")?.value || 0.45),
          force: true,
          file: state.archiveFile || $("x-file")?.value,
        }),
      });
      if (status) status.textContent = t("gallery.redo.done", { count: data.count || eds.length });
      if (state.galleryDir) await loadGalleryDir(state.galleryDir);
    } catch (e) {
      if (status) status.textContent = e.message;
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $("v-triage-run")?.addEventListener("click", async () => {
    const btn = $("v-triage-run");
    const status = $("v-triage-status");
    const applyBtn = $("v-triage-apply");
    if (!state.galleryDir) return;

    try {
      if (btn) btn.disabled = true;
      if (status) status.textContent = t("gallery.triage.running");
      const mode = $("v-triage-mode")?.value || "unmarked";
      const provider = $("v-triage-provider")?.value || "heuristic";
      const autoApply = Boolean($("v-triage-auto-apply")?.checked);

      const data = await api("/api/qa/triage", {
        method: "POST",
        body: JSON.stringify({
          dir: state.galleryDir,
          mode,
          provider,
          autoApplyMarks: autoApply,
          archiveFile: state.archiveFile || $("x-file")?.value,
        }),
      });

      for (const item of (data.results || [])) {
        if (item.edition != null) {
          state.galleryTriage[String(item.edition)] = item;
        }
      }

      if (autoApply && data.marks) {
        state.galleryMarks = data.marks;
        if (applyBtn) applyBtn.style.display = "none";
      } else if (applyBtn && (data.results || []).length > 0) {
        applyBtn.style.display = "inline-block";
        applyBtn.textContent = t("gallery.triage.applyBtn", { count: data.results.length });
      }

      if (status) {
        status.textContent = t("gallery.triage.done", { count: data.evaluated, provider: data.provider });
      }
      renderGallery();
    } catch (e) {
      if (status) status.textContent = e.message;
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $("v-triage-apply")?.addEventListener("click", async () => {
    const applyBtn = $("v-triage-apply");
    const status = $("v-triage-status");
    if (!state.galleryDir) return;

    const newMarks = { ...(state.galleryMarks || {}) };
    let count = 0;
    for (const [ed, triage] of Object.entries(state.galleryTriage || {})) {
      if (triage.verdict === "keep" || triage.verdict === "redo") {
        newMarks[ed] = triage.verdict;
        count++;
      }
    }

    try {
      const data = await api("/api/marks", {
        method: "POST",
        body: JSON.stringify({ dir: state.galleryDir, marks: newMarks }),
      });
      state.galleryMarks = data.marks || newMarks;
      if (applyBtn) applyBtn.style.display = "none";
      if (status) status.textContent = t("gallery.triage.applied", { count });
      renderGallery();
      scheduleWorkspaceSave({ lastSet: state.galleryDir });
    } catch (e) {
      if (status) status.textContent = e.message;
    }
  });
}

/* ---------- Export + workspace + checklist ---------- */

const PATH_PHASES = [
  { id: "lab", tabs: ["home", "base", "ctor", "recipes"], entry: "home" },
  { id: "studio", tabs: ["render", "gallery"], entry: "render" },
  { id: "release", tabs: ["export"], entry: "export" },
  { id: "deploy", tabs: ["deploy"], entry: "deploy" },
  { id: "market", tabs: ["market"], entry: "market" },
];
const PATH_ORDER = ["home", "base", "ctor", "recipes", "render", "gallery", "export", "deploy", "market"];

function phaseForTab(name) {
  return PATH_PHASES.find((p) => p.tabs.includes(name)) || PATH_PHASES[0];
}

function beginnerOn() {
  return Boolean($("path-beginner")?.checked);
}

function renderPath(activeTab) {
  const box = $("path-steps");
  if (!box) return;
  const phase = phaseForTab(activeTab);
  box.innerHTML = "";
  PATH_PHASES.forEach((p, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    if (p.id === phase.id) btn.classList.add("on");
    btn.innerHTML = `<span class="path-n">${i + 1}</span>${escapeHtml(t(`path.${p.id}`))}`;
    btn.addEventListener("click", () => showTab(p.entry));
    box.appendChild(btn);
  });
  const nextWrap = $("path-next");
  const idx = PATH_ORDER.indexOf(activeTab);
  const next = idx >= 0 ? PATH_ORDER[idx + 1] : null;
  if (!nextWrap) return;
  if (!beginnerOn() || activeTab === "admin" || activeTab === "help") {
    nextWrap.hidden = true;
    return;
  }
  nextWrap.hidden = false;
  const where = $("path-where");
  const go = $("path-go");
  if (where) where.textContent = t("path.youAre", { step: t(`path.${phase.id}`) });
  if (!go) return;
  if (!next) {
    go.hidden = true;
    if (where) where.textContent = t("path.done");
    return;
  }
  go.hidden = false;
  go.textContent = t("path.next", { step: t(`nav.${next}`) });
  go.onclick = () => showTab(next);
}

function fmtUsdLoose(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return fmtUsdLocale(v, v < 0.1 ? 4 : 2);
}

function stageLabel(stage, fallback) {
  const key = `stage.${stage}`;
  return hasKey(key) ? t(key) : (fallback || stage || "");
}

function formatQuote(q) {
  if (!q) return { text: "", tip: "" };
  const text = t("price.line", {
    label: stageLabel(q.stage, q.label),
    credits: q.credits ?? 0,
    price: fmtUsdLoose(q.priceUsd),
  });
  const tip = state.account?.admin
    ? t("price.formulaTip", {
      formula: q.formula || "",
      cost: fmtUsdLoose(q.costUsd),
      margin: fmtUsdLoose(q.marginUsd),
    })
    : "";
  return { text, tip };
}

function paintQuote(el, q) {
  const view = formatQuote(q);
  el.textContent = view.text;
  if (view.tip) {
    el.title = view.tip;
    el.dataset.tip = view.tip;
  } else {
    el.removeAttribute("title");
    delete el.dataset.tip;
  }
}

async function showStagePrice(stage, elementId, extra = {}) {
  const el = $(elementId);
  if (!el) return;
  const q = new URLSearchParams({ stage, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])) });
  if (stage === "archive" && (extra.storage || extra.ipfs)) q.set("storage", "1");
  if (stage === "archive" && extra.zip === false) q.set("zip", "0");
  try {
    const data = await api(`/api/stages/quote?${q}`);
    paintQuote(el, data.quote);
  } catch (e) {
    el.textContent = e.message;
  }
}

async function showCurationPrice() {
  const el = $("v-triage-price");
  if (!el) return;
  const provider = $("v-triage-provider")?.value || "heuristic";
  try {
    const data = await api(`/api/stages/quote?stage=curation&provider=${encodeURIComponent(provider)}&count=1`);
    paintQuote(el, data.quote);
  } catch {
    el.textContent = "";
  }
}

function fillKitSets() {
  const source = $("x-set");
  for (const id of ["d-set", "m-set"]) {
    const sel = $(id);
    if (!sel || !source) continue;
    const cur = sel.value;
    sel.innerHTML = source.innerHTML;
    if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
    else if (source.value) sel.value = source.value;
  }
  const name = $("m-name");
  if (name && !name.value) name.value = $("o-name")?.value || "";
  const desc = $("m-desc");
  if (desc && !desc.value) desc.value = $("x-desc")?.value || "";
  const deployDesc = $("d-desc");
  if (deployDesc && !deployDesc.value) deployDesc.value = $("x-desc")?.value || "";
}

function showPreflightReport(preflight) {
  const box = $("x-preflight-report");
  const groups = $("x-preflight-groups");
  const badge = $("x-preflight-badge");
  if (!box) return;
  if (!preflight?.report && !preflight?.checks) {
    box.hidden = true;
    if (groups) groups.replaceChildren();
    box.dataset.report = "";
    return;
  }
  box.hidden = false;
  box.dataset.report = preflight.report || "";
  if (badge) {
    const ready = Boolean(preflight.ready);
    badge.textContent = ready ? t("preflight.status.ready") : t("preflight.status.blocked");
    badge.className = `preflight-badge ${ready ? "ready" : "blocked"}`;
  }
  if (!groups) return;
  groups.replaceChildren();
  const checks = Array.isArray(preflight.checks) ? preflight.checks : [];
  const order = ["error", "warning", "ok"];
  for (const level of order) {
    const rows = checks.filter((c) => c.level === level);
    if (!rows.length) continue;
    const section = document.createElement("section");
    const title = document.createElement("h3");
    title.textContent = t(`preflight.group.${level === "error" ? "errors" : level === "warning" ? "warnings" : "ok"}`);
    section.appendChild(title);
    const list = document.createElement("ul");
    list.className = "preflight-list";
    for (const row of rows) {
      const li = document.createElement("li");
      li.className = `preflight-item ${level}`;
      const icon = document.createElement("span");
      icon.className = "preflight-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = level === "error" ? "✕" : level === "warning" ? "!" : "✓";
      const sr = document.createElement("span");
      sr.className = "visually-hidden";
      sr.textContent = t(`preflight.level.${level}`);
      const text = document.createElement("span");
      text.textContent = row.message || "";
      li.append(icon, sr, text);
      if (level === "warning") {
        const hint = document.createElement("span");
        hint.className = "preflight-hint";
        const key = `preflight.hint.${row.code || "generic"}`;
        hint.textContent = hasKey(key) ? t(key) : t("preflight.hint.generic");
        li.appendChild(hint);
      }
      list.appendChild(li);
    }
    section.appendChild(list);
    groups.appendChild(section);
  }
}

function setupPath() {
  const box = $("path-beginner");
  if (!box) return;
  try {
    const saved = localStorage.getItem("series-lab-beginner");
    if (saved === "0") box.checked = false;
  } catch { /* ignore */ }
  box.addEventListener("change", () => {
    try { localStorage.setItem("series-lab-beginner", box.checked ? "1" : "0"); } catch { /* ignore */ }
    const active = document.querySelector(".tab.on")?.id?.replace(/^tab-/, "") || "home";
    renderPath(active);
  });
  renderPath(document.querySelector(".tab.on")?.id?.replace(/^tab-/, "") || "home");
}

async function fillExportSets() {
  const sel = $("x-set");
  if (!sel) return;
  try {
    const data = await api("/api/sets");
    const sets = data.sets || [];
    const cur = sel.value || state.galleryDir || state.lastSet || "";
    if (!sets.length) {
      sel.innerHTML = `<option value="">${t("export.bundle.noSets")}</option>`;
      return;
    }
    sel.innerHTML = sets
      .map((s) => `<option value="${escapeHtml(s.dir)}">${escapeHtml(s.dir)} (${s.count})</option>`)
      .join("");
    if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
  } catch (e) {
    sel.innerHTML = `<option value="">${escapeHtml(e.message)}</option>`;
  }
}

let workspaceTimer = null;
function scheduleWorkspaceSave(patch) {
  clearTimeout(workspaceTimer);
  workspaceTimer = setTimeout(() => saveWorkspace(patch).catch(() => {}), 400);
}

async function saveWorkspace(patch = {}) {
  const body = {
    locale: getLocale(),
    presetId: $("o-id")?.value?.trim() || $("c-id")?.value?.trim() || null,
    lastArchive: $("x-file")?.value || state.archiveFile || state.archives[0]?.file || null,
    lastSet: $("x-set")?.value || state.galleryDir || state.lastSet || null,
    overview: {
      name: $("o-name")?.value || "",
      id: $("o-id")?.value || "",
      seed: $("o-seed")?.value || "",
      size: $("o-size")?.value || "",
      engine: $("o-engine")?.value || "",
      strength: $("o-strength")?.value || "",
    },
    ...patch,
  };
  await api("/api/workspace", { method: "POST", body: JSON.stringify(body) });
}

async function restoreWorkspace() {
  try {
    const data = await api("/api/workspace");
    if (!data.exists || !data.workspace) return;
    const w = data.workspace;
    const ov = w.overview || {};
    if (ov.name && $("o-name") && !$("o-name").value) $("o-name").value = ov.name;
    if (ov.id && $("o-id") && !$("o-id").value) $("o-id").value = ov.id;
    if (ov.seed && $("o-seed") && !$("o-seed").value) $("o-seed").value = ov.seed;
    if (ov.size && $("o-size") && !$("o-size").value) $("o-size").value = ov.size;
    if (ov.engine && $("o-engine")) $("o-engine").value = ov.engine;
    if (ov.strength && $("o-strength")) {
      $("o-strength").value = ov.strength;
      if ($("o-strength-v")) $("o-strength-v").textContent = String(ov.strength);
    }
    syncCtorFromOverview();
    if (w.lastArchive && $("x-file") && [...($("x-file").options || [])].some((o) => o.value === w.lastArchive)) {
      $("x-file").value = w.lastArchive;
      updateJsonLink();
    }
    if (w.lastSet) {
      state.galleryDir = w.lastSet;
      state.lastSet = w.lastSet;
      if ($("x-set") && [...($("x-set").options || [])].some((o) => o.value === w.lastSet)) {
        $("x-set").value = w.lastSet;
      }
      if ($("v-dir") && [...($("v-dir").options || [])].some((o) => o.value === w.lastSet)) {
        $("v-dir").value = w.lastSet;
        await loadGalleryDir(w.lastSet);
      }
    }
    console.info(t("workspace.restored"));
  } catch {
    /* ignore */
  }
}

async function renderChecklist() {
  const list = $("x-checklist-list");
  const msg = $("x-checklist-msg");
  if (!list) return;
  const archive = $("x-file")?.value;
  const set = $("x-set")?.value;
  if (!archive) {
    if (msg) msg.textContent = t("export.none");
    return;
  }
  try {
    if (msg) msg.textContent = t("ui.working");
    const q = new URLSearchParams({ archive });
    if (set) q.set("set", set);
    const data = await api(`/api/checklist?${q}`);
    list.innerHTML = (data.items || [])
      .map((it) => {
        const icon = it.level === "ok" ? "✓" : it.level === "warn" ? "⚠" : "✗";
        const cls = it.level === "ok" ? "ok" : it.level === "warn" ? "warn" : "fail";
        return `<li class="check ${cls}"><span class="icon">${icon}</span> <b>${escapeHtml(it.label)}</b> — <span class="muted">${escapeHtml(it.detail || "")}</span></li>`;
      })
      .join("");
    if (msg) msg.textContent = t("export.checklist.done", { n: (data.items || []).length });
  } catch (e) {
    if (msg) msg.textContent = e.message;
    list.innerHTML = "";
  }
}

async function updateMetadataPreview() {
  const box = $("x-meta-preview");
  if (!box) return;
  const archive = $("x-file")?.value;
  if (!archive) {
    box.textContent = "{}";
    return;
  }
  try {
    const profile = $("x-profile")?.value || "opensea";
    const data = await api("/api/export/preview-meta", {
      method: "POST",
      body: JSON.stringify({
        archive,
        profile,
        creatorAddress: $("x-creator-address")?.value?.trim() || "",
        zeroIndexed: Boolean($("x-zero-index")?.checked),
        imageUriPrefix: $("x-uri-prefix")?.value?.trim() || "",
        animationUriPrefix: $("x-anim-prefix")?.value?.trim() || "",
        namePrefix: $("x-namePrefix")?.value || "Series #",
        symbol: $("x-symbol")?.value || "LAB",
        sellerFeeBasisPoints: Number($("x-fee")?.value ?? 500),
        description: $("x-desc")?.value || "",
      }),
    });
    box.textContent = JSON.stringify(data.preview, null, 2);
  } catch (e) {
    box.textContent = JSON.stringify({ error: e.message }, null, 2);
  }
}

function bundleBody(extra = {}) {
  return {
    archive: $("x-file")?.value,
    set: extra.set || $("x-set")?.value,
    profile: extra.profile || $("x-profile")?.value || "opensea",
    onlyKeep: extra.onlyKeep ?? Boolean($("x-onlyKeep")?.checked),
    namePrefix: $("x-namePrefix")?.value || "Series #",
    symbol: $("x-symbol")?.value || "LAB",
    sellerFeeBasisPoints: Number($("x-fee")?.value ?? 500),
    description: $("x-desc")?.value || "",
    creatorAddress: $("x-creator-address")?.value || "",
    locale: getLocale(),
    ...extra,
  };
}

/** What each launchpad profile needs: only that profile's hints and fields are shown. */
const PROFILE_UI = {
  opensea: { chain: "evm", storage: true, pin: false },
  magiceden: { chain: "solana", storage: true, pin: true },
  launchmynft: { chain: "solana", storage: true, pin: true },
  ordinalsbot: { chain: "bitcoin", storage: false, pin: false },
};

/**
 * One network for Export, Deploy kit and Marketplace kit. Whichever selector the user
 * changes is the source; the other two follow without firing their own change events.
 *   profile: opensea → evm · magiceden / launchmynft → solana · ordinalsbot → bitcoin
 *   deploy:  solana / solana-legacy / evm / bitcoin (Sugar stays Sugar while the network is Solana)
 */
let builtNetworkKey = null;

/** A built ZIP, its guide and status belong to the network it was built for: drop them when the network changes. */
function clearBuiltKits() {
  for (const [dl, ...texts] of [["x-download", "x-bundle-msg"], ["d-download", "d-msg", "d-guide"], ["m-download", "m-msg", "m-note"]]) {
    const a = $(dl);
    if (a) {
      a.hidden = true;
      a.removeAttribute("href");
    }
    for (const id of texts) {
      const el = $(id);
      if (!el) continue;
      el.textContent = "";
      if (id === "d-guide" || id === "m-note") el.hidden = true;
    }
  }
}

function syncNetwork(source) {
  const x = $("x-profile");
  const d = $("d-chain");
  const m = $("m-chain");
  const chain = source === "profile"
    ? (PROFILE_UI[x?.value] || PROFILE_UI.opensea).chain
    : source === "deploy"
      ? (d?.value === "solana-legacy" ? "solana" : d?.value || "solana")
      : m?.value || "solana";
  if (source !== "profile" && x && (PROFILE_UI[x.value] || PROFILE_UI.opensea).chain !== chain) {
    x.value = chain === "evm" ? "opensea" : chain === "bitcoin" ? "ordinalsbot" : "magiceden";
    applyProfileUi();
    updateMetadataPreview();
    updateReleaseHub();
  }
  if (source !== "deploy" && d) {
    const cur = d.value === "solana-legacy" ? "solana" : d.value;
    if (cur !== chain) {
      d.value = chain;
      loadLaunchAdvisor();
    }
  }
  if (source !== "market" && m && m.value !== chain) m.value = chain;
  const key = `${x?.value}|${d?.value}|${m?.value}`;
  if (builtNetworkKey !== null && builtNetworkKey !== key) clearBuiltKits();
  builtNetworkKey = key;
  const allow = $("d-allowlist-wrap");
  if (allow) {
    const deployChain = d?.value || "solana";
    allow.hidden = deployChain !== "solana" && deployChain !== "solana-legacy";
  }
}

/** null until /api/storage/status answered; false = the server has no IRYS_PRIVATE_KEY. */
let irysKeyPresent = null;

function applyProfileUi() {
  const prof = $("x-profile")?.value || "opensea";
  const cfg = PROFILE_UI[prof] || PROFILE_UI.opensea;
  const fee = $("x-fee");
  if (fee) {
    // Ordinals has no royalty: remember the value and bring it back when the profile changes again.
    if (prof === "ordinalsbot") {
      if (fee.dataset.prevFee === undefined) fee.dataset.prevFee = fee.value;
      fee.value = "0";
    } else if (fee.dataset.prevFee !== undefined) {
      fee.value = fee.dataset.prevFee;
      delete fee.dataset.prevFee;
    }
  }
  const hint = $("x-profile-hint");
  if (hint) {
    hint.setAttribute("data-i18n", `export.profileHint.${prof}`);
    hint.textContent = t(`export.profileHint.${prof}`);
  }
  const creator = $("x-creator-address");
  if (creator) {
    const key = `export.creator.ph.${cfg.chain}`;
    creator.setAttribute("data-i18n-placeholder", key);
    creator.placeholder = t(key);
  }
  const uri = $("x-uri-prefix");
  if (uri && cfg.storage) {
    const key = `export.bundle.uriPrefix.ph.${cfg.chain === "solana" ? "solana" : "evm"}`;
    uri.setAttribute("data-i18n-placeholder", key);
    uri.placeholder = t(key);
  }
  for (const id of ["x-uri-wrap", "x-anim-wrap"]) {
    const wrap = $(id);
    if (wrap) wrap.hidden = !cfg.storage;
  }
  if (!cfg.storage) {
    // A stale prefix from another profile must not leak into Ordinals metadata.
    if ($("x-uri-prefix")) $("x-uri-prefix").value = "";
    if ($("x-anim-prefix")) $("x-anim-prefix").value = "";
  }
  const pin = $("x-pin-irys");
  const noKey = cfg.pin && irysKeyPresent === false;
  if (pin) pin.hidden = !cfg.pin || irysKeyPresent === false;
  const pinStatus = $("x-pin-status");
  if (pinStatus && (!cfg.pin || noKey)) pinStatus.textContent = noKey ? t("export.bundle.pinNoKey") : "";
}

function setupExport() {
  $("x-file")?.addEventListener("change", () => {
    updateJsonLink();
    updateMetadataPreview();
    scheduleWorkspaceSave();
  });
  $("x-profile")?.addEventListener("change", () => {
    applyProfileUi();
    syncNetwork("profile");
    updateMetadataPreview();
  });
  $("x-creator-address")?.addEventListener("input", updateMetadataPreview);
  $("x-zero-index")?.addEventListener("change", updateMetadataPreview);
  $("x-uri-prefix")?.addEventListener("input", updateMetadataPreview);
  $("x-anim-prefix")?.addEventListener("input", updateMetadataPreview);
  $("x-namePrefix")?.addEventListener("input", updateMetadataPreview);
  $("x-symbol")?.addEventListener("input", updateMetadataPreview);
  $("x-fee")?.addEventListener("input", updateMetadataPreview);
  $("x-desc")?.addEventListener("input", updateMetadataPreview);

  $("x-pin-irys")?.addEventListener("click", async () => {
    const btn = $("x-pin-irys");
    const status = $("x-pin-status");
    const set = $("x-set")?.value;
    if (!set) {
      if (status) status.textContent = t("export.bundle.noSets");
      return;
    }
    try {
      if (btn) btn.disabled = true;
      if (status) status.textContent = t("export.bundle.pinning");
      const name = ($("x-namePrefix")?.value || "series").trim().replace(/\s*#$/, "");
      const data = await api("/api/storage/pin", {
        method: "POST",
        body: JSON.stringify({ dir: set, name }),
      });
      if (data.arweaveUri && $("x-uri-prefix")) {
        $("x-uri-prefix").value = data.arweaveUri;
      }
      if (status) {
        status.textContent = t("export.bundle.pinned", { id: data.arweaveId });
      }
      updateMetadataPreview();
    } catch (e) {
      if (status) status.textContent = e.message;
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $("x-manifest-csv")?.addEventListener("click", () => {
    const file = $("x-file")?.value;
    if (!file) {
      $("x-msg").textContent = t("export.none");
      return;
    }
    const profile = $("x-profile")?.value || "opensea";
    const zeroIndexed = Boolean($("x-zero-index")?.checked);
    const uri = $("x-uri-prefix")?.value?.trim() || "";
    const animUri = $("x-anim-prefix")?.value?.trim() || "";
    const namePrefix = $("x-namePrefix")?.value || "";
    const desc = $("x-desc")?.value || "";
    const q = new URLSearchParams({
      archive: file,
      profile,
      zeroIndexed: String(zeroIndexed),
      imageUriPrefix: uri,
      animationUriPrefix: animUri,
      namePrefix,
      description: desc,
    });
    window.location.href = `/api/export/manifest.csv?${q}`;
    $("x-msg").textContent = t("export.ok");
  });

  $("x-csv")?.addEventListener("click", () => {
    const file = $("x-file").value;
    if (!file) {
      $("x-msg").textContent = t("export.none");
      return;
    }
    window.location.href = `/api/export/csv?file=${encodeURIComponent(file)}`;
    $("x-msg").textContent = t("export.ok");
  });
  $("x-txt")?.addEventListener("click", () => {
    const file = $("x-file").value;
    if (!file) {
      $("x-msg").textContent = t("export.none");
      return;
    }
    window.location.href = `/api/export/txt?file=${encodeURIComponent(file)}`;
    $("x-msg").textContent = t("export.ok");
  });
  $("x-showcase")?.addEventListener("click", () => {
    const file = $("x-file")?.value;
    if (!file) {
      $("x-msg").textContent = t("export.none");
      return;
    }
    const q = new URLSearchParams({ archive: file });
    window.open(`/api/export/showcase.html?${q}`, "_blank");
  });
  $("x-release")?.addEventListener("click", async () => {
    const msg = $("x-release-msg");
    const list = $("x-release-list");
    const dl = $("x-release-dl");
    try {
      const archive = $("x-file")?.value;
      const set = $("x-set")?.value;
      if (!archive) throw new Error(t("export.none"));
      if (msg) msg.textContent = t("ui.working");
      if (dl) dl.hidden = true;
      const next = $("x-release-next");
      if (next) next.hidden = true;
      const q = new URLSearchParams({ archive });
      if (set) q.set("set", set);
      const check = await api(`/api/checklist?${q}`);
      const items = check.items || [];
      if (list) {
        list.innerHTML = items.map((it) =>
          `<li class="${escapeHtml(it.level || "")}">${escapeHtml(it.label)}${it.detail ? ` — ${escapeHtml(it.detail)}` : ""}</li>`).join("");
      }
      const fails = items.filter((it) => it.level === "fail");
      if (fails.length) {
        if (msg) msg.textContent = t("export.release.blocked", { n: fails.length });
        return;
      }
      if (!set) throw new Error(t("export.bundle.noSets"));
      const data = await api("/api/export/bundle", {
        method: "POST",
        body: JSON.stringify({
          archive,
          set,
          authorship: authorshipFromForm(),
          profile: "opensea",
          onlyKeep: true,
          namePrefix: $("x-namePrefix")?.value || "Series #",
          symbol: $("x-symbol")?.value || "LAB",
          sellerFeeBasisPoints: Number($("x-fee")?.value ?? 500),
          description: $("x-desc")?.value || "",
          locale: getLocale(),
        }),
      });
      if (msg) msg.textContent = `${t("export.bundle.ok", { n: fmtNum(data.count), missing: fmtNum((data.missing || []).length) })} · ${t("econ.creditsDebited", { n: fmtNum(data.chargedCredits || 0) })}`;
      showPreflightReport(data.preflight);
      if (dl && data.downloadUrl) {
        dl.href = data.downloadUrl;
        dl.download = data.file || "release.zip";
        dl.hidden = false;
      }
      await updateReleaseHub();
      const portal = $("rel-portal-btn");
      if (next && portal?.href) {
        next.href = portal.href;
        next.hidden = false;
        applyTips(next);
      }
    } catch (e) {
      if (msg) msg.textContent = e.message;
      showPreflightReport(e.payload?.preflight);
    }
  });
  $("x-preflight-copy")?.addEventListener("click", async () => {
    const text = $("x-preflight-report")?.dataset.report || "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    const msg = $("x-release-msg");
    if (msg) msg.textContent = t("preflight.copied");
  });
  $("x-preflight")?.addEventListener("click", async () => {
    const msg = $("x-release-msg");
    try {
      if (msg) msg.textContent = t("ui.working");
      const data = await api("/api/preflight", {
        method: "POST",
        body: JSON.stringify(bundleBody({ onlyKeep: true, profile: $("x-profile")?.value || "opensea" })),
      });
      showPreflightReport(data.preflight);
      if (msg) msg.textContent = data.ready ? t("preflight.ready") : t("preflight.blocked");
    } catch (e) {
      if (msg) msg.textContent = e.message;
      showPreflightReport(e.payload?.preflight);
    }
  });
  $("x-bundle")?.addEventListener("click", async () => {
    const msg = $("x-bundle-msg");
    const dl = $("x-download");
    try {
      const archive = $("x-file")?.value;
      const set = $("x-set")?.value;
      if (!archive) throw new Error(t("export.none"));
      if (!set) throw new Error(t("export.bundle.noSets"));
      if (msg) msg.textContent = t("ui.working");
      if (dl) dl.hidden = true;
      const data = await api("/api/export/bundle", {
        method: "POST",
        body: JSON.stringify({
          archive,
          set,
          authorship: authorshipFromForm(),
          profile: $("x-profile")?.value || "opensea",
          creatorAddress: $("x-creator-address")?.value?.trim() || "",
          zeroIndexed: Boolean($("x-zero-index")?.checked),
          onlyKeep: Boolean($("x-onlyKeep")?.checked),
          upscale: Boolean($("x-upscale")?.checked),
          namePrefix: $("x-namePrefix")?.value || "Series #",
          symbol: $("x-symbol")?.value || "LAB",
          sellerFeeBasisPoints: Number($("x-fee")?.value ?? 500),
          description: $("x-desc")?.value || "",
          imageUriPrefix: $("x-uri-prefix")?.value?.trim() || "",
          animationUriPrefix: $("x-anim-prefix")?.value?.trim() || "",
          locale: getLocale(),
        }),
      });
      if (msg) {
        msg.textContent = `${t("export.bundle.ok", {
          n: fmtNum(data.count),
          missing: fmtNum((data.missing || []).length),
        })} · ${t("econ.creditsDebited", { n: fmtNum(data.chargedCredits || 0) })}`;
        msg.className = "small ok-msg";
      }
      showPreflightReport(data.preflight);
      if (dl && data.downloadUrl) {
        dl.href = data.downloadUrl;
        dl.download = data.file || "bundle.zip";
        dl.hidden = false;
      }
      if (data.provenanceHash) {
        const provBox = $("x-prov-result");
        const provCode = $("x-prov-hash");
        if (provBox && provCode) {
          provCode.textContent = data.provenanceHash;
          provBox.style.display = "block";
        }
      }
      scheduleWorkspaceSave({ lastArchive: archive, lastSet: set });
    } catch (e) {
      if (msg) {
        msg.textContent = e.message;
        msg.className = "small err-msg";
      }
      showPreflightReport(e.payload?.preflight);
    }
  });

  $("x-provenance")?.addEventListener("click", async () => {
    const set = $("x-set")?.value;
    const msg = $("x-bundle-msg");
    if (!set) {
      if (msg) msg.textContent = t("export.bundle.noSets");
      return;
    }
    try {
      if (msg) {
        msg.textContent = t("export.provenance.computing");
        msg.className = "small muted";
      }
      const res = await api(`/api/export/provenance?set=${encodeURIComponent(set)}`);
      if (res?.provenance?.provenanceHash) {
        const hash = res.provenance.provenanceHash;
        const provBox = $("x-prov-result");
        const provCode = $("x-prov-hash");
        if (provBox && provCode) {
          provCode.textContent = hash;
          provBox.style.display = "block";
        }
        const checkBox = $("x-prov-check");
        if (checkBox) {
          const c = res.check || { valid: true, errors: [], warnings: [] };
          const li = (a) => a.map((x) => `<li>${escapeHtml(provMessage(x))}</li>`).join("");
          let h = "";
          if (c.valid && !c.warnings.length) h += `<p class="ok-msg">${escapeHtml(t("export.provenance.ok"))}</p>`;
          if (c.errors.length) h += `<p class="err-msg"><b>${escapeHtml(t("export.provenance.problems"))}</b></p><ul class="guide">${li(c.errors)}</ul>`;
          if (c.warnings.length) h += `<p><b>${escapeHtml(t("export.provenance.warnings"))}</b></p><ul class="guide">${li(c.warnings)}</ul>`;
          h += `<p class="muted">${escapeHtml(t("export.provenance.verifyHint"))}</p>`;
          checkBox.innerHTML = h;
          checkBox.hidden = false;
        }
        if (msg) {
          msg.textContent = t("export.provenance.done", { n: res.provenance.count, hash: hash.slice(0, 16) + "..." });
          msg.className = "small ok-msg";
        }
      }
    } catch (err) {
      if (msg) {
        msg.textContent = err.message;
        msg.className = "small err-msg";
      }
    }
  });

  $("x-dataset")?.addEventListener("click", async () => {
    const archive = $("x-file")?.value;
    const set = $("x-set")?.value;
    const msg = $("x-bundle-msg");
    const dl = $("x-download");
    if (!archive) {
      if (msg) msg.textContent = t("export.none");
      return;
    }
    if (!set) {
      if (msg) msg.textContent = t("export.bundle.noSets");
      return;
    }
    const trigger = window.prompt(t("export.dataset.prompt"), "") ?? "";
    try {
      if (msg) {
        msg.textContent = t("export.dataset.creating");
        msg.className = "small muted";
      }
      const res = await api("/api/export/dataset", {
        method: "POST",
        body: JSON.stringify({
          archive,
          set,
          triggerWord: trigger.trim(),
          format: "tags",
          onlyKeep: Boolean($("x-onlyKeep")?.checked),
        }),
      });
      if (res?.ok) {
        if (msg) {
          msg.textContent = t("export.dataset.ok", { n: res.count, file: res.file });
          msg.className = "small ok-msg";
        }
        if (dl && res.downloadUrl) {
          dl.href = res.downloadUrl;
          dl.download = res.file;
          dl.hidden = false;
        }
      }
    } catch (err) {
      if (msg) {
        msg.textContent = err.message;
        msg.className = "small err-msg";
      }
    }
  });
  $("x-checklist")?.addEventListener("click", () => renderChecklist());
  $("x-set")?.addEventListener("change", () => {
    updateMetadataPreview();
    scheduleWorkspaceSave();
  });

  $("rel-config-btn")?.addEventListener("click", () => {
    const profile = $("x-profile")?.value || "opensea";
    const archive = $("x-file")?.value || "";
    const creator = $("x-creator-address")?.value?.trim() || "";
    const zeroIndexed = Boolean($("x-zero-index")?.checked);
    const imageUriPrefix = $("x-uri-prefix")?.value?.trim() || "";
    const animationUriPrefix = $("x-anim-prefix")?.value?.trim() || "";
    const symbol = $("x-symbol")?.value || "LAB";
    const fee = $("x-fee")?.value || "500";
    const namePrefix = $("x-namePrefix")?.value || "";

    const q = new URLSearchParams({
      profile,
      archive,
      creatorAddress: creator,
      zeroIndexed: String(zeroIndexed),
      imageUriPrefix,
      animationUriPrefix,
      symbol,
      sellerFeeBasisPoints: fee,
      namePrefix,
    });
    window.location.href = `/api/release/config?${q}`;
  });

  $("x-profile")?.addEventListener("change", () => {
    updateReleaseHub();
  });

  applyProfileUi();
  api("/api/storage/status")
    .then((st) => {
      irysKeyPresent = Boolean(st?.irys?.present);
      applyProfileUi();
    })
    .catch(() => {});
  setTimeout(() => {
    updateMetadataPreview();
    updateReleaseHub();
  }, 200);
}

async function updateReleaseHub() {
  const portalBtn = $("rel-portal-btn");
  const testnetBtn = $("rel-testnet-btn");
  const tipsList = $("rel-tips-list");
  if (!portalBtn) return;

  const profile = $("x-profile")?.value || "opensea";
  const archive = $("x-file")?.value;
  try {
    const q = new URLSearchParams({ profile });
    if (archive) q.set("archive", archive);
    const data = await api(`/api/release/portals?${q}`);
    const portal = data.portal;
    if (portal) {
      portalBtn.href = portal.portalUrl;
      portalBtn.textContent = t("release.hub.portalNamed", { name: portal.name });
      if (testnetBtn) {
        testnetBtn.href = portal.testnetPortalUrl;
      }
      if (tipsList) {
        const local = [];
        for (let i = 1; i < 10; i++) {
          const key = `release.portal.${portal.id}.tip${i}`;
          if (!hasKey(key)) break;
          local.push(t(key));
        }
        const lines = local.length ? local : (portal.tips || []);
        tipsList.innerHTML = lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("");
      }
    }
  } catch {
    /* ignore */
  }
}

function kitArchive() {
  return $("x-file")?.value || state.archiveFile || state.archives?.[0]?.file || "";
}

function setBusy(btn, on) {
  if (!btn) return;
  btn.disabled = Boolean(on);
  btn.classList.toggle("is-loading", Boolean(on));
  btn.setAttribute("aria-busy", on ? "true" : "false");
}

const advisorChecked = new Set();

function advisorLink(href, label) {
  if (!/^https:\/\//.test(href || "")) return null;
  const a = document.createElement("a");
  a.href = href;
  a.textContent = label || href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  return a;
}

function renderAdvisorSection(section) {
  const det = document.createElement("details");
  det.className = "advisor-section";
  det.open = true;
  const sum = document.createElement("summary");
  sum.textContent = section.title || "";
  det.appendChild(sum);
  const body = document.createElement("div");
  body.className = "advisor-body";
  if (section.lead) {
    const lead = document.createElement("p");
    lead.className = "advisor-lead";
    lead.textContent = section.lead;
    body.appendChild(lead);
  }
  for (const para of section.paragraphs || []) {
    const p = document.createElement("p");
    p.textContent = para;
    body.appendChild(p);
  }
  if (!section.paragraphs?.length && section.body) {
    const p = document.createElement("p");
    p.textContent = section.body;
    body.appendChild(p);
  }
  if (section.checks?.length) {
    const ul = document.createElement("ul");
    ul.className = "advisor-checks";
    for (const item of section.checks) {
      const li = document.createElement("li");
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = advisorChecked.has(item.id);
      input.addEventListener("change", () => {
        if (input.checked) advisorChecked.add(item.id);
        else advisorChecked.delete(item.id);
      });
      const span = document.createElement("span");
      span.textContent = item.text || "";
      label.append(input, span);
      li.appendChild(label);
      ul.appendChild(li);
    }
    body.appendChild(ul);
  }
  if (section.links?.length) {
    const sources = document.createElement("p");
    sources.className = "advisor-sources";
    for (const item of section.links) {
      const a = advisorLink(item.href, item.label);
      if (a) sources.appendChild(a);
    }
    if (sources.childNodes.length) body.appendChild(sources);
  }
  det.appendChild(body);
  return det;
}

async function loadLaunchAdvisor() {
  const root = $("d-advisor");
  if (!root) return;
  const rawChain = $("d-chain")?.value || "solana";
  const chain = rawChain === "solana-legacy" ? "solana" : rawChain;
  try {
    const data = await api(`/api/launch-advisor?chain=${encodeURIComponent(chain)}&locale=${encodeURIComponent(getLocale())}`);
    root.replaceChildren();
    for (const section of data.sections || []) root.appendChild(renderAdvisorSection(section));
    const area = $("d-holder");
    if (area && area.dataset.dirty !== "1" && data.holderTemplate) area.value = data.holderTemplate;
  } catch (e) {
    root.textContent = e.message;
  }
}

/** Fill the holder-licence field with a draft of the chosen model. The user's own edits are never replaced silently. */
async function applyLicenceTemplate() {
  const area = $("d-holder");
  if (!area) return;
  const rawChain = $("d-chain")?.value || "solana";
  const chain = rawChain === "solana-legacy" ? "solana" : rawChain;
  const model = $("d-licence")?.value || "statement";
  if (area.dataset.dirty === "1" && area.value.trim() && !window.confirm(t("advisor.licence.confirm"))) return;
  const q = new URLSearchParams({
    chain,
    locale: getLocale(),
    licence: model,
    name: $("o-name")?.value || "",
    creator: $("d-creator")?.value || "",
    cap: $("d-licence-cap")?.value || "",
  });
  try {
    const data = await api(`/api/launch-advisor?${q}`);
    area.value = data.holderTemplate || "";
    area.dataset.dirty = "";
  } catch (e) {
    alert(e.message);
  }
}

function setupKits() {
  $("d-chain")?.addEventListener("change", () => {
    syncNetwork("deploy");
    loadLaunchAdvisor();
  });
  $("m-chain")?.addEventListener("change", () => syncNetwork("market"));
  // Solana is the default network (Core Candy Machine): align Export and Market with the Deploy default.
  syncNetwork("deploy");
  $("d-licence")?.addEventListener("change", () => {
    const wrap = $("d-licence-cap-wrap");
    if (wrap) wrap.hidden = $("d-licence")?.value !== "commercial_cap";
  });
  $("d-licence-apply")?.addEventListener("click", applyLicenceTemplate);
  $("d-holder")?.addEventListener("input", () => {
    if ($("d-holder")) $("d-holder").dataset.dirty = "1";
  });
  loadLaunchAdvisor();
  $("d-build")?.addEventListener("click", async () => {
    const msg = $("d-msg");
    const dl = $("d-download");
    const guide = $("d-guide");
    const btn = $("d-build");
    try {
      const archive = kitArchive();
      const set = $("d-set")?.value;
      if (!archive) throw new Error(t("export.none"));
      if (!set) throw new Error(t("export.bundle.noSets"));
      setBusy(btn, true);
      if (msg) msg.textContent = t("ui.working");
      if (dl) dl.hidden = true;
      const data = await api("/api/deploy-kit", {
        method: "POST",
        body: JSON.stringify({
          archive,
          set,
          chain: $("d-chain")?.value || "solana",
          legacy: $("d-chain")?.value === "solana-legacy",
          creatorAddress: $("d-creator")?.value || "",
          symbol: $("d-symbol")?.value || "LAB",
          description: $("d-desc")?.value || "",
          allowlist: ($("d-chain")?.value === "evm" || $("d-chain")?.value === "bitcoin") ? "" : ($("d-allowlist")?.value || ""),
          locale: getLocale(),
          includeHolderLicence: Boolean($("d-holder-on")?.checked),
          holderLicence: $("d-holder")?.value || "",
          rehearsal: document.querySelector('input[name="d-rehearsal"]:checked')?.value === "skip" ? "skip" : "devnet",
        }),
      });
      if (msg) msg.textContent = t("deploy.ok", { chain: data.chain, credits: data.chargedCredits || 0 });
      if (dl && data.downloadUrl) {
        dl.href = data.downloadUrl;
        dl.download = data.file || "deploy-kit.zip";
        dl.hidden = false;
      }
      if (guide) {
        guide.hidden = false;
        guide.textContent = data.guide || "";
      }
    } catch (e) {
      if (msg) msg.textContent = e.message;
    } finally {
      setBusy(btn, false);
    }
  });
  $("m-build")?.addEventListener("click", async () => {
    const msg = $("m-msg");
    const dl = $("m-download");
    const note = $("m-note");
    const btn = $("m-build");
    try {
      const archive = kitArchive();
      const set = $("m-set")?.value;
      if (!archive) throw new Error(t("export.none"));
      if (!set) throw new Error(t("export.bundle.noSets"));
      setBusy(btn, true);
      if (msg) msg.textContent = t("ui.working");
      if (dl) dl.hidden = true;
      const data = await api("/api/marketplace-kit", {
        method: "POST",
        body: JSON.stringify({
          archive,
          set,
          chain: $("m-chain")?.value || "solana",
          name: $("m-name")?.value || "",
          description: $("m-desc")?.value || "",
          locale: getLocale(),
        }),
      });
      if (msg) msg.textContent = t("market.ok", { chain: data.chain, credits: data.chargedCredits || 0 });
      if (dl && data.downloadUrl) {
        dl.href = data.downloadUrl;
        dl.download = data.file || "marketplace-kit.zip";
        dl.hidden = false;
      }
      if (note) {
        note.hidden = false;
        const warns = (data.warnings || []).join("\n");
        note.textContent = warns || t("preflight.ready");
      }
    } catch (e) {
      if (msg) msg.textContent = e.message;
    } finally {
      setBusy(btn, false);
    }
  });
  $("v-triage-provider")?.addEventListener("change", () => showCurationPrice());
}


/* ---------- Resources ---------- */
async function renderResources({ probe = false } = {}) {
  const grid = $("res-grid");
  const provBox = $("res-providers");
  const tgBox = $("res-telegram");
  if (!grid) return;
  let keys = [];
  let note = "";
  let keysFileName = "";
  let data = {};
  const btn = $("res-probe");
  if (probe && btn) {
    btn.disabled = true;
    btn.textContent = t("res.providers.probing");
  }
  try {
    data = await api(`/api/resources${probe ? "?probe=1" : ""}`);
    keys = data.keys || [];
    note = data.note || "";
    keysFileName = data.keysFileName || data.keysFile || "";
  } catch {
    keys = [
      { name: "OPENAI_API_KEY", present: false },
      { name: "REPLICATE_API_TOKEN", present: false },
      { name: "STABILITY_API_KEY", present: false },
      { name: "POLLINATIONS_API_KEY", present: false },
    ];
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = t("res.providers.probe");
    }
  }
  if (provBox) {
    const rows = data.health || (data.providers || []).map((p) => ({
      ...p,
      checked: false,
      valid: null,
      balance: null,
    }));
    const floatBy = Object.fromEntries((data.float || []).map((f) => [f.name, f]));
    provBox.innerHTML = rows.map((p) => {
      const float = floatBy[p.name];
      const configured = p.configured;
      let badge = t("res.providers.missing");
      let badgeCls = "off";
      let cardCls = "miss";
      if (configured && p.checked && p.valid === true) {
        badge = t("res.providers.valid");
        badgeCls = "on";
        cardCls = "ok";
      } else if (configured && p.checked && p.valid === false) {
        badge = t("res.providers.invalid");
        badgeCls = "fail";
        cardCls = "bad";
      } else if (configured && !p.checked) {
        badge = t("res.providers.unchecked");
        badgeCls = "off";
        cardCls = "warn";
      } else if (configured) {
        badge = t("res.providers.configured");
        badgeCls = "on";
        cardCls = "ok";
      }
      if (float?.status === "critical") cardCls = "bad";
      else if (float?.status === "low") cardCls = "warn";
      const purpose = hasKey(p.purpose) ? t(p.purpose) : (p.purpose || "");
      let balHtml = "";
      if (p.balance != null) {
        balHtml = `<div class="prov-bal">${escapeHtml(t("res.providers.balance", { n: Math.round(p.balance), usd: p.balance_usd ?? "—" }))}</div>`;
      } else if (float?.recommended_usd != null) {
        balHtml = `<div class="muted small">${escapeHtml(t("res.providers.floatRec", { n: float.recommended_usd }))}</div>`;
      }
      return `<article class="prov-card ${cardCls}">
        <div class="prov-card-head">
          <b>${escapeHtml(p.name)}</b>
          <span class="prov-badge ${badgeCls}">${escapeHtml(badge)}</span>
        </div>
        ${balHtml}
        <p class="muted small">${escapeHtml(purpose)}</p>
        <a href="${escapeHtml(p.url)}" target="_blank" rel="noopener">${escapeHtml(t("res.providers.dashboard"))}</a>
      </article>`;
    }).join("");
  }
  if (tgBox) {
    const tg = data.telegram || {};
    const on = !!tg.configured;
    tgBox.className = `res-telegram ${on ? "ok" : "warn"}`;
    const status = on
      ? t("res.telegram.on", { source: tg.source || "TELEGRAM_*" })
      : t("res.telegram.off");
    tgBox.innerHTML = `
      <div class="res-telegram-meta">
        <b>${escapeHtml(t("res.telegram.h3"))}</b>
        <span class="prov-badge ${on ? "on" : "off"}">${escapeHtml(status)}</span>
        <p class="muted small">${escapeHtml(t("res.telegram.hint"))}</p>
      </div>
      <button type="button" id="res-tg-test" class="btn small primary" ${on ? "" : "disabled"}>${escapeHtml(t("res.telegram.test"))}</button>
      <span id="res-tg-msg" class="res-telegram-msg"></span>`;
  }
  grid.innerHTML = "";
  if (keysFileName || note) {
    const info = document.createElement("p");
    info.className = "muted small";
    info.textContent = keysFileName ? `${t("res.from")}: ${keysFileName}` : note;
    grid.appendChild(info);
  }
  for (const k of keys) {
    const card = document.createElement("div");
    card.className = `card res ${k.present ? "ok" : "warn"}`;
    card.innerHTML = `<h3>${escapeHtml(k.name)}</h3>
      <div class="res-value">${k.present ? t("res.present") : t("res.missing")}</div>
      <p class="muted small">${k.note ? escapeHtml(k.note) : t("res.checklist")}</p>`;
    grid.appendChild(card);
  }
  renderSpend();
  renderTrash();
}

async function testTelegramNotify() {
  const btn = $("res-tg-test");
  const msg = $("res-tg-msg");
  if (btn) {
    btn.disabled = true;
    btn.textContent = t("res.telegram.testing");
  }
  if (msg) msg.textContent = "";
  try {
    const r = await api("/api/notifications/test", { method: "POST", body: JSON.stringify({}) });
    if (msg) msg.textContent = r.ok ? t("res.telegram.ok") : t("res.telegram.fail", { err: r.error || "fail" });
  } catch (e) {
    if (msg) msg.textContent = t("res.telegram.fail", { err: e.message || "fail" });
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = t("res.telegram.test");
    }
  }
}

function setupResources() {
  $("res-probe")?.addEventListener("click", () => renderResources({ probe: true }));
  $("res-telegram")?.addEventListener("click", (e) => {
    if (e.target?.id === "res-tg-test") testTelegramNotify();
  });
}

async function renderSpend() {
  const out = $("spend-out");
  if (!out) return;
  try {
    const d = await api("/api/spend");
    const by = Object.entries(d.byEngine || {}).map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(fmtUsdLocale(v, Number(v) < 0.1 ? 4 : 2))}`).join(" · ");
    const engines = Object.entries(d.engines || {}).map(([k, row]) => {
      const pct = Math.round((row.failRate || 0) * 100);
      return escapeHtml(t("spend.engine", { engine: k, ok: row.ok, fail: row.fail, pct }));
    }).join("<br>");
    out.innerHTML = `<div>${escapeHtml(t("spend.today", { usd: d.spentTodayUsd }))}${by ? ` <span class="muted">(${by})</span>` : ""}</div>
      <div class="muted">${escapeHtml(d.capUsd != null ? t("spend.cap", { usd: d.capUsd }) : t("spend.noCap"))}</div>` +
      (engines ? `<div style="margin-top:8px">${engines}</div>` : "");
    const errBox = $("admin-errors-list");
    if (errBox) {
      const rows = d.errors || [];
      errBox.innerHTML = rows.length
        ? rows.map((r) => {
          const where = [r.set, r.edition != null ? `#${r.edition}` : ""].filter(Boolean).join(" ");
          const when = r.at ? fmtDate(r.at) : "";
          return `<div class="err-row"><b>${escapeHtml(r.engine)}</b> <span class="muted">${escapeHtml(when)}${where ? ` · ${escapeHtml(where)}` : ""}</span><div>${escapeHtml(presentApiError({ error: r.error }, t) || t("admin.errors.unknown"))}</div></div>`;
        }).join("")
        : `<p class="muted">${escapeHtml(t("admin.errors.none"))}</p>`;
    }
  } catch (e) {
    out.textContent = e.message;
  }
}

state.econDays = "all";

function econKpi(label, value, { sub = "", cls = "" } = {}) {
  return `<div class="econ-kpi${cls ? ` ${cls}` : ""}"><span>${escapeHtml(label)}</span><b>${value}</b>${sub ? `<em>${escapeHtml(sub)}</em>` : ""}</div>`;
}

function fmtUsd(n, digits = 2) {
  return fmtUsdLocale(n, digits);
}

function fmtPct(n) {
  return fmtPctLocale(n);
}

async function renderEconomy() {
  const out = $("econ-out");
  if (!out) return;
  out.innerHTML = `<p class="muted">${escapeHtml(t("ui.working"))}</p>`;
  try {
    const q = state.econDays === "all" ? "all" : state.econDays;
    const d = await api(`/api/admin/economy?days=${encodeURIComponent(q)}`);
    const ov = d.overview || {};
    const g = d.gross || {};
    const n = d.net || {};
    const m = d.model || {};
    const be = d.break_even || {};
    const f = d.funnel_30d || {};

    const marginCls = g.gross_margin_pct != null && g.gross_margin_pct < 50 ? "warn" : g.gross_margin_pct != null ? "ok" : "";
    const packs = (m.packages || []).map((p) => `
      <div class="econ-pack${p.recommended ? " rec" : ""}">
        <b>${escapeHtml(p.label)}</b>
        <div class="price">${fmtUsd(p.usd)} · ${p.credits} ${escapeHtml(t("acct.credits"))}</div>
        <div class="muted small">${fmtUsd(p.usd_per_credit, 4)}/${escapeHtml(t("acct.creditsShort"))}</div>
        <div class="muted small">${escapeHtml(p.note || "")}</div>
      </div>`).join("");

    const tariffRows = (m.tariff_families || []).map((row) => `
      <tr>
        <td>${escapeHtml(row.label)}</td>
        <td class="num">${row.draft} / ${fmtUsd(row.cogs_usd.draft, 3)} / ${fmtPct(row.margin_at_cheapest_pack_pct.draft)}</td>
        <td class="num">${row.final} / ${fmtUsd(row.cogs_usd.final, 3)} / ${fmtPct(row.margin_at_cheapest_pack_pct.final)}</td>
        <td class="num">${row.ref} / ${fmtUsd(row.cogs_usd.ref, 3)} / ${fmtPct(row.margin_at_cheapest_pack_pct.ref)}</td>
      </tr>`).join("");

    const engRows = (m.engines || []).map((e) => `
      <tr>
        <td>${escapeHtml(e.id)}${e.support_fee ? ` <span class="muted small">(${escapeHtml(t("econ.support"))})</span>` : ""}</td>
        <td class="num">${fmtUsd(e.cost_usd, 3)}</td>
        <td class="num">${e.credits_ref}</td>
        <td class="num">${fmtUsd(e.revenue_at_cheapest_usd, 3)}</td>
        <td class="num">${fmtPct(e.est_margin_pct)}</td>
      </tr>`).join("");

    const costRows = (g.by_engine_cost || []).map((e) => `
      <tr>
        <td>${escapeHtml(e.engine)}</td>
        <td class="num">${e.ops}</td>
        <td class="num">${e.credits_spent}</td>
        <td class="num">${fmtUsd(e.api_usd, 4)}</td>
      </tr>`).join("") || `<tr><td colspan="4" class="muted">${escapeHtml(t("econ.empty"))}</td></tr>`;

    const oh = m.overhead || {};
    const ohItems = (oh.items || []).map((it) => `
      <div class="econ-pack">
        <b>${escapeHtml(it.label)}</b>
        <div class="price">${escapeHtml(t("econ.perMonth", { usd: fmtUsd(it.usd) }))}</div>
      </div>`).join("");
    const scenRows = (m.scenarios || []).map((r) => `
      <tr>
        <td class="num">${escapeHtml(t("econ.proPacks", { n: fmtNum(r.pro_packs) }))}</td>
        <td class="num">${fmtUsd(r.revenue_usd)}</td>
        <td class="num">${fmtUsd(r.api_usd)}</td>
        <td class="num">${fmtUsd(r.fees_usd)}</td>
        <td class="num">${fmtUsd(r.resource_fx_usd)}</td>
        <td class="num">${fmtUsd(r.fixed_usd)}</td>
        <td class="num">${fmtUsd(r.net_usd)}</td>
        <td class="num">${fmtPct(r.net_margin_pct)}</td>
      </tr>`).join("");
    const warnHtml = (m.warnings || []).map((w) =>
      `<p class="econ-note" style="color:var(--warn)">${escapeHtml(w)}</p>`).join("");

    const arpu = g.arpu_usd != null ? fmtUsd(g.arpu_usd) : "—";
    const stabWarn = g.stability_share_pct != null && g.stability_share_pct > 40
      ? `<p class="econ-note" style="color:var(--warn)">${escapeHtml(t("econ.stabWarn"))} (${g.stability_share_pct}%)</p>`
      : "";

    out.innerHTML = `
      <section class="econ-section">
        <h4>${escapeHtml(t("econ.ov"))}</h4>
        <div class="econ-kpis">
          ${econKpi(t("econ.kpi.users"), ov.users_total ?? "—", { sub: `${t("econ.kpi.verified")}: ${ov.users_verified ?? "—"}` })}
          ${econKpi(t("econ.kpi.revenue"), fmtUsd(ov.revenue_usd), { sub: t("econ.ext", { ext: fmtUsd(ov.revenue_usd_external), int: fmtUsd(ov.revenue_usd_internal) }) })}
          ${econKpi(t("econ.kpi.outstanding"), ov.credits_outstanding == null ? "—" : fmtNum(ov.credits_outstanding), { sub: t("econ.sold", { n: fmtNum(ov.credits_sold ?? 0) }) })}
          ${econKpi(t("econ.kpi.arpu"), arpu, { sub: t("econ.pay", { n: fmtNum(g.payments_count ?? 0) }) })}
        </div>
      </section>
      <section class="econ-section">
        <h4>${escapeHtml(t("econ.live"))} · ${escapeHtml(g.period || q)}</h4>
        <div class="econ-kpis">
          ${econKpi(t("econ.kpi.margin"), fmtPct(g.gross_margin_pct), { cls: marginCls, sub: t("econ.onDebit", { usd: fmtUsd(g.estimated_revenue_on_debited_usd) }) })}
          ${econKpi(t("econ.kpi.api"), fmtUsd(g.estimated_api_usd, 4), { sub: t("econ.creditsDebited", { n: fmtNum(g.credits_debited ?? 0) }) })}
          ${econKpi(t("econ.kpi.util"), fmtPct(g.credits_utilization_pct), { sub: t("econ.avgPerCr", { usd: fmtUsd(g.avg_usd_per_credit, 4) }) })}
          ${econKpi(t("econ.kpi.net"), fmtUsd(n.net_profit_usd), { cls: n.net_profit_usd >= 0 ? "ok" : "warn", sub: fmtPct(n.net_margin_pct) })}
        </div>
        <p class="econ-note">${escapeHtml(t("econ.arpuLine", { arpu, n: g.payments_count ?? 0, avg: g.avg_usd_per_credit ?? 0, welcome: g.welcome_credits_net ?? 0 }))}</p>
        <p class="econ-note">${escapeHtml(t("econ.netLine", {
          rev: n.revenue_usd ?? 0, api: n.api_cost_usd ?? 0,
          fee: n.payment_fee_pct ?? 0, feeu: n.payment_fee_usd ?? 0,
          fx: n.fx_fee_pct ?? 0, fxu: n.fx_fee_usd ?? 0,
          rfx: n.resource_fx_pct ?? 0, rfxu: n.resource_fx_usd ?? 0,
          fixed: n.fixed_cost_usd ?? 0, net: n.net_profit_usd ?? 0,
        }))}</p>
        <p class="econ-note">${escapeHtml(t("econ.ohLine", {
          hosting: n.hosting_monthly_usd ?? oh.hosting_monthly_usd ?? 0,
          saas: n.saas_monthly_usd ?? oh.saas_monthly_usd ?? 0,
          fixed: n.fixed_monthly_usd ?? oh.fixed_monthly_usd ?? 0,
          rfx: n.resource_fx_pct ?? m.fees_defaults?.resource_fx_pct ?? 0,
        }))}</p>
        ${stabWarn}
        <div class="table-wrap" style="max-height:220px;margin-top:8px">
          <table class="econ-table">
            <thead><tr><th>${escapeHtml(t("econ.col.engine"))}</th><th class="num">${escapeHtml(t("econ.col.ops"))}</th><th class="num">${escapeHtml(t("econ.col.spent"))}</th><th class="num">${escapeHtml(t("econ.col.api"))}</th></tr></thead>
            <tbody>${costRows}</tbody>
          </table>
        </div>
        <h4 style="margin-top:14px">${escapeHtml(t("econ.stages"))}</h4>
        <p class="econ-note">${escapeHtml(t("econ.stageHint"))} · ${escapeHtml(d.stages?.usd_per_credit_basis || "")} ${escapeHtml(t("econ.perCr", { usd: fmtUsd(d.stages?.usd_per_credit, 4) }))}</p>
        <div class="table-wrap">
          <table class="econ-table">
            <thead><tr>
              <th>${escapeHtml(t("econ.col.engine"))}</th>
              <th class="num">${escapeHtml(t("econ.col.ops"))}</th>
              <th class="num">${escapeHtml(t("econ.col.spent"))}</th>
              <th class="num">${escapeHtml(t("econ.col.cogs"))}</th>
              <th class="num">${escapeHtml(t("econ.col.rev"))}</th>
              <th class="num">${escapeHtml(t("econ.col.net"))}</th>
            </tr></thead>
            <tbody>${(d.stages?.stages || []).map((s) => `
              <tr>
                <td>${escapeHtml(stageLabel(s.stage, s.label))}</td>
                <td class="num">${s.ops}</td>
                <td class="num">${s.credits_spent}</td>
                <td class="num">${fmtUsd(s.cost_usd, 4)}</td>
                <td class="num">${fmtUsd(s.revenue_usd, 4)}</td>
                <td class="num">${fmtUsd(s.margin_usd, 4)}</td>
              </tr>`).join("") || `<tr><td colspan="6" class="muted">${escapeHtml(t("econ.empty"))}</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
      <section class="econ-section">
        <h4>${escapeHtml(t("econ.be"))}</h4>
        <p class="econ-note">${escapeHtml(t("econ.beLine", {
          contrib: fmtUsd(be.contribution_usd),
          need: be.break_even_count ?? 0,
          have: be.payments_this_month ?? 0,
          pct: be.covered_pct != null ? `${be.covered_pct}%` : "—",
        }))}</p>
      </section>
      <section class="econ-section">
        <h4>${escapeHtml(t("econ.oh"))}</h4>
        <p class="econ-note">${escapeHtml(t("econ.ohHint"))}</p>
        <div class="econ-packs">${ohItems}</div>
        <p class="econ-note">${escapeHtml(t("econ.ohTotal", { total: fmtUsd(oh.fixed_monthly_usd ?? 0) }))}</p>
        <h4 style="margin-top:14px">${escapeHtml(t("econ.scenarios"))}</h4>
        <p class="econ-note">${escapeHtml(t("econ.scenHint", { api: m.blended_api_per_credit ?? 0 }))}</p>
        <div class="table-wrap">
          <table class="econ-table">
            <thead><tr>
              <th>${escapeHtml(t("econ.col.volume"))}</th>
              <th class="num">${escapeHtml(t("econ.col.rev"))}</th>
              <th class="num">${escapeHtml(t("econ.col.api"))}</th>
              <th class="num">${escapeHtml(t("econ.col.fees"))}</th>
              <th class="num">${escapeHtml(t("econ.col.rfx"))}</th>
              <th class="num">${escapeHtml(t("econ.col.fixed"))}</th>
              <th class="num">${escapeHtml(t("econ.col.net"))}</th>
              <th class="num">${escapeHtml(t("econ.col.mgn"))}</th>
            </tr></thead>
            <tbody>${scenRows}</tbody>
          </table>
        </div>
      </section>
      <section class="econ-section">
        <h4>${escapeHtml(t("econ.model"))}</h4>
        <p class="econ-note">${escapeHtml(t("econ.modelNote", {
          target: m.target_gross_margin_pct || "≥25%",
          net: m.target_net_margin_pct || "",
          cheap: m.cheapest_usd_per_credit ?? 0.03,
          rule: m.margin_floor_rule || "",
        }))}</p>
        ${warnHtml}
        <h4 style="margin-top:12px">${escapeHtml(t("econ.packages"))}</h4>
        <div class="econ-packs">${packs}</div>
        <h4 style="margin-top:14px">${escapeHtml(t("econ.tariff"))}</h4>
        <div class="table-wrap">
          <table class="econ-table">
            <thead><tr>
              <th>${escapeHtml(t("econ.col.family"))}</th>
              <th class="num">${escapeHtml(t("econ.col.draft"))}</th>
              <th class="num">${escapeHtml(t("econ.col.final"))}</th>
              <th class="num">${escapeHtml(t("econ.col.ref"))}</th>
            </tr></thead>
            <tbody>${tariffRows}</tbody>
          </table>
        </div>
        <h4 style="margin-top:14px">${escapeHtml(t("econ.engines"))}</h4>
        <div class="table-wrap" style="max-height:260px">
          <table class="econ-table">
            <thead><tr>
              <th>${escapeHtml(t("econ.col.engine"))}</th>
              <th class="num">${escapeHtml(t("econ.col.cogs"))}</th>
              <th class="num">${escapeHtml(t("econ.col.credits"))}</th>
              <th class="num">${escapeHtml(t("econ.col.rev"))}</th>
              <th class="num">${escapeHtml(t("econ.col.mgn"))}</th>
            </tr></thead>
            <tbody>${engRows}</tbody>
          </table>
        </div>
      </section>
      <section class="econ-section">
        <h4>${escapeHtml(t("econ.funnel"))}</h4>
        <div class="econ-kpis">
          ${econKpi(t("econ.funnel.new"), f.new_users ?? "—")}
          ${econKpi(t("econ.funnel.verified"), f.new_verified ?? "—")}
          ${econKpi(t("econ.funnel.paying"), f.paying_wallets ?? "—", { sub: fmtPct(f.conversion_verified_to_paying_pct) })}
          ${econKpi(t("econ.funnel.export"), f.exported_wallets ?? "—", { sub: fmtPct(f.conversion_generate_to_export_pct) })}
        </div>
      </section>`;
  } catch (e) {
    out.innerHTML = `<p class="err-msg">${escapeHtml(t("econ.fail", { err: e.message }))}</p>`;
  }
}

function setupEconomy() {
  document.querySelectorAll("[data-econ-days]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.econDays = btn.dataset.econDays || "all";
      document.querySelectorAll("[data-econ-days]").forEach((b) => b.classList.toggle("on", b === btn));
      renderEconomy();
    });
  });
}

async function renderTrash() {
  const box = $("trash-list");
  if (!box) return;
  let items = [];
  try {
    items = (await api("/api/trash")).items || [];
  } catch (e) {
    box.textContent = e.message;
    return;
  }
  box.innerHTML = "";
  if (!items.length) {
    box.innerHTML = `<p class="muted">${escapeHtml(t("trash.empty"))}</p>`;
    return;
  }
  for (const it of items) {
    const row = document.createElement("div");
    row.className = "trash-row";
    const files = it.files.map((f) => f.from).join(", ");
    const kb = Math.max(1, Math.round((it.bytes || 0) / 1024));
    row.innerHTML = `
      <div><b>${escapeHtml(fmtDate(it.at))}</b> · ${escapeHtml(it.reason || "")}
        <div class="muted">${escapeHtml(files)} · ${fmtNum(kb)} KB</div></div>
      <div class="btns">
        <button type="button" class="btn small b-restore"${tipAttr("trash.restore")}>${escapeHtml(t("trash.restore"))}</button>
        <button type="button" class="btn small b-purge"${tipAttr("trash.purge")}>${escapeHtml(t("trash.purge"))}</button>
      </div>`;
    row.querySelector(".b-restore").addEventListener("click", () => trashAction("/api/trash/restore", it.id));
    const purge = row.querySelector(".b-purge");
    purge.addEventListener("click", () => {
      // two-step confirm without a blocking browser dialog
      if (purge.dataset.armed) return trashAction("/api/trash/purge", it.id);
      purge.dataset.armed = "1";
      purge.textContent = t("trash.purgeConfirm");
      purge.classList.add("danger");
    });
    box.appendChild(row);
  }
  applyTips(box);
}

async function trashAction(path, id) {
  try {
    await api(path, { method: "POST", body: JSON.stringify({ id }) });
  } catch (e) {
    const box = $("trash-list");
    if (box) box.insertAdjacentHTML("afterbegin", `<p class="bad">${escapeHtml(e.message)}</p>`);
    return;
  }
  renderTrash();
}

function setupEngineDiagnostics() {
  const btn = $("btn-test-engines");
  const container = $("engines-status-table");
  if (!btn || !container) return;

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    container.innerHTML = `<p class="muted">${escapeHtml(t("admin.engines.running"))}</p>`;
    try {
      const data = await api("/api/engines/status");
      const list = data.engines || [];
      let html = `<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:10px;">`;
      for (const e of list) {
        const isOk = e.online;
        const color = isOk ? "#4ade80" : "#f87171";
        const badge = isOk ? t("admin.engines.online") : t("admin.engines.offline");
        const ping = e.pingMs ? `${e.pingMs}ms` : "—";
        const localTag = e.local ? `<span style="background:#3b82f6; color:#fff; font-size:10px; padding:2px 5px; border-radius:4px; margin-left:6px">${escapeHtml(t("admin.engines.local"))}</span>` : "";
        html += `
          <div style="border:1px solid #334155; border-radius:8px; padding:10px; background:#0f172a">
            <div style="display:flex; justify-content:space-between; align-items:center">
              <b>${escapeHtml(e.engine.toUpperCase())} ${localTag}</b>
              <span style="color:${color}; font-weight:bold; font-size:11px">${badge} (${ping})</span>
            </div>
            <div class="muted small" style="margin-top:6px">${escapeHtml(e.message || "")}</div>
          </div>
        `;
      }
      html += `</div>`;
      container.innerHTML = html;
    } catch (err) {
      container.innerHTML = `<p class="danger small">${escapeHtml(t("admin.engines.fail", { message: err.message }))}</p>`;
    } finally {
      btn.disabled = false;
    }
  });
}

/* ---------- Boot ---------- */
async function boot() {
  initI18n();
  setupTabs();
  setupHints();
  setupLang();
  setupBase();
  setupOverview();
  setupConstructor();
  setupRecipes();
  setupRender();
  setupGallery();
  setupQuality();
  setupSizeTools();
  setupAuthorship();
  setupEngineDiagnostics();
  setupVersions();
  setupExport();
  setupKits();
  setupPath();
  setupHelp();
  setupAccount();
  setupEconomy();
  setupResources();
  await refreshAccount();

  try {
    state.health = await api("/api/health");
    const me = $("me");
    if (me) {
      me.dataset.mode = "port";
      me.dataset.port = String(state.health.port || 5344);
      me.textContent = t("ui.labPort", { port: me.dataset.port });
    }
  } catch {
    const me = $("me");
    if (me) {
      me.dataset.mode = "offline";
      me.textContent = t("ui.offline");
    }
  }

  // one failing loader must not leave the rest of the UI uninitialised
  const loads = await Promise.allSettled([loadPresets(), loadTemplates(), loadArchives(), refreshBaseStatus()]);
  loads.filter((r) => r.status === "rejected").forEach((r) => console.error(r.reason));
  if (state.presets[0]) {
    try {
      const data = await api(`/api/preset?file=${encodeURIComponent(state.presets[0].file)}`);
      fillConstructor(data.preset);
    } catch {
      /* ignore */
    }
  }
  if (state.archives.length) {
    try { await loadRecipesArchive(state.archives[0].file); } catch { /* ignore */ }
  }
  renderSteps();
  renderFacts();
  renderCtorSummary();
  await loadGallerySets();
  if (state.galleryDir) await loadGalleryDir(state.galleryDir);
  else renderGallery();
  if (state.account?.admin) await renderResources();
  await fillExportSets();
  await restoreWorkspace();
  applyI18n(document);
  relabelEngineSelects();
}

boot().catch((e) => {
  console.error(e);
  $("me").textContent = String(e.message || e);
});
