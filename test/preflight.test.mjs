import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { createMockPng } from "../src/mock-image.mjs";
import { deflateSync, crc32 } from "node:zlib";
import {
  runPreflight,
  metadataSchemaIssues,
  assessRoyalties,
  PREFLIGHT_RECOMMENDED_IMAGE_BYTES,
  dnaKey,
} from "../src/preflight.mjs";
import { dna } from "../src/recipes.mjs";
import { aHashPng, hamming } from "../src/dupes.mjs";
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

function baseInput(images, recipes) {
  return {
    locale: "en",
    standard: "erc721",
    description: "Size check",
    coverPresent: true,
    recipes,
    images,
    metadata: recipes.map((r) => meta(r.edition)),
    royalties: { sellerFeeBasisPoints: 500, creators: [{ address: "Creator11111111111111111111111111111111", share: 100 }] },
  };
}

test("preflight warns above 1 MB and still errors above the hard cap", () => {
  const header = createMockPng({ seed: 3, width: 8, height: 8 });
  const twoMb = Buffer.alloc(2 * 1024 * 1024);
  header.copy(twoMb);
  const warned = runPreflight(baseInput(
    [{ edition: 1, filename: "1.png", buffer: twoMb }],
    [{ edition: 1, dna: "only", traits: { bg: "red" } }],
  ));
  assert.equal(warned.ready, true, warned.report);
  assert.ok(warned.warnings.some((w) => w.code === "size" && w.message.includes("1 MB")));
  assert.ok(twoMb.length > PREFLIGHT_RECOMMENDED_IMAGE_BYTES);

  const over = Buffer.alloc(64 * 1024);
  header.copy(over);
  const blocked = runPreflight(baseInput(
    [{ edition: 1, filename: "1.png", buffer: over }],
    [{ edition: 1, dna: "only", traits: { bg: "red" } }],
  ), { PREFLIGHT_MAX_IMAGE_BYTES: "1024" });
  assert.equal(blocked.ready, false);
  assert.ok(blocked.errors.some((e) => e.code === "size"));
});

test("preflight names ar://, ipfs:// and https:// when image URIs are local filenames", () => {
  const png = createMockPng({ seed: 9, width: 8, height: 8 });
  const local = runPreflight(baseInput(
    [{ edition: 1, filename: "1.png", buffer: png }],
    [{ edition: 1, dna: "solo", traits: { bg: "red" } }],
  ));
  const uri = local.warnings.find((w) => w.code === "uri");
  assert.ok(uri);
  assert.match(uri.message, /ar:\/\//);
  assert.match(uri.message, /ipfs:\/\//);
  assert.match(uri.message, /https:\/\//);

  const uk = runPreflight({
    ...baseInput(
      [{ edition: 1, filename: "1.png", buffer: png }],
      [{ edition: 1, dna: "solo", traits: { bg: "red" } }],
    ),
    locale: "uk",
  });
  assert.match(uk.warnings.find((w) => w.code === "uri").message, /ar:\/\//);

  const remote = runPreflight({
    ...baseInput(
      [{ edition: 1, filename: "1.png", buffer: png }],
      [{ edition: 1, dna: "solo", traits: { bg: "red" } }],
    ),
    metadata: [meta(1, { image: "ar://manifest/1.png" })],
  });
  assert.equal(remote.warnings.some((w) => w.code === "uri"), false);
});

test("preflight uses the recipe DNA helper and warns on a close aHash", () => {
  const traits = { hat: "cap" };
  const key = dnaKey({ line: "a", traits }, ["hat"]);
  assert.equal(key, dna("a", traits, ["hat"]));
  const dup = runPreflight(baseInput(
    [
      { edition: 1, filename: "1.png", buffer: createMockPng({ seed: 1, width: 16, height: 16 }) },
      { edition: 2, filename: "2.png", buffer: createMockPng({ seed: 2, width: 16, height: 16 }) },
    ],
    [
      { edition: 1, line: "a", traits },
      { edition: 2, line: "a", traits },
    ],
  ));
  assert.equal(dup.ready, false);
  assert.ok(dup.errors.some((e) => e.code === "duplicate_dna"));

  const pixels = (flip) => {
    const out = [];
    for (let i = 0; i < 64; i++) {
      const on = i < 32 || (flip && i === 32);
      out.push(on ? [100, 100, 100] : [0, 0, 0]);
    }
    return out;
  };
  const png = (flip) => rgbPng(pixels(flip), 8, 8);
  const left = png(false);
  const right = png(true);
  const distance = hamming(aHashPng(left), aHashPng(right));
  assert.ok(distance > 0 && distance <= 8, `distance ${distance}`);
  const near = runPreflight(baseInput(
    [
      { edition: 1, filename: "1.png", buffer: left },
      { edition: 2, filename: "2.png", buffer: right },
    ],
    [
      { edition: 1, dna: "a", traits: { hat: "cap" } },
      { edition: 2, dna: "b", traits: { hat: "brim" } },
    ],
  ));
  assert.equal(near.ready, true, near.report);
  assert.ok(near.warnings.some((w) => w.code === "near_duplicate" && w.message.includes("1") && w.message.includes("2")));
});

function rgbPng(pixels, w, h) {
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixels[y * w + x];
      const o = 1 + x * 3;
      row[o] = r;
      row[o + 1] = g;
      row[o + 2] = b;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}
