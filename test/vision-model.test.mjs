import test from "node:test";
import assert from "node:assert/strict";
import { analyzeBaseImage } from "../src/vision.mjs";

const GOOD = { styleLock: { angle: "front", light: "soft", mood: "calm", framing: "bust" }, suggestedTraits: [], summary: "ok" };
const reply = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

test("Anthropic vision uses the current model, and ANTHROPIC_MODEL overrides it", async () => {
  const models = [];
  const fetch = async (url, init) => {
    models.push(JSON.parse(init.body).model);
    return reply({ content: [{ text: JSON.stringify(GOOD) }] });
  };
  const image = Buffer.from("png");
  const def = await analyzeBaseImage({ image }, { env: { ANTHROPIC_API_KEY: "k" }, fetch });
  assert.equal(models[0], "claude-sonnet-5-5");
  assert.equal(def.provider, "anthropic (claude-sonnet-5-5)");
  const custom = await analyzeBaseImage({ image }, { env: { ANTHROPIC_API_KEY: "k", ANTHROPIC_MODEL: " claude-opus-5-5 " }, fetch });
  assert.equal(models[1], "claude-opus-5-5");
  assert.equal(custom.provider, "anthropic (claude-opus-5-5)");
});
