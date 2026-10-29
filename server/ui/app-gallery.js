/**
 * Gallery.
 * Moved out of app.js without a change in behaviour (docs/QUALITY-REVIEW.md, item 6). The module graph is circular on purpose:
 * every import is a function or a binding that is only used after all modules have loaded.
 */
import { fmtNum } from "./format.js";
import { applyTips, t } from "./i18n.js";
import { $, api, state, tipAttr } from "./app.js";
import { escapeHtml } from "./app-overview.js";
import { confirmTwice, deleteFrame, dropFrame, openLightbox, openVersions, renderAside, toggleMark } from "./app-versions.js";

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

export function syncCompareSelect() {
  const wrap = $("v-dir2-wrap");
  const sel2 = $("v-dir2");
  const sets = state.gallerySets || [];
  if (!wrap || !sel2) return;
  const canCompare = sets.length >= 2;
  wrap.hidden = !canCompare;
  if (!canCompare) {
    sel2.innerHTML = `<option value="">${escapeHtml(t("gallery.compare.none"))}</option>`;
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
  sel2.innerHTML = `<option value="">${escapeHtml(t("gallery.compare.none"))}</option>${opts}`;
  if (keep2 && keep2 !== primary && [...sel2.options].some((o) => o.value === keep2)) {
    sel2.value = keep2;
    state.galleryDir2 = keep2;
  } else {
    sel2.value = "";
    state.galleryDir2 = null;
    state.galleryImages2 = [];
  }
}

export async function loadGallerySets() {
  try {
    const data = await api("/api/sets");
    const sel = $("v-dir");
    if (!sel) return;
    const sets = data.sets || [];
    state.gallerySets = sets;
    const keep = state.galleryDir || sel.value;
    if (!sets.length) {
      sel.innerHTML = `<option value="">${escapeHtml(t("gallery.noSets"))}</option>`;
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

export async function loadGalleryDir2(dir2) {
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

/** Quality and triage results belong to one set: never show or apply them on another set. */
function resetSetScopedPanels() {
  state.galleryTriage = {};
  const out = $("v-quality-out");
  if (out) {
    out.hidden = true;
    out.innerHTML = "";
  }
  const status = $("v-triage-status");
  if (status) status.textContent = "";
  const applyBtn = $("v-triage-apply");
  if (applyBtn) applyBtn.style.display = "none";
}

export async function loadGalleryDir(dir) {
  // state.galleryDir is already the new value when the selector changes, so remember which set the panels belong to.
  if (dir !== state.panelsDir) {
    resetSetScopedPanels();
    state.panelsDir = dir;
  }
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
    renderAside();
    return;
  }
  try {
    const data = await api(`/api/set?dir=${encodeURIComponent(dir)}`);
    state.galleryDir = data.dir;
    state.galleryImages = data.images || [];
    state.galleryMarks = data.marks || {};
    state.galleryShelved = data.shelved || [];
    state.galleryLineage = data.lineage || null;
    paintLineage();
    await loadGalleryDir2($("v-dir2")?.value || state.galleryDir2);
    renderGallery();
  } catch (e) {
    if (empty) {
      empty.hidden = false;
      empty.textContent = e.message;
    }
    if (grid) grid.innerHTML = "";
  }
}

/** Where the open set came from: painted over another set, or a layers version of it exists (read from dna.json by the server). */
function paintLineage() {
  const el = $("v-lineage");
  if (!el) return;
  const lin = state.galleryLineage;
  const parts = [];
  if (lin?.derivedFrom) {
    parts.push(t("gallery.lineage.from", { set: lin.derivedFrom.set, painted: fmtNum(lin.derivedFrom.painted), count: fmtNum(lin.derivedFrom.count) }));
  }
  if (lin?.derived?.length) {
    parts.push(t("gallery.lineage.to", { sets: lin.derived.map((d) => d.set).join(", ") }));
  }
  el.textContent = parts.join(" ");
  el.hidden = parts.length === 0;
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

export function renderGallery() {
  const empty = $("v-empty");
  const grid = $("v-grid");
  if (!grid) return;
  const images = state.galleryImages || [];
  const images2 = state.galleryImages2 || [];
  const marks = state.galleryMarks || {};
  const redoBtn = $("v-quick-redo");
  if (redoBtn) {
    redoBtn.removeAttribute("data-i18n");
    redoBtn.textContent = t("gallery.redo.btn", { count: Object.values(marks).filter((v) => v === "redo").length });
  }
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
    tile.querySelector(".b-delete")?.addEventListener("click", (ev) => confirmTwice(ev.currentTarget, () => deleteFrame(row.edition)));
    grid.appendChild(tile);
  }
  if ($("v-stats")) $("v-stats").textContent = t("gallery.stats", { keep, redo, none });
  applyTips(grid);
  renderAside();
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
