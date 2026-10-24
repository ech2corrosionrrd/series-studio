// `series upload --devnet`: a rehearsal on Irys devnet with test SOL. Mainnet stays the default and a mix-up of RPC and
// network is refused before anything is paid.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { uploadBundle } from "../src/arweave-upload.mjs";
import { IRYS_NETWORKS, assertRpcMatchesNetwork, irysNetwork } from "../src/storage.mjs";

function makeBundle(count = 2) {
  const root = mkdtempSync(join(tmpdir(), "upload-devnet-"));
  const assets = join(root, "assets");
  mkdirSync(assets);
  for (let i = 0; i < count; i++) {
    writeFileSync(join(assets, `${i}.png`), Buffer.from(`png-${i}`));
    writeFileSync(join(assets, `${i}.json`), JSON.stringify({ name: `Item #${i + 1}`, image: `${i}.png` }));
  }
  return root;
}

function mockUploader() {
  const seen = { key: null, rpc: null, network: null, uploads: 0 };
  let ids = 0;
  const irys = {
    utils: { fromAtomic: (x) => Number(x), toAtomic: (x) => ({ integerValue: () => Math.ceil(x * 1e9) }) },
    getPrice: async () => 0.01,
    getLoadedBalance: async () => 1,
    fund: async () => {},
    upload: async () => {
      seen.uploads += 1;
      return { id: `tx${++ids}` };
    },
  };
  return { seen, create: async (key, rpc, network) => Object.assign(seen, { key, rpc, network }) && irys };
}

describe("Irys network helpers", () => {
  it("mainnet is the default, devnet is explicit, anything else is an error", () => {
    assert.deepEqual([irysNetwork(), irysNetwork(""), irysNetwork(" MAINNET "), irysNetwork("Devnet")], ["mainnet", "mainnet", "mainnet", "devnet"]);
    assert.throws(() => irysNetwork("testnet"), /unknown Irys network/);
    assert.equal(IRYS_NETWORKS.devnet.gateway, "https://devnet.irys.xyz");
  });

  it("an RPC of the other cluster is refused", () => {
    assert.doesNotThrow(() => assertRpcMatchesNetwork("https://api.devnet.solana.com", "devnet"));
    assert.doesNotThrow(() => assertRpcMatchesNetwork("https://api.mainnet-beta.solana.com", "mainnet"));
    assert.doesNotThrow(() => assertRpcMatchesNetwork("https://my-private-rpc.example/abc", "mainnet"));
    assert.throws(() => assertRpcMatchesNetwork("https://api.mainnet-beta.solana.com", "devnet"), /needs a devnet RPC/);
    assert.throws(() => assertRpcMatchesNetwork("https://api.devnet.solana.com", "mainnet"), /needs --devnet/);
  });
});

describe("uploadBundle on devnet", () => {
  it("passes the network to the uploader, uses the devnet RPC and writes devnet links", async () => {
    const root = makeBundle(2);
    const up = mockUploader();
    const logs = [];
    await uploadBundle({ bundleDir: root, key: new Uint8Array(64), network: "devnet", createUploader: up.create, log: (m) => logs.push(m) });
    assert.equal(up.seen.network, "devnet");
    assert.equal(up.seen.rpc, "https://api.devnet.solana.com");
    assert.ok(logs.some((m) => /devnet rehearsal/.test(m)));
    const cache = JSON.parse(readFileSync(join(root, "cache.json"), "utf8"));
    for (const item of Object.values(cache.items)) {
      assert.match(item.image_link, /^https:\/\/devnet\.irys\.xyz\/tx\d+\?ext=png$/);
      assert.match(item.metadata_link, /^https:\/\/devnet\.irys\.xyz\/tx\d+$/);
    }
  });

  it("mainnet stays the default: gateway.irys.xyz links and the mainnet RPC", async () => {
    const root = makeBundle(1);
    const up = mockUploader();
    await uploadBundle({ bundleDir: root, key: new Uint8Array(64), createUploader: up.create });
    assert.equal(up.seen.network, "mainnet");
    assert.equal(up.seen.rpc, "https://api.mainnet-beta.solana.com");
    const cache = JSON.parse(readFileSync(join(root, "cache.json"), "utf8"));
    assert.match(Object.values(cache.items)[0].image_link, /^https:\/\/gateway\.irys\.xyz\//);
  });

  it("a network and RPC mix-up is refused before anything is uploaded", async () => {
    const root = makeBundle(1);
    const up = mockUploader();
    await assert.rejects(
      uploadBundle({ bundleDir: root, key: new Uint8Array(64), network: "devnet", rpcUrl: "https://api.mainnet-beta.solana.com", createUploader: up.create }),
      /needs a devnet RPC/,
    );
    await assert.rejects(
      uploadBundle({ bundleDir: root, key: new Uint8Array(64), rpcUrl: "https://api.devnet.solana.com", createUploader: up.create }),
      /needs --devnet/,
    );
    await assert.rejects(uploadBundle({ bundleDir: root, key: new Uint8Array(64), network: "testnet", createUploader: up.create }), /unknown Irys network/);
    assert.equal(up.seen.uploads, 0);
    assert.equal(up.seen.network, null, "the uploader was never even created");
  });
});

describe("series upload CLI", () => {
  it("lists --devnet in the help and still dry-runs without a key", () => {
    const help = execFileSync("node", ["bin/series.mjs", "--help"], { encoding: "utf8" });
    assert.match(help, /--devnet/);
    const root = makeBundle(2);
    const out = execFileSync("node", ["bin/series.mjs", "upload", root, "--dry-run", "--devnet"], { encoding: "utf8" });
    assert.match(out, /2 to upload|entries/);
  });
});
