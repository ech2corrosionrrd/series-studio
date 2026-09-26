import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import JSZip from "jszip";
import {
  getMimeType,
  getMediaCategory,
  formatForLaunchpad,
  exportManifestCsv,
  findEditionMedia,
  buildBundleZip,
} from "../src/index.mjs";

test("Wave 15 — getMimeType and getMediaCategory", () => {
  assert.equal(getMimeType("1.mp4"), "video/mp4");
  assert.equal(getMimeType("anim.webm"), "video/webm");
  assert.equal(getMimeType("render.mov"), "video/quicktime");
  assert.equal(getMimeType("token.gif"), "image/gif");
  assert.equal(getMimeType("model.glb"), "model/gltf-binary");
  assert.equal(getMimeType("model.gltf"), "model/gltf+json");
  assert.equal(getMimeType("interactive.html"), "text/html");
  assert.equal(getMimeType("poster.png"), "image/png");
  assert.equal(getMimeType("photo.jpg"), "image/jpeg");
  assert.equal(getMimeType("art.webp"), "image/webp");

  assert.equal(getMediaCategory("1.mp4"), "video");
  assert.equal(getMediaCategory("1.webm"), "video");
  assert.equal(getMediaCategory("model.glb"), "vr");
  assert.equal(getMediaCategory("model.gltf"), "vr");
  assert.equal(getMediaCategory("app.html"), "html");
  assert.equal(getMediaCategory("static.png"), "image");
});

test("Wave 15 — formatForLaunchpad with animation_url", () => {
  const recipe = {
    edition: 1,
    traits: { Background: "Neon", Head: "Crown" },
  };

  // OpenSea / ERC-721
  const erc721 = formatForLaunchpad(recipe, "opensea", {
    imageUriPrefix: "ipfs://QmImages/",
    animationUriPrefix: "ipfs://QmAnimations/",
  });
  assert.equal(erc721.image, "ipfs://QmImages/1.png");
  assert.equal(erc721.animation_url, "ipfs://QmAnimations/1.mp4");

  // Metaplex / Magic Eden
  const metaplex = formatForLaunchpad(recipe, "magiceden", {
    imageUriPrefix: "ipfs://QmImages/",
    animationUriPrefix: "ipfs://Qm3DModels/",
    animationExtension: "glb",
    creatorAddress: "SolanaWallet123",
  });
  assert.equal(metaplex.image, "ipfs://QmImages/1.png");
  assert.equal(metaplex.animation_url, "ipfs://Qm3DModels/1.glb");
  assert.equal(metaplex.properties.category, "vr");
  assert.equal(metaplex.properties.files.length, 2);
  assert.equal(metaplex.properties.files[0].uri, "ipfs://QmImages/1.png");
  assert.equal(metaplex.properties.files[0].type, "image/png");
  assert.equal(metaplex.properties.files[1].uri, "ipfs://Qm3DModels/1.glb");
  assert.equal(metaplex.properties.files[1].type, "model/gltf-binary");

  // Ordinals
  const ordinals = formatForLaunchpad(recipe, "ordinalsbot", {
    imageUriPrefix: "ipfs://QmImages/",
    animationUriPrefix: "ipfs://QmAnimations/",
  });
  assert.equal(ordinals.image, "ipfs://QmImages/1.png");
  assert.equal(ordinals.animation_url, "ipfs://QmAnimations/1.mp4");
  assert.equal(ordinals.properties.files.length, 2);
});

test("Wave 15 — exportManifestCsv with animation_url column", () => {
  const recipes = [
    { edition: 1, traits: { BG: "Red" } },
    { edition: 2, traits: { BG: "Blue" }, animation_url: "ipfs://QmCustom/2.mp4" },
  ];

  const csv = exportManifestCsv(recipes, [{ key: "BG" }], {
    imageUriPrefix: "ipfs://QmImg/",
    animationUriPrefix: "ipfs://QmAnim/",
  });

  const lines = csv.trim().split("\r\n");
  assert.equal(lines[0], "id,edition,name,description,image,animation_url,BG");
  assert.ok(lines[1].includes("ipfs://QmAnim/1.mp4"));
  assert.ok(lines[2].includes("ipfs://QmCustom/2.mp4"));
});

test("Wave 15 — findEditionMedia and buildBundleZip with dynamic media", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "series-media-test-"));
  try {
    const setDir = join(tempDir, "set");
    const bundlesDir = join(tempDir, "bundles");
    mkdirSync(setDir, { recursive: true });

    // Create 1.png and 1.mp4, 2.png and 2.glb
    writeFileSync(join(setDir, "1.png"), Buffer.from("mock-png-1"));
    writeFileSync(join(setDir, "1.mp4"), Buffer.from("mock-mp4-video-1"));
    writeFileSync(join(setDir, "2.png"), Buffer.from("mock-png-2"));
    writeFileSync(join(setDir, "2.glb"), Buffer.from("mock-glb-3d-2"));

    const media1 = findEditionMedia(setDir, 1);
    assert.ok(media1.imagePath.endsWith("1.png"));
    assert.ok(media1.animationPath.endsWith("1.mp4"));

    const media2 = findEditionMedia(setDir, 2);
    assert.ok(media2.imagePath.endsWith("2.png"));
    assert.ok(media2.animationPath.endsWith("2.glb"));

    const archive = {
      presetId: "test-series",
      recipes: [
        { edition: 1, traits: { Style: "Neon" } },
        { edition: 2, traits: { Style: "Cyber" } },
      ],
    };

    const res = await buildBundleZip({
      archive,
      preset: { traits: [{ key: "Style" }] },
      setDir,
      set: "test-set",
      bundlesDir,
      bundleId: "media-bundle",
      opts: {
        profile: "magiceden",
        imageUriPrefix: "ipfs://QmImages/",
        animationUriPrefix: "ipfs://QmMedia/",
      },
    });

    assert.equal(res.ok, true);
    assert.equal(res.count, 2);

    // Verify ZIP contents
    const zipPath = join(bundlesDir, res.file);
    assert.ok(existsSync(zipPath));

    const zipData = new JSZip();
    const loaded = await zipData.loadAsync(writeFileSync ? (await import("node:fs")).readFileSync(zipPath) : null);

    assert.ok(loaded.file("images/1.png"));
    assert.ok(loaded.file("images/1.mp4"));
    assert.ok(loaded.file("images/2.png"));
    assert.ok(loaded.file("images/2.glb"));
    assert.ok(loaded.file("metadata/1.json"));
    assert.ok(loaded.file("metadata/2.json"));
    assert.ok(loaded.file("manifest.csv"));
    assert.equal(loaded.file("sugar.json"), null);
    assert.ok(loaded.file("cm-config.json"));
    assert.ok(loaded.file("sugar/config.json"));
    assert.match(await loaded.file("sugar/LEGACY.txt").async("string"), /legacy|застаріл/i);

    const meta1 = JSON.parse(await loaded.file("metadata/1.json").async("text"));
    assert.equal(meta1.image, "ipfs://QmImages/1.png");
    assert.equal(meta1.animation_url, "ipfs://QmMedia/1.mp4");
    assert.equal(meta1.properties.category, "video");

    const meta2 = JSON.parse(await loaded.file("metadata/2.json").async("text"));
    assert.equal(meta2.image, "ipfs://QmImages/2.png");
    assert.equal(meta2.animation_url, "ipfs://QmMedia/2.glb");
    assert.equal(meta2.properties.category, "vr");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
