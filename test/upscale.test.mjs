import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSharp, upscale2x } from "../src/upscale.mjs";

test("upscale module exports loadSharp and upscale2x", () => {
  assert.equal(typeof loadSharp, "function");
  assert.equal(typeof upscale2x, "function");
});

test("upscale2x returns soft failure when sharp missing or input invalid (no throw)", async () => {
  const result = await upscale2x(Buffer.from("not-an-image"));
  assert.equal(typeof result, "object");
  assert.equal(result.ok, false);
  assert.equal(typeof result.reason, "string");
});

test("loadSharp returns null or a sharp factory without throwing", async () => {
  const sharp = await loadSharp();
  assert.ok(sharp === null || typeof sharp === "function");
});
