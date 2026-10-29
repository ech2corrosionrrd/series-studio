/**
 * Options editor (series snapshot only).
 * Moved out of app.js without a change in behaviour (docs/QUALITY-REVIEW.md, item 6). The module graph is circular on purpose:
 * every import is a function or a binding that is only used after all modules have loaded.
 */
import { t } from "./i18n.js";
import { paintStrengthNote, refreshAccount } from "./app-account.js";
import { $, api, reloadStudio, rememberRev, renderProjects, saveRevField, showTab, state, tipAttr } from "./app.js";
import { scheduleWorkspaceSave } from "./app-export.js";
import { escapeHtml, loadPresets, renderCtorSummary, renderFacts, renderSteps } from "./app-overview.js";
import { loadTraitPacks, renderPackSummary, renderTraitChecklist } from "./app-packs.js";

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

/**
 * The option fields the editor does not own (`layer`, `backdrop`, whatever a preset or a CSV carries) must survive
 * an edit of weight or prompt; `normalizeOptionClient` rebuilds only the fields it knows.
 */
const OPTION_OWN_FIELDS = new Set(["value", "weight", "prompt", "exact", "lines", "since"]);
function optionExtras(raw) {
  return Object.fromEntries(Object.entries(raw && typeof raw === "object" ? raw : {}).filter(([k]) => !OPTION_OWN_FIELDS.has(k)));
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

export function ensureDraftTraits() {
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

export function selectTraitKey(key) {
  state.selectedTraitKey = key || null;
  renderTraitChecklist();
  renderOptionsEditor();
}

export function renderOptionsEditor() {
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
  const layerOnly = $("opt-layer-only");
  if (layerOnly) layerOnly.checked = trait.layerOnly === true;
  const layerAlign = $("opt-layer-align");
  if (layerAlign) layerAlign.checked = trait.layerAlign === true;
  for (const axis of ["x", "y"]) {
    const el = $(`opt-offset-${axis}`);
    const v = Number(trait.layerOffset?.[axis]);
    if (el) el.value = Number.isFinite(v) && v !== 0 ? String(Math.round(v)) : "";
  }
  const zInput = $("opt-z");
  if (zInput) zInput.value = Number.isFinite(Number(trait.z)) && trait.z !== "" && trait.z != null ? String(trait.z) : "";
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
      <td><input type="text" data-field="value" data-idx="${idx}" value="${escapeHtml(o.value)}" autocomplete="off" aria-label="${escapeHtml(`${t("ctor.options.colValue")} ${idx + 1}`)}"></td>
      <td class="opt-weight-cell">
        <input class="opt-weight" type="number" min="0.01" step="any" data-field="weight" data-idx="${idx}" value="${escapeHtml(String(o.weight))}" aria-label="${escapeHtml(`${t("ctor.options.colWeight")}: ${o.value}`)}">
        <span class="opt-pct" data-idx="${idx}">${escapeHtml(t("ctor.options.pct", { pct: optionPct(o.weight, trait.options) }))}</span>
      </td>
      <td><input class="opt-exact" type="number" min="0" step="1" data-field="exact" data-idx="${idx}" value="${o.exact == null ? "" : escapeHtml(String(o.exact))}" aria-label="${escapeHtml(`${t("ctor.options.colExact")}: ${o.value}`)}"></td>
      <td>
        <textarea data-field="prompt" data-idx="${idx}" rows="2" aria-label="${escapeHtml(`${t("ctor.options.colPrompt")}: ${o.value}`)}">${escapeHtml(o.prompt)}</textarea>
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
  const cur = { ...optionExtras(trait.options[idx]), ...normalizeOptionClient(trait.options[idx]) };
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
  $("opt-layer-only")?.addEventListener("change", () => {
    ensureDraftTraits();
    const trait = findTrait(state.selectedTraitKey);
    if (!trait) return;
    if ($("opt-layer-only")?.checked) trait.layerOnly = true;
    else delete trait.layerOnly;
    if (state.draftFull) state.draftFull.traits = state.draftTraits;
  });
  $("opt-layer-align")?.addEventListener("change", () => {
    ensureDraftTraits();
    const trait = findTrait(state.selectedTraitKey);
    if (!trait) return;
    if ($("opt-layer-align")?.checked) trait.layerAlign = true;
    else delete trait.layerAlign;
    if (state.draftFull) state.draftFull.traits = state.draftTraits;
  });
  for (const axis of ["x", "y"]) {
    $(`opt-offset-${axis}`)?.addEventListener("input", () => {
      ensureDraftTraits();
      const trait = findTrait(state.selectedTraitKey);
      if (!trait) return;
      const num = (a) => {
        const n = Math.round(Number($(`opt-offset-${a}`)?.value));
        return Number.isFinite(n) ? n : 0;
      };
      const next = { x: num("x"), y: num("y") };
      if (next.x === 0 && next.y === 0) delete trait.layerOffset;
      else trait.layerOffset = next;
      if (state.draftFull) state.draftFull.traits = state.draftTraits;
    });
  }
  $("opt-z")?.addEventListener("input", () => {
    ensureDraftTraits();
    const trait = findTrait(state.selectedTraitKey);
    if (!trait) return;
    const raw = String($("opt-z")?.value ?? "").trim();
    if (raw !== "" && Number.isFinite(Number(raw))) trait.z = Number(raw);
    else delete trait.z;
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
      trait.options[idx] = { ...optionExtras(trait.options[idx]), ...normalizeOptionClient(trait.options[idx]), weight: Number.isFinite(n) ? n : 0 };
      if (state.draftFull) state.draftFull.traits = state.draftTraits;
      refreshWeightPcts();
      return;
    }
    // live-update draft without full re-render (keep caret)
    ensureDraftTraits();
    const trait = findTrait(state.selectedTraitKey);
    const idx = Number(el.dataset.idx);
    if (!trait?.options?.[idx]) return;
    trait.options[idx] = { ...optionExtras(trait.options[idx]), ...normalizeOptionClient(trait.options[idx]), prompt: el.value };
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

export function fillOverview(preset) {
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
  paintOverviewStrength();
}

function syncOverviewFromCtor() {
  if (!$("o-id") || !$("c-id")) return;
  $("o-id").value = $("c-id").value;
  $("o-name").value = $("c-name").value;
  $("o-seed").value = $("c-seed").value;
  $("o-size").value = $("c-size").value;
  $("o-engine").value = $("c-engine").value;
  $("o-strength").value = $("c-strength").value;
  paintOverviewStrength();
}

export function syncCtorFromOverview() {
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

/**
 * The engine and the reference strength saved with the series are the defaults of the Generate tab. They used to be
 * separate controls that never met, so a value picked on Overview did nothing on Generate.
 */
function applyGenerateDefaults(engine, strength) {
  const ge = $("g-engine");
  if (ge && engine && ge.value !== engine && [...ge.options].some((o) => o.value === engine)) {
    ge.value = engine;
    ge.dispatchEvent(new Event("change"));
  }
  const gs = $("g-strength");
  if (gs && strength != null && strength !== "" && Number.isFinite(Number(strength))) {
    gs.value = String(strength);
    if ($("g-strength-v")) $("g-strength-v").textContent = String(gs.value);
    gs.dispatchEvent(new Event("input"));
  }
}

/** The Constructor form as last loaded or saved: "Далі · Рецепти" saves only when it differs (the recipes read the file on disk). */
let ctorSnapshot = null;
function ctorSnap() {
  try {
    return JSON.stringify(readConstructor());
  } catch {
    return null;
  }
}
function ctorUnsaved() {
  const id = ($("c-id")?.value || "").trim();
  if (!id) return false;
  if (!state.presets?.some((p) => p.file === `${id}.json`)) return true; // never saved: there is nothing to build from
  return ctorSnapshot !== null && ctorSnap() !== ctorSnapshot;
}

export function fillConstructor(preset) {
  $("c-id").value = preset.id || "";
  $("c-name").value = preset.name || "";
  $("c-seed").value = preset.seed || "";
  $("c-size").value = preset.size || 1;
  const eng = preset.engine?.default || "kontext";
  $("c-engine").value = eng;
  const str = Number(preset.engine?.strength ?? 0.45);
  $("c-strength").value = str;
  $("c-strength-v").textContent = String(str);
  if (state.generateDefaultsFor !== preset.id) {
    state.generateDefaultsFor = preset.id; // once per series: later edits on Generate are not overwritten
    applyGenerateDefaults(eng, str);
  }
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
  ctorSnapshot = ctorSnap();
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

export function fillStyleLock(lock) {
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

/**
 * The product default of the reference strength; the same number as DEFAULT_STRENGTH in src/reference.mjs (a test pins them).
 * A saved or chosen preset brings its own value, so the Overview slider can honestly show 0.35; the note says that is the preset's choice.
 */
const DEFAULT_STRENGTH = 0.45;

function paintOverviewStrength() {
  const slider = $("o-strength");
  if (!slider) return;
  const value = Number(slider.value);
  if ($("o-strength-v")) $("o-strength-v").textContent = String(slider.value);
  const note = $("o-strength-default");
  if (note) {
    const differs = Number.isFinite(value) && Math.abs(value - DEFAULT_STRENGTH) > 1e-9;
    note.hidden = !differs;
    note.textContent = differs ? t("home.strength.default", { value: String(DEFAULT_STRENGTH) }) : "";
  }
}

export function setupOverview() {
  if (!$("o-name")) return;
  $("o-strength").addEventListener("input", () => {
    paintOverviewStrength();
    syncCtorFromOverview();
    applyGenerateDefaults(null, $("o-strength").value);
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
  $("o-engine")?.addEventListener("change", () => {
    paintStrengthNote("o-strength-note", $("o-engine").value);
    applyGenerateDefaults($("o-engine").value, null);
  });
  paintStrengthNote("o-strength-note", $("o-engine")?.value);
  paintOverviewStrength();
  async function saveOverviewPreset() {
    syncCtorFromOverview();
    const name = $("o-name").value.trim();
    const id = $("o-id").value.trim() || slugifyId(name);
    if (!id && !name) throw new Error(t("home.msg.need"));
    if (!$("o-id").value.trim()) $("o-id").value = id;
    syncCtorFromOverview();
    const preset = readConstructor();
    if (!preset.id) throw new Error(t("home.msg.need"));
    const confirmCharge = state.projectConfirm === preset.id;
    const overwrite = state.projectOverwrite === preset.id;
    const file = `${preset.id}.json`;
    // Saving the file that is loaded in the editor is an edit; any other taken name needs an explicit overwrite.
    const editing = $("ctor-file")?.value === file ? file : null;
    let data;
    try {
      data = await api("/api/preset/save", {
        method: "POST",
        body: JSON.stringify({
          preset,
          ...(confirmCharge ? { confirmCharge: true } : {}),
          ...(overwrite ? { overwrite: true } : {}),
          ...(editing ? { editing } : {}),
          ...saveRevField(file),
        }),
      });
    } catch (e) {
      if (e.payload?.code === "project_exists") {
        state.projectOverwrite = preset.id;
        throw new Error(t("projects.exists", { name: preset.id }));
      }
      if (e.payload?.code === "project_stale") {
        state.projectOverwrite = preset.id;
        throw new Error(t("projects.stale", { name: preset.id }));
      }
      // A new project beyond the free ones costs credits: ask once, charge only on the second, explicit click.
      if (e.payload?.code === "project_charge") {
        state.projectConfirm = preset.id;
        throw new Error(t("projects.confirm", { cost: e.payload.cost, used: e.payload.used, free: e.payload.free }));
      }
      throw e;
    }
    state.projectConfirm = null;
    state.projectOverwrite = null;
    rememberRev(data.file, data.rev);
    ctorSnapshot = ctorSnap();
    const charged = data.project?.charged ? ` ${t("projects.charged", { n: data.project.charged })}` : "";
    $("o-msg").textContent = `${t("home.msg.saved")}: ${data.file}${charged}`;
    $("o-msg").className = "small ok-msg";
    if (data.project?.charged) refreshAccount();
    await loadPresets();
    if (data.file) {
      if ($("ctor-file")) $("ctor-file").value = data.file;
      if ($("r-preset")) $("r-preset").value = data.file;
      state.archiveFile = state.archives?.some((a) => a.file === data.file) ? data.file : null;
    }
    renderFacts();
    renderCtorSummary();
    renderSteps();
    scheduleWorkspaceSave();
    renderProjects();
    if (data.project?.new && state.assetsPerProject) {
      // the new project is now the active one: its (empty) base, layers and sets replace the previous project's on screen
      reloadStudio({ msg: `${t("home.msg.saved")}: ${data.file}${charged}`, tab: state.afterSaveTab || "" });
    }
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
      state.afterSaveTab = "base";
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
      const spinKey = `spin:${file}`;
      let data;
      try {
        data = await api("/api/preset/spinoff", { method: "POST", body: JSON.stringify({ file, ...(state.projectConfirm === spinKey ? { confirmCharge: true } : {}) }) });
      } catch (e) {
        if (e.payload?.code === "project_charge") {
          state.projectConfirm = spinKey;
          throw new Error(t("projects.confirm", { cost: e.payload.cost, used: e.payload.used, free: e.payload.free }));
        }
        throw e;
      }
      state.projectConfirm = null;
      if (data.project?.charged) refreshAccount();
      if (state.assetsPerProject) {
        reloadStudio({ msg: t("home.spin.done", { file: data.file }), tab: "base" });
        return;
      }
      await loadPresets();
      renderProjects();
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

export function setupConstructor() {
  $("ctor-goto-home")?.addEventListener("click", () => showTab("home"));
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
      rememberRev(file, data.rev);
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
  /** Validate and save the Constructor form as the preset. Throws with a readable message when it cannot. */
  async function saveCtorPreset() {
    const preset = readConstructor();
    if (!preset.id) throw new Error(t("ctor.msg.needId"));
    const items = preset.traits?.items || [];
    for (const trait of items) {
      const v = validateOptionsClient(trait.options || []);
      if (!v.ok) throw new Error(`${trait.key}: ${v.errors.join("; ")}`);
    }
    const file = `${preset.id}.json`;
    const overwrite = state.projectOverwrite === preset.id;
    const editing = $("ctor-file")?.value === file ? file : null;
    let data;
    try {
      data = await api("/api/preset/save", {
        method: "POST",
        body: JSON.stringify({ preset, ...(overwrite ? { overwrite: true } : {}), ...(editing ? { editing } : {}), ...saveRevField(file) }),
      });
    } catch (e) {
      const code = e.payload?.code;
      if (code === "project_exists" || code === "project_stale") {
        state.projectOverwrite = preset.id;
        throw new Error(t(code === "project_stale" ? "projects.stale" : "projects.exists", { name: preset.id }));
      }
      throw e;
    }
    state.projectOverwrite = null;
    rememberRev(data.file, data.rev);
    ctorSnapshot = ctorSnap();
    $("ctor-msg").textContent = `${t("ctor.msg.saved")}: ${data.file}`;
    $("ctor-msg").className = "small ok-msg";
    await loadPresets();
    if ($("r-preset")) $("r-preset").value = data.file;
    if ($("ctor-file")) $("ctor-file").value = data.file;
    renderFacts();
    renderSteps();
    scheduleWorkspaceSave();
    return data;
  }
  $("ctor-save")?.addEventListener("click", async () => {
    try {
      await saveCtorPreset();
    } catch (e) {
      $("ctor-msg").textContent = e.message;
      $("ctor-msg").className = "small err-msg";
    }
  });
  $("ctor-next")?.addEventListener("click", async () => {
    syncCtorFromOverview();
    if (ctorUnsaved()) {
      // the recipes are built from the saved file: save the edits first instead of silently dropping them
      try {
        await saveCtorPreset();
      } catch (e) {
        $("ctor-msg").textContent = e.payload?.code === "project_charge" ? t("ctor.next.needSave") : e.message;
        $("ctor-msg").className = "small err-msg";
        return;
      }
    }
    showTab("recipes");
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
