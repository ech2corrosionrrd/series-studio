// Source-level guards for the studio's generation tab (no browser): these were real defects found in a live run.
import { test } from "node:test";
import { readUiSource } from "../scripts/ui-source.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readUiSource();

test("the estimate request carries the regenerate switch, so it matches what Generate charges", () => {
  const est = app.slice(app.indexOf('$("g-estimate")?.addEventListener'), app.indexOf('$("g-stop")?.addEventListener'));
  assert.match(est, /force: Boolean\(\$\("g-force"\)\?\.checked\)/);
});

test("the local GPU explanation shows only for ComfyUI / A1111, never for cloud engines", () => {
  const fn = app.slice(app.indexOf("function renderLocalGpuPanel"), app.indexOf("async function probeLocalGpu"));
  assert.match(fn, /engine !== "comfyui" && engine !== "a1111"/);
  assert.match(app, /\$\("g-engine"\)\?\.addEventListener\("change", \(\) => \{\s*reLockPlan\(\);\s*renderLocalGpuPanel\(\);/);
});

test("quality and triage results are cleared when another set is opened", () => {
  assert.match(app, /function resetSetScopedPanels/);
  assert.match(app, /if \(dir !== state\.panelsDir\) \{\s*resetSetScopedPanels\(\);\s*state\.panelsDir = dir;/);
  const fn = app.slice(app.indexOf("function resetSetScopedPanels"), app.indexOf("async function loadGalleryDir(dir)"));
  assert.match(fn, /state\.galleryTriage = \{\}/);
  assert.match(fn, /v-quality-out/);
});

test("the studio opens on the saved series, else the portrait template, never an arbitrary alphabetical preset", () => {
  const fn = app.slice(app.indexOf("function startSeries"), app.indexOf("async function boot"));
  assert.match(fn, /\[saved, "pfp-portrait\.json", "demo-series\.json"\]/);
  assert.match(app, /const start = startSeries\(ws\?\.workspace, pr\?\.active \|\| null\)/);
  assert.doesNotMatch(app, /state\.presets\[0\]\.file\)\}`\)/, "boot must not load the first preset blindly");
});

test("layers and kits use the current series first, the Export selector only as a fallback", () => {
  const fn = app.slice(app.indexOf("function kitArchive"), app.indexOf("function setBusy"));
  assert.match(fn, /return state\.archiveFile \|\| \$\("x-file"\)\?\.value/);
  assert.match(app, /function syncActiveSeries/);
});
