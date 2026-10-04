/**
 * Image generation for the external APIs (Passport `/gremlin/generate`, Telegram
 * Mini-App). Reproduces Промт `services/ai_service.py` calls exactly — same
 * providers, models, parameters, retries — so partners see identical images,
 * prices and engine labels after the switch.
 *
 *   ENGINE_FLUX      Replicate flux-schnell (txt2img) / flux-kontext-dev (reference)
 *   ENGINE_STABILITY Stability Core (txt2img) / SD3 sd3.5-medium (image-to-image)
 *   ENGINE_GPT_IMAGE OpenAI gpt-image-1 generations / edits
 *
 * Strength default is DEFAULT_STRENGTH from reference.mjs (the studio scale, 0.45).
 * fidelityForGptImage stays local: gpt-image-1 input_fidelity is not the studio slider.
 */
import { DEFAULT_STRENGTH, clampStrength, strengthForStability } from "../reference.mjs";

export const ENGINE_GPT_IMAGE = "OpenAI gpt-image-1";
export const ENGINE_STABILITY = "Stability AI (Core / SD3)";
export const ENGINE_FLUX = "Flux.1 (Replicate)";
export const ENGINES = [ENGINE_GPT_IMAGE, ENGINE_STABILITY, ENGINE_FLUX];

const TIMEOUT = 180_000;
const IMAGE_RETRIES = 4;
const FLUX_NSFW_RETRIES = 2;
const PERMANENT = ["insufficient", "billing", "exceeded your current quota", "spend limit", "payment required"];
const MODERATION = ["moderation_blocked", "safety system", "content_policy", "content policy", "rejected by the safety", "moderation_details"];
const RETRY_AFTER_RE = /(?:try again in|resets? in)\s+([\d.]+)\s*(ms|s|seconds?)\b/i;

export class ImageGenError extends Error {}

/** "" = ready; otherwise the missing env key (same contract as engine_status()). */
export function engineStatus(env = process.env) {
  return {
    [ENGINE_GPT_IMAGE]: env.OPENAI_API_KEY ? "" : "OPENAI_API_KEY",
    [ENGINE_STABILITY]: env.STABILITY_API_KEY ? "" : "STABILITY_API_KEY",
    [ENGINE_FLUX]: env.REPLICATE_API_TOKEN ? "" : "REPLICATE_API_TOKEN",
  };
}

export { DEFAULT_STRENGTH, clampStrength, strengthForStability };
export const fidelityForGptImage = (s) => (clampStrength(s) >= 0.5 ? "high" : "low");
export const closestAspect = (w, h) => (w > h ? "16:9" : h > w ? "9:16" : "1:1");
const gptImageSize = (w, h) => (w > h ? "1536x1024" : h > w ? "1024x1536" : "1024x1024");
const extOf = (mime) => ({ "image/jpeg": "jpg", "image/webp": "webp" })[mime] || "png";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function replicateRun(model, input, token, fetchImpl) {
  const auth = { Authorization: `Token ${token}` };
  const create = await fetchImpl(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json", Prefer: "wait=60" },
    body: JSON.stringify({ input }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (create.status >= 400) throw new ImageGenError(`${ENGINE_FLUX}: HTTP ${create.status}: ${(await create.text()).slice(0, 200)}`);
  let data = await create.json();
  while (["starting", "processing"].includes(data.status) && data.urls?.get) {
    await sleep(1000);
    const poll = await fetchImpl(data.urls.get, { headers: auth, signal: AbortSignal.timeout(30_000) });
    if (poll.status >= 400) throw new ImageGenError(`${ENGINE_FLUX}: HTTP ${poll.status}: ${(await poll.text()).slice(0, 200)}`);
    data = await poll.json();
  }
  if (data.status !== "succeeded") throw new ImageGenError(`Flux.1 (Replicate): ${data.error || data.status || "unknown"}`);
  return data.output;
}

async function generateFlux({ prompt, width, height, seed, reference }, env, fetchImpl) {
  const token = env.REPLICATE_API_TOKEN;
  if (!token) throw new ImageGenError("Flux.1: API-токен не знайдено (REPLICATE_API_TOKEN).");
  const input = { prompt, aspect_ratio: closestAspect(width, height), output_format: "png" };
  if (seed != null) input.seed = Number(seed);
  let model = env.FLUX_MODEL || "black-forest-labs/flux-schnell";
  if (reference) {
    model = env.FLUX_I2I_MODEL || "black-forest-labs/flux-kontext-dev";
    input.input_image = `data:${reference.mime};base64,${Buffer.from(reference.bytes).toString("base64")}`;
  }
  let output;
  for (let attempt = 0; attempt <= FLUX_NSFW_RETRIES; attempt++) {
    try {
      output = await replicateRun(model, input, token, fetchImpl);
      break;
    } catch (e) {
      const nsfw = String(e.message).toLowerCase().includes("nsfw content detected");
      if (!nsfw || attempt === FLUX_NSFW_RETRIES) throw e;
      if ("seed" in input) input.seed = Number(input.seed) + 1; // the checker is deterministic per (prompt, seed)
    }
  }
  const url = String(Array.isArray(output) ? output[0] : output);
  const dl = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!dl.ok) throw new ImageGenError(`${ENGINE_FLUX}: download HTTP ${dl.status}`);
  return Buffer.from(await dl.arrayBuffer());
}

async function generateStability({ prompt, width, height, seed, reference }, env, fetchImpl) {
  const key = env.STABILITY_API_KEY;
  if (!key) throw new ImageGenError("Stability AI: API-ключ не знайдено (STABILITY_API_KEY).");
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("output_format", "png");
  if (seed != null) form.append("seed", String(Number(seed)));
  let url = "https://api.stability.ai/v2beta/stable-image/generate/core";
  if (reference) {
    url = "https://api.stability.ai/v2beta/stable-image/generate/sd3";
    form.append("mode", "image-to-image");
    form.append("model", env.STABILITY_I2I_MODEL || "sd3.5-medium");
    form.append("strength", String(strengthForStability(reference.strength)));
    form.append("image", new Blob([reference.bytes], { type: reference.mime }), `reference.${extOf(reference.mime)}`);
  } else {
    form.append("aspect_ratio", closestAspect(width, height));
    form.append("none", "");
  }
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, Accept: "image/*" },
    body: form,
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (res.status !== 200) throw new ImageGenError(`${ENGINE_STABILITY}: HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

let lastGptImageAt = 0;
async function generateGptImage({ prompt, width, height, reference }, env, fetchImpl) {
  const key = env.OPENAI_API_KEY;
  if (!key) throw new ImageGenError("OpenAI: API-ключ не знайдено (OPENAI_API_KEY).");
  // Proactive throttle for the org limit (GPT_IMAGE_MAX_PER_MIN, default 5/min).
  const perMin = Number(env.GPT_IMAGE_MAX_PER_MIN || 5);
  const interval = perMin > 0 ? 60_000 / perMin : 0;
  const wait = lastGptImageAt + interval - Date.now();
  lastGptImageAt = Math.max(Date.now(), lastGptImageAt + interval);
  if (wait > 0) await sleep(wait);
  let res;
  if (reference) {
    const form = new FormData();
    form.append("model", "gpt-image-1");
    form.append("image", new Blob([reference.bytes], { type: reference.mime }), `reference-0.${extOf(reference.mime)}`);
    form.append("prompt", prompt);
    form.append("size", gptImageSize(width, height));
    form.append("quality", "medium");
    form.append("input_fidelity", fidelityForGptImage(reference.strength));
    form.append("n", "1");
    res = await fetchImpl("https://api.openai.com/v1/images/edits", {
      method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(TIMEOUT),
    });
  } else {
    res = await fetchImpl("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-image-1", prompt, size: gptImageSize(width, height), quality: "medium", n: 1 }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
  }
  if (!res.ok) throw new ImageGenError(`${ENGINE_GPT_IMAGE}: HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const item = (await res.json()).data?.[0] || {};
  if (item.b64_json) return Buffer.from(item.b64_json, "base64");
  if (item.url) return Buffer.from(await (await fetchImpl(item.url)).arrayBuffer());
  throw new ImageGenError("OpenAI: відповідь без зображення (немає b64_json/url).");
}

const HANDLERS = { [ENGINE_FLUX]: generateFlux, [ENGINE_STABILITY]: generateStability, [ENGINE_GPT_IMAGE]: generateGptImage };

const isRetryable = (e) => {
  const t = String(e.message || e).toLowerCase();
  if (PERMANENT.some((m) => t.includes(m))) return false;
  if (MODERATION.some((m) => t.includes(m))) return false;
  return ["429", "rate limit", "timeout", "503", "502", "temporarily"].some((m) => t.includes(m));
};

/**
 * One image with Промт's retry policy. `reference`: {bytes, mime, strength}.
 * → PNG bytes; throws ImageGenError.
 */
export async function generateImage(engine, prompt, { width = 1024, height = 1024, seed = null, reference = null, env = process.env, fetchImpl = fetch } = {}) {
  const handler = HANDLERS[engine];
  if (!handler) throw new Error(`Невідомий двигун: ${engine}. Доступні: ${ENGINES.join(", ")}`);
  let last;
  for (let attempt = 0; attempt <= IMAGE_RETRIES; attempt++) {
    try {
      return await handler({ prompt, width, height, seed, reference }, env, fetchImpl);
    } catch (e) {
      last = e;
      if (attempt < IMAGE_RETRIES && isRetryable(e)) {
        const m = RETRY_AFTER_RE.exec(String(e.message));
        const hint = m ? (m[2].toLowerCase() === "ms" ? Number(m[1]) / 1000 : Number(m[1])) : null;
        await sleep(Math.min(hint ?? 1.5 * (attempt + 1), 20) * 1000);
        continue;
      }
      throw e instanceof ImageGenError ? e : new ImageGenError(`${engine}: ${e.message || e}`);
    }
  }
  throw last;
}
