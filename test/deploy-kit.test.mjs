import test from "node:test";
import assert from "node:assert/strict";
import { createMockPng } from "../src/mock-image.mjs";
import {
  estimateDeployCost,
  buildDeployKit,
  formatCostEstimate,
  chainForProfile,
} from "../src/deploy-kit.mjs";

test("chainForProfile keeps solana first-class without dropping the others", () => {
  assert.equal(chainForProfile("magiceden", "metaplex"), "solana");
  assert.equal(chainForProfile("opensea", "erc721"), "evm");
  assert.equal(chainForProfile("ordinalsbot", "ordinals"), "bitcoin");
});

test("solana estimate is lamports from config, USD only when the owner set a rate", () => {
  const bare = estimateDeployCost({ chain: "solana", count: 10 }, {});
  assert.equal(bare.label, "estimate");
  assert.equal(bare.lamports, 20_000_000 + 10 * 15_000);
  assert.equal(bare.usd, null);
  assert.match(bare.formula, /lamports/);
  const priced = estimateDeployCost({ chain: "solana", count: 10 }, { DEPLOY_SOL_USD: "100" });
  assert.equal(priced.usd, Math.round((bare.sol * 100) * 100) / 100);
  const text = formatCostEstimate(bare, "uk");
  assert.match(text, /ОЦІНКА/);
  assert.match(text, /не задано|USD/);
});

test("evm estimate omits ETH when gwei is unset", () => {
  const est = estimateDeployCost({ chain: "evm", count: 3 }, {});
  assert.equal(est.gasUnits, 2_500_000);
  assert.equal(est.eth, null);
  assert.equal(est.usd, null);
  const withGas = estimateDeployCost({ chain: "evm", count: 3 }, { DEPLOY_EVM_GAS_GWEI: "20", DEPLOY_ETH_USD: "2000" });
  assert.ok(withGas.eth > 0);
  assert.ok(withGas.usd > 0);
});

test("ordinals estimate needs an owner-set sat rate", () => {
  const est = estimateDeployCost({ chain: "bitcoin", count: 2, totalBytes: 1000 }, {});
  assert.equal(est.sats, null);
  assert.equal(est.bytes, 1000 + 2 * 400);
  const set = estimateDeployCost({ chain: "bitcoin", count: 2, totalBytes: 1000 }, { DEPLOY_ORDINALS_SATS_PER_VBYTE: "2" });
  assert.equal(set.sats, est.bytes * 2);
});

test("solana kit defaults to Core Candy Machine, keeps Sugar as labelled legacy, and has no key slot", () => {
  const png = createMockPng({ seed: 3, width: 32, height: 32 });
  const kit = buildDeployKit({
    archive: { presetId: "kit", size: 2 },
    preset: { id: "kit", name: "Kit Series" },
    items: [
      { edition: 1, buffer: png, ext: "png", recipe: { edition: 1, traits: { bg: "a" } } },
      { edition: 2, buffer: createMockPng({ seed: 4, width: 32, height: 32 }), ext: "png", recipe: { edition: 2, traits: { bg: "b" } } },
    ],
    opts: { chain: "solana", symbol: "KIT", sellerFeeBasisPoints: 500, description: "Hello", creatorAddress: "Creator11111111111111111111111111111111" },
    locale: "uk",
    env: {},
  });
  assert.equal(kit.chain, "solana");
  assert.ok(kit.files["cm-config.json"]);
  assert.equal(kit.files["config.json"], undefined);
  assert.ok(kit.files["assets/0.png"]);
  assert.ok(kit.files["assets/0.json"]);
  assert.ok(kit.files["assets/1.json"]);
  assert.ok(kit.files["assets/collection.json"]);
  const cfg = JSON.parse(kit.files["cm-config.json"]);
  assert.equal(cfg.itemsAvailable, 2);
  assert.equal(cfg.sellerFeeBasisPoints, 500);
  assert.equal(cfg.creators[0].address, "Creator11111111111111111111111111111111");
  assert.match(kit.files["DEPLOY.txt"], /mplx/);
  assert.equal(kit.files["DEPLOY.txt"].includes("sugar deploy"), false);
  assert.ok(kit.files["DEPLOY.txt"].toLowerCase().indexOf("devnet") < kit.files["DEPLOY.txt"].toLowerCase().indexOf("mainnet"));
  assert.match(kit.files["DEPLOY.txt"], /allowList/);
  assert.match(kit.files["DEPLOY.txt"], /mintLimit/);
  assert.match(kit.files["DEPLOY.txt"], /botTax/);
  assert.equal(/startDate/.test(kit.files["DEPLOY.txt"]), false);
  assert.match(kit.files["ROYALTIES.txt"], /ProgramAllowList/);
  assert.match(kit.files["sugar/LEGACY.txt"], /sugar/);
  assert.match(kit.files["sugar/LEGACY.txt"], /спадщина|legacy/i);
  assert.match(kit.guide, /приватний ключ|seed/i);
  assert.equal(kit.files.privateKey, undefined);
  const guideBlob = JSON.stringify(kit.files);
  assert.equal(/BEGIN (?:OPENSSH |RSA )?PRIVATE KEY/.test(guideBlob), false);

  const legacy = buildDeployKit({
    archive: { presetId: "kit", size: 2 },
    preset: { id: "kit", name: "Kit Series" },
    items: [
      { edition: 1, buffer: png, ext: "png", recipe: { edition: 1, traits: { bg: "a" } } },
    ],
    opts: { chain: "solana", legacy: true, symbol: "KIT" },
    locale: "uk",
    env: {},
  });
  assert.ok(legacy.files["config.json"]);
  assert.match(legacy.guide, /sugar/);
  assert.match(legacy.guide, /спадщина|legacy/i);
  assert.match(legacy.guide, /devnet/);
  assert.ok(legacy.guide.toLowerCase().indexOf("devnet") < legacy.guide.toLowerCase().indexOf("mainnet"));
});

test("thirdweb package and ordinals guide are chain-specific", () => {
  const item = { edition: 1, buffer: createMockPng({ seed: 9, width: 32, height: 32 }), ext: "png", recipe: { edition: 1, traits: { bg: "a" } } };
  const evm = buildDeployKit({
    items: [item],
    preset: { name: "EVM Series" },
    opts: { chain: "evm", description: "d", creatorAddress: "0x1111111111111111111111111111111111111111" },
    locale: "en",
    env: {},
  });
  assert.ok(evm.files["thirdweb.json"]);
  assert.match(evm.guide, /Sepolia/);
  assert.match(evm.guide, /private key/i);
  const btc = buildDeployKit({
    items: [item],
    preset: { name: "Ord" },
    opts: { chain: "bitcoin", description: "d" },
    locale: "en",
    env: {},
  });
  assert.ok(btc.files["manifest.csv"]);
  assert.match(btc.guide, /[Ss]ignet/);
  assert.match(btc.guide, /[Mm]ainnet/);
});
