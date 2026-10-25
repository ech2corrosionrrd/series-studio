// Hybrid (model frames + PNG layers) is the default path once layers are uploaded.
// Source-level contract: the select picks the newest set by itself, a manual pick is never overridden,
// and a finished generation points the author at the layers card.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../server/ui/app.js", import.meta.url), "utf8");
const loc = (lang) => readFileSync(new URL(`../server/ui/locales/${lang}.js`, import.meta.url), "utf8");

test("with layers uploaded the overlay select defaults to the newest set unless the author picked one", () => {
  assert.match(src, /!keep && !sel\.dataset\.picked && state\.hasLayers && sets\.length\) sel\.value = sets\[0\]\.dir/);
  assert.match(src, /\$\("g-compose-over"\)\?\.addEventListener\("change", \(e\) => \{\r?\n\s*e\.target\.dataset\.picked = "1"/);
});

test("layer presence comes from the Generate status block only", () => {
  assert.match(src, /el\.id === "g-layers-status"\) state\.hasLayers = Boolean\(st\?\.exists && st\.files > 0\)/);
});

test("a finished generation preselects its set and shows the layers hint only when layers exist", () => {
  assert.match(src, /fillComposeOver\(state\.hasLayers \? lastDone\.set : ""\)/);
  assert.match(src, /state\.hasLayers && lastDone\.set && Number\(lastDone\.count\) > 0/);
});

test("the hint exists in both locales", () => {
  for (const lang of ["uk", "en"]) assert.match(loc(lang), /"render\.layers\.afterGen":/);
});
