import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { createMockPng } from "../src/mock-image.mjs";
import {
  runPreflight,
  metadataSchemaIssues,
  assessRoyalties,
} from "../src/preflight.mjs";
import { buildBundleZip } from "../src/export-bundle.mjs";

function meta(edition, extra = {}) {
  return {
    edition,
    meta: {
      name: `Item #${edition}`,
      description: "A tested collection",
      image: `${edition}.png`,
      attributes: [{ trait_type: "Background", value: edition === 1 ? "Red" : "Blue" }],
      ...extra,
    },
  };
}

test("metadata schema accepts erc721 and rejects a missing image", () => {
  assert.deepEqual(metadataSchemaIssues(meta(1).meta, "erc721"), []);
  const bad = metadataSchemaIssues({ name: "x", attributes: [] }, "erc721");
  assert.ok(bad.some((m) => m.includes("image")));
});

test("metaplex schema requires symbol, fee and files", () => {
  const issues = metadataSchemaIssues({
    name: "N",
    description: "d",
    image: "0.png",
    attributes: [],
    symbol: "LAB",
    seller_fee_basis_points: 500,
    properties: { files: [{ uri: "0.png", type: "image/png" }] },
  }, "metaplex");
  assert.deepEqual(issues, []);
  assert.ok(metadataSchemaIssues({ name: "N", image: "0.png", attributes: [] }, "metaplex").length > 0);
});

test("royalties: out of range is an error, placeholder address is a warning", () => {
  const bad = assessRoyalties({ sellerFeeBasisPoints: 20000, creators: [] });
  assert.ok(bad.errors.length > 0);
  const placeholder = assessRoyalties({
    sellerFeeBasisPoints: 500,
    creators: [{ address: "11111111111111111111111111111111", share: 100 }],
  });
  assert.equal(placeholder.errors.length, 0);
  assert.ok(placeholder.warnings.length > 0);
});

test("preflight blocks duplicate bytes and passes two distinct pngs", () => {
  const a = createMockPng({ seed: 1, width: 64, height: 64, title: "a" });
  const blocked = runPreflight({
    locale: "uk",
    standard: "erc721",
    description: "Опис колекції для тесту",
    coverPresent: true,
    recipes: [
      { edition: 1, dna: "bg:red", traits: { bg: "red" } },
      { edition: 2, dna: "bg:blue", traits: { bg: "blue" } },
    ],
    images: [
      { edition: 1, filename: "1.png", buffer: a },
      { edition: 2, filename: "2.png", buffer: a },
    ],
    metadata: [meta(1), meta(2)],
    royalties: { sellerFeeBasisPoints: 500, creators: [{ address: "Creator11111111111111111111111111111111", share: 100 }] },
  });
  assert.equal(blocked.ready, false);
  assert.ok(blocked.errors.some((e) => e.code === "duplicate_image"));
  assert.match(blocked.report, /заблоковано|ERROR/);

  const ok = runPreflight({
    locale: "en",
    standard: "erc721",
    description: "Distinct art",
    coverPresent: true,
    recipes: [
      { edition: 1, dna: "bg:red", traits: { bg: "red" } },
      { edition: 2, dna: "bg:blue", traits: { bg: "blue" } },
    ],
    images: [
      { edition: 1, filename: "1.png", buffer: a },
      { edition: 2, filename: "2.png", buffer: createMockPng({ seed: 2, width: 64, height: 64, title: "b" }) },
    ],
    metadata: [meta(1), meta(2)],
    royalties: { sellerFeeBasisPoints: 500, creators: [{ address: "Creator11111111111111111111111111111111", share: 100 }] },
  });
  assert.equal(ok.ready, true, ok.report);
  assert.equal(ok.errors.length, 0);
});

test("gated bundle throws on duplicate images and packs the ready files when images differ", async () => {
  const dir = mkdtempSync(join(tmpdir(), "series-preflight-"));
  const setDir = join(dir, "set");
  const bundles = join(dir, "bundles");
  mkdirSync(setDir, { recursive: true });
  const same = createMockPng({ seed: 7, width: 48, height: 48 });
  writeFileSync(join(setDir, "1.png"), same);
  writeFileSync(join(setDir, "2.png"), same);
  const archive = {
    presetId: "gate",
    recipes: [
      { edition: 1, dna: "a", traits: { bg: "red" } },
      { edition: 2, dna: "b", traits: { bg: "blue" } },
    ],
  };
  const preset = { id: "gate", name: "Gate", traits: { items: [{ key: "bg", type: "Background" }] } };
  await assert.rejects(
    () => buildBundleZip({
      archive,
      preset,
      setDir,
      set: "set",
      bundlesDir: bundles,
      opts: { profile: "opensea", onlyKeep: false, description: "Gate test", sellerFeeBasisPoints: 500, locale: "en", gate: true },
    }),
    (err) => err.code === "preflight_blocked" && err.status === 422,
  );

  writeFileSync(join(setDir, "2.png"), createMockPng({ seed: 8, width: 48, height: 48 }));
  const res = await buildBundleZip({
    archive,
    preset,
    setDir,
    set: "set",
    bundlesDir: bundles,
    opts: {
      profile: "magiceden",
      onlyKeep: false,
      description: "Gate test collection",
      sellerFeeBasisPoints: 500,
      creatorAddress: "Creator11111111111111111111111111111111",
      locale: "uk",
      gate: true,
    },
  });
  assert.equal(res.ready, true);
  const zip = await JSZip.loadAsync(readFileSync(join(bundles, res.file)));
  for (const name of ["cover.png", "royalties.json", "rarity.json", "rarity.txt", "README.txt", "preflight.txt"]) {
    assert.ok(zip.file(name), name);
  }
  const readme = await zip.file("README.txt").async("string");
  assert.match(readme, /Solana/);
  const royalties = JSON.parse(await zip.file("royalties.json").async("string"));
  assert.equal(royalties.sellerFeeBasisPoints, 500);
  rmSync(dir, { recursive: true, force: true });
});
