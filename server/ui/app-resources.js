/**
 * Resources: provider balances and the recommended balance per provider.
 * Moved out of app.js without a change in behaviour (docs/QUALITY-REVIEW.md, item 6). The module graph is circular on purpose:
 * every import is a function or a binding that is only used after all modules have loaded.
 */
import { presentApiError } from "./api-errors.js";
import { fmtDate, fmtNum, fmtPct as fmtPctLocale, fmtUsd as fmtUsdLocale } from "./format.js";
import { applyTips, hasKey, t } from "./i18n.js";
import { $, api, state, tipAttr } from "./app.js";
import { stageLabel } from "./app-export.js";
import { escapeHtml } from "./app-overview.js";

/* ---------- Resources: recommended balance per provider ---------- */
/** Role text of a service (explicit keys so the i18n audit can see them). */
function resRole(id) {
  const roles = {
    openai: t("res.role.openai"),
    anthropic: t("res.role.anthropic"),
    stability: t("res.role.stability"),
    replicate: t("res.role.replicate"),
    fal: t("res.role.fal"),
    runware: t("res.role.runware"),
    pollinations: t("res.role.pollinations"),
    alchemy: t("res.role.alchemy"),
    solana: t("res.role.solana"),
    base: t("res.role.base"),
    irys: t("res.role.irys"),
    telegram: t("res.role.telegram"),
    localgpu: t("res.role.localgpu"),
  };
  return roles[id] || "";
}

async function renderResourcePlan({ probe = false } = {}) {
  const box = $("res-plan");
  if (!box) return;
  let plan;
  try {
    plan = await api(`/api/admin/resources/plan${probe ? "?probe=1" : ""}`);
  } catch (e) {
    box.innerHTML = `<p class="err-msg">${escapeHtml(e.message)}</p>`;
    return;
  }
  const badge = (label, cls) => `<span class="prov-badge ${cls}">${escapeHtml(label)}</span>`;
  const status = (p) => {
    if (p.status === "ok") return badge(t("res.plan.status.ok"), "on");
    if (p.status === "low") return badge(t("res.plan.status.low"), "off");
    if (p.status === "critical") return badge(t("res.plan.status.critical"), "fail");
    if (p.status === "unknown") return badge(t("res.plan.status.unknown"), "off");
    return badge(t("res.plan.status.off"), "off");
  };
  const alertCell = (p) => {
    const src = p.alert_source === "default" ? t("res.plan.alert.default") : p.alert_source === "custom" ? t("res.plan.alert.custom") : t("res.plan.alert.off");
    const hit = p.alert_triggered ? ` ${badge(t("res.plan.alert.hit"), "fail")}` : "";
    return `<input type="number" min="0" step="0.5" class="res-alert-input" data-provider="${escapeHtml(p.id)}" value="${p.alert_below_usd ?? ""}" placeholder="—" aria-label="${escapeHtml(t("res.plan.alertOf", { name: p.name }))}"> <button type="button" class="btn small res-alert-save" data-provider="${escapeHtml(p.id)}">${escapeHtml(t("res.plan.save"))}</button>${hit}<br><em class="muted small">${escapeHtml(src)}</em>`;
  };
  const noteCell = (id, note) =>
    `<input type="text" maxlength="300" class="res-note-input" data-provider="${escapeHtml(id)}" value="${escapeHtml(note || "")}" placeholder="${escapeHtml(t("res.note.ph"))}" aria-label="${escapeHtml(t("res.note.label", { name: id }))}"> <button type="button" class="btn small res-note-save" data-provider="${escapeHtml(id)}">${escapeHtml(t("res.plan.save"))}</button>`;
  const rows = plan.providers
    .map((p) => {
      const bal = p.balance_usd != null ? p.balance_usd : "";
      const srcNote = p.balance_source === "api"
        ? t("res.plan.src.api")
        : p.balance_source === "manual"
          ? (p.balance_stale ? t("res.plan.src.stale") : t("res.plan.src.manual"))
          : "";
      const trendTxt = p.trend > 1.05 ? `↑ ×${p.trend}` : p.trend < 0.95 ? `↓ ×${p.trend}` : "→";
      return `<tr>
        <td><a href="${escapeHtml(p.url)}" target="_blank" rel="noopener">${escapeHtml(p.name)}</a><br><em class="muted small">${escapeHtml(resRole(p.id))}</em>${p.low_data ? `<br><em class="muted small">${escapeHtml(t("res.plan.lowData"))}</em>` : ""}</td>
        <td class="num">${fmtUsd(p.spend_7d_usd)} / ${fmtUsd(p.spend_30d_usd)}<br><em class="muted small">${escapeHtml(t("res.plan.external", { usd: fmtUsd(p.spend_30d_external_usd) }))}</em></td>
        <td class="num">${fmtUsd(p.projected_per_day_usd)}<br><em class="muted small">${escapeHtml(trendTxt)}</em></td>
        <td class="num">${fmtUsd(p.reserve_usd)}</td>
        <td class="num"><b>${fmtUsd(p.recommended_usd, 0)}</b></td>
        <td class="num"><input type="number" min="0" step="1" class="res-plan-input" data-provider="${escapeHtml(p.id)}" value="${bal}" placeholder="—" aria-label="${escapeHtml(t("res.plan.balanceOf", { name: p.name }))}"> <button type="button" class="btn small res-plan-save" data-provider="${escapeHtml(p.id)}">${escapeHtml(t("res.plan.save"))}</button><br><em class="muted small">${escapeHtml(srcNote)}</em></td>
        <td class="num">${alertCell(p)}</td>
        <td class="num">${p.runway_days == null ? "—" : escapeHtml(t("res.plan.days", { n: Math.floor(p.runway_days) }))}</td>
        <td>${status(p)}</td>
        <td class="num">${p.top_up_usd > 0 ? `<b>${fmtUsd(p.top_up_usd, 0)}</b>` : "—"}</td>
        <td>${noteCell(p.id, p.note)}</td>
      </tr>`;
    })
    .join("");
  const infraRows = (plan.infra || [])
    .map((x) => {
      const state = x.status === "ok"
        ? badge(x.public_default ? t("res.infra.public") : t("res.infra.on"), "on")
        : badge(t("res.infra.off"), "off");
      const link = x.url ? `<a href="${escapeHtml(x.url)}" target="_blank" rel="noopener">${escapeHtml(x.name)}</a>` : escapeHtml(x.name);
      return `<tr>
        <td>${link}</td>
        <td>${escapeHtml(resRole(x.id))}</td>
        <td>${state}</td>
        <td>${noteCell(x.id, x.note)}</td>
      </tr>`;
    })
    .join("");
  box.innerHTML = `<table class="econ-table res-plan-table"><caption class="visually-hidden">${escapeHtml(t("res.plan.caption"))}</caption><thead><tr>
      <th>${escapeHtml(t("res.plan.col.provider"))}</th>
      <th class="num">${escapeHtml(t("res.plan.col.spend"))}</th>
      <th class="num">${escapeHtml(t("res.plan.col.perDay"))}</th>
      <th class="num">${escapeHtml(t("res.plan.col.reserve"))}</th>
      <th class="num">${escapeHtml(t("res.plan.col.rec"))}</th>
      <th class="num">${escapeHtml(t("res.plan.col.balance"))}</th>
      <th class="num">${escapeHtml(t("res.plan.col.alert"))}</th>
      <th class="num">${escapeHtml(t("res.plan.col.runway"))}</th>
      <th>${escapeHtml(t("res.plan.col.status"))}</th>
      <th class="num">${escapeHtml(t("res.plan.col.topup"))}</th>
      <th>${escapeHtml(t("res.plan.col.note"))}</th>
    </tr></thead><tbody>${rows || `<tr><td colspan="11" class="muted">${escapeHtml(t("res.plan.empty"))}</td></tr>`}</tbody></table>
    <p class="econ-note">${escapeHtml(t("res.plan.total", { rec: fmtUsd(plan.totals.recommended_usd, 0), topup: fmtUsd(plan.totals.top_up_usd, 0), unknown: plan.totals.unknown_balances }))}</p>
    <p class="econ-note">${escapeHtml(t("res.plan.method", { days: plan.settings.cover_days, share: Math.round(plan.settings.liability_share * 100), min: plan.settings.min_usd, credits: fmtNum(plan.outstanding_credits) }))}</p>
    <p class="econ-note">${escapeHtml(t("res.plan.alertNote"))}</p>
    <h4 class="econ-sub">${escapeHtml(t("res.infra.h4"))}</h4>
    <table class="econ-table res-plan-table"><caption class="visually-hidden">${escapeHtml(t("res.infra.h4"))}</caption><thead><tr>
      <th>${escapeHtml(t("res.infra.col.service"))}</th>
      <th>${escapeHtml(t("res.infra.col.role"))}</th>
      <th>${escapeHtml(t("res.infra.col.state"))}</th>
      <th>${escapeHtml(t("res.plan.col.note"))}</th>
    </tr></thead><tbody>${infraRows}</tbody></table>
    <p class="econ-note">${escapeHtml(t("res.infra.hint"))}</p>`;
  const post = async (btn, path, payload) => {
    btn.disabled = true;
    try {
      await api(path, { method: "POST", body: JSON.stringify(payload) });
      await renderResourcePlan();
    } catch (e) {
      box.insertAdjacentHTML("beforeend", `<p class="err-msg">${escapeHtml(e.message)}</p>`);
      btn.disabled = false;
    }
  };
  const val = (cls, id) => String(box.querySelector(`.${cls}[data-provider="${id}"]`)?.value ?? "").trim();
  box.querySelectorAll(".res-plan-save").forEach((btn) =>
    btn.addEventListener("click", () => {
      const raw = val("res-plan-input", btn.dataset.provider);
      post(btn, "/api/admin/resources/balance", { provider: btn.dataset.provider, balance_usd: raw === "" ? null : Number(raw) });
    }));
  box.querySelectorAll(".res-alert-save").forEach((btn) =>
    btn.addEventListener("click", () => {
      const raw = val("res-alert-input", btn.dataset.provider);
      post(btn, "/api/admin/resources/alert", { provider: btn.dataset.provider, below_usd: raw === "" ? null : Number(raw) });
    }));
  box.querySelectorAll(".res-note-save").forEach((btn) =>
    btn.addEventListener("click", () => post(btn, "/api/admin/resources/note", { provider: btn.dataset.provider, note: val("res-note-input", btn.dataset.provider) })));
}

/* ---------- Resources ---------- */
export async function renderResources({ probe = false } = {}) {
  // Operator data: a normal wallet would only collect 403s in the console (found by the browser test).
  if (state.account && !state.account.admin) return;
  renderResourcePlan({ probe });
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

export function setupResources() {
  $("res-probe")?.addEventListener("click", () => renderResources({ probe: true }));
  $("res-plan-refresh")?.addEventListener("click", () => renderResourcePlan({ probe: true }));
  $("res-telegram")?.addEventListener("click", (e) => {
    if (e.target?.id === "res-tg-test") testTelegramNotify();
  });
}

export async function renderSpend() {
  const out = $("spend-out");
  if (!out) return;
  if (state.account && !state.account.admin) return;
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

function econKpi(label, value, { sub = "", cls = "" } = {}) {
  return `<div class="econ-kpi${cls ? ` ${cls}` : ""}"><span>${escapeHtml(label)}</span><b>${value}</b>${sub ? `<em>${escapeHtml(sub)}</em>` : ""}</div>`;
}

function fmtUsd(n, digits = 2) {
  return fmtUsdLocale(n, digits);
}

function fmtPct(n) {
  return fmtPctLocale(n);
}

export async function renderEconomy() {
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
    const fe = d.funnel_30d_external || {};
    const ft = d.funnel_total_external || {};
    const dr = d.decision_rule || {};
    const ruleStatus = dr.status === "met" ? t("econ.rule.status.met") : dr.status === "failed" ? t("econ.rule.status.failed") : t("econ.rule.status.active");
    // One row of funnel KPIs: sign-up → welcome (granted / refused for good) → opened payment → paid → repeat.
    const funnelRow = (x, title) => `<h5 class="econ-sub">${escapeHtml(title)}</h5><div class="econ-kpis">
          ${econKpi(t("econ.funnel.new"), x.new_users ?? "—")}
          ${econKpi(t("econ.funnel.granted"), x.welcome_granted_wallets ?? "—")}
          ${econKpi(t("econ.funnel.denied"), x.welcome_denied_lost_wallets ?? "—", { sub: t("econ.funnel.deniedSub", { n: x.welcome_denied_wallets ?? 0 }) })}
          ${econKpi(t("econ.funnel.started"), x.pay_started_wallets ?? "—")}
          ${econKpi(t("econ.funnel.paying"), x.paying_wallets ?? "—", { sub: fmtPct(x.conversion_started_to_paid_pct) })}
          ${econKpi(t("econ.funnel.repeat"), x.repeat_paying_wallets ?? "—")}
          ${econKpi(t("econ.funnel.projectGate"), x.project_gate_wallets ?? "—", { sub: t("econ.funnel.projectGateSub", { n: x.project_paid_wallets ?? 0, pct: fmtPct(x.conversion_project_gate_to_paid_pct) }) })}
          ${econKpi(t("econ.funnel.export"), x.exported_wallets ?? "—", { sub: fmtPct(x.conversion_generate_to_export_pct) })}
        </div>`;

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
          ${econKpi(t("econ.kpi.netExt"), fmtUsd(n.net_profit_external_usd), { cls: n.net_profit_external_usd >= 0 ? "ok" : "warn", sub: t("econ.netExtSub", { rev: fmtUsd(n.revenue_usd_external) }) })}
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
          <table class="econ-table"><caption class="visually-hidden">${escapeHtml(t("econ.caption.costs"))}</caption>
            <thead><tr><th>${escapeHtml(t("econ.col.engine"))}</th><th class="num">${escapeHtml(t("econ.col.ops"))}</th><th class="num">${escapeHtml(t("econ.col.spent"))}</th><th class="num">${escapeHtml(t("econ.col.api"))}</th></tr></thead>
            <tbody>${costRows}</tbody>
          </table>
        </div>
        <h4 style="margin-top:14px">${escapeHtml(t("econ.stages"))}</h4>
        <p class="econ-note">${escapeHtml(t("econ.stageHint"))} · ${escapeHtml(d.stages?.usd_per_credit_basis || "")} ${escapeHtml(t("econ.perCr", { usd: fmtUsd(d.stages?.usd_per_credit, 4) }))}</p>
        <div class="table-wrap">
          <table class="econ-table"><caption class="visually-hidden">${escapeHtml(t("econ.stages"))}</caption>
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
          have: be.payments_this_month_external ?? 0,
          pct: be.covered_pct_external != null ? `${be.covered_pct_external}%` : "—",
          all: be.payments_this_month ?? 0,
          allPct: be.covered_pct != null ? `${be.covered_pct}%` : "—",
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
          <table class="econ-table"><caption class="visually-hidden">${escapeHtml(t("econ.scenarios"))}</caption>
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
          <table class="econ-table"><caption class="visually-hidden">${escapeHtml(t("econ.tariff"))}</caption>
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
          <table class="econ-table"><caption class="visually-hidden">${escapeHtml(t("econ.engines"))}</caption>
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
        <h4>${escapeHtml(t("econ.rule"))} · ${escapeHtml(ruleStatus)}</h4>
        <div class="econ-kpis">
          ${econKpi(t("econ.rule.payers"), `${dr.external_payers ?? "—"} / ${dr.target_payers ?? "—"}`, { cls: (dr.external_payers ?? 0) >= (dr.target_payers ?? 1) ? "ok" : "warn" })}
          ${econKpi(t("econ.rule.repeat"), `${dr.external_repeat_payers ?? "—"} / ${dr.target_repeat ?? "—"}`, { cls: (dr.external_repeat_payers ?? 0) >= (dr.target_repeat ?? 0) ? "ok" : "warn" })}
          ${econKpi(t("econ.rule.revenue"), fmtUsd(dr.external_revenue_usd))}
          ${econKpi(t("econ.rule.days"), `${dr.days_left ?? "—"}`, { sub: t("econ.rule.window", { start: dr.start ?? "—", end: dr.end ?? "—" }) })}
        </div>
        <p class="econ-note">${escapeHtml(t("econ.rule.note"))}</p>
      </section>
      <section class="econ-section">
        <h4>${escapeHtml(t("econ.funnel"))}</h4>
        ${funnelRow(f, t("econ.funnel.all30"))}
        ${funnelRow(fe, t("econ.funnel.ext30"))}
        ${funnelRow(ft, t("econ.funnel.extTotal"))}
        <p class="econ-note">${escapeHtml(t("econ.funnel.note"))}</p>
      </section>`;
  } catch (e) {
    out.innerHTML = `<p class="err-msg">${escapeHtml(t("econ.fail", { err: e.message }))}</p>`;
  }
}

export function setupEconomy() {
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

export function setupEngineDiagnostics() {
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
