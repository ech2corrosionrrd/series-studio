import test from "node:test";
import assert from "node:assert/strict";
import { createMockPng } from "../src/mock-image.mjs";
import {
  DEFAULT_STRENGTH,
  clampStrength,
  strengthForStability,
  strengthForFal,
  strengthForRunware,
  kontextGuidance,
  imagesDirName,
} from "../src/reference.mjs";
import {
  ENGINES,
  buildWishPrompt,
  planPrimaryGenerate,
  primaryGenerateArgs,
} from "../src/engines.mjs";
import { DEFAULT_STRENGTH as platformDefault } from "../src/platform/imagegen.mjs";
import { parseTmaBody, decodeReferenceImage } from "../src/platform/partners.mjs";
import uk from "../server/ui/locales/uk.js";
import en from "../server/ui/locales/en.js";

const POINTS = [0.1, 0.45, 0.5, 0.95];

test("strength mappers stay on the studio scale and move between neighbouring steps", () => {
  assert.equal(DEFAULT_STRENGTH, 0.45);
  assert.equal(platformDefault, DEFAULT_STRENGTH);
  for (const s of POINTS) {
    const denoise = strengthForStability(s);
    const fal = strengthForFal(s);
    const runware = strengthForRunware(s);
    assert.ok(denoise >= 0.62 && denoise <= 0.85, `stability ${s} → ${denoise}`);
    assert.ok(fal >= 0.35 && fal <= 0.95, `fal ${s} → ${fal}`);
    assert.ok(fal > 0.01);
    assert.ok(runware >= 0.05 && runware <= 0.95, `runware ${s} → ${runware}`);
  }
  assert.ok(strengthForStability(0.95) < strengthForStability(0.1));
  assert.ok(strengthForFal(0.95) < strengthForFal(0.1));
  assert.ok(strengthForRunware(0.95) < strengthForRunware(0.1));
  assert.notEqual(strengthForStability(0.45), strengthForStability(0.5));
  assert.notEqual(strengthForFal(0.45), strengthForFal(0.5));
  assert.notEqual(strengthForRunware(0.45), strengthForRunware(0.5));
  assert.notEqual(kontextGuidance(0.45), kontextGuidance(0.5));
  assert.equal(imagesDirName("x", 0.5), "x-s0.50");
  assert.equal(imagesDirName("kontext/../", 0.45), "kontext-s0.45");
});

test("platform defaults use the studio strength", () => {
  assert.equal(parseTmaBody({ prompt: "x" }).strength, DEFAULT_STRENGTH);
  const png = createMockPng({ seed: 2, width: 8, height: 8 });
  const decoded = decodeReferenceImage(png.toString("base64"));
  assert.equal(decoded.strength, DEFAULT_STRENGTH);
});

test("txt2img omits strength and img2img without a primary fails before a paid call", () => {
  assert.throws(
    () => planPrimaryGenerate({ useRef: true, hasPrimary: false, engine: "mock" }),
    (err) => err.code === "no_primary",
  );
  const txt = primaryGenerateArgs({ mode: "txt2img", wish: "a fox", strength: 0.8, seed: 3 });
  assert.equal("strength" in txt, false);
  assert.equal(txt.prompt, buildWishPrompt("a fox"));
  assert.equal(txt.prompt, `${en["base.wish.wrapPrefix"]}a fox`);
  assert.equal(uk["base.wish.wrapPrefix"], en["base.wish.wrapPrefix"]);
  const edit = primaryGenerateArgs({ mode: "edit", wish: "a fox", strength: 0.8, seed: 3 });
  assert.equal(edit.prompt, "a fox");
  assert.equal(edit.strength, clampStrength(0.8));
  const plan = planPrimaryGenerate({ useRef: false, hasPrimary: false, engine: "mock", env: {} });
  assert.equal(plan.mode, "txt2img");
  assert.equal(plan.engine, "mock");
  assert.throws(
    () => planPrimaryGenerate({ useRef: true, hasPrimary: true, engine: "schnell", env: { REPLICATE_API_TOKEN: "x" } }),
    (err) => err.code === "engine_unavailable",
  );
});

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new Uint8Array(createMockPng({ seed: 9, width: 8, height: 8 })).buffer,
  };
}

test("fal, comfyui, a1111 and runware receive a real strength, not ~0.00x", async () => {
  const image = createMockPng({ seed: 4, width: 8, height: 8 });
  const ctx = { env: { FAL_KEY: "k", RUNWARE_API_KEY: "k", COMFYUI_URL: "http://gpu.test", A1111_URL: "http://gpu.test" } };

  async function capture(engine, strength, fetchImpl) {
    await ENGINES[engine].generate(
      { prompt: "portrait", image, mime: "image/png", seed: 7, strength },
      { ...ctx, fetch: fetchImpl },
    );
  }

  const falBodies = [];
  const falFetch = async (url, init) => {
    if (String(url).includes("fal.run")) {
      falBodies.push(JSON.parse(init.body));
      return jsonResponse({ images: [{ url: "https://img.test/out.png" }] });
    }
    return jsonResponse({});
  };
  await capture("fal", 0.45, falFetch);
  await capture("fal", 0.5, falFetch);
  assert.equal(falBodies[0].strength, strengthForFal(0.45));
  assert.notEqual(falBodies[0].strength, falBodies[1].strength);
  assert.ok(falBodies[0].strength > 0.05);

  const runwareBodies = [];
  const runwareFetch = async (_url, init) => {
    runwareBodies.push(JSON.parse(init.body)[0]);
    return jsonResponse({ data: [{ imageBase64DataURI: `data:image/png;base64,${image.toString("base64")}` }] });
  };
  await capture("runware", 0.45, runwareFetch);
  await capture("runware", 0.5, runwareFetch);
  assert.equal(runwareBodies[0].strength, strengthForRunware(0.45));
  assert.notEqual(runwareBodies[0].strength, runwareBodies[1].strength);
  assert.ok(runwareBodies[0].strength > 0.05);

  const a1111Bodies = [];
  const a1111Fetch = async (_url, init) => {
    a1111Bodies.push(JSON.parse(init.body));
    return jsonResponse({ images: [image.toString("base64")] });
  };
  await capture("a1111", 0.45, a1111Fetch);
  await capture("a1111", 0.5, a1111Fetch);
  assert.equal(a1111Bodies[0].denoising_strength, strengthForStability(0.45));
  assert.notEqual(a1111Bodies[0].denoising_strength, a1111Bodies[1].denoising_strength);
  assert.ok(a1111Bodies[0].denoising_strength > 0.1);

  const comfyDenoise = [];
  const comfyFetch = async (url, init) => {
    const u = String(url);
    if (u.endsWith("/upload/image")) return jsonResponse({ name: "base.png" });
    if (u.endsWith("/prompt")) {
      const workflow = JSON.parse(init.body).prompt;
      const sampler = Object.values(workflow).find((node) => node.class_type === "KSampler");
      comfyDenoise.push(sampler.inputs.denoise);
      return jsonResponse({ prompt_id: "p1" });
    }
    if (u.includes("/history/")) {
      return jsonResponse({ p1: { outputs: { "8": { images: [{ filename: "out.png", subfolder: "", type: "output" }] } } } });
    }
    return jsonResponse({});
  };
  await capture("comfyui", 0.45, comfyFetch);
  await capture("comfyui", 0.5, comfyFetch);
  assert.equal(comfyDenoise[0], strengthForStability(0.45));
  assert.notEqual(comfyDenoise[0], comfyDenoise[1]);
  assert.ok(comfyDenoise[0] >= 0.05 && comfyDenoise[0] <= 0.99);
});
