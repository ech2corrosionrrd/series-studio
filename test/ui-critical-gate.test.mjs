// Before a paid run the author is warned when a critical trait (layerOnly) has no layer file: the model does not
// draw it, so the frames would come out without it and still be charged. Same pattern as the FLUX [dev] licence warning.
// Source-level contract: the page itself cannot be driven without a paid engine.
import { test } from "node:test";
import { readUiSource } from "../scripts/ui-source.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readUiSource();
const html = readFileSync(new URL("../server/ui/index.html", import.meta.url), "utf8");
const loc = (lang) => readFileSync(new URL(`../server/ui/locales/${lang}.js`, import.meta.url), "utf8");

test("the gate applies only with missing critical layers, no acknowledgement and a paid engine", () => {
  assert.match(app, /Number\(state\.criticalMissing\) > 0 && !state\.criticalAck && \(\$\("g-engine"\)\?\.value \|\| ""\) !== "mock"/);
});

test("the run button stops at the gate before anything is started or charged", () => {
  const run = app.indexOf('$("g-run")?.addEventListener("click"');
  const gate = app.indexOf("if (criticalGateApplies())", run);
  const start = app.indexOf("renderAbort?.abort();", run);
  assert.ok(run > 0 && gate > run && start > gate, "the gate check must come before the stream starts");
  assert.match(app, /if \(criticalGateApplies\(\)\) \{\r?\n\s*paintCriticalGate\(\);\r?\n\s*return;/);
});

test("the count comes from the Generate layers status and a changed count asks again", () => {
  assert.match(app, /if \(critical !== state\.criticalMissing\) state\.criticalAck = false;/);
  assert.match(app, /state\.criticalMissing = critical;/);
});

test("the confirm button acknowledges and re-runs, and the markup and both locales exist", () => {
  assert.match(app, /state\.criticalAck = true;\r?\n\s*paintCriticalGate\(\);\r?\n\s*\$\("g-run"\)\?\.click\(\);/);
  for (const id of ["g-critical-gate", "g-critical-gate-body", "g-critical-proceed"]) assert.ok(html.includes(`id="${id}"`), id);
  for (const lang of ["uk", "en"]) {
    for (const key of ["critical.gate.title", "critical.gate.body", "critical.gate.proceed"]) assert.ok(loc(lang).includes(`"${key}":`), `${lang} ${key}`);
  }
});
