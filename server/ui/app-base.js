/**
 * Base image screen.
 * Moved out of app.js without a change in behaviour (docs/QUALITY-REVIEW.md, item 6). The module graph is circular on purpose:
 * every import is a function or a binding that is only used after all modules have loaded.
 */
import { thumbUrl } from "./format.js";
import { applyTips, t } from "./i18n.js";
import { paintWishPrompt, relabelEngineSelects, syncWishControls } from "./app-account.js";
import { $, api, showTab, state, tipAttr } from "./app.js";
import { ensureDraftTraits, fillStyleLock, renderOptionsEditor } from "./app-options.js";
import { escapeHtml, renderFacts, renderSteps } from "./app-overview.js";
import { renderPackSummary, renderTraitChecklist } from "./app-packs.js";

/* ---------- Base ---------- */
function fileToB64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = String(fr.result || "");
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    fr.onerror = () => reject(fr.error || new Error("read failed"));
    fr.readAsDataURL(file);
  });
}

/** Soft readiness line next to "Далі · Конструктор": is a primary base picture set? (it never blocks the step) */
function paintBasePrimaryStatus(files) {
  const el = $("base-primary-status");
  if (!el) return;
  const primary = (files || []).find((f) => f.primary);
  el.textContent = primary ? t("base.primary.ok", { file: primary.file }) : t("base.primary.missing");
  el.className = primary ? "small ok-msg" : "small warn";
}

function renderBaseGallery(files) {
  paintBasePrimaryStatus(files);
  const grid = $("base-gallery");
  if (!grid) return;
  grid.innerHTML = "";
  if (!files?.length) {
    grid.innerHTML = `<p class="muted small">${escapeHtml(t("base.gallery.empty"))}</p>`;
    return;
  }
  for (const f of files) {
    const tile = document.createElement("div");
    tile.className = `base-tile${f.primary ? " primary" : ""}`;
    const roleLabel = t(`base.role.${f.role}`) || f.role;
    tile.innerHTML = `
      <img loading="lazy" decoding="async" src="${thumbUrl(`/input/${encodeURIComponent(f.file)}?t=${Date.now()}`, 256)}" alt="">
      <div class="meta"><b>${escapeHtml(f.file)}</b> ${escapeHtml(roleLabel)}${f.line ? ` · ${escapeHtml(f.line)}` : ""}</div>
      <div class="btns">
        ${f.primary ? "" : `<button type="button" class="btn small" data-act="primary" data-file="${escapeHtml(f.file)}"${tipAttr("base.setPrimary")}>${t("base.setPrimary")}</button>`}
        <button type="button" class="btn small" data-act="del" data-file="${escapeHtml(f.file)}"${tipAttr("base.delete")}>${t("base.delete")}</button>
      </div>`;
    tile.querySelector('[data-act="primary"]')?.addEventListener("click", async () => {
      await api("/api/base/primary", { method: "POST", body: JSON.stringify({ file: f.file }) });
      await refreshBaseStatus();
    });
    tile.querySelector('[data-act="del"]')?.addEventListener("click", async () => {
      await api("/api/base/delete", { method: "POST", body: JSON.stringify({ file: f.file }) });
      await refreshBaseStatus();
    });
    grid.appendChild(tile);
  }
  applyTips(grid);
}

export async function refreshBaseStatus() {
  try {
    const data = await api("/api/base/list");
    state.baseFiles = data.files || [];
    renderBaseGallery(state.baseFiles);
    const linesEl = $("base-lines");
    if (linesEl) {
      const lines = state.baseFiles.filter((f) => f.role === "line");
      linesEl.textContent = lines.length
        ? `${t("base.lines")}: ${lines.map((f) => f.line || f.file).join(", ")}`
        : "";
    }
    if (state.health) {
      state.health.base = {
        exists: state.baseFiles.some((f) => f.primary) || state.baseFiles.length > 0,
        file: state.baseFiles.find((f) => f.primary)?.file || state.baseFiles[0]?.file,
        count: state.baseFiles.length,
      };
    }
    renderSteps();
    syncWishControls();
  } catch {
    /* ignore */
  }
}

export function setupBase() {
  const syncBasePick = () => {
    const input = $("base-file");
    const btn = $("base-upload");
    const list = $("base-pick-list");
    const files = [...(input?.files || [])];
    if (btn) btn.disabled = files.length === 0;
    if (list) {
      list.textContent = files.length
        ? files.map((f) => f.name).join(", ")
        : "";
    }
  };

  $("base-role")?.addEventListener("change", () => {
    const role = $("base-role").value;
    if ($("base-line-wrap")) $("base-line-wrap").hidden = role !== "line";
  });
  $("base-file")?.addEventListener("change", syncBasePick);
  syncBasePick();

  $("base-upload")?.addEventListener("click", async () => {
    const btn = $("base-upload");
    try {
      const input = $("base-file");
      const files = [...(input?.files || [])];
      if (!files.length) throw new Error(t("base.msg.needFile"));
      if (btn) btn.disabled = true;
      let last = null;
      for (const file of files) {
        const data = await fileToB64(file);
        last = await api("/api/base/upload", {
          method: "POST",
          body: JSON.stringify({
            filename: file.name,
            data,
            role: $("base-role")?.value || "primary",
            line: $("base-line-id")?.value || "a",
          }),
        });
      }
      if (input) input.value = "";
      syncBasePick();
      const asExtra = last?.role === "extra" && ($("base-role")?.value || "primary") === "primary";
      $("base-msg").textContent = asExtra
        ? t("base.msg.asExtra", { file: last?.file || "" })
        : t("base.msg.saved");
      $("base-msg").className = "small ok-msg";
      await refreshBaseStatus();
    } catch (e) {
      $("base-msg").textContent = e.message;
      $("base-msg").className = "small err-msg";
      syncBasePick();
    }
  });
  $("base-wish-save")?.addEventListener("click", async () => {
    try {
      await api("/api/base/wish", {
        method: "POST",
        body: JSON.stringify({ wish: $("base-wish")?.value || "" }),
      });
      $("base-msg").textContent = t("base.wish.saved");
      $("base-msg").className = "small ok-msg";
    } catch (e) {
      $("base-msg").textContent = e.message;
      $("base-msg").className = "small err-msg";
    }
  });
  $("base-wish-str")?.addEventListener("input", () => {
    if ($("base-wish-str-v")) $("base-wish-str-v").textContent = $("base-wish-str").value;
  });
  $("base-wish-ref")?.addEventListener("change", () => relabelEngineSelects());
  $("base-wish-engine")?.addEventListener("change", () => syncWishControls());
  $("base-wish")?.addEventListener("input", () => paintWishPrompt());
  syncWishControls();
  $("base-wish-gen")?.addEventListener("click", async () => {
    const useRef = Boolean($("base-wish-ref")?.checked);
    const hasPrimary = (state.baseFiles || []).some((f) => f.primary);
    if (useRef && !hasPrimary) {
      syncWishControls();
      return;
    }
    try {
      $("base-wish-gen").dataset.busy = "1";
      $("base-wish-gen").disabled = true;
      const data = await api("/api/base/generate", {
        method: "POST",
        body: JSON.stringify({
          wish: $("base-wish")?.value || "",
          engine: $("base-wish-engine")?.value,
          strength: Number($("base-wish-str")?.value),
          useRef: Boolean($("base-wish-ref")?.checked),
          makePrimary: Boolean($("base-wish-primary")?.checked),
        }),
      });
      // The raw answer (ok, stub, costUsd, bytes…) is for whoever debugs; the author gets one sentence and an opt-in "details" block.
      if ($("base-wish-out")) {
        if ($("base-wish-details")) $("base-wish-details").hidden = false;
        $("base-wish-out").textContent = JSON.stringify(data, null, 2);
      }
      $("base-msg").textContent = data.ok ? t("base.wish.done") : (data.message || t("base.wish.fail"));
      $("base-msg").className = data.ok ? "small ok-msg" : "small err-msg";
      await refreshBaseStatus();
    } catch (e) {
      $("base-msg").textContent = e.message;
      $("base-msg").className = "small err-msg";
    } finally {
      if ($("base-wish-gen")) delete $("base-wish-gen").dataset.busy;
      syncWishControls();
    }
  });

  $("base-vision-analyze")?.addEventListener("click", async () => {
    const btn = $("base-vision-analyze");
    const status = $("base-vision-status");
    const box = $("base-vision-box");
    try {
      if (btn) btn.disabled = true;
      if (status) status.textContent = t("base.vision.analyzing");
      const data = await api("/api/base/analyze", { method: "POST", body: JSON.stringify({}) });
      state.lastVisionResult = data.data;
      if (status) status.textContent = t("base.vision.provider", { provider: data.provider || "AI" });
      if ($("base-vision-summary")) $("base-vision-summary").textContent = data.data.summary || "";
      if ($("base-vision-out")) $("base-vision-out").textContent = JSON.stringify(data.data, null, 2);
      if (box) box.hidden = false;
    } catch (e) {
      if (status) status.textContent = e.message;
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $("base-vision-apply")?.addEventListener("click", () => {
    const v = state.lastVisionResult;
    if (!v) return;
    if (v.styleLock) {
      fillStyleLock(v.styleLock);
      if (state.draftFull) state.draftFull.styleLock = v.styleLock;
    }
    if (Array.isArray(v.suggestedTraits) && v.suggestedTraits.length) {
      ensureDraftTraits();
      const existingKeys = new Set((state.draftTraits.items || []).map((t) => t.key));
      for (const st of v.suggestedTraits) {
        if (!existingKeys.has(st.key)) {
          state.draftTraits.items.push(st);
        }
      }
      if (state.draftFull) state.draftFull.traits = state.draftTraits;
    }
    renderTraitChecklist();
    renderPackSummary();
    renderOptionsEditor();
    renderFacts();
    renderSteps();
    const status = $("base-vision-status");
    if (status) status.textContent = t("base.vision.done");
    showTab("ctor");
  });

  $("base-next")?.addEventListener("click", () => showTab("ctor"));
}
