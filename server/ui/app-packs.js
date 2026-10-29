/**
 * Trait packs (library → snapshot).
 * Moved out of app.js without a change in behaviour (docs/QUALITY-REVIEW.md, item 6). The module graph is circular on purpose:
 * every import is a function or a binding that is only used after all modules have loaded.
 */
import { applyTips, t } from "./i18n.js";
import { $, api, state, tipAttr } from "./app.js";
import { renderOptionsEditor, selectTraitKey } from "./app-options.js";
import { escapeHtml } from "./app-overview.js";

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

export async function loadTraitPacks() {
  const data = await api("/api/trait-packs");
  state.packs = data.packs || [];
  renderPacks();
  renderPackSummary();
  renderTraitChecklist();
  renderOptionsEditor();
}

export function renderPacks() {
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

export function renderPackSummary() {
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

export function renderTraitChecklist() {
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
