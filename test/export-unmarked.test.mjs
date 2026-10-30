// R4 (BETA-REVIEW round 2): the ZIP is built from Keep-marked frames; the frames left out must be counted, not vanish.
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectBundleRecipes } from "../src/export-bundle.mjs";

const recipes = [1, 2, 3, 4, 5, 6].map((edition) => ({ edition }));
const images = new Set([1, 2, 3, 4, 5, 6]);

test("frames with an image but no Keep mark are counted as left out", () => {
  const sel = selectBundleRecipes(recipes, { 1: "keep", 2: "keep", 3: "keep" }, true, images);
  assert.deepEqual(sel.recipes.map((r) => r.edition), [1, 2, 3]);
  assert.equal(sel.unmarked, 3);
});

test("nothing is left out when every frame is kept, or when the filter is off", () => {
  const all = Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [n, "keep"]));
  assert.equal(selectBundleRecipes(recipes, all, true, images).unmarked, 0);
  assert.ok(!selectBundleRecipes(recipes, { 1: "keep" }, false, images).unmarked);
});

test("a frame without an image is not counted as left out", () => {
  const sel = selectBundleRecipes(recipes, { 1: "keep" }, true, new Set([1, 2]));
  assert.equal(sel.unmarked, 1, "only frame 2 has an image and no mark");
});
