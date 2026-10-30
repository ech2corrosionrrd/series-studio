/**
 * Account: wallet, credits, top-up (public mode).
 * Moved out of app.js without a change in behaviour (docs/QUALITY-REVIEW.md, item 6). The module graph is circular on purpose:
 * every import is a function or a binding that is only used after all modules have loaded.
 */
import { fmtDate, fmtNum, fmtUsd as fmtUsdLocale } from "./format.js";
import { groupHistory, historyLabel } from "./history.js";
import { applyTips, hasKey, t, tipText } from "./i18n.js";
import { applyAdminNav } from "./app-admin.js";
import { $, api, showTab, state } from "./app.js";
import { setBusy } from "./app-export.js";
import { renderHelp, tList } from "./app-help.js";
import { escapeHtml } from "./app-overview.js";

/* ---------- Account (public mode: wallet, credits, top-up) ---------- */

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
  // Kontext and Stability have engine-specific advice from the live tests (docs/ENGINES.md); the others share their kind's note.
  if (engineId === "kontext" || engineId === "stability") return t(`strength.note.${engineId}`);
  return t(`strength.note.${kind}`);
}

export function paintStrengthNote(noteId, engineId) {
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
  const c = (mode === "txt" ? me.creditCostsTxt : me.creditCosts)?.[id];
  if (c === 0 || id === "mock") return `${base} · ${t("engine.free")}`;
  if (typeof c === "number" && c > 0) return `${base} · ${t("engine.perImage", { n: c })}`;
  return base;
}

export function relabelEngineSelects() {
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

export function paintWishPrompt() {
  const el = $("base-wish-prompt");
  if (!el) return;
  const wish = ($("base-wish")?.value || "").trim();
  const useRef = Boolean($("base-wish-ref")?.checked);
  el.textContent = useRef
    ? `${t("base.wish.promptEdit")}\n${wish}`
    : `${t("base.wish.promptTxt")}\n${t("base.wish.wrapPrefix")}${wish}`;
}

export function syncWishControls() {
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

export function renderLocalGpuPanel() {
  const box = $("local-gpu-panel");
  if (!box) return;
  const me = state.account;
  const gpu = me?.localGpu;
  const engine = $("g-engine")?.value || "";
  // Only the engines that need a local GPU explain it; cloud engines show nothing here.
  if (!gpu || (engine !== "comfyui" && engine !== "a1111")) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
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

export async function refreshAccount() {
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
  // A wallet below the minimum balance gets no welcome credits: say so, instead of a silent zero (BETA-REVIEW, economy review)
  const wn = $("welcome-note");
  if (wn) {
    const noGrant = me.welcome && !me.welcome.granted && me.welcome.requiresBalance && !me.admin && Number(me.balance) < 1;
    wn.hidden = !noGrant;
    if (noGrant) wn.textContent = t("acct.welcome.none", { sol: me.welcome.minSol, eth: me.welcome.minEth });
  }
  const topupBtn = $("acct-topup");
  if (topupBtn) topupBtn.setAttribute("aria-label", `${t("acct.topup")} · ${me.balance} ${t("acct.credits")}`);
}

export function renderTopup() {
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
      ? groupHistory(rows).map((tx) => {
        const label = historyLabel(tx, t, hasKey) + (tx.count > 1 ? ` ×${tx.count}` : "");
        return `<div class="hist-row"><span>${escapeHtml(fmtDate(tx.created_at))}</span><span title="${escapeHtml(label)}">${escapeHtml(label)}</span><b class="${tx.credits < 0 ? "bad" : "ok"}">${tx.credits > 0 ? "+" : ""}${fmtNum(tx.credits)}</b></div>`;
      })
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

export function showToast(text) {
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

/** Opens the top-up window; `needed`/`balance` explain why (refused generation). */
export function openTopup({ needed, balance } = {}) {
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
  // Власний збір (scripts/build-vendor.mjs), не стороння CDN: код на сторінці оплати.
  const mod = await import("./vendor/solana-tx.js");
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

export function setupAccount() {
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
