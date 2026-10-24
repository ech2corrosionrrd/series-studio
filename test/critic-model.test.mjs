import test from "node:test";
import assert from "node:assert/strict";
import { triageImageVision } from "../src/critic.mjs";
import { DEFAULT_ANTHROPIC_MODEL, anthropicModel } from "../src/models.mjs";

const answer = { ok: true, status: 200, json: async () => ({ content: [{ text: JSON.stringify({ score: 8, verdict: "keep", reason: "fine" }) }] }) };

test("anthropicModel: default, trimmed override, empty falls back", () => {
  assert.equal(DEFAULT_ANTHROPIC_MODEL, "claude-sonnet-5-5");
  assert.equal(anthropicModel({}), DEFAULT_ANTHROPIC_MODEL);
  assert.equal(anthropicModel({ ANTHROPIC_MODEL: "  " }), DEFAULT_ANTHROPIC_MODEL);
  assert.equal(anthropicModel({ ANTHROPIC_MODEL: " claude-haiku-5-5 " }), "claude-haiku-5-5");
});

test("the AI critic asks Anthropic for the configured model", async () => {
  const saved = process.env.ANTHROPIC_MODEL;
  const models = [];
  const fetchFn = async (url, init) => {
    models.push(JSON.parse(init.body).model);
    return answer;
  };
  const run = () => triageImageVision({ image: Buffer.from("png"), apiKey: "k", provider: "anthropic", recipe: { edition: 1, traits: {} }, fetchFn });
  try {
    delete process.env.ANTHROPIC_MODEL;
    await run();
    process.env.ANTHROPIC_MODEL = "claude-opus-5-5";
    await run();
  } finally {
    if (saved === undefined) delete process.env.ANTHROPIC_MODEL;
    else process.env.ANTHROPIC_MODEL = saved;
  }
  assert.deepEqual(models, ["claude-sonnet-5-5", "claude-opus-5-5"]);
});
