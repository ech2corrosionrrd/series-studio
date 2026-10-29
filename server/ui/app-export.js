/**
 * Export, workspace and the pre-release checklist.
 * Moved out of app.js without a change in behaviour (docs/QUALITY-REVIEW.md, item 6). The module graph is circular on purpose:
 * every import is a function or a binding that is only used after all modules have loaded.
 */
import { fmtNum, fmtUsd as fmtUsdLocale } from "./format.js";
import { applyTips, getLocale, hasKey, t } from "./i18n.js";
import { showToast } from "./app-account.js";
import { $, api, showTab, state } from "./app.js";
import { loadGalleryDir } from "./app-gallery.js";
import { syncCtorFromOverview } from "./app-options.js";
import { escapeHtml } from "./app-overview.js";
import { syncActiveSeries, updateJsonLink } from "./app-recipes.js";
import { authorshipFromForm, provMessage } from "./app-versions.js";

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

export function renderPath(activeTab) {
  const box = $("path-steps");
  if (!box) return;
  document.body.classList.toggle("beginner-on", beginnerOn());
  if ($("path-adv-note")) $("path-adv-note").hidden = !beginnerOn();
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

export function stageLabel(stage, fallback) {
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

export async function showStagePrice(stage, elementId, extra = {}) {
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

export async function showCurationPrice() {
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

export function fillKitSets() {
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

export function setupPath() {
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

/** With the base as edition #0 (Genesis) a series of N ships N + 1 items: say so next to the ZIP button, where "25 шт" appears. */
function paintGenesisNote() {
  const note = $("x-genesis-note");
  if (!note) return;
  const on = Boolean($("o-genesis")?.checked);
  note.hidden = !on;
  if (!on) return;
  const n = Number($("o-size")?.value) || 0;
  note.textContent = t("export.genesisNote", { n, total: n + 1 });
}

/** The NFT name prefix follows the series name until the author types their own ("Series #" is only the untouched default). */
function syncNamePrefixDefault() {
  const el = $("x-namePrefix");
  const series = $("o-name")?.value?.trim();
  if (!el || !series || el.dataset.touched === "1") return;
  if (!el.value || el.value === "Series #" || el.dataset.auto === el.value) {
    el.value = `${series} #`;
    el.dataset.auto = el.value;
  }
}

export async function fillExportSets() {
  paintGenesisNote();
  syncNamePrefixDefault();
  const sel = $("x-set");
  if (!sel) return;
  try {
    const data = await api("/api/sets");
    const sets = data.sets || [];
    const cur = sel.value || state.galleryDir || state.lastSet || "";
    if (!sets.length) {
      sel.innerHTML = `<option value="">${escapeHtml(t("export.bundle.noSets"))}</option>`;
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
let workspacePending = null; // the debounced save that has not been sent yet ({} when only the form values changed)
export function scheduleWorkspaceSave(patch) {
  clearTimeout(workspaceTimer);
  workspacePending = patch || {};
  workspaceTimer = setTimeout(() => saveWorkspace(patch).catch(() => {}), 400);
}

/** The tab is closing or hidden: send a save that is still waiting for its debounce, so the last edit is not lost. */
function flushWorkspace() {
  if (workspacePending === null) return;
  clearTimeout(workspaceTimer);
  saveWorkspace(workspacePending, { keepalive: true }).catch(() => {});
}
window.addEventListener("pagehide", flushWorkspace);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushWorkspace();
});

async function saveWorkspace(patch = {}, { keepalive = false } = {}) {
  workspacePending = null;
  const body = {
    locale: getLocale(),
    presetId: $("o-id")?.value?.trim() || $("c-id")?.value?.trim() || null,
    lastArchive: state.archiveFile || $("x-file")?.value || state.archives[0]?.file || null,
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
  await api("/api/workspace", { method: "POST", body: JSON.stringify(body), ...(keepalive ? { keepalive: true } : {}) });
}

export async function restoreWorkspace() {
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
    if (!state.archiveFile && w.lastArchive && $("x-file") && [...($("x-file").options || [])].some((o) => o.value === w.lastArchive)) {
      syncActiveSeries(w.lastArchive);
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
    // The metadata lists traits from the recipes; offer the author an explicit confirmation when no vision check covers the frames.
    const vis = (data.items || []).find((it) => it.id === "visibility")?.data;
    const wrap = $("x-visibility-wrap");
    if (wrap) {
      wrap.hidden = !(vis && (vis.status === "unchecked" || vis.status === "partial"));
      if ($("x-visibility-ack")) $("x-visibility-ack").checked = Boolean(vis?.acknowledged);
    }
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

export function setupExport() {
  $("x-file")?.addEventListener("change", () => {
    syncActiveSeries($("x-file").value);
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
  $("x-namePrefix")?.addEventListener("input", () => {
    $("x-namePrefix").dataset.touched = "1";
    updateMetadataPreview();
  });
  $("o-genesis")?.addEventListener("change", paintGenesisNote);
  $("o-size")?.addEventListener("input", paintGenesisNote);
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
          aiMark: $("x-ai-mark")?.checked !== false,
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
          aiMark: $("x-ai-mark")?.checked !== false,
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
  $("x-visibility-ack")?.addEventListener("change", async () => {
    const set = $("x-set")?.value;
    if (!set) return;
    try {
      await api("/api/qa/visibility-ack", { method: "POST", body: JSON.stringify({ dir: set, ack: Boolean($("x-visibility-ack")?.checked) }) });
      await renderChecklist();
    } catch (e) {
      const msg = $("x-checklist-msg");
      if (msg) msg.textContent = e.message;
    }
  });
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

export async function updateReleaseHub() {
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

export function kitArchive() {
  return state.archiveFile || $("x-file")?.value || state.archives?.[0]?.file || "";
}

export function setBusy(btn, on) {
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

export async function loadLaunchAdvisor() {
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
    showToast(e.message);
  }
}

/**
 * Ready-to-paste terminal commands for the release on the author's PC (Solana, Core Candy Machine). Names the studio
 * knows (the archive file, the creator address, the symbol, devnet or mainnet) are filled in; what it cannot know
 * (the folder the ZIP was unpacked to, the key files) stays in angle brackets. Nothing here is run by the studio.
 * Plain comments and single-line commands, so the same text works in PowerShell and in Bash.
 */
function deployCommandsText() {
  const chain = $("d-chain")?.value || "solana";
  if (chain !== "solana") return null;
  const devnet = document.querySelector('input[name="d-rehearsal"]:checked')?.value !== "skip";
  // the series that is open, when its recipes are built; otherwise whatever archive the kits use
  const open = $("r-preset")?.value || "";
  const archive = (open && state.archives?.some((x) => x.file === open) ? open : kitArchive()) || t("deploy.commands.archivePh");
  const creator = ($("d-creator")?.value || "").trim();
  const symbol = ($("d-symbol")?.value || "").trim();
  const rpc = "https://api.devnet.solana.com";
  const release = ["series release-init", archive, "-o release.json"];
  if (creator) release.push("--creator", creator);
  if (symbol) release.push("--symbol", symbol);
  const lines = [
    `# ${t("deploy.commands.c.tip")}`,
    `# ${t("deploy.commands.c.cli")}`,
    `# ${t("deploy.commands.c.folder")}`,
    `cd <${t("deploy.commands.folderPh")}>`,
    "",
    `# ${t("deploy.commands.c.key")}`,
    "solana-keygen new --outfile deployer.json",
    "",
    `# ${t("deploy.commands.c.doctor")}`,
    "series doctor --release --keypair deployer.json",
    ...(devnet ? ["", `# ${t("deploy.commands.c.airdrop")}`, `solana airdrop 2 --url ${rpc} --keypair deployer.json`] : []),
    "",
    `# ${t("deploy.commands.c.release")}`,
    release.join(" "),
    `# ${t("deploy.commands.c.fill")}`,
    "",
    `# ${t(devnet ? "deploy.commands.c.uploadDevnet" : "deploy.commands.c.upload")}`,
    `series upload . --keypair deployer.json${devnet ? " --devnet" : ""}`,
    "",
    `# ${t("deploy.commands.c.cache")}`,
    "series doctor --release --keypair deployer.json --cache cache.json",
    "",
    `# ${t("deploy.commands.c.hidden")}`,
    `series hidden . --uri <${t("deploy.commands.hiddenPh")}>`,
    "",
    `# ${t("deploy.commands.c.guards")}`,
    "series guards release.json -o guard-config.json",
    "",
    `# ${t("deploy.commands.c.machine")}`,
    "mplx cm create --wizard",
    "",
    `# ${t("deploy.commands.c.verify")}`,
    `series verify release.json${devnet ? ` --rpc ${rpc}` : ""}`,
    "",
    `# ${t("deploy.commands.c.mint")}`,
    `series mint release.json --keypair <${t("deploy.commands.minterPh")}>`,
    "",
    `# ${t("deploy.commands.c.reveal")}`,
    `series reveal . --keypair <${t("deploy.commands.authorityPh")}>`,
  ];
  return lines.join("\n");
}

export function paintDeployCommands() {
  const pre = $("d-commands-text");
  if (!pre) return;
  const text = deployCommandsText();
  pre.textContent = text ?? t("deploy.commands.other");
  if ($("d-commands-copy")) $("d-commands-copy").hidden = text == null;
}

function setupDeployCommands() {
  for (const id of ["d-chain", "d-creator", "d-symbol", "x-file", "r-preset"]) {
    $(id)?.addEventListener("input", paintDeployCommands);
    $(id)?.addEventListener("change", paintDeployCommands);
  }
  document.querySelectorAll('input[name="d-rehearsal"]').forEach((r) => r.addEventListener("change", paintDeployCommands));
  $("d-commands-copy")?.addEventListener("click", async () => {
    const msg = $("d-commands-msg");
    try {
      await navigator.clipboard.writeText(deployCommandsText() || "");
      if (msg) msg.textContent = t("deploy.commands.copied");
    } catch {
      if (msg) msg.textContent = t("deploy.commands.copyFail");
    }
  });
  paintDeployCommands();
}

export function setupKits() {
  setupDeployCommands();
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
