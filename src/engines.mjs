/**
 * Image engines for Series Lab Studio.
 * Inspired by gremlin-nft / W3IR Prompt — clean reimplementation.
 * Keys only from env (src/keys.mjs ← local .env / SERIES_KEYS_FILE).
 */
import {
  kontextGuidance,
  strengthForStability,
  strengthForFal,
  strengthForRunware,
  clampStrength,
} from "./reference.mjs";
import {
  falRun,
  runwareRun,
  comfyUiPrompt,
  a1111Run,
  DEFAULT_COMFYUI_URL,
  DEFAULT_A1111_URL,
} from "./connectors.mjs";
import { createMockPng } from "./mock-image.mjs";
import { withPngOutput } from "./png-normalize.mjs";

const REPLICATE_API = "https://api.replicate.com/v1";
export const REPLICATE_MAX_WAIT_MS = 5 * 60_000;
export const REQUEST_TIMEOUT_MS = 4 * 60_000;

export function withTimeout(fetchFn, ms = REQUEST_TIMEOUT_MS) {
  return (url, init = {}) => {
    const timeout = AbortSignal.timeout(ms);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return fetchFn(url, { ...init, signal });
  };
}

async function failText(res) {
  const body = await res.text().catch(() => "");
  return `HTTP ${res.status}: ${body.slice(0, 400)}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function replicateRun(model, input, { fetch, env, maxWaitMs = REPLICATE_MAX_WAIT_MS }) {
  const token = env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("Replicate: missing REPLICATE_API_TOKEN");
  const auth = { Authorization: `Token ${token}` };
  const create = await fetch(`${REPLICATE_API}/models/${model}/predictions`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json", Prefer: "wait=60" },
    body: JSON.stringify({ input }),
  });
  if (!create.ok) throw new Error(`Replicate: ${await failText(create)}`);
  let data = await create.json();
  const deadline = Date.now() + maxWaitMs;
  while (["starting", "processing"].includes(data.status) && data.urls?.get) {
    if (Date.now() > deadline) {
      if (data.urls.cancel) await fetch(data.urls.cancel, { method: "POST", headers: auth }).catch(() => {});
      throw new Error(`Replicate: timeout after ${Math.round(maxWaitMs / 60_000)} min`);
    }
    await sleep(1500);
    const poll = await fetch(data.urls.get, { headers: auth });
    if (!poll.ok) throw new Error(`Replicate: ${await failText(poll)}`);
    data = await poll.json();
  }
  if (data.status !== "succeeded") throw new Error(`Replicate: ${data.error ?? data.status}`);
  const url = Array.isArray(data.output) ? data.output[0] : data.output;
  const img = await fetch(String(url));
  if (!img.ok) throw new Error(`Replicate download: ${await failText(img)}`);
  return Buffer.from(await img.arrayBuffer());
}

/** Edit / img2img — needs a reference (primary base) image. */
export const ENGINES = {
  kontext: {
    title: "Flux Kontext Pro (Replicate)",
    key: "REPLICATE_API_TOKEN",
    costUsd: 0.04,
    mode: "edit",
    async generate({ prompt, image, mime, seed, strength }, ctx) {
      return replicateRun(
        "black-forest-labs/flux-kontext-pro",
        {
          prompt: `${kontextGuidance(strength)} ${prompt}`,
          input_image: `data:${mime};base64,${image.toString("base64")}`,
          aspect_ratio: "1:1",
          output_format: "png",
          seed,
          safety_tolerance: 2,
        },
        ctx,
      );
    },
  },
  fal: {
    title: "Fal.ai Flux Dev (Fast Cloud)",
    key: "FAL_KEY",
    costUsd: 0.025,
    mode: "edit",
    async generate({ prompt, image, mime, seed, strength }, { fetch, env }) {
      const key = env.FAL_KEY || env.FAL_API_KEY;
      return falRun({
        model: "fal-ai/flux/dev/image-to-image",
        input: {
          prompt: `${kontextGuidance(strength)} ${prompt}`,
          image_url: `data:${mime};base64,${image.toString("base64")}`,
          strength: strengthForFal(strength),
          ...(seed != null ? { seed: Number(seed) } : {}),
        },
        key,
        fetch,
      });
    },
  },
  comfyui: {
    title: "Local ComfyUI (Free $0.00)",
    key: "COMFYUI_URL",
    costUsd: 0.0,
    mode: "edit",
    async generate({ prompt, image, mime, seed, strength }, { fetch, env }) {
      return comfyUiPrompt({
        prompt,
        image,
        mime,
        seed,
        strength: strengthForStability(strength),
        url: env.COMFYUI_URL || DEFAULT_COMFYUI_URL,
        fetch,
      });
    },
  },
  a1111: {
    title: "Local Automatic1111 / WebUI (Free $0.00)",
    key: "A1111_URL",
    costUsd: 0.0,
    mode: "edit",
    async generate({ prompt, image, seed, strength }, { fetch, env }) {
      return a1111Run({
        prompt,
        image,
        seed,
        strength: strengthForStability(strength),
        url: env.A1111_URL || env.SD_WEBUI_URL || DEFAULT_A1111_URL,
        fetch,
      });
    },
  },
  runware: {
    title: "Runware AI (Fast img2img)",
    key: "RUNWARE_API_KEY",
    costUsd: 0.006,
    mode: "edit",
    async generate({ prompt, image, mime, seed, strength }, { fetch, env }) {
      return runwareRun({
        prompt,
        seed,
        inputImage: `data:${mime};base64,${image.toString("base64")}`,
        strength: strengthForRunware(strength),
        key: env.RUNWARE_API_KEY,
        fetch,
      });
    },
  },
  openai: {
    title: "OpenAI gpt-image-2 (edits)",
    key: "OPENAI_API_KEY",
    costUsd: 0.07,
    mode: "edit",
    async generate({ prompt, image, mime, strength }, { fetch, env }) {
      if (!env.OPENAI_API_KEY) throw new Error("OpenAI: missing OPENAI_API_KEY");
      const form = new FormData();
      form.append("model", "gpt-image-2");
      form.append("prompt", `${kontextGuidance(strength)} ${prompt}`);
      form.append("size", "1024x1024");
      form.append("quality", "medium");
      form.append("n", "1");
      form.append("image[]", new Blob([image], { type: mime }), `base.${mime === "image/png" ? "png" : "jpg"}`);
      const res = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
        body: form,
      });
      if (!res.ok) throw new Error(`OpenAI: ${await failText(res)}`);
      const json = await res.json();
      return Buffer.from(json.data[0].b64_json, "base64");
    },
  },
  stability: {
    title: "Stability SD3.5 Medium (img2img)",
    key: "STABILITY_API_KEY",
    costUsd: 0.035,
    mode: "edit",
    async generate({ prompt, image, mime, seed, strength }, { fetch, env }) {
      if (!env.STABILITY_API_KEY) throw new Error("Stability: missing STABILITY_API_KEY");
      const form = new FormData();
      form.append("prompt", prompt);
      form.append("mode", "image-to-image");
      form.append("model", "sd3.5-medium");
      form.append("strength", String(strengthForStability(strength)));
      form.append("output_format", "png");
      if (seed !== undefined) form.append("seed", String(seed));
      form.append("image", new Blob([image], { type: mime }), "base.jpg");
      const res = await fetch("https://api.stability.ai/v2beta/stable-image/generate/sd3", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.STABILITY_API_KEY}`, Accept: "image/*" },
        body: form,
      });
      if (!res.ok) throw new Error(`Stability: ${await failText(res)}`);
      return Buffer.from(await res.arrayBuffer());
    },
  },
  pollinations: {
    title: "Pollinations Kontext",
    key: "POLLINATIONS_API_KEY",
    costUsd: 0.02,
    mode: "edit",
    async generate({ prompt, image, mime, seed, strength }, { fetch, env }) {
      const token = env.POLLINATIONS_API_KEY || env.POLLINATIONS_TOKEN;
      if (!token) throw new Error("Pollinations: missing POLLINATIONS_API_KEY");
      const form = new FormData();
      form.append("prompt", `${kontextGuidance(strength)} ${prompt}`);
      form.append("model", "kontext");
      form.append("nologo", "true");
      form.append("private", "true");
      if (seed !== undefined && seed !== null) form.append("seed", String(seed));
      const ext = mime === "image/png" ? "png" : "jpg";
      form.append("image", new Blob([image], { type: mime }), `base.${ext}`);
      const res = await fetch("https://gen.pollinations.ai/v1/images/edits", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) throw new Error(`Pollinations: ${await failText(res)}`);
      const ctype = (res.headers.get("content-type") || "").toLowerCase();
      if (ctype.includes("application/json")) {
        const json = await res.json();
        const b64 = json.data?.[0]?.b64_json;
        if (b64) return Buffer.from(b64, "base64");
        const out = json.data?.[0]?.url || json.url || json.imageURL;
        if (!out) throw new Error(`Pollinations: unexpected JSON`);
        const img = await fetch(String(out), { headers: { Authorization: `Bearer ${token}` } });
        if (!img.ok) throw new Error(`Pollinations download: ${await failText(img)}`);
        return Buffer.from(await img.arrayBuffer());
      }
      return Buffer.from(await res.arrayBuffer());
    },
  },
  mock: {
    title: "Offline Mock Generator (Free $0.00)",
    key: "MOCK_ENABLED",
    costUsd: 0.0,
    mode: "edit",
    async generate({ prompt, seed }, ctx) {
      const hold = Number(ctx?.env?.SERIES_MOCK_HOLD_MS || 0);
      const signal = ctx?.signal;
      if (hold > 0) {
        await new Promise((resolve, reject) => {
          let timer;
          const fail = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", fail);
            const err = new Error("stopped");
            err.name = "AbortError";
            reject(err);
          };
          timer = setTimeout(() => {
            signal?.removeEventListener("abort", fail);
            resolve();
          }, hold);
          if (signal) signal.addEventListener("abort", fail, { once: true });
          if (signal?.aborted) fail();
        });
      } else if (signal?.aborted) {
        const err = new Error("stopped");
        err.name = "AbortError";
        throw err;
      }
      return createMockPng({ seed: seed ?? 42, title: prompt || "Mock Edit" });
    },
  },
};

/**
 * Text → image for primary base from wishes (no reference required).
 * Prefer OpenAI generations; fallback Replicate flux; Stability txt2img.
 */
export const TXT2IMG = {
  openai: {
    title: "OpenAI gpt-image-2 (generations)",
    key: "OPENAI_API_KEY",
    costUsd: 0.07,
    async generate({ prompt, seed }, { fetch, env }) {
      if (!env.OPENAI_API_KEY) throw new Error("OpenAI: missing OPENAI_API_KEY");
      const body = {
        model: "gpt-image-2",
        prompt,
        size: "1024x1024",
        quality: "medium",
        n: 1,
      };
      const res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`OpenAI txt2img: ${await failText(res)}`);
      const json = await res.json();
      const b64 = json.data?.[0]?.b64_json;
      if (!b64) throw new Error("OpenAI txt2img: no b64_json");
      return Buffer.from(b64, "base64");
    },
  },
  fal: {
    title: "Fal.ai Flux Schnell (Fast txt2img)",
    key: "FAL_KEY",
    costUsd: 0.003,
    async generate({ prompt, seed }, { fetch, env }) {
      const key = env.FAL_KEY || env.FAL_API_KEY;
      return falRun({
        model: "fal-ai/flux/schnell",
        input: {
          prompt,
          image_size: "square_hd",
          num_inference_steps: 4,
          ...(seed != null ? { seed: Number(seed) } : {}),
        },
        key,
        fetch,
      });
    },
  },
  schnell: {
    title: "Replicate Flux Schnell (txt2img)",
    key: "REPLICATE_API_TOKEN",
    costUsd: 0.005,
    async generate({ prompt, seed }, ctx) {
      return replicateRun(
        "black-forest-labs/flux-schnell",
        {
          prompt,
          aspect_ratio: "1:1",
          output_format: "png",
          ...(seed !== undefined && seed !== null ? { seed: Number(seed) } : {}),
        },
        ctx,
      );
    },
  },
  comfyui: {
    title: "Local ComfyUI txt2img (Free $0.00)",
    key: "COMFYUI_URL",
    costUsd: 0.0,
    async generate({ prompt, seed }, { fetch, env }) {
      return comfyUiPrompt({
        prompt,
        seed,
        url: env.COMFYUI_URL || DEFAULT_COMFYUI_URL,
        fetch,
      });
    },
  },
  a1111: {
    title: "Local Automatic1111 txt2img (Free $0.00)",
    key: "A1111_URL",
    costUsd: 0.0,
    async generate({ prompt, seed }, { fetch, env }) {
      return a1111Run({
        prompt,
        seed,
        url: env.A1111_URL || env.SD_WEBUI_URL || DEFAULT_A1111_URL,
        fetch,
      });
    },
  },
  runware: {
    title: "Runware AI txt2img",
    key: "RUNWARE_API_KEY",
    costUsd: 0.005,
    async generate({ prompt, seed }, { fetch, env }) {
      return runwareRun({ prompt, seed, key: env.RUNWARE_API_KEY, fetch });
    },
  },
  kontext: {
    title: "Flux 1.1 Pro (Replicate txt2img)",
    key: "REPLICATE_API_TOKEN",
    costUsd: 0.04,
    async generate({ prompt, seed }, ctx) {
      return replicateRun(
        "black-forest-labs/flux-1.1-pro",
        {
          prompt,
          aspect_ratio: "1:1",
          output_format: "png",
          output_quality: 90,
          safety_tolerance: 2,
          ...(seed !== undefined && seed !== null ? { seed: Number(seed) } : {}),
        },
        ctx,
      );
    },
  },
  stability: {
    title: "Stability SD3.5 txt2img",
    key: "STABILITY_API_KEY",
    costUsd: 0.035,
    async generate({ prompt, seed }, { fetch, env }) {
      if (!env.STABILITY_API_KEY) throw new Error("Stability: missing STABILITY_API_KEY");
      const form = new FormData();
      form.append("prompt", prompt);
      form.append("model", "sd3.5-medium");
      form.append("output_format", "png");
      form.append("aspect_ratio", "1:1");
      if (seed !== undefined) form.append("seed", String(seed));
      const res = await fetch("https://api.stability.ai/v2beta/stable-image/generate/sd3", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.STABILITY_API_KEY}`, Accept: "image/*" },
        body: form,
      });
      if (!res.ok) throw new Error(`Stability txt2img: ${await failText(res)}`);
      return Buffer.from(await res.arrayBuffer());
    },
  },
  pollinations: {
    title: "Pollinations flux txt2img",
    key: "POLLINATIONS_API_KEY",
    costUsd: 0.02,
    async generate({ prompt, seed }, { fetch, env }) {
      const token = env.POLLINATIONS_API_KEY || env.POLLINATIONS_TOKEN;
      if (!token) throw new Error("Pollinations: missing POLLINATIONS_API_KEY");
      const q = new URLSearchParams({
        model: "flux",
        width: "1024",
        height: "1024",
        nologo: "true",
        private: "true",
      });
      if (seed !== undefined && seed !== null) q.set("seed", String(seed));
      const url = `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?${q}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Pollinations txt2img: ${await failText(res)}`);
      return Buffer.from(await res.arrayBuffer());
    },
  },
  mock: {
    title: "Offline Mock txt2img (Free $0.00)",
    key: "MOCK_ENABLED",
    costUsd: 0.0,
    async generate({ prompt, seed }) {
      return createMockPng({ seed: seed ?? 42, title: prompt || "Mock txt2img" });
    },
  },
};

for (const table of [ENGINES, TXT2IMG]) {
  for (const engine of Object.values(table)) withPngOutput(engine);
}

export const DEFAULT_ENGINE = "kontext";

export function getEngine(name) {
  const engine = ENGINES[name];
  if (!engine) throw new Error(`unknown engine "${name}"; choose: ${Object.keys(ENGINES).join(", ")}`);
  return engine;
}

export function getTxt2Img(name) {
  const engine = TXT2IMG[name];
  if (!engine) throw new Error(`unknown txt2img "${name}"; choose: ${Object.keys(TXT2IMG).join(", ")}`);
  return engine;
}

export function engineCtx(env = process.env) {
  return {
    fetch: withTimeout(globalThis.fetch),
    env,
    sleep,
  };
}

export async function withRetry(fn, { tries = 4 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const text = String(err.message).toLowerCase();
      const permanent = /insufficient|billing|quota|401|403|invalid api key|payment|missing/.test(text);
      const transient = /429|rate limit|timeout|502|503|504|temporarily|fetch failed/.test(text);
      if (permanent || !transient || attempt >= tries) throw err;
      await sleep(2000 * attempt);
    }
  }
}

export function buildWishPrompt(wish) {
  const base =
    "Create a single square character portrait for an NFT series primary/base reference image. " +
    "Photorealistic or high-quality 3D render, chest-up, centered, clean background, " +
    "no text, no letters, no logos, no watermark, no brand names. ";
  return `${base}${String(wish || "").trim()}`;
}

export function pickAvailableEngine(preferred, env = process.env, table = ENGINES, opts = {}) {
  const fallback = [
    "fal",
    "kontext",
    "schnell",
    "openai",
    "stability",
    "pollinations",
    "runware",
    "comfyui",
    "a1111",
    "mock",
  ];
  const order = (opts.exact ? [preferred] : [preferred, ...fallback]).filter(Boolean);
  const seen = new Set();
  for (const name of order) {
    if (seen.has(name)) continue;
    seen.add(name);
    const eng = table[name];
    if (!eng) continue;
    const key = eng.key;
    if (name === "comfyui") {
      if (
        preferred === "comfyui" ||
        (env.COMFYUI_URL && String(env.COMFYUI_URL).trim()) ||
        env.COMFYUI_ENABLED === "1"
      ) {
        return name;
      }
      continue;
    }
    if (name === "a1111") {
      if (
        preferred === "a1111" ||
        (env.A1111_URL && String(env.A1111_URL).trim()) ||
        (env.SD_WEBUI_URL && String(env.SD_WEBUI_URL).trim()) ||
        env.A1111_ENABLED === "1"
      ) {
        return name;
      }
      continue;
    }
    if (name === "mock") {
      if (preferred === "mock" || env.MOCK_ENABLED === "1" || env.OFFLINE === "1") {
        return name;
      }
      continue;
    }
    const alt =
      key === "POLLINATIONS_API_KEY"
        ? env.POLLINATIONS_TOKEN
        : key === "FAL_KEY"
        ? env.FAL_API_KEY
        : null;
    if ((env[key] && String(env[key]).trim()) || (alt && String(alt).trim())) return name;
  }
  if (!opts.exact && preferred === "mock") return "mock";
  return null;
}

/** Names in `table` the user can select without a silent swap. */
export function listSelectableEngines(env = process.env, table = ENGINES) {
  return Object.keys(table).filter((name) => pickAvailableEngine(name, env, table, { exact: true }) === name);
}

/**
 * Decide Path B before any paid call.
 * useRef without a primary is an error, not a silent txt2img.
 * exact: the requested engine is used or the call fails — no fallback.
 */
export function planPrimaryGenerate({ useRef = false, hasPrimary = false, engine, env = process.env } = {}) {
  if (useRef && !hasPrimary) {
    const err = new Error("Image-to-image needs a primary base image.");
    err.code = "no_primary";
    err.status = 400;
    throw err;
  }
  const mode = useRef ? "edit" : "txt2img";
  const table = useRef ? ENGINES : TXT2IMG;
  const requestedEngine = engine || (useRef ? "kontext" : "openai");
  const resolved = pickAvailableEngine(requestedEngine, env, table, { exact: true });
  if (!resolved) {
    const err = new Error(`Engine unavailable for ${mode}: ${requestedEngine}`);
    err.code = "engine_unavailable";
    err.status = 400;
    throw err;
  }
  return { mode, engine: resolved, requestedEngine };
}

/** Arguments for one primary generate. txt2img omits strength; edit sends the raw wish. */
export function primaryGenerateArgs({ mode, wish, strength, seed, image, mime } = {}) {
  if (mode === "edit") {
    return {
      prompt: String(wish || "").trim(),
      image,
      mime,
      seed,
      strength: clampStrength(strength),
    };
  }
  return { prompt: buildWishPrompt(wish), seed };
}

export { clampStrength };
