import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import JSZip from "jszip";
import {
  getLaunchpadProfiles,
  formatForLaunchpad,
  exportManifestCsv,
  buildBundleZip,
  generateMetadataPreview,
} from "../src/index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const preset = JSON.parse(readFileSync(join(ROOT, "presets", "demo-series.json"), "utf8"));
const archiveFull = JSON.parse(readFileSync(join(ROOT, "out", "demo-series.json"), "utf8"));

function mockPng() {
  // 1x1 PNG header + padding to pass QA min size (>1024 bytes)
  const header = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  return Buffer.concat([header, Buffer.alloc(1100)]);
}

test("getLaunchpadProfiles returns all 4 standard profiles", () => {
  const profiles = getLaunchpadProfiles();
  assert.equal(profiles.length, 4);
  const ids = profiles.map((p) => p.id);
  assert.ok(ids.includes("opensea"));
  assert.ok(ids.includes("magiceden"));
  assert.ok(ids.includes("launchmynft"));
  assert.ok(ids.includes("ordinalsbot"));
});

test("formatForLaunchpad OpenSea ERC-721", () => {
  const recipe = {
    edition: 3,
    traits: { expression: "Smile", eyewear: "None", mood: "Happy" },
  };
  const traitItems = preset.traits?.items || preset.traits;
  const meta = formatForLaunchpad(recipe, "opensea", {
    namePrefix: "Grem #",
    description: "Series Gremlins",
    imageUriPrefix: "ipfs://Qm123/",
  }, traitItems);

  assert.equal(meta.name, "Grem #3");
  assert.equal(meta.description, "Series Gremlins");
  assert.equal(meta.image, "ipfs://Qm123/3.png");
  assert.ok(Array.isArray(meta.attributes));
  assert.ok(!meta.attributes.some((a) => a.value === "None"));
});

test("formatForLaunchpad Magic Eden Metaplex with royalties", () => {
  const recipe = {
    edition: 5,
    traits: { expression: "Smile" },
  };
  const traitItems = preset.traits?.items || preset.traits;
  const meta = formatForLaunchpad(recipe, "magiceden", {
    namePrefix: "Magic #",
    symbol: "MGC",
    sellerFeeBasisPoints: 750,
    creatorAddress: "8W4w...SoL",
    imageUriPrefix: "https://arweave.net/tx123/",
  }, traitItems);

  assert.equal(meta.name, "Magic #5");
  assert.equal(meta.symbol, "MGC");
  assert.equal(meta.seller_fee_basis_points, 750);
  assert.equal(meta.image, "https://arweave.net/tx123/5.png");
  assert.equal(meta.properties.category, "image");
  assert.equal(meta.properties.creators[0].address, "8W4w...SoL");
  assert.equal(meta.properties.creators[0].share, 100);
  assert.equal(meta.properties.files[0].uri, "https://arweave.net/tx123/5.png");
});

test("formatForLaunchpad LaunchMyNFT with 0-based indexing", () => {
  const recipe = {
    edition: 1,
    traits: { expression: "Smile" },
  };
  const traitItems = preset.traits?.items || preset.traits;
  const meta = formatForLaunchpad(recipe, "launchmynft", {
    namePrefix: "LMNFT #",
    symbol: "LMN",
    zeroIndexed: true,
    imageUriPrefix: "ipfs://QmZero/",
  }, traitItems);

  // Edition 1 maps to display 0 with 0-based indexing
  assert.equal(meta.name, "LMNFT #0");
  assert.equal(meta.image, "ipfs://QmZero/0.png");
  assert.equal(meta.properties.files[0].uri, "ipfs://QmZero/0.png");
});

test("formatForLaunchpad Bitcoin Ordinals Inscription format", () => {
  const recipe = {
    edition: 42,
    traits: { expression: "Grin" },
  };
  const traitItems = preset.traits?.items || preset.traits;
  const meta = formatForLaunchpad(recipe, "ordinalsbot", {
    namePrefix: "BtcGremlin #",
    symbol: "BTCG",
    imageUriPrefix: "ord://",
  }, traitItems);

  assert.equal(meta.id, "BTCG-42");
  assert.equal(meta.name, "BtcGremlin #42");
  assert.equal(meta.properties.edition, 42);
  assert.equal(meta.properties.collection, "BtcGremlin");
  assert.equal(meta.properties.files[0].uri, "ord://42.png");
});

test("exportManifestCsv generates valid CSV with attributes", () => {
  const recipes = [
    { edition: 1, traits: { hair: "Punk", eyewear: "None", mood: "Cool, Relaxed" } },
    { edition: 2, traits: { hair: "Bald", eyewear: "VR", mood: "Focused" } },
  ];
  const traitItems = [{ key: "hair" }, { key: "eyewear" }, { key: "mood" }];
  const csv = exportManifestCsv(recipes, traitItems, {
    namePrefix: "Series #",
    description: "Series NFT",
    imageUriPrefix: "ipfs://QmHash/",
  });

  const lines = csv.trim().split("\r\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[0], "id,edition,name,description,image,hair,eyewear,mood");
  // Check row 1 with quoted comma cell
  assert.equal(lines[1], '1,1,Series #1,Series NFT,ipfs://QmHash/1.png,Punk,,"Cool, Relaxed"');
  assert.equal(lines[2], "2,2,Series #2,Series NFT,ipfs://QmHash/2.png,Bald,VR,Focused");
});

test("buildBundleZip generates bundle with launchpad profile and manifest.csv", async () => {
  const testSetDir = join(ROOT, "out", "test-w13-set");
  const testBundlesDir = join(ROOT, "out", "test-w13-bundles");
  mkdirSync(testSetDir, { recursive: true });
  mkdirSync(testBundlesDir, { recursive: true });

  writeFileSync(join(testSetDir, "1.png"), mockPng());
  writeFileSync(join(testSetDir, "2.png"), mockPng());

  const marks = { 1: "keep", 2: "keep" };
  const archive = {
    presetId: "demo-series",
    recipes: [
      { edition: 1, traits: { hair: "Buzz", expression: "Smile" } },
      { edition: 2, traits: { hair: "Long", expression: "Grin" } },
    ],
  };

  const res = await buildBundleZip({
    archive,
    preset,
    setDir: testSetDir,
    set: "test-w13-set",
    marks,
    bundlesDir: testBundlesDir,
    bundleId: "w13-test-bundle",
    opts: {
      profile: "magiceden",
      creatorAddress: "8Creator...Sol",
      onlyKeep: true,
      namePrefix: "MagicGrem #",
      imageUriPrefix: "ipfs://QmBundle/",
    },
  });

  assert.equal(res.ok, true);
  assert.equal(res.profile, "magiceden");
  assert.equal(res.format, "metaplex");

  const zipPath = join(testBundlesDir, res.file);
  assert.ok(existsSync(zipPath));

  const zipBuf = readFileSync(zipPath);
  const zip = await JSZip.loadAsync(zipBuf);

  // Assert manifest.csv is present in root
  assert.ok(zip.file("manifest.csv") != null);
  const manifestContent = await zip.file("manifest.csv").async("string");
  assert.ok(manifestContent.includes("id,edition,name,description,image"));
  assert.ok(manifestContent.includes("MagicGrem #1"));
  assert.ok(manifestContent.includes("ipfs://QmBundle/1.png"));

  // Assert metadata files exist and have metaplex shape
  assert.ok(zip.file("metadata/1.json") != null);
  const meta1 = JSON.parse(await zip.file("metadata/1.json").async("string"));
  assert.equal(meta1.name, "MagicGrem #1");
  assert.equal(meta1.properties.creators[0].address, "8Creator...Sol");

  // Clean up
  try {
    rmSync(testSetDir, { recursive: true, force: true });
    rmSync(testBundlesDir, { recursive: true, force: true });
  } catch {}
});

test("CLI series manifest command creates CSV", () => {
  const archivePath = join(ROOT, "out", "demo-series.json");
  const outCsv = join(ROOT, "out", "test-cli-manifest.csv");

  execSync(`node bin/series.mjs manifest "${archivePath}" -o "${outCsv}" --profile opensea --image-prefix "ipfs://QmCLI/"`, {
    cwd: ROOT,
    stdio: "pipe",
  });

  assert.ok(existsSync(outCsv));
  const content = readFileSync(outCsv, "utf8");
  assert.ok(content.startsWith("id,edition,name,description,image"));
  assert.ok(content.includes("ipfs://QmCLI/1.png"));

  try {
    rmSync(outCsv, { force: true });
  } catch {}
});
