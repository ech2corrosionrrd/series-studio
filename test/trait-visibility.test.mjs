// Metadata lists the traits from the recipes; only the vision check looks at the pictures. These tests pin how far that check got
// is reported in the export checklist and in the ZIP, and that the author's confirmation is explicit.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { buildBundleZip, runChecklist } from "../src/index.mjs";
import { describeVisibility, readTriageDoc, readVisibilityAck, traitVisibility, writeVisibilityAck } from "../src/trait-visibility.mjs";
import { buildDemoArchive, loadDemoPreset } from "./helpers/demo-archive.mjs";

const vision = (edition, extra = {}) => ({ edition, mode: "vision", verdict: "keep", issues: ["none"], missingTraits: [], ...extra });
const heuristic = (edition) => ({ edition, mode: "heuristic", verdict: "keep", issues: ["none"], missingTraits: [] });

describe("traitVisibility", () => {
  it("has nothing to say without frames", () => {
    assert.equal(traitVisibility({ triage: null, editions: [] }).status, "none");
  });

  it("is unchecked without a triage file and for heuristic rows, which only check the file", () => {
    assert.equal(traitVisibility({ triage: null, editions: [1, 2] }).status, "unchecked");
    const v = traitVisibility({ triage: { results: [heuristic(1), heuristic(2)] }, editions: [1, 2] });
    assert.equal(v.status, "unchecked");
    assert.equal(v.checked, 0);
    assert.match(describeVisibility(v), /no frame checked by vision \(0 of 2\)/);
  });

  it("is partial when only some frames were checked by vision and verified when all were", () => {
    const part = traitVisibility({ triage: { results: [vision(1)] }, editions: [1, 2, 3] });
    assert.equal(part.status, "partial");
    assert.deepEqual([part.checked, part.total], [1, 3]);
    assert.equal(traitVisibility({ triage: [vision(1), vision(2)], editions: [1, 2] }).status, "verified");
  });

  it("reports frames where a listed trait is not visible, and counts only the frames that go into the release", () => {
    const rows = [vision(1, { missingTraits: ["hat"] }), vision(2, { issues: ["missing_trait"] }), vision(3), vision(9, { missingTraits: ["hat"] })];
    const v = traitVisibility({ triage: { results: rows }, editions: [1, 2, 3] });
    assert.equal(v.status, "issues");
    assert.deepEqual(v.missingEditions, [1, 2]);
    assert.equal(v.missingFrames, 2);
    assert.equal(traitVisibility({ triage: { results: rows }, editions: [3] }).status, "verified");
  });

  it("takes the author's confirmation only for an unchecked or partial set", () => {
    const ack = { ack: true, at: "2026-10-28T10:00:00.000Z" };
    const un = traitVisibility({ triage: null, editions: [1], ack });
    assert.equal(un.acknowledged, true);
    assert.equal(un.ackAt, ack.at);
    assert.match(describeVisibility(un), /the author confirmed this on 2026-10-28/);
    assert.equal(traitVisibility({ triage: null, editions: [1], ack: { ack: false } }).acknowledged, false);
    assert.equal(traitVisibility({ triage: [vision(1)], editions: [1], ack }).acknowledged, false, "verified needs no confirmation");
    const bad = traitVisibility({ triage: [vision(1, { missingTraits: ["x"] })], editions: [1], ack });
    assert.equal(bad.status, "issues");
    assert.equal(bad.acknowledged, false, "a confirmation does not hide a frame that lacks a trait");
  });
});

describe("files", () => {
  it("writes and withdraws the confirmation without deleting anything", () => {
    const dir = mkdtempSync(join(tmpdir(), "series-vis-"));
    assert.equal(readVisibilityAck(dir), null);
    writeVisibilityAck(dir, true, new Date("2026-10-28T10:00:00Z"));
    assert.deepEqual(readVisibilityAck(dir), { ack: true, at: "2026-10-28T10:00:00.000Z" });
    writeVisibilityAck(dir, false);
    assert.equal(readVisibilityAck(dir).ack, false);
    writeFileSync(join(dir, "triage.json"), "{ broken");
    assert.equal(readTriageDoc(dir), null);
    writeFileSync(join(dir, "triage.json"), JSON.stringify({ results: [vision(1)] }));
    assert.equal(readTriageDoc(dir).results.length, 1);
  });
});

describe("export checklist item `visibility`", () => {
  const preset = loadDemoPreset();
  const archive = buildDemoArchive(preset);
  const byId = (items) => Object.fromEntries(items.map((i) => [i.id, i]));
  const run = (extra) => byId(runChecklist({ preset, archive, marks: {}, images: [{ edition: 1 }, { edition: 2 }], baseExists: true, ...extra })).visibility;

  it("warns when nothing was checked by vision and carries the data for the checkbox", () => {
    const item = run({});
    assert.equal(item.level, "warn");
    assert.equal(item.data.status, "unchecked");
    assert.match(item.detail, /from the recipes, not from the pictures/);
  });

  it("is ok when every frame was checked, and when the author confirmed", () => {
    assert.equal(run({ triage: { results: [vision(1), vision(2)] } }).level, "ok");
    assert.equal(run({ visibilityAck: { ack: true, at: "2026-10-28T10:00:00Z" } }).level, "ok");
  });

  it("stays a warning for frames that lack a trait, and follows the keep marks", () => {
    assert.equal(run({ triage: { results: [vision(1, { missingTraits: ["hat"] }), vision(2)] } }).level, "warn");
    const kept = run({ marks: { 2: "keep" }, triage: { results: [vision(1, { missingTraits: ["hat"] }), vision(2)] } });
    assert.equal(kept.level, "ok", "only the kept frame goes into the release");
  });

  it("is absent when the set has no images", () => {
    assert.equal(byId(runChecklist({ preset, archive, marks: {}, images: [], baseExists: true })).visibility, undefined);
  });
});

describe("export ZIP", () => {
  const preset = loadDemoPreset();
  const archive = { ...buildDemoArchive(preset), size: 2 };
  archive.recipes = archive.recipes.filter((r) => r.edition <= 2);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

  async function build(files = {}) {
    const dir = mkdtempSync(join(tmpdir(), "series-vis-zip-"));
    const setDir = join(dir, "set");
    mkdirSync(setDir, { recursive: true });
    for (const ed of [1, 2]) writeFileSync(join(setDir, `${ed}.png`), png);
    for (const [name, doc] of Object.entries(files)) writeFileSync(join(setDir, name), JSON.stringify(doc));
    const bundlesDir = join(dir, "bundles");
    const result = await buildBundleZip({
      archive,
      preset,
      setDir,
      set: "set",
      marks: {},
      bundlesDir,
      opts: { format: "erc721", namePrefix: "T #", symbol: "T", sellerFeeBasisPoints: 500, description: "test", locale: "en", upscale: false },
    });
    const zip = await JSZip.loadAsync(readFileSync(join(bundlesDir, result.file || result.path.split(/[\\/]/).pop())));
    return {
      collection: JSON.parse(await zip.file("collection.json").async("string")),
      preflight: JSON.parse(await zip.file("preflight.json").async("string")),
    };
  }

  it("warns and records the status when the traits were not checked by image", async () => {
    const { collection, preflight } = await build();
    assert.equal(collection.traitVisibility.status, "unchecked");
    assert.deepEqual([collection.traitVisibility.checkedByVision, collection.traitVisibility.frames, collection.traitVisibility.acknowledged], [0, 2, false]);
    assert.ok(preflight.checks.some((c) => c.code === "traits_unverified"));
  });

  it("drops the warning, but keeps the record, once the author confirmed", async () => {
    const { collection, preflight } = await build({ "visibility-ack.json": { ack: true, at: "2026-10-28T10:00:00.000Z" } });
    assert.equal(collection.traitVisibility.acknowledged, true);
    assert.equal(collection.traitVisibility.acknowledgedAt, "2026-10-28T10:00:00.000Z");
    assert.ok(!preflight.checks.some((c) => c.code === "traits_unverified"));
  });

  it("is silent when every frame was checked by vision", async () => {
    const { collection, preflight } = await build({ "triage.json": { results: [vision(1), vision(2)] } });
    assert.equal(collection.traitVisibility.status, "verified");
    assert.ok(!preflight.checks.some((c) => c.code === "traits_unverified"));
  });
});
