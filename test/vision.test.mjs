import test from "node:test";
import assert from "node:assert/strict";
import { analyzeBaseImage, fallbackVisionOutput, parseVisionJson, sanitizeVisionOutput } from "../src/vision.mjs";

const GOOD = {
  styleLock: { angle: " front ", light: "soft", mood: "calm", framing: "bust", extraKeep: ["a", "", null, " b "] },
  suggestedTraits: [
    { key: "eye color!", options: [{ value: "Blue", weight: 0, prompt: "blue eyes" }, { value: "" }, null] },
    { key: "empty", options: [] },
    { type: "no key", options: [{ value: "x" }] },
    "junk",
  ],
  summary: "  nice  ",
};
const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const openai = (content) => reply({ choices: [{ message: { content } }] });
const anthropic = (text) => reply({ content: [{ text }] });
const IMG = { image: Buffer.from("png") };
const quiet = async (fn) => {
  const w = console.warn;
  console.warn = () => {};
  try { return await fn(); } finally { console.warn = w; }
};

test("sanitizeVisionOutput: trims, strips key characters, drops empty traits, min weight 1", () => {
  const out = sanitizeVisionOutput(GOOD);
  assert.deepEqual(out.styleLock, { angle: "front", light: "soft", mood: "calm", framing: "bust", extraKeep: ["a", "b"] });
  assert.deepEqual(out.suggestedTraits, [{ key: "eyecolor", type: "eyecolor", options: [{ value: "Blue", weight: 1, prompt: "blue eyes" }] }]);
  assert.equal(out.summary, "nice");
  assert.deepEqual(sanitizeVisionOutput(null).suggestedTraits, []);
});

test("parseVisionJson: plain, fenced and invalid input", () => {
  assert.equal(parseVisionJson(JSON.stringify(GOOD)).summary, "nice");
  assert.equal(parseVisionJson("```json\n" + JSON.stringify(GOOD) + "\n```").summary, "nice");
  assert.equal(parseVisionJson("not json"), null);
  assert.equal(parseVisionJson(""), null);
  assert.equal(parseVisionJson("42"), null);
});

test("fallbackVisionOutput is already in the sanitized shape", () => {
  const f = fallbackVisionOutput();
  assert.deepEqual(sanitizeVisionOutput(f), f);
});

test("analyzeBaseImage: no image, no keys → heuristic", async () => {
  assert.equal((await analyzeBaseImage({ image: "" }, { env: {} })).ok, false);
  const r = await analyzeBaseImage(IMG, { env: {} });
  assert.deepEqual([r.ok, r.provider.startsWith("heuristic")], [true, true]);
});

test("analyzeBaseImage: OpenAI first, request carries the image", async () => {
  const seen = [];
  const fetch = async (url, init) => {
    seen.push({ url, body: JSON.parse(init.body) });
    return openai(JSON.stringify(GOOD));
  };
  const r = await analyzeBaseImage(IMG, { env: { OPENAI_API_KEY: "k" }, fetch });
  assert.match(r.provider, /^openai/);
  assert.equal(seen.length, 1);
  assert.ok(seen[0].body.messages[1].content[1].image_url.url.startsWith("data:image/png;base64,"));
});

test("analyzeBaseImage: OpenAI failure falls through to Anthropic, then to heuristic", async () => {
  await quiet(async () => {
    const urls = [];
    const both = async (url) => {
      urls.push(url);
      return url.includes("openai") ? reply({}, 500) : anthropic(JSON.stringify(GOOD));
    };
    const a = await analyzeBaseImage({ ...IMG, mime: "image/webp" }, { env: { OPENAI_API_KEY: "k", ANTHROPIC_API_KEY: "k" }, fetch: both });
    assert.match(a.provider, /^anthropic/);
    assert.equal(urls.length, 2);
    const dead = async () => { throw new Error("offline"); };
    const h = await analyzeBaseImage(IMG, { env: { OPENAI_API_KEY: "k", ANTHROPIC_API_KEY: "k" }, fetch: dead });
    assert.match(h.provider, /^heuristic/);
    const garbage = await analyzeBaseImage(IMG, { env: { OPENAI_API_KEY: "k" }, fetch: async () => openai("nonsense") });
    assert.match(garbage.provider, /^heuristic/);
  });
});
