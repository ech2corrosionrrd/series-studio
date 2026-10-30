/**
 * Recipes tab.
 * Moved out of app.js without a change in behaviour (docs/QUALITY-REVIEW.md, item 6). The module graph is circular on purpose:
 * every import is a function or a binding that is only used after all modules have loaded.
 */
import { fmtNum } from "./format.js";
import { applyTips, setMessage, t } from "./i18n.js";
import { showToast } from "./app-account.js";
import { $, api, lockGenerate, paintGenerateNotice, reloadStudio, rememberRev, setProjectsMsg, showTab, state, tipAttr } from "./app.js";
import { scheduleWorkspaceSave } from "./app-export.js";
import { refreshLayersStatus } from "./app-generate.js";
import { fillConstructor, fillOverview } from "./app-options.js";
import { escapeHtml, renderFacts, renderSteps } from "./app-overview.js";

/* ---------- Recipes ---------- */
function renderRarity(rarity, { open = false } = {}) {
  const box = $("r-rarity-table");
  if (!box) return;
  const card = $("r-rarity");
  if (!rarity?.traits?.length) {
    box.innerHTML = "";
    if (card) card.hidden = true;
    return;
  }
  // the card sits hidden in the page; a report that was drawn into it must also be shown (BETA-REVIEW R17)
  if (card) {
    card.hidden = false;
    if (open) card.open = true;
  }
  let html = `<table class="table"><caption class="visually-hidden">${escapeHtml(t("recipes.rarity.title"))}</caption><thead><tr>
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

export function renderRecipeTable() {
  const table = $("r-table");
  if (!table) return;
  const q = ($("r-search")?.value || "").toLowerCase();
  const line = $("r-line")?.value || "";
  let rows = state.recipes || [];
  if (line) rows = rows.filter((r) => r.line === line);
  if (q) rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
  if ($("r-count")) $("r-count").textContent = String(rows.length);
  const showWave = rows.some((r) => r.wave != null);
  table.innerHTML = `<caption class="visually-hidden">${escapeHtml(t("table.caption.recipes"))}</caption><thead><tr><th scope="col">#</th>${showWave ? `<th scope="col">${escapeHtml(t("waves.col"))}</th>` : ""}<th scope="col">${escapeHtml(t("recipes.col.line"))}</th><th scope="col">${escapeHtml(t("recipes.col.dna"))}</th><th scope="col"></th></tr></thead><tbody>` +
    rows.map((r) => `<tr data-i="${r.index}">
      <td>${r.edition}</td>${showWave ? `<td>${r.wave ?? ""}</td>` : ""}<td>${escapeHtml(r.line)}</td>
      <td class="mono small">${escapeHtml(r.dna || "")}</td>
      <td><button type="button" class="btn small" data-ed="${r.index}"${tipAttr("recipes.edit")}>${t("recipes.edit") || "Edit"}</button></td>
    </tr>`).join("") + "</tbody>";
  table.querySelectorAll("button[data-ed]").forEach((btn) => {
    btn.addEventListener("click", () => openRecipeEditor(Number(btn.dataset.ed)));
  });
  // The page says "click a row to see the full prompt": the whole row does that (the button stays for the keyboard).
  table.querySelectorAll("tbody tr[data-i]").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("button, a, input, select, textarea")) return;
      openRecipeEditor(Number(row.dataset.i));
    });
  });
  applyTips(table);
}

function openRecipeEditor(index) {
  const recipe = state.recipes.find((r) => r.index === index);
  if (!recipe) return;
  state.editingIndex = index;
  if ($("r-editor")) {
    $("r-editor").hidden = false;
    // The editor opens under a long table: bring it into view instead of leaving it off screen.
    $("r-editor").scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }
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

/**
 * One "current series": its archive file has the same name as its preset. The Recipes, Constructor and Export
 * selectors and state.archiveFile must always point at it, or "Compose layers" and the kits use a different series
 * than the one the user is looking at.
 */
export function syncActiveSeries(file) {
  if (!file) return;
  state.archiveFile = file;
  state.archiveOut = `out/${file}`;
  for (const id of ["x-file", "r-preset", "ctor-file"]) {
    const el = $(id);
    if (el && [...el.options].some((o) => o.value === file)) el.value = file;
  }
  updateJsonLink();
}

export async function loadRecipesArchive(file) {
  if (!file) return;
  const data = await api(`/api/recipes?file=${encodeURIComponent(file)}`);
  state.recipes = data.recipes || data.archive?.recipes || [];
  syncActiveSeries(file);
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

export async function loadArchives() {
  const data = await api("/api/archive/list");
  state.archives = data.archives || [];
  state.archivesLoaded = true;
  paintGenerateNotice();
  fillArchiveSelect();
  const sel = $("r-preset");
  if (sel && state.presets?.length) {
    /* keep */
  }
  refreshLayersStatus(); // coverage needs the archive: it is only known once the list is loaded
  return state.archives;
}

export function fillArchiveSelect() {
  const sel = $("x-file");
  if (!sel) return;
  const cur = sel.value;
  if (!state.archives.length) {
    sel.innerHTML = `<option value="">${escapeHtml(t("export.none"))}</option>`;
    updateJsonLink();
    return;
  }
  sel.innerHTML = state.archives
    .map((a) => `<option value="${escapeHtml(a.file)}">${escapeHtml(a.file)} (${a.size ?? "?"})</option>`)
    .join("");
  if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
  if (state.archiveFile && [...sel.options].some((o) => o.value === state.archiveFile)) sel.value = state.archiveFile;
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

export function updateJsonLink() {
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

export async function refreshWaves() {
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

export function setupRecipes() {
  $("r-preset")?.addEventListener("change", async () => {
    const file = $("r-preset").value;
    if (!file) return;
    // A project of its own: the server switches to its base image, layers and frame sets, and the studio restarts on it.
    if (state.assetsPerProject && state.projectFiles?.has(file) && file !== state.activeProject) {
      try {
        await api("/api/projects/open", { method: "POST", body: JSON.stringify({ file }) });
        reloadStudio();
      } catch (e) {
        setProjectsMsg(e.message, "small err-msg");
      }
      return;
    }
    // Choosing a series here switches the whole studio to it (Overview, Constructor), and the workspace remembers it.
    try {
      const data = await api(`/api/preset?file=${encodeURIComponent(file)}`);
      rememberRev(file, data.rev);
      fillConstructor(data.preset);
    } catch {
      /* the archive may exist without the preset file; the selectors still follow */
    }
    if (state.archives?.some((a) => a.file === file)) await loadRecipesArchive(file).catch(() => syncActiveSeries(file));
    else syncActiveSeries(file);
    scheduleWorkspaceSave();
  });
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
      showToast(e.message);
    }
  });
  $("r-simulate")?.addEventListener("click", async () => {
    const msg = $("r-simulate-msg");
    try {
      if (msg) msg.textContent = t("recipes.simulate.running");
      const file = $("r-preset")?.value;
      const data = await api("/api/simulate", { method: "POST", body: JSON.stringify({ file }) });
      if (data.rarity) renderRarity(data.rarity, { open: true });
      const bits = [t("recipes.simulate.done", { size: data.size, rejected: data.rejectedConflicts ?? 0 })];
      const pairs = (data.conflictExamples || []).map((h) => `${h.a} / ${h.b}`);
      if (pairs.length) bits.push(t("recipes.simulate.conflicts", { list: pairs.join("; ") }));
      if (msg) msg.textContent = bits.join(" ");
    } catch (e) {
      if (msg) msg.textContent = e.message;
    }
  });
  $("r-archive-collide")?.addEventListener("click", async () => {
    const msg = $("r-archive-diff-msg");
    const list = $("r-archive-diff-list");
    try {
      const a = $("r-diff-a")?.value;
      const b = $("r-diff-b")?.value;
      if (!a || !b) throw new Error(t("archive.diff.need"));
      const data = await api("/api/archive/collisions", { method: "POST", body: JSON.stringify({ a, b }) });
      if (msg) msg.textContent = data.collisionCount ? t("archive.collide.summary", { shared: fmtNum(data.shared), kinds: fmtNum(data.collisionCount), a: fmtNum(data.countA), b: fmtNum(data.countB) }) : "";
      if (list) {
        const nums = (arr) => arr.slice(0, 6).map((n) => `#${n}`).join(", ") + (arr.length > 6 ? " …" : "");
        const rows = data.collisions.slice(0, 20).map((c) =>
          `<div class="err-row"><b>${escapeHtml(nums(c.editionsA))}</b> ↔ <b>${escapeHtml(nums(c.editionsB))}</b> <span class="muted">${escapeHtml(Object.entries(c.traits).map(([k, v]) => `${k}: ${v}`).join(", "))}</span></div>`);
        list.innerHTML = rows.join("") || `<p class="muted">${escapeHtml(t("archive.collide.none"))}</p>`;
      }
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
      showToast(e.message);
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
      setMessage($("r-ed-msg"), { key: "recipes.saved" });
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
      setMessage($("r-ed-msg"), { key: "recipes.saved" });
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

export function licenseApplies() {
  const engine = $("g-engine")?.value || "";
  if (engine === "fal") return true;
  if ((engine === "comfyui" || engine === "a1111") && $("g-flux-dev")?.checked) return true;
  return false;
}

/**
 * A critical trait (layerOnly) is not drawn by the model, so without its layer file the frames come out without it.
 * Before a paid run the author sees which layers are missing and confirms, like the FLUX [dev] licence warning.
 */
export function criticalGateApplies() {
  return Number(state.criticalMissing) > 0 && !state.criticalAck && ($("g-engine")?.value || "") !== "mock";
}

export function paintCriticalGate() {
  const box = $("g-critical-gate");
  if (!box) return;
  box.hidden = !criticalGateApplies();
  const body = $("g-critical-gate-body");
  if (body && !box.hidden) body.textContent = t("critical.gate.body", { n: fmtNum(state.criticalMissing), list: state.criticalList || "" });
}

/**
 * Before a paid run: if the preset changed after the recipes were built, the prompts in the archive are no longer what the preset says,
 * and the frames would not match it. The server rebuilds the recipes and compares (`/api/archive/sync`); the author sees what differs and confirms.
 * A failed check never blocks the run.
 */
export async function syncGateCheck() {
  const box = $("g-sync-gate");
  if (!box || ($("g-engine")?.value || "") === "mock") return false;
  const file = state.archiveFile || $("x-file")?.value;
  if (!file) return false;
  let sync;
  try {
    sync = await api(`/api/archive/sync?${new URLSearchParams({ file })}`);
  } catch {
    box.hidden = true;
    return false;
  }
  if (sync.status !== "stale") {
    box.hidden = true;
    return false;
  }
  const signature = `${file}|${sync.dnaChanged}|${sync.promptChanged}|${sync.missing}|${sync.extra}`;
  if (state.syncAck === signature) {
    box.hidden = true;
    return false;
  }
  state.syncSignature = signature;
  const body = $("g-sync-gate-body");
  if (body) {
    body.textContent = t("sync.gate.body", {
      dna: fmtNum(sync.dnaChanged),
      prompt: fmtNum(sync.promptChanged),
      missing: fmtNum(sync.missing),
      extra: fmtNum(sync.extra),
      list: (sync.editions || []).join(", "),
    });
  }
  box.hidden = false;
  return true;
}

export function paintLicenseWarning() {
  const box = $("g-license");
  const wrap = $("g-flux-dev-wrap");
  const engine = $("g-engine")?.value || "";
  if (wrap) wrap.hidden = engine !== "comfyui" && engine !== "a1111";
  if (box) box.hidden = !licenseApplies();
}

/** Per-frame offset of the layers: shown for the frame in the preview, editable only when painting over a set (it is kept with the set). */
export function paintFrameOffset(offset, overSet) {
  if ($("g-frame-off-x")) $("g-frame-off-x").value = offset?.x ? String(offset.x) : "";
  if ($("g-frame-off-y")) $("g-frame-off-y").value = offset?.y ? String(offset.y) : "";
  if ($("g-frame-off-save")) $("g-frame-off-save").disabled = !overSet;
  const wrap = $("g-frame-offset-wrap");
  if (wrap) wrap.hidden = !overSet;
}
