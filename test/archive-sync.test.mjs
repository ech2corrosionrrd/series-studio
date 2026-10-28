// archiveSync: is the archive still what the current preset would produce? Before a paid run and in the export checklist.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveSync, describeSync } from "../src/archive-sync.mjs";
import { runChecklist } from "../src/checklist.mjs";
import { buildRecipes } from "../src/recipes.mjs";

const preset = JSON.parse(readFileSync(new URL("../presets/demo-series.json", import.meta.url), "utf8"));
const archiveOf = (p) => ({ presetId: p.id, seed: p.seed, size: p.size, recipes: buildRecipes(p, { items: p.overrides || {} }) });
const clone = (o) => JSON.parse(JSON.stringify(o));

describe("archiveSync", () => {
  it("matches an archive built from the same preset", () => {
    const s = archiveSync(preset, archiveOf(preset));
    assert.equal(s.status, "match");
    assert.equal(s.total, preset.size);
    assert.deepEqual([s.dnaChanged, s.promptChanged, s.missing, s.extra], [0, 0, 0, 0]);
    assert.match(describeSync(s), /match the preset/);
  });

  it("is stale when a seed or a weight changed after the archive was built", () => {
    const archive = archiveOf(preset);
    const reseeded = { ...clone(preset), seed: `${preset.seed}-x` };
    const a = archiveSync(reseeded, archive);
    assert.equal(a.status, "stale");
    assert.ok(a.dnaChanged > 0 && a.editions.length > 0);
    const heavier = clone(preset);
    heavier.traits.items[0].options[0].weight = 9999;
    assert.equal(archiveSync(heavier, archive).status, "stale");
  });

  it("is stale when only the prompt text changed and reports it apart from the traits", () => {
    const archive = archiveOf(preset);
    const edited = clone(preset);
    edited.promptTemplate.keep = [...edited.promptTemplate.keep, "extra words in the style block"];
    const s = archiveSync(edited, archive);
    assert.equal(s.status, "stale");
    assert.equal(s.dnaChanged, 0);
    assert.ok(s.promptChanged > 0);
    assert.match(describeSync(s), /another prompt/);
  });

  it("reports missing and extra editions when the size changed", () => {
    const archive = archiveOf(preset);
    // line quotas must add up to the size, so the quota of the first line moves with it
    const resize = (delta) => {
      const p = clone(preset);
      p.size += delta;
      p.lines[Object.keys(p.lines)[0]].quota += delta;
      return p;
    };
    const bigger = resize(3);
    const grown = archiveSync(bigger, archive);
    assert.equal(grown.status, "stale");
    assert.ok(grown.missing + grown.dnaChanged + grown.promptChanged > 0);
    const smaller = resize(-2);
    const shrunk = archiveSync(smaller, archive);
    assert.equal(shrunk.status, "stale");
    assert.ok(shrunk.extra + shrunk.dnaChanged + shrunk.promptChanged > 0);
  });

  it("applies the manual edits stored in preset.overrides", () => {
    const first = preset.traits.items[0];
    const other = first.options.find((o) => o.value !== buildRecipes(preset)[0].traits[first.key] && o.value !== "None");
    const edited = { ...clone(preset), overrides: { 0: { traits: { [first.key]: other.value }, note: "hand edit" } } };
    assert.equal(archiveSync(edited, archiveOf(edited)).status, "match");
    // an archive built without the edits no longer describes this preset
    assert.equal(archiveSync(edited, archiveOf(preset)).status, "stale");
  });

  it("says unknown, not stale, when there is nothing to compare", () => {
    assert.equal(archiveSync(null, archiveOf(preset)).reason, "no_preset");
    assert.equal(archiveSync(preset, { recipes: [] }).reason, "no_recipes");
    assert.equal(archiveSync({ ...clone(preset), traits: { items: [] } }, archiveOf(preset)).reason, "preset_invalid");
  });
});

describe("export checklist item `sync`", () => {
  const ctx = (p, a) => ({ preset: p, archive: a, marks: {}, images: [], baseExists: true });
  const byId = (items) => Object.fromEntries(items.map((i) => [i.id, i]));

  it("is ok for a matching archive and a warning (not a failure) for a stale one", () => {
    assert.equal(byId(runChecklist(ctx(preset, archiveOf(preset)))).sync.level, "ok");
    const stale = byId(runChecklist(ctx({ ...clone(preset), seed: "changed" }, archiveOf(preset)))).sync;
    assert.equal(stale.level, "warn");
    assert.match(stale.detail, /differs from the preset/);
  });

  it("is absent without a preset or an archive", () => {
    assert.equal(byId(runChecklist(ctx(null, archiveOf(preset)))).sync, undefined);
    assert.equal(byId(runChecklist(ctx(preset, null))).sync, undefined);
  });
});

describe("series build", () => {
  it("applies preset.overrides, like the studio does", () => {
    const first = preset.traits.items[0];
    const base = buildRecipes(preset)[0].traits[first.key];
    const other = first.options.find((o) => o.value !== base && o.value !== "None").value;
    const edited = { ...clone(preset), overrides: { 0: { traits: { [first.key]: other }, note: "" } } };
    const dir = mkdtempSync(join(tmpdir(), "series-sync-"));
    const presetFile = join(dir, "p.json");
    const out = join(dir, "a.json");
    writeFileSync(presetFile, JSON.stringify(edited));
    execFileSync(process.execPath, [new URL("../bin/series.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), "build", presetFile, "-o", out], { stdio: "pipe" });
    const built = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(built.recipes[0].traits[first.key], other);
    assert.equal(archiveSync(edited, built).status, "match");
  });
});
