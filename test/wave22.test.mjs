import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import {
  falRun,
  buildComfyUiWorkflow,
  checkComfyUiStatus,
  checkA1111Status,
  a1111Run,
  testEngineConnection,
  DEFAULT_COMFYUI_URL,
  DEFAULT_A1111_URL,
} from "../src/connectors.mjs";
import {
  ENGINES,
  TXT2IMG,
  getEngine,
  getTxt2Img,
  pickAvailableEngine,
} from "../src/engines.mjs";

test("Wave 22: buildComfyUiWorkflow builds valid txt2img and img2img node graphs", () => {
  const txtGraph = buildComfyUiWorkflow({
    prompt: "Cyberpunk neon cat NFT, 8k",
    seed: 42,
    steps: 25,
    width: 1024,
    height: 1024,
  });

  assert.equal(txtGraph["1"].class_type, "CheckpointLoaderSimple");
  assert.equal(txtGraph["2"].class_type, "EmptyLatentImage");
  assert.equal(txtGraph["3"].inputs.text, "Cyberpunk neon cat NFT, 8k");
  assert.equal(txtGraph["5"].inputs.seed, 42);
  assert.equal(txtGraph["5"].inputs.steps, 25);
  assert.equal(txtGraph["7"].class_type, "SaveImage");

  const imgGraph = buildComfyUiWorkflow({
    prompt: "Cyberpunk neon cat with gold armor",
    inputImageName: "input_base.png",
    denoise: 0.45,
  });

  assert.equal(imgGraph["2"].class_type, "LoadImage");
  assert.equal(imgGraph["2"].inputs.image, "input_base.png");
  assert.equal(imgGraph["3"].class_type, "VAEEncode");
  assert.equal(imgGraph["6"].class_type, "KSampler");
  assert.equal(imgGraph["6"].inputs.denoise, 0.45);
});

test("Wave 22: checkComfyUiStatus and checkA1111Status handle mock responses and errors", async () => {
  // ComfyUI mock success
  const mockComfyFetch = async (url) => {
    assert.match(url, /\/system_stats$/);
    return {
      ok: true,
      json: async () => ({
        devices: [{ name: "NVIDIA GeForce RTX 4090", vram_free: 20000000000 }],
      }),
    };
  };

  const comfyStat = await checkComfyUiStatus({ url: "http://127.0.0.1:8188", fetch: mockComfyFetch });
  assert.equal(comfyStat.online, true);
  assert.equal(comfyStat.devices[0], "NVIDIA GeForce RTX 4090");

  // ComfyUI mock failure
  const failFetch = async () => {
    throw new Error("Connection refused");
  };
  const comfyFail = await checkComfyUiStatus({ url: "http://127.0.0.1:8188", fetch: failFetch });
  assert.equal(comfyFail.online, false);
  assert.match(comfyFail.error, /Connection refused/);

  // A1111 mock success
  const mockA1111Fetch = async (url) => {
    assert.match(url, /\/sdapi\/v1\/progress$/);
    return {
      ok: true,
      json: async () => ({ state: { job_count: 0 } }),
    };
  };
  const a1111Stat = await checkA1111Status({ url: "http://127.0.0.1:7860", fetch: mockA1111Fetch });
  assert.equal(a1111Stat.online, true);
  assert.equal(a1111Stat.jobCount, 0);
});

test("Wave 22: a1111Run formats txt2img and img2img requests and decodes output", async () => {
  let capturedBody = null;
  const fakeB64 = Buffer.from("fake-png-data").toString("base64");

  const mockFetch = async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({ images: [fakeB64] }),
    };
  };

  const buf = await a1111Run({
    prompt: "Golden crown mascot",
    seed: 12345,
    fetch: mockFetch,
    url: DEFAULT_A1111_URL,
  });

  assert.equal(capturedBody.prompt, "Golden crown mascot");
  assert.equal(capturedBody.seed, 12345);
  assert.equal(buf.toString(), "fake-png-data");

  // With image (img2img)
  const inputImg = Buffer.from("base-ref-pixels");
  await a1111Run({
    prompt: "Golden crown mascot v2",
    image: inputImg,
    strength: 0.6,
    fetch: mockFetch,
  });

  assert.equal(capturedBody.init_images[0], inputImg.toString("base64"));
  assert.equal(capturedBody.denoising_strength, 0.6);
});

test("Wave 22: falRun validates key and downloads image buffer from mock API", async () => {
  await assert.rejects(
    async () => {
      await falRun({ prompt: "test", key: "" });
    },
    /missing FAL_KEY/,
  );

  const mockFetch = async (url, init) => {
    if (url.startsWith("https://fal.run/")) {
      assert.equal(init.headers.Authorization, "Key test-fal-key");
      return {
        ok: true,
        json: async () => ({
          images: [{ url: "https://fal.media/files/sample.png", content_type: "image/png" }],
        }),
      };
    }
    if (url === "https://fal.media/files/sample.png") {
      return {
        ok: true,
        arrayBuffer: async () => Buffer.from("fal-image-bytes"),
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const resultBuf = await falRun({
    model: "fal-ai/flux/schnell",
    input: { prompt: "Sci-fi astronaut" },
    key: "test-fal-key",
    fetch: mockFetch,
  });

  assert.equal(resultBuf.toString(), "fal-image-bytes");
});

test("Wave 22: testEngineConnection diagnoses local and cloud engines", async () => {
  const mockFetch = async (url) => {
    if (url.includes("fal.run")) return { status: 200 };
    if (url.includes("system_stats")) return { ok: true, json: async () => ({ devices: [{ name: "RTX 3080" }] }) };
    if (url.includes("replicate.com")) return { ok: true };
    return { ok: true };
  };

  // Fal missing key
  const falNoKey = await testEngineConnection("fal", {}, mockFetch);
  assert.equal(falNoKey.online, false);

  // Fal with key
  const falWithKey = await testEngineConnection("fal", { FAL_KEY: "secret" }, mockFetch);
  assert.equal(falWithKey.online, true);

  // ComfyUI
  const comfyRes = await testEngineConnection("comfyui", {}, mockFetch);
  assert.equal(comfyRes.online, true);
  assert.equal(comfyRes.local, true);
  assert.match(comfyRes.message, /RTX 3080/);
});

test("Wave 22: ENGINES and TXT2IMG registries include fast connectors and resolve available engines", () => {
  assert.ok(ENGINES.fal, "fal in ENGINES");
  assert.ok(ENGINES.comfyui, "comfyui in ENGINES");
  assert.ok(ENGINES.a1111, "a1111 in ENGINES");
  assert.ok(ENGINES.runware, "runware in ENGINES");

  assert.ok(TXT2IMG.fal, "fal in TXT2IMG");
  assert.ok(TXT2IMG.schnell, "schnell in TXT2IMG");
  assert.ok(TXT2IMG.comfyui, "comfyui in TXT2IMG");
  assert.ok(TXT2IMG.a1111, "a1111 in TXT2IMG");

  assert.equal(ENGINES.comfyui.costUsd, 0.0);
  assert.equal(ENGINES.a1111.costUsd, 0.0);
  assert.equal(TXT2IMG.fal.costUsd, 0.003);
  assert.equal(TXT2IMG.schnell.costUsd, 0.005);

  // pickAvailableEngine resolution
  const envWithFal = { FAL_KEY: "fal-key-123" };
  const pickedFal = pickAvailableEngine("fal", envWithFal, ENGINES);
  assert.equal(pickedFal, "fal");

  const envWithComfy = { COMFYUI_URL: "http://127.0.0.1:8188" };
  const pickedComfy = pickAvailableEngine("comfyui", envWithComfy, ENGINES);
  assert.equal(pickedComfy, "comfyui");

  // Fallback order: fal before kontext if FAL_KEY present
  const envBoth = { FAL_KEY: "fal-123", REPLICATE_API_TOKEN: "rep-123" };
  const pickedAuto = pickAvailableEngine(null, envBoth, ENGINES);
  assert.equal(pickedAuto, "fal");

  assert.notEqual(pickAvailableEngine("schnell", envBoth, ENGINES), "schnell");
  assert.equal(pickAvailableEngine("schnell", envBoth, ENGINES, { exact: true }), null);
  assert.equal(pickAvailableEngine("openai", {}, ENGINES, { exact: true }), null);
  assert.equal(pickAvailableEngine("fal", envWithFal, ENGINES, { exact: true }), "fal");
});

test("Wave 22: CLI series engines outputs all supported engines and pricing", () => {
  const cli = resolve("bin/series.mjs");
  const stdout = execFileSync(process.execPath, [cli, "engines"], { encoding: "utf8" });
  assert.match(stdout, /Series Lab Image Engines/);
  assert.match(stdout, /kontext/);
  assert.match(stdout, /fal/);
  assert.match(stdout, /comfyui/);
  assert.match(stdout, /a1111/);
  assert.match(stdout, /schnell/);
  assert.match(stdout, /\$0/);
});
