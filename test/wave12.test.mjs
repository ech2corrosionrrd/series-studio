import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import JSZip from "jszip";
import {
  buildImageUri,
  calculateDeterministicCid,
  checkStorageStatus,
  uploadToPinata,
  generateMetadataPreview,
  buildBundleZip,
} from "../src/index.mjs";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const binPath = join(rootDir, "bin", "series.mjs");

function tinyPng() {
  const base = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  return Buffer.concat([base, Buffer.alloc(1100, 0)]);
}

describe("Wave 12: IPFS / Arweave Storage Dispatcher", () => {
  it("buildImageUri formats relative and decentralized URI prefixes accurately", () => {
    // Relative sugar default
    assert.equal(buildImageUri(1), "1.png");
    assert.equal(buildImageUri(42, ""), "42.png");

    // IPFS prefix
    assert.equal(buildImageUri(1, "ipfs://QmXabc123"), "ipfs://QmXabc123/1.png");
    assert.equal(buildImageUri(7, "ipfs://QmXabc123/"), "ipfs://QmXabc123/7.png");

    // Arweave prefix
    assert.equal(buildImageUri(5, "ar://TX_HASH_999"), "ar://TX_HASH_999/5.png");

    // HTTPS Gateway prefix
    assert.equal(buildImageUri(10, "https://ipfs.io/ipfs/bafy123"), "https://ipfs.io/ipfs/bafy123/10.png");

    // Custom placeholder template
    assert.equal(buildImageUri(3, "https://storage.io/img?id={edition}"), "https://storage.io/img?id=3");
    assert.equal(buildImageUri(3, "https://storage.io/{filename}"), "https://storage.io/3.png");
  });

  it("calculateDeterministicCid produces reproducible multihash CIDv0 strings", () => {
    const cid1 = calculateDeterministicCid("test data string");
    const cid2 = calculateDeterministicCid("test data string");
    const cidOther = calculateDeterministicCid("different data string");

    assert.ok(cid1.startsWith("Qm"));
    assert.equal(cid1, cid2);
    assert.notEqual(cid1, cidOther);
  });

  it("checkStorageStatus detects present Pinata env keys", () => {
    const empty = checkStorageStatus({});
    assert.equal(empty.pinata.present, false);

    const withJwt = checkStorageStatus({ PINATA_JWT: "mock-jwt" });
    assert.equal(withJwt.pinata.present, true);
    assert.equal(withJwt.pinata.type, "jwt");

    const withKeys = checkStorageStatus({ PINATA_API_KEY: "k", PINATA_SECRET_API_KEY: "s" });
    assert.equal(withKeys.pinata.present, true);
    assert.equal(withKeys.pinata.type, "keys");
  });

  it("uploadToPinata handles mock responses and error paths", async () => {
    const testDir = join(rootDir, "out", "test-pinata-upload");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "1.png"), tinyPng());

    const mockFetch = async () => ({
      ok: true,
      json: async () => ({
        IpfsHash: "QmMockPinataCid123456789",
        PinSize: 1024,
        Timestamp: new Date().toISOString(),
      }),
    });

    const res = await uploadToPinata({
      dir: testDir,
      name: "test-collection",
      pinataJwt: "mock-jwt",
      fetchFn: mockFetch,
    });

    assert.equal(res.ok, true);
    assert.equal(res.ipfsHash, "QmMockPinataCid123456789");
    assert.equal(res.ipfsUri, "ipfs://QmMockPinataCid123456789/");
    assert.equal(res.gatewayUrl, "https://gateway.pinata.cloud/ipfs/QmMockPinataCid123456789/");
  });

  it("generateMetadataPreview formats sample metadata with custom IPFS URI prefix", () => {
    const recipe = {
      edition: 1,
      prompt: "A cyber warrior",
      traits: { helmet: "Laser Visor" },
    };
    const traitItems = [{ key: "helmet", label: "Helmet", type: "Headgear" }];

    const erc = generateMetadataPreview(recipe, "erc721", {
      imageUriPrefix: "ipfs://QmCollectionHash/",
      namePrefix: "Cyber #",
    }, traitItems);

    assert.equal(erc.name, "Cyber #1");
    assert.equal(erc.image, "ipfs://QmCollectionHash/1.png");
    assert.deepEqual(erc.attributes, [{ trait_type: "Headgear", value: "Laser Visor" }]);

    const metaplex = generateMetadataPreview(recipe, "metaplex", {
      imageUriPrefix: "ipfs://QmCollectionHash/",
      symbol: "CYBER",
    }, traitItems);

    assert.equal(metaplex.image, "ipfs://QmCollectionHash/1.png");
    assert.equal(metaplex.properties.files[0].uri, "ipfs://QmCollectionHash/1.png");

    const ordinals = generateMetadataPreview(recipe, "ordinals", {
      imageUriPrefix: "ipfs://QmCollectionHash/",
    }, traitItems);

    assert.equal(ordinals.image, "ipfs://QmCollectionHash/1.png");
    assert.equal(ordinals.properties.files[0].uri, "ipfs://QmCollectionHash/1.png");
  });

  it("buildBundleZip applies imageUriPrefix into bundle metadata and collection.json", async () => {
    const setDir = join(rootDir, "out", "test-bundle-ipfs-set");
    const bundlesDir = join(rootDir, "out", "bundles");
    mkdirSync(setDir, { recursive: true });
    mkdirSync(bundlesDir, { recursive: true });

    writeFileSync(join(setDir, "1.png"), tinyPng());

    const archive = {
      presetId: "test-ipfs-series",
      size: 1,
      recipes: [{ edition: 1, traits: { type: "Warrior" }, prompt: "p1" }],
    };

    const result = await buildBundleZip({
      archive,
      setDir,
      set: "test-bundle-ipfs-set",
      bundlesDir,
      opts: {
        format: "erc721",
        onlyKeep: false,
        imageUriPrefix: "ipfs://QmBundleTestCid/",
        namePrefix: "Test #",
      },
    });

    assert.equal(result.ok, true);
    const zipPath = join(rootDir, result.path);
    const zip = await JSZip.loadAsync(readFileSync(zipPath));

    const item1Text = await zip.file("metadata/1.json").async("text");
    const item1 = JSON.parse(item1Text);
    assert.equal(item1.image, "ipfs://QmBundleTestCid/1.png");

    const collText = await zip.file("collection.json").async("text");
    const coll = JSON.parse(collText);
    assert.equal(coll.imageUriPrefix, "ipfs://QmBundleTestCid/");
  });

  it("CLI pin command executes dry-run cleanly with simulated CID", async () => {
    const testDir = join(rootDir, "out", "test-cli-pin");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "1.png"), tinyPng());

    const { stdout, stderr } = await execFileAsync("node", [
      binPath,
      "pin",
      testDir,
      "--dry-run",
    ]);

    assert.equal(stderr, "");
    assert.ok(stdout.includes("Series Lab CLI Pin"));
    assert.ok(stdout.includes("[DRY-RUN] Simulated IPFS CID: Qm"));
    assert.ok(stdout.includes("[DRY-RUN] Gateway URI: ipfs://Qm"));
  });
});
