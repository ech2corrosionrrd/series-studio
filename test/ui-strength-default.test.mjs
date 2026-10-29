// QUALITY-REVIEW item 12: the Overview slider note compares the preset's strength with the product default. The browser keeps its own copy of
// that number (it cannot import src/), so this pins it to the one the server and the engines use.
import { describe, it } from "node:test";
import { readUiSource } from "../scripts/ui-source.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_STRENGTH } from "../src/reference.mjs";

const app = readUiSource();
const html = readFileSync(new URL("../server/ui/index.html", import.meta.url), "utf8");

describe("reference strength default", () => {
  it("the page's copy equals DEFAULT_STRENGTH in src/reference.mjs", () => {
    const m = /^const DEFAULT_STRENGTH = ([0-9.]+);/m.exec(app);
    assert.ok(m, "app.js declares DEFAULT_STRENGTH");
    assert.equal(Number(m[1]), DEFAULT_STRENGTH);
  });

  it("every empty form starts at that default", () => {
    for (const id of ["o-strength", "base-wish-str", "g-strength"]) {
      const tag = new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(html)?.[0] || "";
      const v = /value="([0-9.]+)"/.exec(tag)?.[1];
      assert.equal(Number(v), DEFAULT_STRENGTH, `${id} starts at ${v}`);
    }
  });
});
