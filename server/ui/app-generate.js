/**
 * Render / Generate.
 * Moved out of app.js without a change in behaviour (docs/QUALITY-REVIEW.md, item 6). The module graph is circular on purpose:
 * every import is a function or a binding that is only used after all modules have loaded.
 */
import { fmtNum } from "./format.js";
import { presentApiError } from "./api-errors.js";
import { getLocale, t } from "./i18n.js";
import { parseSseBuffer, settleGenerateStream } from "./render-stream.js";
import { formatPlan } from "./plan-text.js";
import { paintStrengthNote, refreshAccount, renderLocalGpuPanel } from "./app-account.js";
import { $, api, lockGenerate, playCompletionChime, showTab, state } from "./app.js";
import { kitArchive, scheduleWorkspaceSave, setBusy } from "./app-export.js";
import { loadGallerySets } from "./app-gallery.js";
import { ensureDraftTraits, paintGenerateEcho, renderOptionsEditor } from "./app-options.js";
import { escapeHtml, renderCtorSummary } from "./app-overview.js";
import { renderTraitChecklist } from "./app-packs.js";
import { criticalGateApplies, licenseApplies, paintCriticalGate, paintFrameOffset, paintLicenseWarning, syncGateCheck } from "./app-recipes.js";

/* ---------- Render / Generate ---------- */
let renderAbort = null;

function setRenderStop(on) {
  const stop = $("g-stop");
  if (!stop) return;
  stop.hidden = !on;
  stop.disabled = !on;
}

function paintGenerateEvent(ev, ui) {
  const { progressBar, progressPct, progressText, thumbs } = ui;
  if (ev.type === "start") {
    if (progressText) progressText.textContent = `${fmtNum(0)} / ${fmtNum(ev.total)}`;
  } else if (ev.type === "progress") {
    const total = Number(ev.total) || 0;
    const pct = total > 0 ? Math.round((ev.completed / total) * 100) : 0;
    if (progressBar) progressBar.style.width = `${pct}%`;
    if (progressPct) progressPct.textContent = `${pct}%`;
    if (progressText) progressText.textContent = `${fmtNum(ev.completed)} / ${fmtNum(total)}`;
    if (ev.result?.url && thumbs) {
      const a = document.createElement("a");
      a.href = ev.result.url;
      a.target = "_blank";
      a.innerHTML = `<img src="${ev.result.url}" alt="#${ev.result.edition}" />`;
      thumbs.appendChild(a);
    }
  } else if (ev.type === "error" && progressText) {
    progressText.textContent = String(ev.error || t("render.streamEnded"));
  }
}

async function applyGenerateOutcome(settled, ui) {
  const { progressBar, progressPct, progressText } = ui;
  if (!settled || settled.state === "stopped") {
    if (progressText) progressText.textContent = t("render.stoppedByUser");
    return;
  }
  if (settled.state === "empty") {
    if (progressText) progressText.textContent = t("render.nothing");
    if (progressBar) progressBar.style.width = "100%";
    if (progressPct) progressPct.textContent = "100%";
    return;
  }
  if (settled.state === "error") {
    const msg = settled.message || t(settled.messageKey || "render.streamEnded");
    if (progressText) progressText.textContent = msg;
    return;
  }
  if (settled.state !== "done" || !settled.payload) {
    if (progressText) progressText.textContent = t("render.streamEnded");
    return;
  }
  const lastDone = settled.payload;
  if (Number(lastDone.count) > 0) playCompletionChime();
  if ("Notification" in window && Notification.permission === "granted" && Number(lastDone.count) > 0) {
    new Notification(t("render.notify.title"), {
      body: t("render.notify.body", { count: fmtNum(lastDone.count), set: lastDone.set }),
    });
  }
  if (lastDone.set) {
    state.lastSet = lastDone.set;
    scheduleWorkspaceSave({ lastSet: lastDone.set });
    await loadGallerySets();
    const over = $("g-compose-over");
    if (over) delete over.dataset.picked;
    await fillComposeOver(state.hasLayers ? lastDone.set : "");
  }
  if (progressText) progressText.textContent = t("render.done", { n: lastDone.count, set: lastDone.set }) || `Done: ${lastDone.count}`;
  refreshAccount();
  if (progressText && state.hasLayers && lastDone.set && Number(lastDone.count) > 0) {
    progressText.textContent += ` · ${t("render.layers.afterGen")}`;
  }
  if (progressText && lastDone.stopped) {
    if (lastDone.stopped === "stopped") {
      progressText.textContent = t("render.stoppedByUser");
    } else {
      progressText.textContent += ` · ⛔ ${t("render.stopped", { reason: lastDone.stopped, skipped: lastDone.skipped })}`;
    }
  }
  if (progressBar) progressBar.style.width = "100%";
  if (progressPct) progressPct.textContent = "100%";
}

const mbText = (bytes) => fmtNum(Math.round((Number(bytes) || 0) / 104857.6) / 10);

function renderLayersStatus(st, el = $("g-layers-status")) {
  if (!el) return;
  el.textContent = "";
  const line = (text, cls = "") => {
    const d = document.createElement("div");
    if (cls) d.className = cls;
    d.textContent = text;
    el.appendChild(d);
  };
  if (el.id === "g-layers-status") state.hasLayers = Boolean(st?.exists && st.files > 0);
  const critical = (st?.coverage?.criticalMissingCount) || 0;
  if (el.id === "g-layers-status") {
    if (critical !== state.criticalMissing) state.criticalAck = false;
    state.criticalMissing = critical;
    state.criticalList = (st?.coverage?.criticalMissing || []).slice(0, 6).join(", ");
    paintCriticalGate();
  }
  const criticalLine = () => {
    if (critical > 0) line(t("render.layers.criticalMissing", { n: fmtNum(critical), list: st.coverage.criticalMissing.slice(0, 6).join(", ") }), "warn");
  };
  if (!st?.exists) {
    line(t("render.layers.empty"), "muted");
    criticalLine();
    return;
  }
  line(t("render.layers.status", { files: fmtNum(st.files), keys: fmtNum(st.keys?.length || 0), mb: mbText(st.bytes) }));
  const cov = st.coverage;
  if (cov) {
    line(t("render.layers.coverage", { present: fmtNum(cov.present), expected: fmtNum(cov.expected) }), cov.missingCount > 0 ? "warn" : "ok");
    if (cov.missingCount > 0) {
      const shown = cov.missing.slice(0, 6).join(", ");
      const more = cov.missingCount > 6 ? ` … +${fmtNum(cov.missingCount - 6)}` : "";
      line(t("render.layers.missing", { list: shown, more }), "muted");
    }
  }
  criticalLine();
}

/** Constructor, step 2: do the uploaded PNG layers cover the saved series? (shown once a series is saved) */
export async function refreshCtorLayers() {
  const box = $("ctor-layers-status");
  if (!box) return;
  const file = $("ctor-file")?.value || "";
  try {
    const st = await api(`/api/layers/status${file ? `?preset=${encodeURIComponent(file)}` : ""}`);
    if (!st?.exists) {
      box.textContent = t("ctor.layers.none");
      box.className = "muted u-mt-4";
      return;
    }
    box.className = "u-mt-4";
    renderLayersStatus(st, box);
  } catch {
    box.textContent = "";
  }
}

export async function refreshLayersStatus() {
  if (!$("g-layers-status")) return;
  try {
    const archive = kitArchive();
    const st = await api(`/api/layers/status${archive ? `?archive=${encodeURIComponent(archive)}` : ""}`);
    renderLayersStatus(st);
  } catch (e) {
    $("g-layers-status").textContent = e.message;
  }
}

/**
 * The ZIP uploader for the PNG layers. It exists twice with the same behaviour: on Generate (g-layers-*) and in the
 * Constructor (ctor-layers-*), where the author sees the coverage of the series right after the upload.
 * @param {{ pick: string, file: string, upload: string, picked: string, replace: string, clear: string, msg: string }} ids
 * @param {{ query: () => Record<string, string>, onChange: (data: any) => void }} hooks
 */
function bindLayersUploader(ids, { query, onChange }) {
  const file = $(ids.file);
  const upload = $(ids.upload);
  const picked = $(ids.picked);
  if (!file || !upload) return;
  const say = (text) => {
    if ($(ids.msg)) $(ids.msg).textContent = text;
  };
  const sync = () => {
    const f = file.files?.[0];
    upload.disabled = !f;
    if (picked) picked.textContent = f ? t("render.layers.picked", { name: f.name, mb: mbText(f.size) }) : "";
  };
  $(ids.pick)?.addEventListener("click", () => file.click());
  file.addEventListener("change", sync);
  upload.addEventListener("click", async () => {
    const f = file.files?.[0];
    if (!f) {
      say(t("render.layers.pickFirst"));
      return;
    }
    try {
      setBusy(upload, true);
      say(t("ui.working"));
      const qs = new URLSearchParams(query());
      if ($(ids.replace)?.checked) qs.set("clear", "1");
      const q = qs.toString();
      const data = await api(`/api/layers/upload${q ? `?${q}` : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/zip", "Accept-Language": getLocale() },
        body: f,
      });
      const skipped = data.skipped?.length ? t("render.layers.skipped", { n: fmtNum(data.skipped.length) }) : "";
      say(t("render.layers.uploaded", { files: fmtNum(data.files), mb: mbText(data.bytes), skipped }));
      file.value = "";
      sync();
      onChange(data);
    } catch (e) {
      say(e.message);
    } finally {
      setBusy(upload, false);
      sync();
    }
  });
  $(ids.clear)?.addEventListener("click", async () => {
    try {
      const data = await api("/api/layers/clear", { method: "POST", body: "{}" });
      say(t("render.layers.cleared", { n: fmtNum(data.removed) }));
      onChange(data);
    } catch (e) {
      say(e.message);
    }
  });
}

/**
 * "Риси з шарів" and the CSV sheet in the Constructor: the server merges them into the table that is in the editor
 * (nothing is removed) and sends the result back; the author reviews it and saves the preset as usual.
 */
function setupTraitsImport() {
  const say = (text, cls = "") => {
    const el = $("ctor-traits-import-msg");
    if (!el) return;
    el.textContent = text;
    el.className = `small ${cls}`.trim();
  };
  const apply = (res) => {
    const draft = ensureDraftTraits();
    draft.items = res.items;
    if (state.draftFull) state.draftFull.traits = draft;
    renderTraitChecklist();
    renderOptionsEditor();
    renderCtorSummary();
  };
  // the server names the first bad CSV row; the rest are only counted
  const problem = (e) => (Number(e?.payload?.errorCount) > 1 ? `${e.message} (+${fmtNum(e.payload.errorCount - 1)})` : e.message);
  $("ctor-traits-from-layers")?.addEventListener("click", async () => {
    const btn = $("ctor-traits-from-layers");
    try {
      setBusy(btn, true);
      const res = await api("/api/traits/from-layers", { method: "POST", body: JSON.stringify({ items: ensureDraftTraits().items, replace: document.body.dataset.seriesMode === "layers" }) });
      apply(res);
      const ok = t("ctor.import.layersOk", { traits: fmtNum(res.traitsAdded), options: fmtNum(res.optionsAdded), skipped: fmtNum(res.skippedCount || 0) });
      const removed = res.traitsRemoved || res.optionsRemoved ? ` ${t("ctor.import.layersRemoved", { traits: fmtNum(res.traitsRemoved || 0), options: fmtNum(res.optionsRemoved || 0) })}` : "";
      const bare = res.withoutLayersCount ? ` ${t("ctor.import.layersBare", { n: fmtNum(res.withoutLayersCount), list: (res.withoutLayers || []).slice(0, 5).join(", ") })}` : "";
      say(ok + removed + bare, bare ? "warn" : "ok");
    } catch (e) {
      say(problem(e), "warn");
    } finally {
      setBusy(btn, false);
    }
  });
  $("ctor-traits-csv-export")?.addEventListener("click", async () => {
    try {
      const items = ensureDraftTraits().items;
      if (!items.length) {
        say(t("ctor.import.noTraits"), "warn");
        return;
      }
      const res = await api("/api/traits/to-csv", { method: "POST", body: JSON.stringify({ items }) });
      const url = URL.createObjectURL(new Blob([res.csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${$("ctor-file")?.value?.replace(/\.json$/i, "") || "traits"}-traits.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      say(t("ctor.import.csvSaved"), "ok");
    } catch (e) {
      say(problem(e), "warn");
    }
  });
  $("ctor-traits-csv-import")?.addEventListener("click", () => $("ctor-traits-csv-file")?.click());
  $("ctor-traits-csv-file")?.addEventListener("change", async (ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    try {
      const csv = await file.text();
      const res = await api("/api/traits/from-csv", { method: "POST", body: JSON.stringify({ csv, items: ensureDraftTraits().items }) });
      apply(res);
      say(t("ctor.import.csvOk", { traits: fmtNum(res.traitsAdded), options: fmtNum(res.optionsAdded), updated: fmtNum(res.optionsUpdated) }), "ok");
    } catch (e) {
      say(problem(e), "warn");
    }
  });
}

function setupLayersUpload() {
  $("x-file")?.addEventListener("change", refreshLayersStatus);
  bindLayersUploader(
    { pick: "g-layers-pick", file: "g-layers-file", upload: "g-layers-upload", picked: "g-layers-picked", replace: "g-layers-replace", clear: "g-layers-clear", msg: "g-compose-msg" },
    {
      query: () => (kitArchive() ? { archive: kitArchive() } : {}),
      onChange: (data) => {
        if (data?.status) {
          renderLayersStatus(data.status);
          fillComposeOver();
        } else refreshLayersStatus().then(() => fillComposeOver());
        refreshCtorLayers();
      },
    },
  );
  // the same ZIP can be uploaded from the Constructor, against the saved preset
  bindLayersUploader(
    { pick: "ctor-layers-pick", file: "ctor-layers-file", upload: "ctor-layers-upload", picked: "ctor-layers-picked", replace: "ctor-layers-replace", clear: "ctor-layers-clear", msg: "ctor-layers-msg" },
    {
      query: () => ($("ctor-file")?.value ? { preset: $("ctor-file").value } : {}),
      onChange: () => {
        refreshCtorLayers();
        refreshLayersStatus();
      },
    },
  );
}

/**
 * Список наборів для гібридного накладання шарів («база» або кадри вже згенерованого набору).
 * Гібрид типовий, коли шари завантажені: без власного вибору автора береться найновіший набір кадрів ШІ
 * (або `prefer` одразу після генерації).
 */
async function fillComposeOver(prefer = "") {
  const sel = $("g-compose-over");
  if (!sel) return;
  const keep = prefer || sel.value;
  try {
    const data = await api("/api/sets");
    const sets = (data.sets || []).filter((x) => !String(x.dir).endsWith("-layers") && x.dir !== "layers");
    sel.innerHTML = [`<option value="">${escapeHtml(t("render.layers.overBase"))}</option>`]
      .concat(sets.map((x) => `<option value="${escapeHtml(x.dir)}">${escapeHtml(t("render.layers.overSet", { dir: x.dir, count: x.count }))}</option>`))
      .join("");
    if (keep && [...sel.options].some((o) => o.value === keep)) sel.value = keep;
    else if (!keep && !sel.dataset.picked && state.hasLayers && sets.length) sel.value = sets[0].dir;
  } catch {
    sel.innerHTML = `<option value="">${escapeHtml(t("render.layers.overBase"))}</option>`;
  }
}

export function setupRender() {
  setupLayersUpload();
  setupTraitsImport();
  fillComposeOver();
  $("g-compose-over")?.addEventListener("change", (e) => {
    e.target.dataset.picked = "1";
  });
  let composeAbort = null;
  let composeProgress = null;
  $("g-compose-stop")?.addEventListener("click", () => composeAbort?.abort());
  $("g-compose")?.addEventListener("click", async () => {
    const msg = $("g-compose-msg");
    const btn = $("g-compose");
    const stopBtn = $("g-compose-stop");
    try {
      const archive = kitArchive();
      if (!archive) throw new Error(t("export.none"));
      setBusy(btn, true);
      if (stopBtn) stopBtn.hidden = false;
      if (msg) msg.textContent = t("ui.working");
      const over = $("g-compose-over")?.value || "";
      composeAbort = new AbortController();
      let last = null;
      composeProgress = () => last;
      // A series of a thousand frames takes minutes: the server streams its progress and the Stop button closes the stream.
      const data = await streamCompose({ archive, ...(over ? { over } : {}) }, composeAbort.signal, (p) => {
        last = p;
        if (msg) msg.textContent = t("render.layers.progress", { done: fmtNum(p.done), total: fmtNum(p.total) });
      });
      if (msg) {
        msg.textContent = data.stopped
          ? t("render.layers.stopped", { done: fmtNum(data.count), total: fmtNum(data.total), dir: data.dir })
          : data.mode === "overlay"
            ? t("render.layers.okOver", { count: data.count, painted: data.painted, left: data.unpainted, dir: data.dir })
            : t("render.layers.ok", { count: data.count, dir: data.dir });
      }
      if (data.mode === "overlay") fillComposeOver();
    } catch (e) {
      if (msg) {
        // Stopped by the button: the server keeps the frames composed so far; say how many we saw it finish.
        const seen = composeProgress?.();
        const over = $("g-compose-over")?.value || "";
        msg.textContent = e.name === "AbortError" && seen
          ? t("render.layers.stopped", { done: fmtNum(seen.done), total: fmtNum(seen.total), dir: over ? `out/${over}-layers` : "out/layers" })
          : e.name === "AbortError" ? t("render.layers.stoppedShort") : e.message;
      }
    } finally {
      composeAbort = null;
      if (stopBtn) stopBtn.hidden = true;
      setBusy(btn, false);
    }
  });
  $("g-frame-off-save")?.addEventListener("click", async () => {
    const msg = $("g-frame-off-msg");
    const set = $("g-compose-over")?.value || "";
    const edition = Number($("g-compose-preview-n")?.value);
    try {
      if (!set || !Number.isInteger(edition) || edition < 1) throw new Error(t("render.layers.previewBad"));
      if (msg) msg.textContent = t("ui.working");
      const x = Math.round(Number($("g-frame-off-x")?.value) || 0);
      const y = Math.round(Number($("g-frame-off-y")?.value) || 0);
      await api("/api/layers/frame-offset", { method: "POST", body: JSON.stringify({ set, edition, x, y }) });
      if (msg) msg.textContent = t("render.layers.frameOffsetSaved", { n: String(edition) });
      $("g-compose-preview")?.click();
    } catch (e) {
      if (msg) msg.textContent = e.message;
    }
  });
  const hybridSeen = new Set();
  function paintHybridSeen() {
    for (const n of ["1", "2", "3"]) {
      const btn = document.querySelector(`[data-preview-n="${n}"]`);
      if (btn) btn.setAttribute("aria-pressed", hybridSeen.has(n) ? "true" : "false");
    }
    const done = $("g-hybrid-preview-done");
    if (!done) return;
    const left = ["1", "2", "3"].filter((n) => !hybridSeen.has(n));
    done.textContent = left.length ? t("render.hybridLeft", { n: left.join(", ") }) : t("render.hybridDone");
  }
  document.querySelectorAll("[data-preview-n]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = $("g-compose-preview-n");
      if (input) input.value = btn.dataset.previewN || "1";
      $("g-compose-preview")?.click();
    });
  });
  window.addEventListener("series-lab:locale", () => {
    if (hybridSeen.size) paintHybridSeen();
  });
  $("g-compose-preview")?.addEventListener("click", async () => {
    const msg = $("g-compose-preview-msg");
    const img = $("g-compose-preview-img");
    const btn = $("g-compose-preview");
    try {
      const archive = kitArchive();
      if (!archive) throw new Error(t("export.none"));
      const n = Number($("g-compose-preview-n")?.value);
      if (!Number.isInteger(n) || n < 1) throw new Error(t("render.layers.previewBad"));
      setBusy(btn, true);
      if (msg) msg.textContent = t("ui.working");
      const over = $("g-compose-over")?.value || "";
      const data = await api("/api/compose", {
        method: "POST",
        body: JSON.stringify({ archive, preview: n, ...(over ? { over } : {}) }),
      });
      if (img) {
        img.src = data.png;
        img.alt = t("render.layers.previewAlt", { n: data.edition });
        img.hidden = false;
      }
      paintFrameOffset(data.over ? data.frameOffset : null, Boolean(data.over));
      if ([1, 2, 3].includes(Number(data.edition))) {
        hybridSeen.add(String(data.edition));
        paintHybridSeen();
      }
      if (msg) {
        msg.textContent = t("render.layers.previewOk", { n: data.edition, painted: data.layers.length, left: data.skipped.length });
        if (data.align?.skipped) msg.textContent += ` ${t("render.layers.alignSkipped", { reason: t(`render.layers.alignWhy.${data.align.skipped}`) })}`;
        else if (data.align) msg.textContent += ` ${t("render.layers.alignOk", { dx: String(data.align.dx), dy: String(data.align.dy), scale: String(data.align.scale) })}`;
      }
    } catch (e) {
      if (img) img.hidden = true;
      if (msg) msg.textContent = e.message;
    } finally {
      setBusy(btn, false);
    }
  });
  const reLockPlan = () => lockGenerate(true);
  $("g-strength")?.addEventListener("input", () => {
    if ($("g-strength-v")) $("g-strength-v").textContent = $("g-strength").value;
    paintGenerateEcho();
    reLockPlan();
  });
  $("g-engine")?.addEventListener("change", () => {
    reLockPlan();
    renderLocalGpuPanel();
    state.licenseAck = false;
    paintStrengthNote("g-strength-note", $("g-engine")?.value);
    paintLicenseWarning();
    paintGenerateEcho();
  });
  $("g-flux-dev")?.addEventListener("change", () => {
    state.licenseAck = false;
    paintLicenseWarning();
  });
  $("g-engine")?.addEventListener("change", paintCriticalGate);
  $("g-critical-proceed")?.addEventListener("click", () => {
    state.criticalAck = true;
    paintCriticalGate();
    $("g-run")?.click();
  });
  $("g-sync-proceed")?.addEventListener("click", () => {
    state.syncAck = state.syncSignature;
    if ($("g-sync-gate")) $("g-sync-gate").hidden = true;
    $("g-run")?.click();
  });
  $("g-license-proceed")?.addEventListener("click", () => {
    state.licenseAck = true;
    $("g-run")?.click();
  });
  paintStrengthNote("g-strength-note", $("g-engine")?.value);
  paintLicenseWarning();
  $("g-pilot")?.addEventListener("input", () => {
    $("g-pilot").dataset.touched = "1";
    paintPilotButton();
    reLockPlan();
  });
  paintPilotDefault();
  $("g-first")?.addEventListener("input", reLockPlan);
  $("g-only")?.addEventListener("input", reLockPlan);
  $("g-force")?.addEventListener("change", reLockPlan);
  document.querySelectorAll('input[name="g-sel"]').forEach((el) => {
    el.addEventListener("change", reLockPlan);
  });
  $("g-pilots")?.addEventListener("click", () => {
    const radio = document.querySelector('input[name="g-sel"][value="pilot"]');
    if (radio) radio.checked = true;
    paintPilotDefault();
    $("g-estimate")?.click();
  });
  $("g-estimate")?.addEventListener("click", async () => {
    try {
      const data = await api("/api/estimate", {
        method: "POST",
        body: JSON.stringify({
          file: state.archiveFile || $("x-file")?.value,
          engine: $("g-engine")?.value,
          strength: Number($("g-strength")?.value),
          mode: document.querySelector('input[name="g-sel"]:checked')?.value || "pilot",
          pilot: Number($("g-pilot")?.value),
          first: Number($("g-first")?.value),
          only: $("g-only")?.value,
          force: Boolean($("g-force")?.checked),
        }),
      });
      if ($("g-plan-out")) {
        $("g-plan-out").dataset.dirty = "1";
        state.lastPlan = data;
        $("g-plan-out").textContent = formatPlan(data, t) || data.text || JSON.stringify(data, null, 2);
      }
      lockGenerate(false);
    } catch (e) {
      if ($("g-plan-out")) $("g-plan-out").textContent = e.message;
      lockGenerate(true);
    }
  });
  $("g-stop")?.addEventListener("click", () => {
    renderAbort?.abort();
  });
  $("g-run")?.addEventListener("click", async () => {
    const progressWrap = $("g-progress-wrap");
    const progressBar = $("g-progress-bar");
    const progressText = $("g-progress-text");
    const progressPct = $("g-progress-pct");
    const thumbs = $("g-thumbs");
    const ui = { progressBar, progressPct, progressText, thumbs };

    try {
      if (licenseApplies() && !state.licenseAck) {
        paintLicenseWarning();
        return;
      }
      if (criticalGateApplies()) {
        paintCriticalGate();
        return;
      }
      if (await syncGateCheck()) return;
      renderAbort?.abort();
      renderAbort = new AbortController();
      const signal = renderAbort.signal;
      $("g-run").disabled = true;
      setRenderStop(true);
      if (progressWrap) progressWrap.hidden = false;
      if (progressBar) progressBar.style.width = "0%";
      if (progressPct) progressPct.textContent = "0%";
      if (progressText) progressText.textContent = t("render.working");
      if ($("g-result")) $("g-result").hidden = false;
      if (thumbs) thumbs.innerHTML = "";

      const payload = {
        file: state.archiveFile || $("x-file")?.value,
        engine: $("g-engine")?.value,
        strength: Number($("g-strength")?.value),
        mode: document.querySelector('input[name="g-sel"]:checked')?.value || "pilot",
        pilot: Number($("g-pilot")?.value),
        first: Number($("g-first")?.value),
        only: $("g-only")?.value,
        force: Boolean($("g-force")?.checked),
        concurrency: Number($("g-concurrency")?.value || 2),
        stream: true,
        ackLicense: Boolean(state.licenseAck),
        fluxDevWeights: Boolean($("g-flux-dev")?.checked),
      };

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(payload),
        signal,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || errJson.errors || `HTTP ${res.status}`);
      }

      const ctype = res.headers.get("content-type") || "";
      if (!ctype.includes("text/event-stream")) {
        const bodyText = await res.text();
        await applyGenerateOutcome(settleGenerateStream({ contentType: ctype, bodyText }), ui);
        return;
      }

      if (progressText) progressText.textContent = t("render.streaming");
      if (!res.body) {
        await applyGenerateOutcome(settleGenerateStream({ contentType: ctype, events: [] }), ui);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      const events = [];
      let zeroTotal = false;

      while (!zeroTotal) {
        const { value, done } = await reader.read();
        if (done) break;
        const parsed = parseSseBuffer(buffer + decoder.decode(value, { stream: true }));
        buffer = parsed.rest;
        for (const ev of parsed.events) {
          events.push(ev);
          paintGenerateEvent(ev, ui);
          if (ev.type === "start" && Number(ev.total) === 0) {
            zeroTotal = true;
            try { await reader.cancel(); } catch { /* already closed */ }
            break;
          }
        }
      }

      if (signal.aborted) {
        if (progressText) progressText.textContent = t("render.stoppedByUser");
        return;
      }
      await applyGenerateOutcome(settleGenerateStream({ contentType: ctype, events }), ui);
    } catch (e) {
      if (e.name === "AbortError") {
        if (progressText) progressText.textContent = t("render.stoppedByUser");
      } else if (progressText) {
        progressText.textContent = e.message;
      }
    } finally {
      setRenderStop(false);
      renderAbort = null;
      // Plan may be stale after a run — require Estimate again.
      lockGenerate(true);
    }
  });
  $("g-open-gallery")?.addEventListener("click", () => showTab("gallery"));
}

/** A pilot is a few frames to look at before the whole series (the page says 3–5): never more than the series has. */
export function defaultPilot() {
  const size = Number($("o-size")?.value) || 0;
  return size > 0 ? Math.min(5, size) : 5;
}

/** The pilot field follows the series size until the author types a number of their own. */
export function paintPilotDefault() {
  const input = $("g-pilot");
  if (input && !input.dataset.touched) input.value = String(defaultPilot());
  paintPilotButton();
}

/** "Pilot (N) — estimate": the label shows the number that the estimate will use. */
export function paintPilotButton() {
  const btn = $("g-pilots");
  if (btn) btn.textContent = t("render.pilots", { n: Number($("g-pilot")?.value) || defaultPilot() });
}

/** After a language switch the plan that was drawn is written again, in the new language. */
export function repaintPlan() {
  const out = $("g-plan-out");
  if (out?.dataset.dirty && state.lastPlan) out.textContent = formatPlan(state.lastPlan, t) || state.lastPlan.text || out.textContent;
  paintPilotButton();
}

/**
 * POST /api/compose as a live stream: `onProgress({done, total})` for every frame, the final `done` event as the result.
 * Stopping (the signal) closes the connection; the server then stops between frames and keeps what it composed.
 */
async function streamCompose(body, signal, onProgress) {
  const res = await fetch("/api/compose", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(presentApiError({ ...json, status: res.status }, t) || `HTTP ${res.status}`);
  }
  if (!String(res.headers.get("content-type") || "").includes("text/event-stream")) return res.json();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseBuffer(buffer);
    buffer = parsed.rest;
    for (const ev of parsed.events) {
      if (ev.type === "progress") onProgress(ev);
      else if (ev.type === "done") result = ev;
      else if (ev.type === "error") throw new Error(presentApiError({ error: ev.error, code: ev.code }, t));
    }
  }
  if (!result) throw new Error(t("api.generic"));
  return result;
}
