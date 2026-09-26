import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import JSZip from "jszip";
import {
  buildSugarConfig,
  buildThirdwebConfig,
  getLaunchpadPortalUrls,
  buildReleaseGuide,
  buildBundleZip,
} from "../src/index.mjs";
import { buildDemoArchive, loadDemoPreset, writeDemoArchive } from "./helpers/demo-archive.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const preset = loadDemoPreset();
const archiveFull = buildDemoArchive(preset);

function mockPng() {
  const header = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  return Buffer.concat([header, Buffer.alloc(1100)]);
}

test("buildSugarConfig generates valid Metaplex Sugar CLI JSON", () => {
  const sugar = buildSugarConfig(archiveFull, preset, {
    creatorAddress: "8Creator111111111111111111111111111111111",
    price: 0.5,
    symbol: "GREM",
    sellerFeeBasisPoints: 750,
    imageUriPrefix: "ipfs://QmSugar123/",
  });

  assert.equal(sugar.number, archiveFull.recipes.length);
  assert.equal(sugar.price, 0.5);
  assert.equal(sugar.symbol, "GREM");
  assert.equal(sugar.sellerFeeBasisPoints, 750);
  assert.equal(sugar.isMutable, true);
  assert.equal(sugar.creators[0].address, "8Creator111111111111111111111111111111111");
  assert.equal(sugar.creators[0].share, 100);
  assert.equal(sugar.uploadMethod, "pinata");
});

test("buildThirdwebConfig generates valid EVM Drop contract deploy config", () => {
  const tw = buildThirdwebConfig(archiveFull, preset, {
    namePrefix: "Gremlins #",
    symbol: "GREM",
    creatorAddress: "0x1234567890123456789012345678901234567890",
    sellerFeeBasisPoints: 500,
    imageUriPrefix: "ipfs://QmCollection123/",
    description: "Official Gremlins Drop",
  });

  assert.equal(tw.name, "Gremlins");
  assert.equal(tw.symbol, "GREM");
  assert.equal(tw.description, "Official Gremlins Drop");
  assert.equal(tw.seller_fee_basis_points, 500);
  assert.equal(tw.fee_recipient, "0x1234567890123456789012345678901234567890");
  assert.equal(tw.defaultAdmin, "0x1234567890123456789012345678901234567890");
  assert.equal(tw.total_supply, archiveFull.recipes.length);
});

test("getLaunchpadPortalUrls provides URLs and deployment steps for all profiles", () => {
  const os = getLaunchpadPortalUrls("opensea", archiveFull);
  assert.equal(os.id, "opensea");
  assert.ok(os.portalUrl.includes("opensea.io/studio"));
  assert.ok(os.tips.length >= 3);

  const me = getLaunchpadPortalUrls("magiceden", archiveFull);
  assert.equal(me.id, "magiceden");
  assert.ok(me.portalUrl.includes("magiceden.io/creator-hub"));
  assert.equal(me.recommendedFile, "sugar.json");

  const lmn = getLaunchpadPortalUrls("launchmynft", archiveFull);
  assert.equal(lmn.id, "launchmynft");
  assert.ok(lmn.portalUrl.includes("launchmynft.io"));

  const ord = getLaunchpadPortalUrls("ordinalsbot", archiveFull);
  assert.equal(ord.id, "ordinalsbot");
  assert.ok(ord.portalUrl.includes("ordinalsbot.com"));
});

test("buildReleaseGuide generates detailed localized checklist", () => {
  const guideUk = buildReleaseGuide("uk", archiveFull, { profile: "magiceden" });
  assert.ok(guideUk.includes("Інструкція з релізу"));
  assert.ok(guideUk.includes("Magic Eden"));
  assert.ok(guideUk.includes("sugar.json"));

  const guideEn = buildReleaseGuide("en", archiveFull, { profile: "opensea" });
  assert.ok(guideEn.includes("Release & Deployment Guide"));
  assert.ok(guideEn.includes("OpenSea"));
  assert.ok(guideEn.includes("manifest.csv"));
});

test("buildBundleZip packs sugar.json, thirdweb.json, and release-guide.txt into ZIP", async () => {
  const testSetDir = join(ROOT, "out", "test-w14-set");
  const testBundlesDir = join(ROOT, "out", "test-w14-bundles");
  mkdirSync(testSetDir, { recursive: true });
  mkdirSync(testBundlesDir, { recursive: true });

  writeFileSync(join(testSetDir, "1.png"), mockPng());

  const marks = { 1: "keep" };
  const archive = {
    presetId: "demo-series",
    recipes: [{ edition: 1, traits: { hair: "Buzz" } }],
  };

  // Test Solana profile bundle with sugar.json
  const resMe = await buildBundleZip({
    archive,
    preset,
    setDir: testSetDir,
    set: "test-w14-set",
    marks,
    bundlesDir: testBundlesDir,
    bundleId: "w14-test-me",
    opts: {
      profile: "magiceden",
      creatorAddress: "8Creator111111111111111111111111111111111",
      onlyKeep: true,
    },
  });

  const zipPathMe = join(testBundlesDir, resMe.file);
  const zipMe = await JSZip.loadAsync(readFileSync(zipPathMe));
  assert.ok(zipMe.file("sugar.json") != null);
  assert.ok(zipMe.file("release-guide.txt") != null);
  const sugarContent = JSON.parse(await zipMe.file("sugar.json").async("string"));
  assert.equal(sugarContent.creators[0].address, "8Creator111111111111111111111111111111111");

  // Test OpenSea EVM profile bundle with thirdweb.json
  const resOs = await buildBundleZip({
    archive,
    preset,
    setDir: testSetDir,
    set: "test-w14-set",
    marks,
    bundlesDir: testBundlesDir,
    bundleId: "w14-test-os",
    opts: {
      profile: "opensea",
      creatorAddress: "0x1234567890123456789012345678901234567890",
      onlyKeep: true,
    },
  });

  const zipPathOs = join(testBundlesDir, resOs.file);
  const zipOs = await JSZip.loadAsync(readFileSync(zipPathOs));
  assert.ok(zipOs.file("thirdweb.json") != null);
  assert.ok(zipOs.file("release-guide.txt") != null);

  // Clean up
  try {
    rmSync(testSetDir, { recursive: true, force: true });
    rmSync(testBundlesDir, { recursive: true, force: true });
  } catch {}
});

test("CLI series release-config generates deploy configs", () => {
  const scratch = mkdtempSync(join(tmpdir(), "series-w14-"));
  const archivePath = join(scratch, "demo-series.json");
  const sugarOut = join(scratch, "sugar.json");
  const twOut = join(scratch, "thirdweb.json");
  writeDemoArchive(archivePath, preset);

  // Generate Sugar config
  execSync(`node bin/series.mjs release-config "${archivePath}" --profile magiceden --creator "8CreatorSol111111" -o "${sugarOut}"`, {
    cwd: ROOT,
    stdio: "pipe",
  });
  assert.ok(existsSync(sugarOut));
  const sugar = JSON.parse(readFileSync(sugarOut, "utf8"));
  assert.equal(sugar.creators[0].address, "8CreatorSol111111");

  // Generate Thirdweb config
  execSync(`node bin/series.mjs release-config "${archivePath}" --profile opensea --creator "0xEvmCreator123" -o "${twOut}"`, {
    cwd: ROOT,
    stdio: "pipe",
  });
  assert.ok(existsSync(twOut));
  const tw = JSON.parse(readFileSync(twOut, "utf8"));
  assert.equal(tw.fee_recipient, "0xEvmCreator123");

  rmSync(scratch, { recursive: true, force: true });
});
