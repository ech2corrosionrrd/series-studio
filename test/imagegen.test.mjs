import test from "node:test";
import assert from "node:assert/strict";
import {
  ENGINES, ENGINE_FLUX, ENGINE_GPT_IMAGE, ENGINE_STABILITY, ImageGenError, closestAspect, engineStatus,
  fidelityForGptImage, generateImage,
} from "../src/platform/imagegen.mjs";

const PNG = Buffer.from("fake-png");
const res = (status, body = {}) => ({
  ok: status < 400,
  status,
  json: async () => body,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.length),
});
const REF = { bytes: Buffer.from("ref"), mime: "image/jpeg", strength: 0.6 };
const ENV = { OPENAI_API_KEY: "o", STABILITY_API_KEY: "s", REPLICATE_API_TOKEN: "r", GPT_IMAGE_MAX_PER_MIN: "0" };
const b64Answer = () => res(200, { data: [{ b64_json: PNG.toString("base64") }] });

test("helpers: aspect, fidelity, engine status", () => {
  assert.deepEqual([closestAspect(2, 1), closestAspect(1, 2), closestAspect(1, 1)], ["16:9", "9:16", "1:1"]);
  assert.deepEqual([fidelityForGptImage(0.5), fidelityForGptImage(0.2)], ["high", "low"]);
  assert.deepEqual(engineStatus({}), {
    [ENGINE_GPT_IMAGE]: "OPENAI_API_KEY",
    [ENGINE_STABILITY]: "STABILITY_API_KEY",
    [ENGINE_FLUX]: "REPLICATE_API_TOKEN",
  });
  assert.deepEqual(Object.values(engineStatus(ENV)), ["", "", ""]);
});

test("unknown engine and missing keys fail without a request", async () => {
  await assert.rejects(generateImage("nope", "p"), /Невідомий двигун/);
  const never = async () => { throw new Error("must not be called"); };
  for (const [engine, key] of [[ENGINE_FLUX, "REPLICATE_API_TOKEN"], [ENGINE_STABILITY, "STABILITY_API_KEY"], [ENGINE_GPT_IMAGE, "OPENAI_API_KEY"]]) {
    await assert.rejects(generateImage(engine, "p", { env: {}, fetchImpl: never }), (e) => e instanceof ImageGenError && e.message.includes(key));
  }
});

test("flux: text-to-image, reference switches model, output is downloaded", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: init?.body });
    return url.includes("/predictions") ? res(200, { status: "succeeded", output: ["https://cdn.test/o.png"] }) : res(200);
  };
  const a = await generateImage(ENGINE_FLUX, "cat", { width: 2, height: 1, seed: 7, env: ENV, fetchImpl });
  assert.deepEqual([...a], [...PNG]);
  assert.ok(calls[0].url.includes("flux-schnell"));
  const input = JSON.parse(calls[0].body).input;
  assert.deepEqual([input.aspect_ratio, input.seed], ["16:9", 7]);
  await generateImage(ENGINE_FLUX, "cat", { reference: REF, env: ENV, fetchImpl });
  assert.ok(calls[2].url.includes("flux-kontext-dev"));
  assert.ok(JSON.parse(calls[2].body).input.input_image.startsWith("data:image/jpeg;base64,"));
});

test("flux: an NSFW false positive is retried with the next seed; other errors are not", async () => {
  const seeds = [];
  const fetchImpl = async (url, init) => {
    if (!url.includes("/predictions")) return res(200);
    seeds.push(JSON.parse(init.body).input.seed);
    return seeds.length < 2
      ? res(200, { status: "failed", error: "NSFW content detected" })
      : res(200, { status: "succeeded", output: "https://cdn.test/o.png" });
  };
  await generateImage(ENGINE_FLUX, "p", { seed: 10, env: ENV, fetchImpl });
  assert.deepEqual(seeds, [10, 11]);
  await assert.rejects(generateImage(ENGINE_FLUX, "p", { env: ENV, fetchImpl: async () => res(400, "bad input") }), /HTTP 400/);
});

test("stability: core for text, sd3 image-to-image for a reference, HTTP errors surface", async () => {
  const urls = [];
  const ok = async (url) => { urls.push(url); return res(200); };
  await generateImage(ENGINE_STABILITY, "p", { env: ENV, fetchImpl: ok });
  await generateImage(ENGINE_STABILITY, "p", { reference: REF, env: ENV, fetchImpl: ok });
  assert.ok(urls[0].endsWith("/core") && urls[1].endsWith("/sd3"));
  await assert.rejects(generateImage(ENGINE_STABILITY, "p", { env: ENV, fetchImpl: async () => res(403, "no") }), /Stability.*HTTP 403/);
});

test("gpt-image: generations and edits, b64 and url outputs, empty answer", async () => {
  const seen = [];
  const b64 = async (url) => { seen.push(url); return b64Answer(); };
  assert.deepEqual([...(await generateImage(ENGINE_GPT_IMAGE, "p", { env: ENV, fetchImpl: b64 }))], [...PNG]);
  await generateImage(ENGINE_GPT_IMAGE, "p", { reference: REF, env: ENV, fetchImpl: b64 });
  assert.ok(seen[0].endsWith("/generations") && seen[1].endsWith("/edits"));
  const viaUrl = async (url) => (url.includes("openai") ? res(200, { data: [{ url: "https://cdn.test/i.png" }] }) : res(200));
  assert.deepEqual([...(await generateImage(ENGINE_GPT_IMAGE, "p", { env: ENV, fetchImpl: viaUrl }))], [...PNG]);
  await assert.rejects(generateImage(ENGINE_GPT_IMAGE, "p", { env: ENV, fetchImpl: async () => res(200, { data: [] }) }), /без зображення/);
});

test("retry policy: quota and moderation are final, a rate limit waits for the hint and retries", async () => {
  let n = 0;
  await assert.rejects(generateImage(ENGINE_GPT_IMAGE, "p", { env: ENV, fetchImpl: async () => { n++; return res(402, "insufficient quota"); } }), /HTTP 402/);
  await assert.rejects(generateImage(ENGINE_GPT_IMAGE, "p", { env: ENV, fetchImpl: async () => { n++; return res(400, "moderation_blocked"); } }), /moderation_blocked/);
  assert.equal(n, 2, "no retries");
  let calls = 0;
  const limited = async () => {
    calls++;
    return calls === 1 ? res(429, "rate limit, try again in 1ms") : b64Answer();
  };
  assert.deepEqual([...(await generateImage(ENGINE_GPT_IMAGE, "p", { env: ENV, fetchImpl: limited }))], [...PNG]);
  assert.equal(calls, 2);
  assert.equal(ENGINES.length, 3);
});
