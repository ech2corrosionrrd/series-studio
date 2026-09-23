import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildErc721Meta,
  buildMetaplexMeta,
  selectBundleRecipes,
  buildBundleZip,
  runChecklist,
  traitsToAttributes,
  upscale2x,
} from "../src/index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const preset = JSON.parse(readFileSync(join(ROOT, "presets", "demo-series.json"), "utf8"));
const archiveFull = JSON.parse(readFileSync(join(ROOT, "out", "demo-series.json"), "utf8"));

function tinyPng() {
  // 1x1 PNG
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
}

test("traitsToAttributes drops None and uses type labels", () => {
  const items = preset.traits?.items || preset.traits;
  const attrs = traitsToAttributes(
    { hair: "Buzz", eyewear: "None", expression: "Smile" },
    items,
  );
  assert.ok(attrs.every((a) => a.value !== "None"));
  assert.ok(attrs.some((a) => a.trait_type && a.value === "Buzz"));
});

test("erc721 and metaplex metadata shapes", () => {
  const recipe = {
    edition: 7,
    traits: { hair: "Buzz", expression: "Smile", eyewear: "None" },
  };
  const items = preset.traits?.items || preset.traits;
  const erc = buildErc721Meta(recipe, { namePrefix: "Demo #", description: "d" }, items);
  assert.equal(erc.name, "Demo #7");
  assert.equal(erc.image, "7.png");
  assert.ok(Array.isArray(erc.attributes));
  assert.equal(erc.attributes.some((a) => a.value === "None"), false);

  const mp = buildMetaplexMeta(
    recipe,
    { namePrefix: "Demo #", symbol: "DEMO", sellerFeeBasisPoints: 250, description: "d" },
    items,
  );
  assert.equal(mp.symbol, "DEMO");
  assert.equal(mp.seller_fee_basis_points, 250);
  assert.equal(mp.properties.category, "image");
  assert.equal(mp.properties.files[0].uri, "7.png");
});

test("selectBundleRecipes onlyKeep with keep marks", () => {
  const recipes = archiveFull.recipes.slice(0, 5);
  const marks = { [String(recipes[0].edition)]: "keep", [String(recipes[1].edition)]: "redo" };
  const sel = selectBundleRecipes(recipes, marks, true, new Set(recipes.map((r) => r.edition)));
  assert.equal(sel.error, null);
  assert.deepEqual(sel.recipes.map((r) => r.edition), [recipes[0].edition]);
});

test("selectBundleRecipes onlyKeep without marks falls back to images", () => {
  const recipes = archiveFull.recipes.slice(0, 3);
  const sel = selectBundleRecipes(recipes, {}, true, new Set([recipes[0].edition]));
  assert.ok(["all_with_images","all_with_images","images"].includes(sel.fallback) || sel.recipes.length===1);
  assert.equal(sel.recipes.length, 1);
});

test("runChecklist returns expected ids and levels", () => {
  const small = {
    ...archiveFull,
    size: 3,
    recipes: archiveFull.recipes.slice(0, 3),
  };
  const items = runChecklist({
    preset,
    archive: small,
    marks: { "1": "keep", "2": "keep" },
    images: [{ edition: 1 }, { edition: 2 }],
    baseExists: false,
  });
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.equal(byId.preset.level, "ok");
  assert.equal(byId.archive.level, "ok");
  assert.equal(byId.base.level, "fail");
  assert.ok(["warn", "ok"].includes(byId.styleLock.level));
  assert.equal(byId.uniqueness.level, "ok");
  assert.ok(["warn", "ok"].includes(byId.keeps.level));
  assert.equal(byId.images.level, "ok");
  assert.equal(byId.lint.level, "ok");
});

test("buildBundleZip writes mint-ready zip", async () => {
  const setDir = join(ROOT, "out/test-set");
  mkdirSync(setDir, { recursive: true });
  const png = tinyPng();
  for (const ed of [1, 2, 3]) writeFileSync(join(setDir, `${ed}.png`), png);
  writeFileSync(join(setDir, "marks.json"), JSON.stringify({ "1": "keep", "2": "keep", "3": "redo" }));
  const small = {
    ...archiveFull,
    size: 3,
    recipes: archiveFull.recipes.filter((r) => r.edition <= 3),
  };
  const bundlesDir = join(ROOT, "out/bundles");
  mkdirSync(bundlesDir, { recursive: true });
  const result = await buildBundleZip({
    archive: small,
    preset,
    setDir,
    set: "test-set",
    marks: { "1": "keep", "2": "keep", "3": "redo" },
    bundlesDir,
    opts: {
      format: "erc721",
      onlyKeep: true,
      namePrefix: "T #",
      symbol: "T",
      sellerFeeBasisPoints: 500,
      description: "test",
      locale: "en",
      upscale: false,
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.count, 2);
  assert.ok(existsSync(join(ROOT, result.path)));
});

test("upscale2x does not throw without valid image / reports reason", async () => {
  const bad = await upscale2x(Buffer.from("not-an-image"));
  assert.equal(bad.ok, false);
  assert.ok(bad.reason);
});
