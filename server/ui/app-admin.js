/**
 * Admin screens (the System panel).
 * Moved out of app.js without a change in behaviour (docs/QUALITY-REVIEW.md, item 6). The module graph is circular on purpose:
 * every import is a function or a binding that is only used after all modules have loaded.
 */
import { fmtDate, fmtNum } from "./format.js";
import { applyTips, getLocale, setLocale, t } from "./i18n.js";
import { refreshAccount, relabelEngineSelects, renderTopup } from "./app-account.js";
import { $, api, renderProjects, showTab, state } from "./app.js";
import { refreshBaseStatus } from "./app-base.js";
import { loadLaunchAdvisor, paintDeployCommands, renderPath, repaintExportCopy, showCurationPrice, showStagePrice, updateReleaseHub } from "./app-export.js";
import { repaintPlan } from "./app-generate.js";
import { renderGallery, syncCompareSelect } from "./app-gallery.js";
import { renderHelp } from "./app-help.js";
import { paintOverviewStrength, renderOptionsEditor, repaintWhoLines } from "./app-options.js";
import { escapeHtml, fillPresetSelects, renderCtorSummary, renderFacts, renderSteps, renderTemplates } from "./app-overview.js";
import { renderPackSummary, renderPacks, renderTraitChecklist } from "./app-packs.js";
import { fillArchiveSelect, renderRecipeTable } from "./app-recipes.js";
import { renderEconomy, renderResources } from "./app-resources.js";

/* ---------- Адмінка · «Система» ---------- */
function fmtDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return t("sys.dur", { d, h, m });
}

function fmtAgoMin(min) {
  if (min == null) return "—";
  if (min < 120) return t("sys.agoMin", { n: fmtNum(min) });
  if (min < 48 * 60) return t("sys.agoHour", { n: fmtNum(Math.round(min / 60)) });
  return t("sys.agoDay", { n: fmtNum(Math.round(min / 1440)) });
}

function sysBar(pct, warnAt = 75, badAt = 90) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const lvl = p >= badAt ? "bad" : p >= warnAt ? "warn" : "";
  return `<div class="sys-bar ${lvl}" role="img" aria-label="${escapeHtml(String(Math.round(p)))}%"><i style="width:${p}%"></i></div>`;
}

function sysKv(label, value) {
  return `<div class="sys-kv"><span>${escapeHtml(label)}</span><span>${value}</span></div>`;
}

function sysPill(on, onKey = "sys.on", offKey = "sys.off") {
  return `<span class="sys-pill ${on ? "ok" : "off"}">${escapeHtml(t(on ? onKey : offKey))}</span>`;
}

function sysCard(titleKey, body, wide = false) {
  return `<section class="sys-card${wide ? " wide" : ""}"><h3>${escapeHtml(t(titleKey))}</h3>${body}</section>`;
}

function sysRouteTable(rows, withErrors = false) {
  if (!rows?.length) return `<p class="muted small">${escapeHtml(t("sys.none"))}</p>`;
  const head = `<tr><th>${escapeHtml(t("sys.col.route"))}</th><th>${escapeHtml(t("sys.col.count"))}</th><th>${escapeHtml(t("sys.col.p50"))}</th><th>${escapeHtml(t("sys.col.p95"))}</th><th>${escapeHtml(t("sys.col.max"))}</th>${withErrors ? `<th>${escapeHtml(t("sys.col.errors"))}</th>` : ""}</tr>`;
  const body = rows
    .map((r) => `<tr><td><code>${escapeHtml(r.route)}</code></td><td>${fmtNum(r.count)}</td><td>${fmtNum(r.p50)}</td><td>${fmtNum(r.p95)}</td><td>${fmtNum(r.max)}</td>${withErrors ? `<td>${fmtNum(r.errors)}</td>` : ""}</tr>`)
    .join("");
  return `<div class="opt-table-wrap"><table class="sys-table"><caption class="visually-hidden">${escapeHtml(t("table.caption.sysRoutes"))}</caption>${head}${body}</table></div>`;
}

function renderSystemPayload(j) {
  const alertsEl = $("sys-alerts");
  const gridEl = $("sys-grid");
  if (!alertsEl || !gridEl) return;
  alertsEl.innerHTML = j.alerts?.length
    ? j.alerts
        .map((a) => `<div class="sys-alert ${escapeHtml(a.level)}">${escapeHtml(t(`sys.alert.${a.code}`, a.params || {}))}</div>`)
        .join("")
    : `<div class="sys-alert ok">${escapeHtml(t("sys.ok"))}</div>`;
  const a = j.app || {};
  const p = j.process || {};
  const d = j.disk;
  const bk = j.backup || {};
  const pl = j.platform;
  const rq = j.requests || {};
  const f = a.flags || {};
  const cards = [];
  cards.push(
    sysCard(
      "sys.card.app",
      [
        sysKv(t("sys.app.version"), escapeHtml(a.version || "—")),
        sysKv(t("sys.app.revision"), a.revision ? `<code>${escapeHtml(a.revision)}</code>` : "—"),
        sysKv(t("sys.app.mode"), escapeHtml(t(a.mode === "public" ? "sys.mode.public" : "sys.mode.local"))),
        sysKv(t("sys.app.node"), escapeHtml(a.node || "—")),
        sysKv(t("sys.app.uptime"), escapeHtml(fmtDuration(p.uptimeSec))),
        sysKv(t("sys.app.started"), escapeHtml(p.startedAt ? fmtDate(p.startedAt) : "—")),
      ].join(""),
    ),
  );
  cards.push(
    sysCard(
      "sys.card.flags",
      [
        sysKv(t("sys.flag.payments"), sysPill(f.payments)),
        sysKv(t("sys.flag.telegram"), sysPill(f.telegram)),
        sysKv(t("sys.flag.csp"), escapeHtml(t(`sys.csp.${f.csp || "report"}`))),
        sysKv(t("sys.flag.cap"), f.spendCapUsd == null ? escapeHtml(t("sys.off")) : escapeHtml(`$${f.spendCapUsd}`)),
        sysKv(t("sys.flag.platform"), sysPill(f.platform)),
      ].join(""),
    ),
  );
  const c = p.container;
  const memPct = c?.limitMb ? ((c.usedMb ?? p.rssMb) / c.limitMb) * 100 : null;
  cards.push(
    sysCard(
      "sys.card.mem",
      [
        sysKv(t("sys.mem.rss"), escapeHtml(`${fmtNum(p.rssMb)} ${t("sys.mb")}`)),
        sysKv(t("sys.mem.heap"), escapeHtml(`${fmtNum(p.heapUsedMb)} / ${fmtNum(p.heapTotalMb)} ${t("sys.mb")}`)),
        c
          ? sysKv(t("sys.mem.container"), escapeHtml(`${fmtNum(c.usedMb ?? p.rssMb)} / ${fmtNum(c.limitMb)} ${t("sys.mb")}`)) + sysBar(memPct)
          : sysKv(t("sys.mem.host"), escapeHtml(`${fmtNum(p.hostFreeMemMb)} / ${fmtNum(p.hostTotalMemMb)} ${t("sys.mb")}`)),
        sysKv(t("sys.mem.load"), escapeHtml((p.loadavg || []).join(" · ") || "—")),
        sysKv(t("sys.mem.cpus"), escapeHtml(fmtNum(p.cpus))),
      ].join(""),
    ),
  );
  const dt = j.data || {};
  cards.push(
    sysCard(
      "sys.card.disk",
      [
        d
          ? sysKv(t("sys.disk.used"), escapeHtml(`${fmtNum(d.usedPct)}% · ${t("sys.disk.free", { gb: fmtNum(d.freeGb), total: fmtNum(d.totalGb) })}`)) + sysBar(d.usedPct, 85, 93)
          : sysKv(t("sys.disk.used"), "—"),
        sysKv(t("sys.data.db"), dt.dbMb == null ? "—" : escapeHtml(`${fmtNum(dt.dbMb)} ${t("sys.mb")}`)),
        sysKv(t("sys.data.wal"), dt.walMb == null ? "—" : escapeHtml(`${fmtNum(dt.walMb)} ${t("sys.mb")}`)),
        sysKv(t("sys.data.wallets"), dt.wallets == null ? "—" : escapeHtml(fmtNum(dt.wallets))),
        sysKv(t("sys.data.tree"), dt.tree ? escapeHtml(`${fmtNum(dt.tree.mb)} ${t("sys.mb")} · ${t("sys.files", { n: fmtNum(dt.tree.files) })}${dt.tree.truncated ? " +" : ""}`) : "—"),
      ].join(""),
    ),
  );
  const bkBody = !bk.present
    ? `<p class="muted small">${escapeHtml(t("sys.backup.none"))}</p>`
    : [
        sysKv(t("sys.backup.last"), escapeHtml(`${fmtAgoMin(bk.ageMin)}${bk.at ? ` · ${fmtDate(bk.at)}` : ""}`)),
        sysKv(t("sys.backup.status"), `<span class="sys-pill ${bk.ok ? "ok" : "bad"}">${escapeHtml(t(bk.ok ? "sys.backup.ok" : "sys.backup.fail"))}</span>`),
        sysKv(t("sys.backup.kind"), escapeHtml(t(bk.kind === "hourly" ? "sys.backup.hourly" : "sys.backup.full"))),
        sysKv(t("sys.backup.copies"), escapeHtml(t("sys.backup.copiesVal", { h: bk.hourly, d: bk.daily, w: bk.weekly }))),
        sysKv(t("sys.backup.size"), bk.sizeMb == null ? "—" : escapeHtml(`${fmtNum(bk.sizeMb)} ${t("sys.mb")}`)),
        sysKv(t("sys.backup.offsite"), sysPill(bk.offsite, "sys.yes", "sys.no")),
      ].join("");
  cards.push(sysCard("sys.card.backup", bkBody));
  if (pl) {
    cards.push(
      sysCard(
        "sys.card.users",
        [
          sysKv(t("sys.users.total"), escapeHtml(fmtNum(pl.usersTotal))),
          sysKv(t("sys.users.new24"), escapeHtml(fmtNum(pl.users24h))),
          sysKv(t("sys.users.new7"), escapeHtml(fmtNum(pl.users7d))),
          sysKv(t("sys.users.pay24"), escapeHtml(fmtNum(pl.payments24h))),
          sysKv(t("sys.users.rev24"), pl.revenue24hUsd == null ? "—" : escapeHtml(`$${fmtNum(pl.revenue24hUsd)}`)),
          sysKv(t("sys.users.solPending"), escapeHtml(fmtNum(pl.solPending))),
          sysKv(t("sys.users.solPaid"), escapeHtml(fmtNum(pl.solPaid24h))),
        ].join(""),
      ),
    );
  }
  const bc = rq.byClass || {};
  cards.push(
    sysCard(
      "sys.card.req",
      [
        sysKv(t("sys.req.total"), escapeHtml(fmtNum(rq.total))),
        sysKv(t("sys.req.classes"), escapeHtml(`${fmtNum(bc["2xx"])} · ${fmtNum(bc["3xx"])} · ${fmtNum(bc["4xx"])} · ${fmtNum(bc["5xx"])}`)),
        sysKv(t("sys.req.p50"), escapeHtml(`${fmtNum(rq.p50)} ${t("sys.ms")}`)),
        sysKv(t("sys.req.p95"), escapeHtml(`${fmtNum(rq.p95)} ${t("sys.ms")}`)),
        sysKv(t("sys.req.rps"), escapeHtml(fmtNum(rq.rps5m))),
        sysKv(t("sys.req.errRate"), escapeHtml(`${fmtNum(Math.round((rq.errorRateRecent || 0) * 1000) / 10)}%`)),
        sysKv(t("sys.req.since"), escapeHtml(rq.since ? fmtDate(rq.since) : "—")),
      ].join(""),
    ),
  );
  cards.push(sysCard("sys.card.slow", sysRouteTable(rq.slowest), true));
  cards.push(sysCard("sys.card.busy", sysRouteTable(rq.busiest, true), true));
  const errs = rq.recentErrors || [];
  cards.push(
    sysCard(
      "sys.card.errors",
      errs.length
        ? errs.map((e) => sysKv(`${e.method} ${e.route}`, escapeHtml(`${e.status} · ${fmtDate(e.at)}`))).join("")
        : `<p class="muted small">${escapeHtml(t("sys.errors.none"))}</p>`,
    ),
  );
  const csp = j.csp || { total: 0, top: [] };
  cards.push(
    sysCard(
      "sys.card.csp",
      csp.top?.length
        ? csp.top.map((x) => sysKv(x.key, escapeHtml(fmtNum(x.count)))).join("")
        : `<p class="muted small">${escapeHtml(t("sys.csp.none"))}</p>`,
    ),
  );
  gridEl.innerHTML = cards.join("");
  const up = $("sys-updated");
  if (up) up.textContent = t("sys.updated", { time: new Date(j.generatedAt || Date.now()).toLocaleTimeString() });
}

let sysTimer = null;
export function stopSystemTimer() {
  if (sysTimer) {
    clearTimeout(sysTimer);
    sysTimer = null;
  }
}
export async function renderSystem() {
  stopSystemTimer();
  const up = $("sys-updated");
  try {
    renderSystemPayload(await api("/api/admin/system"));
  } catch (e) {
    if (up) up.textContent = e.message;
  }
  // Оновлюємо, лише поки вкладка «Система» відкрита й увімкнено «Авто».
  const visible = $("tab-admin")?.classList.contains("on") && $("admin-sys")?.classList.contains("on");
  if (visible && $("sys-auto")?.checked) sysTimer = setTimeout(renderSystem, 30000);
}

export function setupSystemPane() {
  $("sys-refresh")?.addEventListener("click", () => renderSystem());
  $("sys-auto")?.addEventListener("change", () => renderSystem());
}

export function applyAdminNav() {
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

export function setupHints() {
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

export function setupLang() {
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
  paintDeployCommands();
  renderSteps();
  renderFacts();
  renderCtorSummary();
  repaintWhoLines();
  paintOverviewStrength();
  renderTemplates();
  // Lists that were drawn once in the previous language: projects, base pictures, the account (credit history), the export notes.
  renderProjects();
  refreshBaseStatus();
  refreshAccount();
  repaintExportCopy();
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
  repaintPlan();
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
