import { test } from "node:test";
import assert from "node:assert/strict";
import { providerLinks, providersSnapshot, keyHealth, FLOAT_RECOMMENDED_USD } from "../src/platform/providers.mjs";

test("providerLinks lists Lab providers with dashboard urls", () => {
  const links = providerLinks();
  assert.ok(links.some((p) => p.id === "stability" && p.balance_via_api));
  assert.ok(links.every((p) => p.url.startsWith("http")));
});

test("providersSnapshot has float note and recommended map", () => {
  const s = providersSnapshot();
  assert.equal(s.providers.length, providerLinks().length);
  assert.ok(s.stability_usd_per_credit > 0);
  assert.ok(FLOAT_RECOMMENDED_USD["Stability AI"] >= 20);
});

test("keyHealth does not crash without keys (offline probe)", async () => {
  const rows = await keyHealth(async () => ({ ok: false }));
  assert.ok(Array.isArray(rows) && rows.length > 0);
  assert.ok(rows.every((r) => typeof r.id === "string"));
});
