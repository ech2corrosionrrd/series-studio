/**
 * Versions: re-renders never overwrite.
 * Moved out of app.js without a change in behaviour (docs/QUALITY-REVIEW.md, item 6). The module graph is circular on purpose:
 * every import is a function or a binding that is only used after all modules have loaded.
 */
import { fmtDate } from "./format.js";
import { applyTips, t } from "./i18n.js";
import { showToast } from "./app-account.js";
import { $, api, lockGenerate, showTab, state, tipAttr } from "./app.js";
import { scheduleWorkspaceSave } from "./app-export.js";
import { loadGalleryDir, loadGalleryDir2, loadGallerySets, renderGallery, syncCompareSelect } from "./app-gallery.js";
import { escapeHtml } from "./app-overview.js";

/* ---------- Versions (re-renders never overwrite) ---------- */
export async function openVersions(edition) {
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
    item.querySelector(".b-drop")?.addEventListener("click", (ev) => confirmTwice(ev.currentTarget, () => versionAction("/api/versions/drop", data.edition, v.v)));
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

export async function dropFrame(edition) {
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

/** Irreversible actions ask twice: the first click arms the button for a few seconds, the second one runs. */
export function confirmTwice(btn, run) {
  if (btn.dataset.armed) {
    delete btn.dataset.armed;
    return run();
  }
  btn.dataset.armed = "1";
  const label = btn.textContent;
  btn.textContent = t("common.deleteSure");
  setTimeout(() => {
    if (btn.dataset.armed) {
      delete btn.dataset.armed;
      btn.textContent = label;
    }
  }, 6000);
}

export async function deleteFrame(edition) {
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

export function renderAside() {
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
    item.querySelector(".b-delete").addEventListener("click", (ev) => confirmTwice(ev.currentTarget, () => deleteFrame(row.edition)));
    list.appendChild(item);
  }
  applyTips(list);
}

export function setupVersions() {
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
  } else if (data.baseUnusable) {
    parts.push(`<p class="warn-note"><b>${escapeHtml(t("gallery.quality.simSkipped"))}</b></p>`);
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
      showToast(e.message);
    }
  });
}

/** The verifier speaks English so the standalone script needs no locale files; show it in the UI language. */
export function provMessage(text) {
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

export function setupSizeTools() {
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
const AIMARK_KEY = "series-lab-aimark";

export function authorshipFromForm() {
  const a = {
    baseOrigin: $("x-auth-base")?.value || "",
    handEdited: Boolean($("x-auth-edited")?.checked),
    handLayers: Boolean($("x-auth-layers")?.checked),
    note: $("x-auth-note")?.value?.trim() || "",
  };
  return a.baseOrigin || a.handEdited || a.handLayers || a.note ? a : null;
}

export function setupAiMark() {
  const box = $("x-ai-mark");
  if (!box) return;
  try {
    if (localStorage.getItem(AIMARK_KEY) === "off") box.checked = false;
  } catch { /* default is on */ }
  box.addEventListener("change", () => {
    try {
      localStorage.setItem(AIMARK_KEY, box.checked ? "on" : "off");
    } catch { /* storage is optional */ }
  });
}

export function setupAuthorship() {
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

export function setupQuality() {
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

export async function toggleMark(edition, kind) {
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
    showToast(e.message);
  }
}

export function openLightbox(url) {
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

export function setupGallery() {
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
