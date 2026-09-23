import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  calculateRarityScores,
  generateShowcaseHtml,
  getRarityTier,
  RARITY_TIERS,
} from "../src/index.mjs";

test("Wave 16 — getRarityTier assigns accurate percentile tiers", () => {
  assert.equal(getRarityTier(1, 100).tier, "mythic"); // Top 1%
  assert.equal(getRarityTier(5, 100).tier, "legendary"); // Top 5%
  assert.equal(getRarityTier(20, 100).tier, "epic"); // Top 20%
  assert.equal(getRarityTier(40, 100).tier, "rare"); // Top 40%
  assert.equal(getRarityTier(80, 100).tier, "common"); // Bottom 50%
});

test("Wave 16 — calculateRarityScores calculates trait scores and ranks editions", () => {
  const archive = {
    presetId: "test-rarity",
    seed: "seed-123",
    recipes: [
      { edition: 1, dna: "A1-B1", traits: { Hat: "Crown", Shirt: "Gold" } },
      { edition: 2, dna: "A2-B2", traits: { Hat: "Cap", Shirt: "Tee" } },
      { edition: 3, dna: "A2-B2", traits: { Hat: "Cap", Shirt: "Tee" } },
      { edition: 4, dna: "A2-B2", traits: { Hat: "Cap", Shirt: "Tee" } },
    ],
  };

  const scores = calculateRarityScores(archive);
  assert.equal(scores.totalEditions, 4);
  assert.equal(scores.editions.length, 4);

  // Edition #1 has rare traits (Crown: 1/4 = score 4, Gold: 1/4 = score 4 -> total 8)
  const topEdition = scores.editions[0];
  assert.equal(topEdition.edition, 1);
  assert.equal(topEdition.rank, 1);
  assert.equal(topEdition.rarityScore, 8);
  assert.equal(topEdition.tier.tier, "mythic");

  // Editions #2, #3, #4 have common traits (Cap: 3/4 = score 1.33, Tee: 3/4 = score 1.33 -> total 2.66)
  assert.equal(scores.editions[1].rarityScore, 2.66);
  assert.equal(scores.stats.topScore, 8);
  assert.equal(scores.stats.minScore, 2.66);
});

test("Wave 16 — generateShowcaseHtml produces valid self-contained HTML", () => {
  const archive = {
    presetId: "cyber-gremlins",
    seed: "cyber-v1",
    recipes: [
      { edition: 1, dna: "DNA-001", traits: { Skin: "Chrome", Eyes: "Laser" } },
      { edition: 2, dna: "DNA-002", traits: { Skin: "Green", Eyes: "Normal" } },
    ],
  };

  const html = generateShowcaseHtml(archive, { name: "Cyber Gremlins" });
  assert.ok(html.includes("<!doctype html>"));
  assert.ok(html.includes("Cyber Gremlins"));
  assert.ok(html.includes("cyber-gremlins"));
  assert.ok(html.includes("cyber-v1"));
  assert.ok(html.includes("DATA ="));
  assert.ok(html.includes("card-grid"));
  assert.ok(html.includes("tier-btn"));
});

test("Wave 16 — CLI series showcase generates standalone HTML file", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "series-showcase-test-"));
  try {
    const archivePath = join(tempDir, "archive.json");
    const outHtml = join(tempDir, "showcase.html");

    const archive = {
      presetId: "showcase-demo",
      seed: "showcase-seed",
      recipes: [
        { edition: 1, dna: "G1", traits: { BG: "Neon", Head: "Crown" } },
        { edition: 2, dna: "G2", traits: { BG: "Dark", Head: "Cap" } },
      ],
    };
    writeFileSync(archivePath, JSON.stringify(archive, null, 2));

    execSync(`node bin/series.mjs showcase "${archivePath}" -o "${outHtml}"`, {
      encoding: "utf8",
    });

    assert.ok(existsSync(outHtml));
    const content = readFileSync(outHtml, "utf8");
    assert.ok(content.includes("showcase-demo"));
    assert.ok(content.includes("Crown"));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
