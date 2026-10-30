/**
 * Series Lab Studio UI — tabs, Lab APIs, i18n (uk/en).
 * Prompts/recipe content stay English for generators.
 */
import { presentApiError } from "./api-errors.js";
import { setupModalFocus } from "./focus-trap.js";
import { applyI18n, getLocale, initI18n, t, tipText } from "./i18n.js";
import { openTopup, refreshAccount, relabelEngineSelects, setupAccount } from "./app-account.js";
import { renderSystem, setupHints, setupLang, setupSystemPane, stopSystemTimer } from "./app-admin.js";
import { refreshBaseStatus, setupBase } from "./app-base.js";
import { fillExportSets, fillKitSets, paintDeployCommands, renderPath, restoreWorkspace, setupExport, setupKits, setupPath, showCurationPrice, showStagePrice } from "./app-export.js";
import { loadGalleryDir, loadGallerySets, renderGallery } from "./app-gallery.js";
import { refreshCtorLayers, refreshLayersStatus, setupRender } from "./app-generate.js";
import { setupHelp } from "./app-help.js";
import { fillConstructor, setupConstructor, setupOverview } from "./app-options.js";
import { escapeHtml, loadPresets, loadTemplates, renderCtorSummary, renderFacts, renderSteps } from "./app-overview.js";
import { fillArchiveSelect, loadArchives, loadRecipesArchive, renderRecipeTable, setupRecipes } from "./app-recipes.js";
import { renderEconomy, renderResources, renderSpend, setupEconomy, setupEngineDiagnostics, setupResources } from "./app-resources.js";
import { setupAiMark, setupAuthorship, setupGallery, setupQuality, setupSizeTools, setupVersions } from "./app-versions.js";

export function tipAttr(key) {
  const s = tipText(key);
  return s ? ` title="${escapeHtml(s)}" data-tip="${escapeHtml(s)}"` : "";
}

export const state = {
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
  renderPlan: null,
  lastSet: null,
  rarity: null,
  account: null,
  econDays: "all",
};

/** Revision of each preset file as this tab last saw it: sent back on save so a change made elsewhere is not lost. */
export function rememberRev(file, rev) {
  if (!file || !rev) return;
  state.presetRevs = { ...(state.presetRevs || {}), [file]: rev };
}
export const saveRevField = (file) => (state.presetRevs?.[file] ? { baseRev: state.presetRevs[file] } : {});

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

export function playCompletionChime() {
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

// A paid step (base, triage, ZIP, pin, kits ...) changes the balance, so the header re-reads it after any write.
// Writes that never charge and fire often (autosave, previews, marks) are skipped; bursts collapse into one read.
const NO_BALANCE_REFRESH_PREFIXES = ["/api/me", "/api/workspace", "/api/marks", "/api/validate", "/api/simulate", "/api/lint", "/api/diff-seed", "/api/recipe", "/api/layers/frame-offset", "/api/qa/"];
const NO_BALANCE_REFRESH = { test: (path) => NO_BALANCE_REFRESH_PREFIXES.some((p) => String(path).startsWith(p)) };
let balanceTimer = null;
function scheduleBalanceRefresh() {
  clearTimeout(balanceTimer);
  balanceTimer = setTimeout(() => refreshAccount(), 800);
}

export async function api(path, opts = {}) {
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
  if (opts.method && opts.method !== "GET" && !NO_BALANCE_REFRESH.test(path)) scheduleBalanceRefresh();
  return data;
}

export function $(id) {
  return document.getElementById(id);
}

export function showTab(name) {
  let adminPane = null;
  if (name === "res") {
    adminPane = "res";
    name = "admin";
  }
  if (name === "admin" && state.account && !state.account.admin) name = "home";
  document.querySelectorAll(".tab").forEach((el) => el.classList.toggle("on", el.id === `tab-${name}`));
  document.querySelectorAll("#tabs button").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.tab === name);
    if (btn.dataset.tab === name) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
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
  if (name === "ctor") refreshCtorLayers();
  if (name === "deploy") paintDeployCommands();
  if (name === "render") {
    if (state.archivesLoaded) paintGenerateNotice();
    else loadArchives().catch(() => {});
  }
  if (name === "recipes") ensureRecipesLoaded();
  if (name === "gallery") ensureGalleryLoaded();
  if (name === "render") {
    lockGenerate(true);
    refreshLayersStatus();
  }
  if (name === "admin") {
    const current = document.querySelector(".admin-pane.on")?.id?.replace(/^admin-/, "");
    showAdminPane(adminPane || current || "sys");
  }
}

/** Generate needs the recipe texts of the series; without them "Estimate" only prints a raw server error. */
export function paintGenerateNotice() {
  const box = $("g-needs-recipes");
  if (!box) return;
  if (!state.archivesLoaded) return; // not loaded yet: loadArchives paints when it is
  const series = $("r-preset")?.value || "";
  const built = series ? state.archives.some((a) => a.file === series) : state.archives.length > 0;
  box.hidden = built;
}

export function lockGenerate(locked) {
  const run = $("g-run");
  if (!run) return;
  run.disabled = Boolean(locked);
  run.classList.toggle("primary", !locked);
}

async function ensureGalleryLoaded() {
  await loadGallerySets();
  if (state.galleryDir) await loadGalleryDir(state.galleryDir);
  else renderGallery();
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
  // In-page pointers to another tab (and a card on it), e.g. "fix a critical trait with a PNG layer".
  document.addEventListener("click", (e) => {
    const go = e.target.closest?.("[data-goto-tab]");
    if (!go) return;
    showTab(go.dataset.gotoTab);
    const target = go.dataset.scrollTo ? $(go.dataset.scrollTo) : null;
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
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
  const pane = name || "sys";
  document.querySelectorAll(".admin-pane").forEach((el) => el.classList.toggle("on", el.id === `admin-${pane}`));
  document.querySelectorAll("[data-admin]").forEach((btn) => btn.classList.toggle("on", btn.dataset.admin === pane));
  if (pane !== "sys") stopSystemTimer();
  if (pane === "sys") renderSystem();
  else if (pane === "res") renderResources();
  else if (pane === "econ") renderEconomy();
  else renderSpend();
}

/* ---------- Boot ---------- */
/**
 * Opening, creating or restoring a project changes which base image, layers and frame sets the server works on, so the
 * studio restarts on it; a short message and the tab to show survive the reload.
 */
export function reloadStudio({ msg = "", tab = "" } = {}) {
  try {
    sessionStorage.setItem("series.flash", JSON.stringify({ msg, tab }));
  } catch {
    /* the flash is optional */
  }
  location.reload();
}

function showFlash() {
  let flash = null;
  try {
    flash = JSON.parse(sessionStorage.getItem("series.flash") || "null");
    sessionStorage.removeItem("series.flash");
  } catch {
    flash = null;
  }
  if (!flash) return;
  if (flash.msg && $("o-msg")) {
    $("o-msg").textContent = flash.msg;
    $("o-msg").className = "small ok-msg";
  }
  if (flash.tab) showTab(flash.tab);
}

export const setProjectsMsg = (text, cls = "small") => {
  const el = $("projects-msg");
  if (!el) return;
  el.textContent = text || "";
  el.className = cls;
};

/** Deleting asks twice: the first click arms the button, the second deletes (to the trash, so it can be restored). */
let armedDelete = null;
async function deleteProject(btn, current) {
  const file = btn.dataset.projectDelete;
  if (armedDelete?.file !== file) {
    if (armedDelete) armedDelete.btn.textContent = t("projects.delete");
    armedDelete = { file, btn };
    btn.textContent = t("projects.deleteSure");
    setProjectsMsg(t("projects.deleteHint", { name: btn.dataset.name }));
    setTimeout(() => {
      if (armedDelete?.file === file) {
        btn.textContent = t("projects.delete");
        armedDelete = null;
      }
    }, 12000);
    return;
  }
  armedDelete = null;
  try {
    await api("/api/projects/delete", { method: "POST", body: JSON.stringify({ file, confirm: true }) });
  } catch (e) {
    setProjectsMsg(e.message, "small err-msg");
    return;
  }
  setProjectsMsg(t("projects.deletedMsg", { name: btn.dataset.name }), "small ok-msg");
  await loadPresets();
  await loadArchives().catch(() => {});
  if (file === state.activeProject || file.replace(/\.json$/, "") === current) {
    // the open project is gone: restart the studio on another one (the saved series no longer exists)
    state.archiveFile = null;
    setTimeout(() => location.reload(), 900);
    return;
  }
  renderProjects();
}

let armedRestore = null;
let armedPurge = null;
function renderDeletedProjects(deleted) {
  const wrap = $("projects-deleted-wrap");
  const ul = $("projects-deleted");
  if (!wrap || !ul) return;
  wrap.hidden = !deleted.length;
  ul.innerHTML = "";
  for (const d of deleted) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="p-name">${escapeHtml(d.file.replace(/\.json$/, ""))}</span><span class="p-meta">${escapeHtml(String(d.at || "").slice(0, 10))}${d.daysLeft != null ? ` · ${escapeHtml(t("projects.purgeIn", { n: d.daysLeft }))}` : ""}</span><span class="p-actions"><button type="button" class="btn small" data-restore="${escapeHtml(d.trashId)}">${escapeHtml(t("projects.restore"))}</button> <button type="button" class="btn small" data-purge="${escapeHtml(d.trashId)}" data-name="${escapeHtml(d.file.replace(/\.json$/, ""))}">${escapeHtml(t("projects.purge"))}</button></span>`;
    ul.appendChild(li);
  }
  ul.querySelectorAll("[data-purge]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.purge;
      if (armedPurge?.id !== id) {
        if (armedPurge) armedPurge.btn.textContent = t("projects.purge");
        armedPurge = { id, btn };
        btn.textContent = t("projects.purgeSure");
        setProjectsMsg(t("projects.purgeHint", { name: btn.dataset.name }));
        setTimeout(() => {
          if (armedPurge?.id === id) {
            btn.textContent = t("projects.purge");
            armedPurge = null;
          }
        }, 12000);
        return;
      }
      armedPurge = null;
      try {
        await api("/api/projects/purge", { method: "POST", body: JSON.stringify({ id, confirm: true }) });
      } catch (e) {
        setProjectsMsg(e.message, "small err-msg");
        return;
      }
      setProjectsMsg(t("projects.purgedMsg", { name: btn.dataset.name }), "small ok-msg");
      renderProjects();
    });
  });
  ul.querySelectorAll("[data-restore]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.restore;
      try {
        const data = await api("/api/projects/restore", { method: "POST", body: JSON.stringify({ id, ...(armedRestore === id ? { confirmCharge: true } : {}) }) });
        armedRestore = null;
        setProjectsMsg(data.charged ? t("projects.restoredCharged", { n: data.charged }) : t("projects.restoredMsg"), "small ok-msg");
        if (data.charged) refreshAccount();
        if (state.assetsPerProject) {
          reloadStudio({ msg: data.charged ? t("projects.restoredCharged", { n: data.charged }) : t("projects.restoredMsg") });
          return;
        }
        await loadPresets();
        await loadArchives().catch(() => {});
        renderProjects();
      } catch (e) {
        if (e.payload?.code === "project_charge") {
          armedRestore = id;
          setProjectsMsg(t("projects.confirm", { cost: e.payload.cost, used: e.payload.used, free: e.payload.free }), "small err-msg");
          return;
        }
        setProjectsMsg(e.message, "small err-msg");
      }
    });
  });
}

/** Move a frame set of the open project into another one (the set changes owner; nothing is copied or charged). */
async function renderMoveSet(projects, current) {
  const wrap = $("projects-move-wrap");
  if (!wrap) return;
  const others = (projects || []).filter((p) => p.id !== current);
  let sets = [];
  if (state.assetsPerProject && others.length) {
    try {
      sets = (await api("/api/sets")).sets || [];
    } catch {
      sets = [];
    }
  }
  wrap.hidden = !sets.length;
  if (!sets.length) return;
  $("projects-move-set").innerHTML = sets.map((s) => `<option value="${escapeHtml(s.dir)}">${escapeHtml(s.dir)} (${s.count})</option>`).join("");
  $("projects-move-to").innerHTML = others.map((p) => `<option value="${escapeHtml(p.file)}">${escapeHtml(p.name)}</option>`).join("");
  $("projects-move-btn").onclick = async () => {
    const dir = $("projects-move-set").value;
    const to = $("projects-move-to").value;
    try {
      await api("/api/projects/move-set", { method: "POST", body: JSON.stringify({ dir, to }) });
    } catch (e) {
      setProjectsMsg(e.message, "small err-msg");
      return;
    }
    setProjectsMsg(t("projects.moved", { set: dir, to: $("projects-move-to").selectedOptions[0]?.textContent || to }), "small ok-msg");
    loadGallerySets();
    renderProjects();
  };
}

/** "My projects": every collection is a project you can reopen; beyond the free ones a new project costs credits once. */
export async function renderProjects() {
  const list = $("projects-list");
  if (!list) return;
  let data;
  try {
    data = await api("/api/projects");
  } catch {
    return;
  }
  state.assetsPerProject = Boolean(data.assetsPerProject);
  state.activeProject = data.active || null;
  state.projectFiles = new Set((data.projects || []).map((p) => p.file));
  const q = data.quota || {};
  const quota = $("projects-quota");
  if (quota) {
    quota.textContent = q.exempt
      ? t("projects.exempt", { used: q.used })
      : q.needsCharge
        ? t("projects.quotaFull", { used: q.used, free: q.free, cost: q.extraCredits })
        : t("projects.quota", { used: q.used, free: q.free, left: q.freeLeft, cost: q.extraCredits });
  }
  const storage = $("projects-storage");
  if (storage) {
    const s = data.storage || {};
    const mbOf = (n) => Math.round((Number(n) || 0) / (1024 * 1024));
    storage.textContent = !s.limit
      ? ""
      : t(s.used >= s.limit ? "projects.storageFull" : "projects.storage", { used: mbOf(s.used), limit: mbOf(s.limit) });
  }
  const current = state.assetsPerProject && state.activeProject
    ? state.activeProject.replace(/\.json$/, "")
    : (state.archiveFile || $("r-preset")?.value || "").replace(/\.json$/, "");
  list.innerHTML = "";
  if (!data.projects?.length) {
    list.innerHTML = `<li class="muted small">${escapeHtml(t("projects.empty"))}</li>`;
    renderDeletedProjects(data.deleted || []);
    return;
  }
  for (const p of data.projects) {
    const li = document.createElement("li");
    if (p.id === current) li.classList.add("current");
    const a = p.assets;
    const assets = state.assetsPerProject && a
      ? ` · ${escapeHtml(t("projects.assets", { sets: a.sets, frames: a.frames, mb: (a.bytes / 1048576).toFixed(1) }))}${a.hasBase ? "" : ` · ${escapeHtml(t("projects.noBase"))}`}`
      : "";
    const size = (p.size != null ? ` · ${escapeHtml(t("projects.frames", { n: p.size }))}` : "") + assets;
    li.innerHTML = `<span class="p-name">${escapeHtml(p.name)}</span><span class="p-meta">${escapeHtml(p.file)}${size}</span>${p.paid ? `<span class="badge paid">${escapeHtml(t("projects.paid", { n: p.credits }))}</span>` : ""}<span class="p-actions"><button type="button" class="btn small" data-project="${escapeHtml(p.file)}">${escapeHtml(p.id === current ? t("projects.current") : t("projects.open"))}</button> <button type="button" class="btn small" data-project-delete="${escapeHtml(p.file)}" data-name="${escapeHtml(p.name)}">${escapeHtml(t("projects.delete"))}</button></span>`;
    list.appendChild(li);
  }
  list.querySelectorAll("[data-project-delete]").forEach((btn) => {
    btn.addEventListener("click", () => deleteProject(btn, current));
  });
  renderDeletedProjects(data.deleted || []);
  renderMoveSet(data.projects, current);
  list.querySelectorAll("[data-project]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const sel = $("r-preset");
      if (!sel) return;
      sel.value = btn.dataset.project;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      setTimeout(renderProjects, 600);
    });
  });
}

/**
 * Which series the studio opens on: the one saved in the workspace; for a first visit the portrait template
 * (a new series inherits its text and traits from the preset that is loaded when it is first saved, so the
 * first one must not be an arbitrary alphabetical neighbour such as an abstract preset).
 */
function startSeries(workspace, active = null) {
  const presets = new Set((state.presets || []).map((p) => p.file));
  const archives = new Set((state.archives || []).map((a) => a.file));
  const saved = active || (workspace?.presetId ? `${workspace.presetId}.json` : "");
  const preferred = [saved, "pfp-portrait.json", "demo-series.json"].find((f) => f && presets.has(f));
  const preset = preferred || state.presets?.[0]?.file || "";
  const savedArchive = workspace?.lastArchive && archives.has(workspace.lastArchive) ? workspace.lastArchive : "";
  const archive = archives.has(preset) ? preset : savedArchive || state.archives?.[0]?.file || "";
  return { preset, archive };
}

async function boot() {
  initI18n();
  setupTabs();
  setupHints();
  setupModalFocus();
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
  setupAiMark();
  setupSystemPane();
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
      // The port is a developer detail of the local studio; on the public site it only confuses ("lab · :5344").
      const hosted = state.account?.mode === "public";
      me.dataset.mode = hosted ? "hosted" : "port";
      me.dataset.port = String(state.health.port || 5344);
      me.textContent = hosted ? "" : t("ui.labPort", { port: me.dataset.port });
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
  const ws = await api("/api/workspace").catch(() => null);
  const pr = await api("/api/projects").catch(() => null);
  state.assetsPerProject = Boolean(pr?.assetsPerProject);
  state.activeProject = pr?.active || null;
  state.projectFiles = new Set((pr?.projects || []).map((p) => p.file));
  const start = startSeries(ws?.workspace, pr?.active || null);
  if (start.preset) {
    try {
      const data = await api(`/api/preset?file=${encodeURIComponent(start.preset)}`);
      rememberRev(start.preset, data.rev);
      fillConstructor(data.preset);
      for (const id of ["ctor-file", "r-preset"]) if ($(id) && [...$(id).options].some((o) => o.value === start.preset)) $(id).value = start.preset;
    } catch {
      /* ignore */
    }
  }
  if (start.archive) {
    try { await loadRecipesArchive(start.archive); } catch { /* ignore */ }
  }
  renderSteps();
  renderFacts();
  renderCtorSummary();
  renderProjects();
  await loadGallerySets();
  if (state.galleryDir) await loadGalleryDir(state.galleryDir);
  else renderGallery();
  if (state.account?.admin) await renderResources();
  await fillExportSets();
  await restoreWorkspace();
  applyI18n(document);
  relabelEngineSelects();
  showFlash();
}

boot().catch((e) => {
  console.error(e);
  $("me").textContent = String(e.message || e);
});
