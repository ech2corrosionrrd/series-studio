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

test("Anthropic vision leaves room for a long trait list, and a cut-off reply is reported, not swallowed", async () => {
  const bodies = [];
  const cut = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return reply({ stop_reason: "max_tokens", content: [{ text: '{ "styleLock": { "angle": "front"' }] });
  };
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...a) => warnings.push(a.join(" "));
  try {
    const r = await analyzeBaseImage({ image: Buffer.from("png") }, { env: { ANTHROPIC_API_KEY: "k" }, fetch: cut });
    assert.match(r.provider, /^heuristic/, "falls back instead of returning half a JSON");
  } finally {
    console.warn = realWarn;
  }
  assert.ok(bodies[0].max_tokens >= 4096, `max_tokens ${bodies[0].max_tokens}`);
  assert.ok(warnings.some((w) => /cut off/.test(w)), `a warning says why: ${warnings.join("|")}`);
});

test("a reply that is whole but not JSON is also reported", async () => {
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...a) => warnings.push(a.join(" "));
  try {
    const r = await analyzeBaseImage(
      { image: Buffer.from("png") },
      { env: { ANTHROPIC_API_KEY: "k" }, fetch: async () => reply({ stop_reason: "end_turn", content: [{ text: "I cannot describe this image." }] }) },
    );
    assert.match(r.provider, /^heuristic/);
  } finally {
    console.warn = realWarn;
  }
  assert.ok(warnings.some((w) => /without usable JSON/.test(w)), warnings.join("|"));
});
