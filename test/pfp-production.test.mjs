import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { b58decode, isSolanaWallet } from "../src/platform/wallet.mjs";
import {
  buildAllowlist,
  encodeBase58,
  normalizeAllowlist,
  parseAllowlistText,
  verifyMerkleProof,
} from "../src/allowlist.mjs";
import {
  coreGuardConfig,
  guardUpdateConfig,
  releaseFromArchive,
} from "../src/release-config.mjs";
import {
  canonicalRevealJson,
  checkReveal,
  hiddenSettings,
  placeholderPng,
  revealDataHash,
  revealItemsFromCache,
  revealUpdates,
} from "../src/reveal.mjs";
import { decodePngRgba } from "../src/dupes.mjs";
import { encodeRgbaPng } from "../src/png-fit.mjs";
import { composeEdition, compositeOver } from "../src/layers.mjs";
import { dna } from "../src/recipes.mjs";
import { buildDeployKit } from "../src/deploy-kit.mjs";

const CREATOR = "So11111111111111111111111111111111111111112";
const WALLETS = [
  "GjwcWFQYzemBtpUoN5fMAP2FZviTtMRWCmrppGuTthJS",
  "2vjCrmEFiN9CLLhiqy8u1JPh48av8Zpzp3kNkdTtirYG",
  "AT8nPwujHAD14cLojTcB1qdBzA1VXnT6LVGuUd6Y73Cy",
];
const cli = resolve("bin/series.mjs");

function tmp() {
  return mkdtempSync(join(tmpdir(), "series-pfp-"));
}

function leafOf(address) {
  return Buffer.from(keccak_256(Buffer.from(address, "utf8")));
}

function hashPair(a, b) {
  const [left, right] = Buffer.compare(a, b) <= 0 ? [a, b] : [b, a];
  return Buffer.from(keccak_256(Buffer.concat([left, right])));
}

function solidPng(w, h, r, g, b, a = 255) {
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = a;
  }
  return encodeRgbaPng(w, h, rgba);
}

function release(extra = {}) {
  return {
    ...releaseFromArchive({ size: 20 }, { name: "Drop", symbol: "DRP" }, { creator: CREATOR, price: 0.3 }),
    ...extra,
  };
}

describe("allowlist merkle", () => {
  it("hashes the base58 text and sorts pairs the way Candy Guard does", () => {
    for (const w of WALLETS) assert.equal(isSolanaWallet(w), true);
    const one = buildAllowlist([WALLETS[0]]);
    assert.equal(one.merkleRoot, leafOf(WALLETS[0]).toString("hex"));
    assert.equal(one.proofs[0].proof.length, 0);
    assert.equal(Buffer.from(b58decode(one.merkleRootBase58)).toString("hex"), one.merkleRoot);

    const twoLeaves = WALLETS.slice(0, 2).map(leafOf);
    const two = buildAllowlist(WALLETS.slice(0, 2));
    assert.equal(two.merkleRoot, hashPair(twoLeaves[0], twoLeaves[1]).toString("hex"));

    const threeLeaves = WALLETS.map(leafOf);
    const promoted = hashPair(hashPair(threeLeaves[0], threeLeaves[1]), threeLeaves[2]);
    const three = buildAllowlist(WALLETS);
    assert.equal(three.merkleRoot, promoted.toString("hex"));
    assert.match(three.merkleRoot, /^[0-9a-f]{64}$/);
    for (const row of three.proofs) {
      const proof = row.proof.map((hex) => Buffer.from(hex, "hex"));
      assert.equal(verifyMerkleProof(leafOf(row.address), proof, Buffer.from(three.merkleRoot, "hex")), true);
    }
    // A sorted pair ignores order. Which leaves are paired does not: reversing three wallets changes the root.
    assert.equal(buildAllowlist([WALLETS[1], WALLETS[0]]).merkleRoot, two.merkleRoot);
    assert.notEqual(buildAllowlist([...WALLETS].reverse()).merkleRoot, three.merkleRoot);
  });

  it("rejects duplicates, comments, and a bad label", () => {
    assert.deepEqual(parseAllowlistText("# note\n\n" + WALLETS[0] + "\n"), [WALLETS[0]]);
    assert.throws(() => buildAllowlist([WALLETS[0], WALLETS[0]]), /duplicate/);
    assert.throws(() => buildAllowlist(["not-a-wallet"]), /not a Solana address/);
    assert.throws(() => normalizeAllowlist({ label: "toolong", wallets: [WALLETS[0]] }), /1\.\.6/);
    const priced = normalizeAllowlist({ label: "vip", wallets: [WALLETS[0]], priceSol: 0.05 });
    assert.equal(priced.label, "vip");
    assert.equal(priced.priceSol, 0.05);
    assert.equal(normalizeAllowlist(null), null);
    assert.equal(encodeBase58(Buffer.from(threeRoot())), buildAllowlist(WALLETS).merkleRootBase58);
  });
});

function threeRoot() {
  return Buffer.from(buildAllowlist(WALLETS).merkleRoot, "hex");
}

describe("guards include allowList as a group", () => {
  it("keeps the public set free of allowList and repeats payment inside the group", () => {
    const bare = coreGuardConfig(release());
    assert.deepEqual(Object.keys(bare.guardConfig), ["solPayment"]);
    assert.equal(bare.groups, undefined);

    const cfg = release({ allowlist: { label: "wl", wallets: WALLETS, priceSol: 0.05 } });
    const core = coreGuardConfig(cfg);
    assert.equal(core.guardConfig.allowList, undefined);
    assert.equal(core.guardConfig.solPayment.lamports, 300000000);
    assert.equal(core.groups.length, 1);
    assert.equal(core.groups[0].label, "wl");
    assert.equal(core.groups[0].guards.allowList.merkleRoot, buildAllowlist(WALLETS).merkleRoot);
    assert.equal(core.groups[0].guards.solPayment.lamports, 50000000);
    assert.equal(core.groups[0].guards.solPayment.destination, CREATOR);

    const sugar = guardUpdateConfig(cfg);
    assert.equal(sugar.guards.default.allowList, undefined);
    assert.equal(sugar.guards.groups[0].guards.allowList.merkleRoot, buildAllowlist(WALLETS).merkleRootBase58);
    assert.equal(sugar.guards.groups[0].guards.solPayment.value, 0.05);
  });

  it("series guards writes the Core group and the proof file", () => {
    const dir = tmp();
    const rel = join(dir, "release.json");
    writeFileSync(rel, JSON.stringify(release()));
    writeFileSync(join(dir, "wallets.txt"), `# vip\n${WALLETS[0]}\n${WALLETS[1]}\n`);
    const out = join(dir, "guard-config.json");
    const text = execFileSync(process.execPath, [cli, "guards", rel, "-o", out, "--allowlist", join(dir, "wallets.txt")], { encoding: "utf8" });
    const conf = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(conf.guardConfig.allowList, undefined);
    assert.equal(conf.groups[0].label, "wl");
    assert.equal(conf.groups[0].guards.allowList.merkleRoot, buildAllowlist(WALLETS.slice(0, 2)).merkleRoot);
    const proofs = JSON.parse(readFileSync(join(dir, "allowlist-proofs.json"), "utf8"));
    assert.equal(proofs.wallets.length, 2);
    assert.match(text, /allowlist-proofs\.json/);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("solana hidden settings and reveal", () => {
  const rows = [
    { name: "Drop #1", uri: "https://gateway.irys.xyz/aaa" },
    { name: "Drop #2", uri: "https://gateway.irys.xyz/bbb" },
  ];

  it("hashes JSON.stringify([{name,uri}]) and refuses a password field", () => {
    const json = JSON.stringify(rows);
    assert.equal(canonicalRevealJson(rows), json);
    const hash = createHash("sha256").update(json).digest("hex");
    assert.equal(revealDataHash(rows), hash);
    const hidden = hiddenSettings({ name: "Hidden #", uri: "https://gateway.irys.xyz/hidden", revealData: rows });
    assert.deepEqual(Object.keys(hidden).sort(), ["hash", "name", "uri"]);
    assert.equal(hidden.hash, hash);
    assert.equal(hidden.password, undefined);
    assert.throws(() => hiddenSettings({ name: "", uri: "https://x", revealData: rows }), /name/);
    assert.throws(() => hiddenSettings({ name: "n", uri: "", revealData: rows }), /uri/);
    const png = placeholderPng();
    assert.equal(png.subarray(0, 4).toString("hex"), "89504e47");
    assert.equal(decodePngRgba(png).width, 32);
  });

  it("reads cache.json in index order and skips the collection", () => {
    const items = revealItemsFromCache({
      items: {
        "-1": { name: "Collection", metadata_link: "https://gateway.irys.xyz/col" },
        1: { name: rows[1].name, metadata_link: rows[1].uri },
        0: { name: rows[0].name, metadata_link: rows[0].uri },
      },
    });
    assert.deepEqual(items, rows);
    assert.throws(() => revealItemsFromCache({ items: { 0: { name: "A", metadata_link: "https://x" }, 2: { name: "C", metadata_link: "https://z" } } }), /missing item 1/);
  });

  it("series hidden fills the hash, series reveal writes the update list", () => {
    const dir = tmp();
    writeFileSync(join(dir, "cache.json"), JSON.stringify({
      items: {
        "-1": { name: "Collection", metadata_link: "https://gateway.irys.xyz/col" },
        0: { name: rows[0].name, metadata_link: rows[0].uri },
        1: { name: rows[1].name, metadata_link: rows[1].uri },
      },
    }));
    const uri = "https://gateway.irys.xyz/hiddenjson";
    execFileSync(process.execPath, [cli, "hidden", dir, "--uri", uri, "--name", "Hidden #"], { encoding: "utf8" });
    const hidden = JSON.parse(readFileSync(join(dir, "hidden-settings.json"), "utf8"));
    assert.equal(hidden.uri, uri);
    assert.equal(hidden.hash, revealDataHash(rows));
    assert.equal(hidden.password, undefined);
    const out = execFileSync(process.execPath, [cli, "reveal", dir], { encoding: "utf8" });
    const updates = JSON.parse(readFileSync(join(dir, "reveal-updates.json"), "utf8"));
    assert.equal(updates.hash, hidden.hash);
    assert.deepEqual(updates.items.map(({ name, uri: u }) => ({ name, uri: u })), rows);
    assert.match(out, /does not sign/);
    writeFileSync(join(dir, "bad.json"), JSON.stringify([{ name: "Other", uri: "https://no" }]));
    assert.throws(() => execFileSync(process.execPath, [cli, "reveal", dir, "--check", join(dir, "bad.json")], { stdio: "pipe" }));
    const report = checkReveal(rows, rows);
    assert.equal(report.ok, true);
    assert.equal(checkReveal(rows, [{ name: "Drop #1", uri: "https://other" }]).ok, false);
    hidden.hash = "0".repeat(64);
    assert.throws(() => revealUpdates(rows, hidden), /does not match/);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("png layer compositor", () => {
  const items = [
    { key: "bg", options: [{ value: "Red", prompt: "red fill" }, { value: "Blue", prompt: "blue fill" }, { value: "Green", prompt: "green fill" }] },
    { key: "fx", skipDna: true, options: [{ value: "Glow", prompt: "glow", layer: "shared/glow.png" }] },
  ];

  function layers(dir) {
    mkdirSync(join(dir, "bg"), { recursive: true });
    mkdirSync(join(dir, "shared"), { recursive: true });
    writeFileSync(join(dir, "bg", "Red.png"), solidPng(2, 2, 200, 10, 10, 255));
    writeFileSync(join(dir, "bg", "Blue.png"), solidPng(2, 2, 10, 10, 200, 128));
    writeFileSync(join(dir, "shared", "glow.png"), solidPng(2, 2, 0, 255, 0, 0));
  }

  it("stacks base then traits, keeps the prompt, and matches DNA", () => {
    const bottom = decodePngRgba(solidPng(2, 2, 0, 0, 255, 255)).rgba;
    const top = decodePngRgba(solidPng(2, 2, 255, 0, 0, 255)).rgba;
    const over = compositeOver(bottom, top);
    assert.equal(over[0], 255);
    assert.equal(over[2], 0);
    const clear = decodePngRgba(solidPng(2, 2, 1, 2, 3, 0)).rgba;
    assert.equal(compositeOver(bottom, clear).equals(bottom), true);

    const dir = tmp();
    layers(dir);
    const base = solidPng(2, 2, 0, 0, 40, 255);
    const traits = { bg: "Red", fx: "Glow" };
    const recipe = { edition: 1, line: "A", traits, prompt: "keep this prompt", dna: dna("A", traits, ["bg"]) };
    const a = composeEdition({ recipe, items, basePng: base, layerDir: dir });
    const b = composeEdition({ recipe, items, basePng: base, layerDir: dir });
    assert.equal(a.sha256, b.sha256);
    assert.equal(a.prompt, "keep this prompt");
    assert.equal(a.dna, "A|Red");
    assert.deepEqual(a.layers, ["base", "bg/Red", "fx/Glow"]);
    const px = decodePngRgba(a.png).rgba;
    assert.equal(px[0], 200);
    assert.equal(px[1], 10);

    const none = composeEdition({
      recipe: { edition: 2, line: "A", traits: { bg: "None", fx: "None" }, prompt: "still here" },
      items,
      basePng: base,
      layerDir: dir,
    });
    assert.deepEqual(none.layers, ["base"]);
    assert.equal(none.prompt, "still here");
    assert.equal(none.dna, "A|None");
    assert.throws(() => composeEdition({
      recipe: { edition: 3, line: "A", traits: { bg: "Green", fx: "None" }, prompt: "x" },
      items,
      basePng: base,
      layerDir: dir,
    }), /missing layer/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("series compose writes edition pngs and dna.json without dropping prompts", () => {
    const dir = tmp();
    const layerDir = join(dir, "layers");
    layers(layerDir);
    const preset = join(dir, "preset.json");
    writeFileSync(preset, JSON.stringify({ id: "layers", traits: { items } }));
    const traits = { bg: "Red", fx: "Glow" };
    const archive = join(dir, "archive.json");
    writeFileSync(archive, JSON.stringify({
      presetId: "layers",
      size: 1,
      recipes: [{ edition: 1, line: "A", traits, prompt: "engine prompt stays", dna: dna("A", traits, ["bg"]) }],
    }));
    const base = join(dir, "base.png");
    writeFileSync(base, solidPng(2, 2, 0, 0, 40, 255));
    const out = join(dir, "out");
    const text = execFileSync(process.execPath, [cli, "compose", archive, "--preset", preset, "--layers", layerDir, "--base", base, "-o", out], { encoding: "utf8" });
    assert.match(text, /Composed 1/);
    const report = JSON.parse(readFileSync(join(out, "dna.json"), "utf8"));
    assert.equal(report.source, "layers");
    assert.equal(report.editions[0].prompt, "engine prompt stays");
    assert.equal(report.editions[0].dna, "A|Red");
    assert.equal(readFileSync(join(out, "1.png")).subarray(0, 4).toString("hex"), "89504e47");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("deploy kit allowlist", () => {
  it("writes allowlist.json and still leaves the hidden hash empty", () => {
    const kit = buildDeployKit({
      archive: { presetId: "kit", size: 1 },
      preset: { id: "kit", name: "Kit" },
      items: [{ edition: 1, buffer: solidPng(2, 2, 1, 2, 3), ext: "png", recipe: { edition: 1, traits: { bg: "a" } } }],
      opts: { chain: "solana", symbol: "KIT", creatorAddress: CREATOR, allowlist: WALLETS.join("\n") },
      locale: "en",
      env: {},
    });
    const al = JSON.parse(kit.files["allowlist.json"]);
    assert.equal(al.merkleRoot, buildAllowlist(WALLETS).merkleRoot);
    assert.equal(al.wallets.length, 3);
    assert.equal(kit.files["DEPLOY.txt"].includes(al.merkleRoot), true);
    assert.equal(/startDate/.test(kit.files["DEPLOY.txt"]), false);
    const hidden = JSON.parse(kit.files["hidden-settings.json"]);
    assert.equal(hidden.hash, null);
    assert.equal(hidden.uri, "");
    assert.throws(() => buildDeployKit({
      archive: { presetId: "kit", size: 1 },
      preset: { id: "kit", name: "Kit" },
      items: [{ edition: 1, buffer: solidPng(2, 2, 1, 2, 3), ext: "png", recipe: { edition: 1, traits: {} } }],
      opts: { chain: "solana", symbol: "KIT", allowlist: "nope" },
      locale: "en",
      env: {},
    }), /not a Solana address/);
  });
});
