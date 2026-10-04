import test from "node:test";
import assert from "node:assert/strict";
import { createMockPng } from "../src/mock-image.mjs";
import { pngDimensions } from "../src/png-fit.mjs";
import {
  buildMarketplaceKit,
  buildListingCopy,
  marketplaceSizes,
  DEFAULT_MARKETPLACE_SIZES,
} from "../src/marketplace-kit.mjs";

test("sizes stay configurable and document the defaults", () => {
  const base = marketplaceSizes({});
  assert.equal(base.magicEden.banner.width, DEFAULT_MARKETPLACE_SIZES.magicEden.banner.width);
  assert.equal(base.openSea.avatar.width, 350);
  const custom = marketplaceSizes({
    MARKETPLACE_IMAGE_SIZES: JSON.stringify({ magicEden: { banner: { width: 800, height: 200 } } }),
  });
  assert.equal(custom.magicEden.banner.width, 800);
  assert.equal(custom.magicEden.banner.height, 200);
  assert.equal(custom.magicEden.avatar.width, 500);
});

test("listing copy keeps social placeholders and both locales", () => {
  const uk = buildListingCopy({ name: "Тест", description: "", locale: "uk" });
  assert.equal(uk.socials.twitter, "{{twitter}}");
  assert.match(uk.description, /Тест/);
  const en = buildListingCopy({ name: "Test", description: "About the drop", locale: "en" });
  assert.equal(en.description, "About the drop");
  assert.equal(en.socials.discord, "{{discord}}");
});

test("solana kit exports Magic Eden and Tensor images at the documented sizes", async () => {
  const cover = createMockPng({ seed: 11, width: 64, height: 64, title: "cover" });
  const kit = await buildMarketplaceKit({
    coverBuffer: cover,
    preset: { name: "Covered" },
    opts: { chain: "solana", description: "A drop", symbol: "COV" },
    locale: "en",
    env: {},
  });
  assert.equal(kit.chain, "solana");
  assert.match(kit.files["CHECKLIST.txt"], /Magic Eden/);
  assert.match(kit.files["CHECKLIST.txt"], /Tensor/);
  assert.match(kit.files["LISTING.txt"], /\{\{twitter\}\}/);
  assert.match(kit.files["VERIFY.txt"], /mplx cm validate/);
  const sizes = JSON.parse(kit.files["SIZES.json"]);
  assert.match(sizes.source, /cover/i);
  for (const [file, w, h] of [
    ["images/magic-eden-banner.png", 1400, 400],
    ["images/magic-eden-avatar.png", 500, 500],
    ["images/tensor-cover.png", 1000, 1000],
  ]) {
    const dim = pngDimensions(kit.files[file]);
    assert.ok(dim, file);
    assert.equal(dim.width, w, file);
    assert.equal(dim.height, h, file);
  }
  assert.equal(kit.warnings.length, 0);
});

test("evm kit is OpenSea-only and bitcoin kit names ordinals marketplaces", async () => {
  const cover = createMockPng({ seed: 12, width: 40, height: 40 });
  const evm = await buildMarketplaceKit({
    coverBuffer: cover,
    opts: { chain: "evm", name: "E", description: "d" },
    locale: "uk",
    env: {},
  });
  assert.ok(evm.files["images/opensea-banner.png"]);
  assert.equal(evm.files["images/magic-eden-banner.png"], undefined);
  assert.match(evm.files["CHECKLIST.txt"], /OpenSea/);
  const btc = await buildMarketplaceKit({
    coverBuffer: cover,
    opts: { chain: "bitcoin", name: "B", description: "d" },
    locale: "en",
    env: {},
  });
  assert.match(btc.files["CHECKLIST.txt"], /UniSat/);
  assert.match(btc.files["CHECKLIST.txt"], /Satflow/);
  assert.match(btc.files["CHECKLIST.txt"], /Gamma/);
  assert.match(btc.files["CHECKLIST.txt"], /OKX/);
  assert.match(btc.files["CHECKLIST.txt"], /Ordzaar/);
  const btcText = ["CHECKLIST.txt", "LISTING.txt", "VERIFY.txt", "ORDINALS.txt", "inscriptions.json", "SIZES.json"]
    .map((name) => String(btc.files[name] || ""))
    .join("\n");
  assert.equal(/magic eden/i.test(btcText), false);
  assert.match(btc.files["ORDINALS.txt"], /parent/i);
  assert.match(btc.files["ORDINALS.txt"], /child/i);
  const ids = JSON.parse(btc.files["inscriptions.json"]);
  assert.equal(ids.parent.inscriptionId, "");
  assert.equal(ids.children[0].inscriptionId, "");
  const evmText = ["CHECKLIST.txt", "LISTING.txt", "VERIFY.txt"].map((name) => String(evm.files[name] || "")).join("\n");
  assert.equal(/magic eden/i.test(evmText), false);
  const dim = pngDimensions(btc.files["images/ordinals-avatar.png"]);
  assert.equal(dim.width, 400);
  assert.equal(dim.height, 400);
});
