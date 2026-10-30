// A trait table from the layers the author already has, and from a CSV sheet.
// Both merge into the table in the editor: nothing is removed, typed weights and prompts survive a layers import.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { encodeRgbaPng } from "../src/png-fit.mjs";
import {
  CSV_LIMITS,
  DEFAULT_WEIGHT,
  mergeTraitItems,
  parseLayerName,
  traitsFromCsv,
  traitsFromLayerFiles,
  traitsToCsv,
} from "../src/traits-import.mjs";
import { startStudio } from "./helpers/studio-server.mjs";

describe("parseLayerName", () => {
  it("reads a weight after #, with a dot or a comma, and ignores a missing or non-positive one", () => {
    assert.deepEqual(parseLayerName("Cap#20.png"), { value: "Cap", weight: 20 });
    assert.deepEqual(parseLayerName("Wide Brim # 3,5.PNG".replace(" # ", "#")), { value: "Wide Brim", weight: 3.5 });
    assert.deepEqual(parseLayerName("Bob.png"), { value: "Bob", weight: null });
    assert.deepEqual(parseLayerName("Bob#0.png"), { value: "Bob", weight: null });
    assert.deepEqual(parseLayerName("Bob#x.png"), { value: "Bob#x", weight: null });
  });
});

describe("traitsFromLayerFiles", () => {
  it("builds traits and options, keeps the real path only when the file name differs from the value", () => {
    const { items, skipped } = traitsFromLayerFiles(["hair/Bob.png", "hair/Bun#25.png", "hair/Long/Wavy#3.5.png", "hat/None.png", "hat/Cap.png"]);
    assert.deepEqual(items.map((t) => t.key), ["hair", "hat"]);
    assert.deepEqual(items[0].options, [
      { value: "Bob", weight: DEFAULT_WEIGHT, prompt: "" },
      { value: "Bun", weight: 25, prompt: "", layer: "hair/Bun#25.png" },
      { value: "Wavy", weight: 3.5, prompt: "", layer: "hair/Long/Wavy#3.5.png" },
    ]);
    assert.deepEqual(items[1].options.map((o) => o.value), ["Cap", "None"]);
    assert.equal(skipped.length, 0);
  });

  it("names what it skipped: wrong depth, not a PNG, a repeated value", () => {
    const { items, skipped } = traitsFromLayerFiles(["a.png", "hat/readme.txt", "hat/Cap.png", "hat/cap#5.png", "x/y/z/w.png"]);
    assert.deepEqual(items.map((t) => t.key), ["hat"]);
    assert.deepEqual(skipped.map((s) => s.reason).sort(), ["depth", "depth", "duplicate", "not_png"]);
  });

  it("an option path built from the real file path is what layerFileFor expects", async () => {
    const { layerFileFor } = await import("../src/layers.mjs");
    const { items } = traitsFromLayerFiles(["hair/Bun#25.png"]);
    const file = layerFileFor("/layers", items[0], "Bun", items[0].options[0]).replaceAll("\\", "/");
    assert.ok(file.endsWith("/layers/hair/Bun#25.png"), file);
  });
});

describe("mergeTraitItems", () => {
  const existing = [{ key: "hair", type: "Hair", options: [{ value: "Bob", weight: 7, prompt: "a bob" }] }];

  it("adds what is missing and keeps typed weights and prompts, without touching the input", () => {
    const frozen = JSON.stringify(existing);
    const incoming = [
      { key: "hair", type: "Hair", options: [{ value: "Bob", weight: 10, prompt: "", layer: "hair/Bob#10.png" }, { value: "Bun", weight: 10, prompt: "" }] },
      { key: "hat", type: "Hat", options: [{ value: "Cap", weight: 10, prompt: "" }] },
    ];
    const { items, stats } = mergeTraitItems(existing, incoming);
    assert.equal(JSON.stringify(existing), frozen);
    assert.deepEqual(stats, { traitsAdded: 1, optionsAdded: 2, optionsUpdated: 1 });
    assert.deepEqual(items[0].options[0], { value: "Bob", weight: 7, prompt: "a bob", layer: "hair/Bob#10.png" }, "weight and prompt kept, missing layer filled");
    assert.deepEqual(items[0].options[1], { value: "Bun", weight: 10, prompt: "" });
    assert.equal(items[1].key, "hat");
  });

  it("with overwrite the incoming fields win, but only the ones it carries", () => {
    const { items, stats } = mergeTraitItems(existing, [{ key: "hair", options: [{ value: "Bob", weight: 30 }] }], { overwrite: true });
    assert.deepEqual(items[0].options[0], { value: "Bob", weight: 30, prompt: "a bob" });
    assert.equal(stats.optionsUpdated, 1);
  });
});

describe("CSV", () => {
  const items = [{ key: "hair", options: [{ value: "Bob", weight: 12, prompt: 'a, "quoted" bob', exact: 2 }, { value: "Bun", weight: 5, prompt: "multi\nline" }] }];

  it("round-trips, including commas, quotes, line breaks and a BOM", () => {
    const csv = traitsToCsv(items);
    assert.ok(csv.startsWith("﻿"));
    const back = traitsFromCsv(csv);
    assert.deepEqual(back.errors, []);
    assert.deepEqual(back.items[0].options, [
      { value: "Bob", weight: 12, prompt: 'a, "quoted" bob', exact: 2 },
      { value: "Bun", weight: 5, prompt: "multi\nline" },
    ]);
  });

  it("reads a semicolon or tab sheet and any column order; only trait and value are required", () => {
    const semi = traitsFromCsv("value;trait;weight\nBob;hair;3\nCap;hat;");
    assert.deepEqual(semi.errors, []);
    assert.deepEqual(semi.items.map((t) => [t.key, t.options]), [["hair", [{ value: "Bob", weight: 3 }]], ["hat", [{ value: "Cap" }]]]);
    assert.deepEqual(traitsFromCsv("trait\tvalue\nhair\tBob\n").items[0].options, [{ value: "Bob" }]);
  });

  it("a spreadsheet formula is marked on export and unmarked on import", () => {
    const csv = traitsToCsv([{ key: "t", options: [{ value: "=1+1", weight: 1 }] }]);
    assert.ok(csv.includes("'=1+1"));
    assert.equal(traitsFromCsv(csv).items[0].options[0].value, "=1+1");
  });

  it("is strict: a bad row names its line and nothing is half-imported", () => {
    const r = traitsFromCsv("trait,value,weight,exact,layer\nhair,Bob,x,,\n,Bun,1,,\nhair,Eve,1,0,\nhair,Cap,1,,../x.png\nhair,Dup,1,,\nhair,dup,1,,\n");
    assert.deepEqual(r.errors.map((e) => e.row), [2, 3, 4, 5, 7]);
    assert.match(r.errors[0].message, /weight/);
    assert.match(r.errors[3].message, /layer/);
    assert.match(r.errors[4].message, /twice/);
  });

  it("refuses a missing header, an unclosed quote, an empty file and an oversize file", () => {
    assert.match(traitsFromCsv("name,x\nBob,1").errors[0].message, /trait, value/);
    assert.match(traitsFromCsv('trait,value\nhair,"Bob').errors[0].message, /not closed/);
    assert.match(traitsFromCsv("").errors[0].message, /empty/);
    assert.match(traitsFromCsv("x".repeat(CSV_LIMITS.chars + 1)).errors[0].message, /larger/);
  });
});

describe("routes", () => {
  let s;
  before(async () => {
    s = await startStudio({ adminWallet: false });
    await s.signIn();
  });
  after(() => s?.stop());

  const post = (path, body) => s.call("POST", path, { body });

  it("without any layers the layers route says so with a 400, not a 500", async () => {
    const r = await post("/api/traits/from-layers", {});
    assert.equal(r.status, 400);
    assert.equal(r.json.code, "no_layers");
  });

  it("bad input is a 400 on every route", async () => {
    assert.equal((await post("/api/traits/to-csv", {})).status, 400);
    assert.equal((await post("/api/traits/from-csv", {})).status, 400);
    assert.equal((await post("/api/traits/from-csv", { csv: "trait,value\n,x\n" })).status, 400);
    assert.equal((await post("/api/traits/from-layers", { items: "nope" })).status, 400);
  });

  it("CSV out and back in through the routes", async () => {
    const out = await post("/api/traits/to-csv", { items: [{ key: "hair", options: [{ value: "Bob", weight: 4, prompt: "p" }] }] });
    assert.equal(out.status, 200);
    const back = await post("/api/traits/from-csv", { csv: out.json.csv, items: [] });
    assert.equal(back.status, 200);
    assert.deepEqual(back.json.items[0].options, [{ value: "Bob", weight: 4, prompt: "p" }]);
    assert.equal(back.json.optionsAdded, 1);
  });

  it("uploaded layers become traits, merged into the table that is already there", async () => {
    const png = encodeRgbaPng(2, 2, Buffer.alloc(16, 200));
    const zip = new JSZip();
    zip.file("hair/Bob.png", png);
    zip.file("hair/Bun#25.png", png);
    zip.file("hat/Cap.png", png);
    const up = await s.call("POST", "/api/layers/upload", { body: await zip.generateAsync({ type: "nodebuffer" }), headers: { "Content-Type": "application/zip" } });
    assert.equal(up.status, 200, up.text);
    const r = await post("/api/traits/from-layers", { items: [{ key: "hair", type: "Hair", options: [{ value: "Bob", weight: 7, prompt: "typed" }] }] });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual({ t: r.json.traitsAdded, o: r.json.optionsAdded }, { t: 1, o: 2 });
    const hair = r.json.items.find((t) => t.key === "hair");
    assert.deepEqual(hair.options[0], { value: "Bob", weight: 7, prompt: "typed" }, "what was typed survives");
    assert.deepEqual(hair.options[1], { value: "Bun", weight: 25, prompt: "", layer: "hair/Bun#25.png" });
  });

  it("replace: the table becomes what the layers hold; without it what has no layer is only reported", async () => {
    const stale = [
      { key: "hair", type: "Hair", options: [{ value: "Bob", weight: 7, prompt: "typed" }, { value: "Mullet", weight: 5, prompt: "no layer" }] },
      { key: "expression", type: "Expression", options: [{ value: "Smile", weight: 10, prompt: "" }] },
    ];
    const keep = await post("/api/traits/from-layers", { items: stale });
    assert.equal(keep.status, 200, keep.text);
    assert.equal(keep.json.traitsRemoved, 0);
    assert.deepEqual(keep.json.withoutLayers.sort(), ["expression/Smile", "hair/Mullet"]);
    assert.ok(keep.json.items.some((t) => t.key === "expression"), "merge keeps the trait the model draws");
    const r = await post("/api/traits/from-layers", { items: stale, replace: true });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.items.map((t) => t.key).sort(), ["hair", "hat"]);
    assert.deepEqual({ t: r.json.traitsRemoved, o: r.json.optionsRemoved }, { t: 1, o: 1 });
    assert.deepEqual(r.json.items.find((t) => t.key === "hair").options.map((o) => o.value), ["Bob", "Bun"]);
    assert.equal(r.json.items.find((t) => t.key === "hair").options[0].prompt, "typed", "typed prompt of a value that has a layer stays");
    assert.equal(r.json.withoutLayersCount, 0);
  });
});
