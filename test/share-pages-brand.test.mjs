import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

// Картки поширення ведуть лише на Series Lab: не на w3ir.io (Промт) і не на ai.w3ir.io (стара платформа).
process.env.SERIES_PUBLIC_DIR = mkdtempSync(join(tmpdir(), "share-brand-"));
delete process.env.AUTH_URI;
const site = await import("../src/platform/site.mjs");

test("share card: og:image, canonical and CTA point to lab.w3ir.io", () => {
  const slug = site.publishCollection("Brand check", [{ name: "a.png", bytes: Buffer.from("png") }]);
  const html = site.renderCollectionHtml(slug);
  assert.ok(html.includes(`https://lab.w3ir.io/c/${slug}/img/1.png`));
  assert.ok(html.includes(`https://lab.w3ir.io/c/${slug}`));
  assert.ok(html.includes("https://lab.w3ir.io/?utm_source=collection_share"));
  assert.ok(!/ai\.w3ir\.io|https:\/\/w3ir\.io/.test(html), "no links to other products");
});

test("legal pages link to Series Lab only", () => {
  for (const lang of ["uk", "en"]) {
    const html = site.renderLegalHtml(lang);
    if (!html) continue;
    assert.ok(!/href="https:\/\/ai\.w3ir\.io/.test(html), `${lang}: no ai.w3ir.io link`);
  }
});
