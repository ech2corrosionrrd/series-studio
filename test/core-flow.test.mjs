import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";
import { allowlistOf, releaseFromArchive } from "../src/release-config.mjs";
import { revealUpdates } from "../src/reveal.mjs";
import {
  ALLOW_LIST_GUARD_ID,
  MINT_V1_DISCRIMINATOR,
  MPL_CORE_PROGRAM,
  ROUTE_DISCRIMINATOR,
  UPDATE_V1_DISCRIMINATOR,
  allowListProofPda,
  appendMintRecord,
  buildUpdateV1,
  candyMachineAuthorityPda,
  mintLimitPda,
  planCoreMint,
  planCoreReveal,
  readCollectionUpdateAuthority,
  selectMintGroup,
  sendInstructions,
} from "../src/core-flow.mjs";

const CREATOR = "So11111111111111111111111111111111111111112";
const MACHINE = "2vjCrmEFiN9CLLhiqy8u1JPh48av8Zpzp3kNkdTtirYG";
const GUARD = "AT8nPwujHAD14cLojTcB1qdBzA1VXnT6LVGuUd6Y73Cy";
const OTHER = "GjwcWFQYzemBtpUoN5fMAP2FZviTtMRWCmrppGuTthJS";
const cli = resolve("bin/series.mjs");

function releaseFor(minter) {
  const cfg = releaseFromArchive({ size: 10 }, {}, { creator: CREATOR, price: 0.2 });
  cfg.allowlist = { wallets: [minter, OTHER] };
  cfg.mint = { startDate: "2026-10-15T18:00:00Z", limitPerWallet: 2 };
  cfg.deployed = { candyMachine: MACHINE, candyGuard: GUARD, collection: CREATOR };
  return cfg;
}

function tmp() {
  return mkdtempSync(join(tmpdir(), "series-core-flow-"));
}

describe("core mint transaction", () => {
  const minter = Keypair.generate();
  const minterKey = minter.publicKey.toBase58();
  const asset = Keypair.generate().publicKey.toBase58();

  it("builds route then mintV1 for an allowlist wallet", () => {
    const cfg = releaseFor(minterKey);
    assert.equal(selectMintGroup({ release: cfg, minter: minterKey }), "wl");
    assert.equal(selectMintGroup({ release: cfg, minter: OTHER, publicPhase: true }), null);
    const plan = planCoreMint({ release: cfg, minter: minterKey, asset, index: 3, label: "wl" });
    assert.equal(plan.index, 3);
    assert.equal(plan.instructions.length, 2);
    const [route, mint] = plan.instructions;
    assert.equal(route.name, "route");
    assert.ok(route.data.subarray(0, 8).equals(ROUTE_DISCRIMINATOR));
    assert.equal(route.data[8], ALLOW_LIST_GUARD_ID);
    assert.equal(route.keys[3].pubkey, plan.proofPda);
    assert.equal(route.keys[3].isWritable, true);
    assert.equal(route.keys[4].pubkey, "11111111111111111111111111111111");
    assert.ok(route.data.includes(Buffer.from("wl")));

    assert.ok(mint.data.subarray(0, 8).equals(MINT_V1_DISCRIMINATOR));
    assert.equal(mint.data.readUInt32LE(8), 0);
    assert.equal(mint.data[12], 1);
    assert.equal(mint.keys.length, 16);
    assert.equal(mint.keys[0].pubkey, GUARD);
    assert.equal(mint.keys[1].pubkey, "CMACYFENjoBMHzapRXyo1JZkVS6EtaDDzkjMrmQLvr4J");
    assert.equal(mint.keys[2].isWritable, true);
    assert.equal(mint.keys[3].pubkey, candyMachineAuthorityPda(MACHINE));
    assert.equal(mint.keys[3].isWritable, true);
    assert.equal(mint.keys[6].pubkey, "CMAGAKJ67e9hRZgfC5SFTbZH8MgEmtqazKXjmkaJjWTJ");
    assert.equal(mint.keys[6].isSigner, false);
    assert.equal(mint.keys[7].pubkey, asset);
    assert.equal(mint.keys[7].isSigner, true);
    assert.equal(mint.keys[7].isWritable, true);
    assert.equal(mint.keys[8].pubkey, CREATOR);
    assert.equal(mint.keys[13].pubkey, CREATOR);
    assert.equal(mint.keys[13].isWritable, true);
    assert.equal(mint.keys[14].pubkey, plan.proofPda);
    assert.equal(mint.keys[14].isWritable, false);
    assert.equal(mint.keys[15].isWritable, true);
    assert.equal(mint.keys[15].pubkey, mintLimitPda({ id: 1, minter: minterKey, candyGuard: GUARD, candyMachine: MACHINE }));
    const authority = PublicKey.findProgramAddressSync(
      [Buffer.from("candy_machine"), new PublicKey(MACHINE).toBuffer()],
      new PublicKey("CMACYFENjoBMHzapRXyo1JZkVS6EtaDDzkjMrmQLvr4J"),
    )[0].toBase58();
    assert.equal(candyMachineAuthorityPda(MACHINE), authority);
    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("allow_list"),
        Buffer.from(allowlistOf(cfg).merkleRoot, "hex"),
        new PublicKey(minterKey).toBuffer(),
        new PublicKey(GUARD).toBuffer(),
        new PublicKey(MACHINE).toBuffer(),
      ],
      new PublicKey("CMAGAKJ67e9hRZgfC5SFTbZH8MgEmtqazKXjmkaJjWTJ"),
    );
    assert.equal(plan.proofPda, pda.toBase58());
  });

  it("puts the merkle proof bytes on the route and omits them for a public mint", () => {
    const cfg = releaseFor(minterKey);
    const plan = planCoreMint({ release: cfg, minter: minterKey, asset, label: "wl" });
    const alRoot = plan.instructions[0];
    const innerLen = alRoot.data.readUInt32LE(9);
    const count = alRoot.data.readUInt32LE(13);
    assert.equal(count, 1);
    assert.equal(innerLen, 4 + 32);
    const sibling = alRoot.data.subarray(17, 49);
    assert.equal(sibling.length, 32);

    const outsider = Keypair.generate().publicKey.toBase58();
    assert.equal(selectMintGroup({ release: cfg, minter: outsider }), null);
    const pub = planCoreMint({ release: cfg, minter: outsider, asset, label: null });
    assert.equal(pub.instructions.length, 1);
    assert.equal(pub.instructions[0].name, "mintV1");
    assert.equal(pub.instructions[0].data[12], 0);
    assert.equal(pub.proofPda, null);
    assert.equal(pub.instructions[0].keys.length, 15);
    assert.equal(pub.instructions[0].keys[13].pubkey, CREATOR);
    assert.equal(pub.instructions[0].keys[14].pubkey, mintLimitPda({ id: 1, minter: outsider, candyGuard: GUARD, candyMachine: MACHINE }));
  });

  it("refuses a guard it cannot fill, a root mismatch, and a Sugar machine", () => {
    const cfg = releaseFor(minterKey);
    assert.throws(
      () => planCoreMint({
        release: cfg,
        minter: minterKey,
        asset,
        label: "wl",
        chain: { groupList: [{ label: "wl", guards: { botTax: { lamports: 1 }, solPayment: { destination: CREATOR } } }] },
      }),
      /botTax/,
    );
    assert.throws(
      () => planCoreMint({
        release: cfg,
        minter: minterKey,
        asset,
        label: "wl",
        chain: { groupList: [{ label: "wl", guards: { allowList: { merkleRoot: "ab".repeat(32) }, solPayment: { destination: CREATOR } } }] },
      }),
      /root/,
    );
    assert.throws(() => planCoreMint({ release: { ...cfg, standard: "v3" }, minter: minterKey, asset }), /v3/);
    assert.throws(() => selectMintGroup({ release: cfg, minter: minterKey, group: "nope" }), /not "nope"/);
  });

  it("sends the built transaction through the caller and records the asset", async () => {
    const cfg = releaseFor(minterKey);
    const plan = planCoreMint({ release: cfg, minter: minterKey, asset, index: 0, label: "wl" });
    const sig = await sendInstructions({
      instructions: plan.instructions,
      signers: [minter, Keypair.generate()],
      rpcUrl: "http://127.0.0.1:1",
      feePayer: minter.publicKey,
      sendImpl: async ({ transaction }) => {
        assert.equal(transaction.instructions.length, 2);
        assert.equal(transaction.feePayer.toBase58(), minterKey);
        assert.equal(transaction.instructions[0].programId.toBase58(), "CMAGAKJ67e9hRZgfC5SFTbZH8MgEmtqazKXjmkaJjWTJ");
        return "mint-sig";
      },
    });
    const dir = tmp();
    const file = join(dir, "mints.json");
    appendMintRecord(file, { ...plan, mintSignature: sig });
    const saved = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(saved.items[0].asset, asset);
    assert.equal(saved.items[0].index, 0);
    assert.equal(saved.items[0].mintSignature, "mint-sig");
    assert.equal(saved.items[0].revealSignature, null);
    assert.equal(saved.collection, CREATOR);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("core reveal transaction", () => {
  it("signs UpdateV1 as the collection update authority", () => {
    const payer = Keypair.generate();
    const asset = Keypair.generate().publicKey.toBase58();
    const ix = buildUpdateV1({
      asset,
      collection: CREATOR,
      payer: payer.publicKey.toBase58(),
      name: "Drop #1",
      uri: "https://gateway.irys.xyz/aaa",
    });
    assert.equal(ix.programId, MPL_CORE_PROGRAM);
    assert.equal(ix.data[0], UPDATE_V1_DISCRIMINATOR);
    assert.equal(ix.data[1], 1);
    assert.ok(ix.data.includes(Buffer.from("Drop #1")));
    assert.ok(ix.data.includes(Buffer.from("https://gateway.irys.xyz/aaa")));
    assert.equal(ix.data[ix.data.length - 1], 0);
    assert.equal(ix.keys[0].pubkey, asset);
    assert.equal(ix.keys[0].isSigner, false);
    assert.equal(ix.keys[0].isWritable, true);
    assert.equal(ix.keys[1].pubkey, CREATOR);
    assert.equal(ix.keys[2].pubkey, payer.publicKey.toBase58());
    assert.equal(ix.keys[2].isSigner, true);
    assert.equal(ix.keys[3].isSigner, true);
    assert.equal(ix.keys[5].pubkey, MPL_CORE_PROGRAM);

    const buf = Buffer.alloc(33);
    buf[0] = 5;
    payer.publicKey.toBuffer().copy(buf, 1);
    assert.equal(readCollectionUpdateAuthority(buf), payer.publicKey.toBase58());
    assert.throws(() => readCollectionUpdateAuthority(Buffer.from([1, 0])), /not a Core collection/);
  });

  it("pairs minted indexes with reveal rows and skips a finished one", () => {
    const payer = Keypair.generate().publicKey.toBase58();
    const updates = revealUpdates([
      { name: "Drop #1", uri: "https://gateway.irys.xyz/aaa" },
      { name: "Drop #2", uri: "https://gateway.irys.xyz/bbb" },
    ], null);
    const asset0 = Keypair.generate().publicKey.toBase58();
    const asset1 = Keypair.generate().publicKey.toBase58();
    const plan = planCoreReveal({
      updates,
      payer,
      mints: {
        collection: CREATOR,
        items: [
          { index: 0, asset: asset0, revealSignature: "done" },
          { index: 1, asset: asset1, revealSignature: null, hidden: true },
        ],
      },
    });
    assert.equal(plan.pending.length, 1);
    assert.equal(plan.pending[0].asset, asset1);
    assert.equal(plan.pending[0].name, "Drop #2");
    assert.equal(plan.skipped[0].reason, "already revealed");
    assert.throws(
      () => planCoreReveal({
        updates,
        payer,
        mints: { collection: CREATOR, items: [{ index: 4, asset: asset0 }] },
      }),
      /no row/,
    );
  });
});

describe("series mint and series reveal CLI", () => {
  it("dry-run mint prints the allowlist route and does not write mints.json", () => {
    const dir = tmp();
    const kp = Keypair.generate();
    const cfg = releaseFor(kp.publicKey.toBase58());
    const release = join(dir, "release.json");
    const keyFile = join(dir, "minter.json");
    writeFileSync(release, JSON.stringify(cfg));
    writeFileSync(keyFile, JSON.stringify([...kp.secretKey]));
    const out = execFileSync(process.execPath, [cli, "mint", release, "--keypair", keyFile, "--dry-run", "--index", "4"], { encoding: "utf8" });
    assert.match(out, /group wl/);
    assert.match(out, /index 4/);
    assert.match(out, /allowList route/);
    assert.match(out, /route \+ mintV1/);
    assert.match(out, /dry-run/);
    assert.throws(() => readFileSync(join(dir, "mints.json")));
    const pub = execFileSync(process.execPath, [cli, "mint", release, "--keypair", keyFile, "--public", "--dry-run"], { encoding: "utf8" });
    assert.match(pub, /public guard set/);
    assert.equal(/allowList route/.test(pub), false);
    assert.throws(
      () => execFileSync(process.execPath, [cli, "mint", release, "--keypair", keyFile, "--index", "1"], { encoding: "utf8", stdio: "pipe" }),
      (err) => /--index/.test(err.stderr),
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it("dry-run reveal names the minted asset and leaves the record unsigned", () => {
    const dir = tmp();
    const creator = Keypair.generate();
    const asset = Keypair.generate().publicKey.toBase58();
    writeFileSync(join(dir, "reveal-data.json"), JSON.stringify([
      { name: "Drop #1", uri: "https://gateway.irys.xyz/aaa" },
    ]));
    writeFileSync(join(dir, "hidden-settings.json"), JSON.stringify({
      name: "Hidden #",
      uri: "https://gateway.irys.xyz/hidden",
      hash: revealUpdates([{ name: "Drop #1", uri: "https://gateway.irys.xyz/aaa" }], null).hash,
    }));
    writeFileSync(join(dir, "mints.json"), JSON.stringify({
      standard: "core",
      collection: CREATOR,
      items: [{ index: 0, asset, mintSignature: "mint-sig", revealSignature: null, hidden: true }],
    }));
    writeFileSync(join(dir, "creator.json"), JSON.stringify([...creator.secretKey]));
    const out = execFileSync(process.execPath, [cli, "reveal", dir, "--keypair", join(dir, "creator.json"), "--dry-run"], { encoding: "utf8" });
    assert.match(out, new RegExp(asset));
    assert.match(out, /Drop #1/);
    assert.match(out, /dry-run/);
    assert.match(out, /thirdweb/i);
    const saved = JSON.parse(readFileSync(join(dir, "mints.json"), "utf8"));
    assert.equal(saved.items[0].revealSignature, null);
    rmSync(dir, { recursive: true, force: true });
  });
});
