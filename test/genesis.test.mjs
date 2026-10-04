import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMockPng } from "../src/mock-image.mjs";
import {
  displayEdition,
  genesisEnabled,
  hasGenesis,
  supplyOf,
  syncGenesisImage,
  withGenesis,
  withoutGenesis,
} from "../src/genesis.mjs";
import { buildDeployKit } from "../src/deploy-kit.mjs";
import { selectBundleRecipes } from "../src/export-bundle.mjs";
import { releaseFromArchive } from "../src/release-config.mjs";
import { formatForLaunchpad } from "../src/launchpads.mjs";

const archive = { presetId: "g", size: 2, recipes: [{ edition: 1, traits: { bg: "a" } }, { edition: 2, traits: { bg: "b" } }] };
const on = { id: "g", name: "Gen Series", genesis: true };

test("genesis is opt-in and the stored archive keeps exactly N recipes", () => {
  assert.equal(genesisEnabled({}), false);
  assert.equal(genesisEnabled({ genesis: false }), false);
  assert.equal(genesisEnabled({ genesis: true }), true);
  assert.equal(genesisEnabled({ genesis: { enabled: true } }), true);
  assert.equal(withGenesis(archive, {}), archive, "no genesis: archive untouched");
  const g = withGenesis(archive, on);
  assert.equal(g.size, 3);
  assert.deepEqual(g.recipes.map((r) => r.edition), [0, 1, 2]);
  assert.equal(archive.recipes.length, 2, "input archive is not mutated");
  assert.equal(withGenesis(g, on), g, "idempotent");
  assert.deepEqual(withoutGenesis(g.recipes).map((r) => r.edition), [1, 2]);
  assert.equal(hasGenesis(g.recipes), true);
  assert.equal(hasGenesis(archive.recipes), false);
});

test("supply is N+1 with genesis and never counted twice", () => {
  assert.equal(supplyOf(archive, {}), 2);
  assert.equal(supplyOf(archive, on), 3);
  assert.equal(supplyOf(withGenesis(archive, on), on), 3);
  assert.equal(releaseFromArchive(archive, on).size, 3);
  assert.equal(releaseFromArchive(archive, {}).size, 2);
});

test("0-based numbering: legacy shifts by one, genesis series keep edition numbers", () => {
  assert.equal(displayEdition(1, { zeroIndexed: true }), 0);
  assert.equal(displayEdition(1, { zeroIndexed: true, genesis: true }), 1);
  assert.equal(displayEdition(0, { zeroIndexed: true, genesis: true }), 0);
  assert.equal(displayEdition(5, { zeroIndexed: false, genesis: true }), 5);
  const rec = { edition: 1, traits: {} };
  assert.match(formatForLaunchpad(rec, "magiceden", { zeroIndexed: true, namePrefix: "S #" }).name, /^S #0$/);
  assert.match(formatForLaunchpad(rec, "magiceden", { zeroIndexed: true, genesis: true, namePrefix: "S #" }).name, /^S #1$/);
});

test("deploy kit (Solana) with genesis: base is 0, edition k is k, base carries Edition=Genesis", () => {
  const png = (n) => createMockPng({ seed: n, width: 32, height: 32 });
  const g = withGenesis(archive, on);
  const kit = buildDeployKit({
    archive: g,
    preset: on,
    items: g.recipes.map((r) => ({ edition: r.edition, buffer: png(r.edition + 1), ext: "png", recipe: r })),
    opts: { chain: "solana", symbol: "GEN", creatorAddress: "Creator11111111111111111111111111111111" },
    locale: "en",
    env: {},
  });
  for (const i of [0, 1, 2]) assert.ok(kit.files[`assets/${i}.png`], `assets/${i}.png`);
  assert.equal(kit.files["assets/3.png"], undefined);
  const meta = (i) => JSON.parse(kit.files[`assets/${i}.json`]);
  assert.match(meta(0).name, /#0$/);
  assert.match(meta(1).name, /#1$/);
  assert.match(meta(2).name, /#2$/);
  assert.deepEqual(meta(0).attributes, [{ trait_type: "Edition", value: "Genesis" }]);
  assert.equal(meta(1).attributes.some((a) => a.value === "Genesis"), false);
  assert.equal(JSON.parse(kit.files["cm-config.json"]).itemsAvailable, 3, "Candy Machine supply is N+1");
});

test("deploy kit without genesis is unchanged: edition 1 is still index 0 and #0", () => {
  const png = createMockPng({ seed: 9, width: 32, height: 32 });
  const kit = buildDeployKit({
    archive,
    preset: { id: "g", name: "Gen Series" },
    items: archive.recipes.map((r) => ({ edition: r.edition, buffer: png, ext: "png", recipe: r })),
    opts: { chain: "solana", symbol: "GEN", creatorAddress: "Creator11111111111111111111111111111111" },
    locale: "en",
    env: {},
  });
  assert.ok(kit.files["assets/0.png"] && kit.files["assets/1.png"]);
  assert.equal(kit.files["assets/2.png"], undefined);
  assert.match(JSON.parse(kit.files["assets/0.json"]).name, /#0$/);
});

test("bundle selection: the genesis lot is in even when only keep-marked frames are exported", () => {
  const g = withGenesis(archive, on);
  const images = new Set([0, 1, 2]);
  const sel = selectBundleRecipes(g.recipes, { 2: "keep" }, true, images);
  assert.equal(sel.error, null);
  assert.deepEqual(sel.recipes.map((r) => r.edition), [0, 2]);
  // not in the set folder yet -> not selected, nothing breaks
  const noBase = selectBundleRecipes(g.recipes, { 2: "keep" }, true, new Set([1, 2]));
  assert.deepEqual(noBase.recipes.map((r) => r.edition), [2]);
  // legacy archive: same as before
  const legacy = selectBundleRecipes(archive.recipes, { 1: "keep" }, true, new Set([1, 2]));
  assert.deepEqual(legacy.recipes.map((r) => r.edition), [1]);
});

test("syncGenesisImage copies the base into the set as 0.<ext> without touching input/", () => {
  const root = mkdtempSync(join(tmpdir(), "series-genesis-"));
  try {
    const inputDir = join(root, "input");
    const setDir = join(root, "out", "set");
    mkdirSync(inputDir, { recursive: true });
    mkdirSync(setDir, { recursive: true });
    assert.equal(syncGenesisImage({ inputDir, setDir }), null, "no base image yet");
    const png = createMockPng({ seed: 5, width: 32, height: 32 });
    writeFileSync(join(inputDir, "primary.png"), png);
    assert.equal(syncGenesisImage({ inputDir, setDir }), "0.png");
    assert.ok(existsSync(join(setDir, "0.png")));
    assert.ok(existsSync(join(inputDir, "primary.png")), "input stays");
    assert.equal(syncGenesisImage({ inputDir, setDir }), "0.png", "idempotent");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
