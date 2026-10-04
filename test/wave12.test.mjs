import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, readdirSync, writeFileSync, readFileSync } from "node:fs";
import JSZip from "jszip";
import {
  buildImageUri,
  calculateDeterministicCid,
  checkStorageStatus,
  uploadToIrys,
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

  it("checkStorageStatus detects Irys key", () => {
    assert.equal(checkStorageStatus({}).irys.present, false);
    assert.equal(checkStorageStatus({ IRYS_PRIVATE_KEY: "  " }).irys.present, false);
    assert.equal(checkStorageStatus({ IRYS_PRIVATE_KEY: "key" }).irys.present, true);
  });

  it("uploadToIrys uploads the folder via injected uploader and errors clearly", async () => {
    const testDir = join(rootDir, "out", "test-irys-upload");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "1.png"), tinyPng());
    writeFileSync(join(testDir, "2.png"), tinyPng());
    writeFileSync(join(testDir, "marks.json"), "{}\n");
    writeFileSync(join(testDir, "triage.json"), "{}\n");

    const calls = [];
    const funded = [];
    const uploaded = [];
    let price = 0.00001;
    let balance = 1;
    const createUploader = async (key, rpc) => {
      calls.push({ key, rpc });
      return {
        utils: { fromAtomic: (x) => Number(x), toAtomic: (x) => x },
        getPrice: async () => price,
        getLoadedBalance: async () => balance,
        fund: async (x) => funded.push(x),
        uploadFolder: async (dir) => {
          uploaded.push({ dir, names: readdirSync(dir).sort() });
          return { id: "MockManifestId123", dir };
        },
      };
    };

    const res = await uploadToIrys({ dir: testDir, irysPrivateKey: "k", rpcUrl: "http://rpc", createUploader });
    assert.equal(res.ok, true);
    assert.deepEqual(uploaded[0].names, ["1.png", "2.png"]);
    assert.notEqual(uploaded[0].dir, testDir);
    assert.equal(res.arweaveId, "MockManifestId123");
    assert.equal(res.arweaveUri, "ar://MockManifestId123/");
    assert.equal(res.gatewayUrl, "https://gateway.irys.xyz/MockManifestId123/");
    assert.equal(res.count, 2);
    assert.deepEqual(calls, [{ key: "k", rpc: "http://rpc" }]);

    // balance short -> top-up with a whole atomic amount; price over the limit -> refused before upload
    balance = 0;
    await uploadToIrys({ dir: testDir, irysPrivateKey: "k", createUploader });
    assert.equal(funded.length, 1);
    price = 1;
    await assert.rejects(uploadToIrys({ dir: testDir, irysPrivateKey: "k", createUploader, maxPriceSol: 0.05 }), /above the limit/);
    price = 0.00001;
    balance = 1;
    await assert.rejects(uploadToIrys({ dir: testDir, irysPrivateKey: "", createUploader }), /IRYS_PRIVATE_KEY/);
    await assert.rejects(
      uploadToIrys({ dir: testDir, irysPrivateKey: "k", createUploader: async () => ({ ...(await createUploader()), uploadFolder: async () => ({}) }) }),
      /no manifest ID/,
    );
    await assert.rejects(uploadToIrys({ dir: join(testDir, "nope"), irysPrivateKey: "k", createUploader }), /not found/);
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

  it("CLI pin command executes dry-run cleanly with simulated content ID", async () => {
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
    assert.match(stdout, /\[DRY-RUN\] Local stand-in, not an Arweave id: Qm/);
    assert.ok(stdout.includes("Arweave (Irys): ar://<manifest-id>/"));
    assert.equal(stdout.includes("Simulated content ID"), false);
  });
});
