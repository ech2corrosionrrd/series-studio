/**
 * Direct Fast Engine Connectors for Series Lab Studio.
 * Provides high-speed cloud generation APIs (Fal.ai, Runware)
 * and local zero-cost GPU engine connectors (ComfyUI, Automatic1111 / SD-WebUI).
 */
import { randomUUID } from "node:crypto";

export const DEFAULT_COMFYUI_URL = "http://127.0.0.1:8188";
export const DEFAULT_A1111_URL = "http://127.0.0.1:7860";
export const REQUEST_TIMEOUT_MS = 3 * 60_000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function failText(res) {
  const body = await res.text().catch(() => "");
  return `HTTP ${res.status}: ${body.slice(0, 400)}`;
}

// ============================================================================
// Fal.ai Direct Connector (Flux Schnell & Flux Dev)
// ============================================================================

export async function falRun({
  model = "fal-ai/flux/schnell",
  input = {},
  key,
  fetch = globalThis.fetch,
  maxWaitMs = REQUEST_TIMEOUT_MS,
}) {
  if (!key) throw new Error("Fal.ai: missing FAL_KEY");
  const auth = { Authorization: `Key ${key}` };

  const url = `https://fal.run/${model}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    throw new Error(`Fal.ai: ${await failText(res)}`);
  }

  const data = await res.json();
  const imageUrl = data.images?.[0]?.url || data.image?.url;
  if (!imageUrl) {
    throw new Error("Fal.ai: no image URL returned in response");
  }

  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) {
    throw new Error(`Fal.ai download: ${await failText(imgRes)}`);
  }
  return Buffer.from(await imgRes.arrayBuffer());
}

// ============================================================================
// Runware Direct Connector
// ============================================================================

export async function runwareRun({
  prompt,
  seed,
  key,
  fetch = globalThis.fetch,
  width = 1024,
  height = 1024,
  model = "runware:100@1",
  inputImage = null,
  strength = 0.7,
}) {
  if (!key) throw new Error("Runware: missing RUNWARE_API_KEY");

  const taskUUID = randomUUID();
  const task = {
    taskType: "imageInference",
    taskUUID,
    positivePrompt: prompt,
    model,
    width,
    height,
    numberResults: 1,
    outputType: "dataURI",
  };
  if (seed != null) task.seed = Number(seed);
  if (inputImage) {
    task.inputImage = inputImage;
    task.strength = strength;
  }

  const res = await fetch("https://api.runware.ai/v1", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([task]),
  });

  if (!res.ok) {
    throw new Error(`Runware: ${await failText(res)}`);
  }

  const json = await res.json();
  const item = json.data?.[0];
  if (!item) throw new Error("Runware: no data returned");
  if (item.error) throw new Error(`Runware error: ${item.errorMessage || item.error}`);

  if (item.imageURL) {
    const dl = await fetch(item.imageURL);
    if (!dl.ok) throw new Error(`Runware download: ${await failText(dl)}`);
    return Buffer.from(await dl.arrayBuffer());
  }

  if (item.imageBase64DataURI || item.imageURI) {
    const uri = item.imageBase64DataURI || item.imageURI;
    const base64 = uri.replace(/^data:image\/\w+;base64,/, "");
    return Buffer.from(base64, "base64");
  }

  throw new Error("Runware: unrecognized response format");
}

// ============================================================================
// Local ComfyUI Connector (Free $0.00 local GPU inference)
// ============================================================================

export function buildComfyUiWorkflow({
  prompt,
  negativePrompt = "ugly, blurry, low quality, distorted, bad anatomy",
  seed = Math.floor(Math.random() * 1_000_000_000),
  steps = 20,
  cfg = 7.0,
  width = 1024,
  height = 1024,
  sampler = "euler",
  scheduler = "normal",
  checkpoint = "v1-5-pruned-emaonly.ckpt",
  inputImageName = null,
  denoise = 0.7,
}) {
  if (inputImageName) {
    return {
      "1": {
        inputs: { ckpt_name: checkpoint },
        class_type: "CheckpointLoaderSimple",
      },
      "2": {
        inputs: { image: inputImageName, upload: "image" },
        class_type: "LoadImage",
      },
      "3": {
        inputs: { pixels: ["2", 0], vae: ["1", 2] },
        class_type: "VAEEncode",
      },
      "4": {
        inputs: { text: prompt, clip: ["1", 1] },
        class_type: "CLIPTextEncode",
      },
      "5": {
        inputs: { text: negativePrompt, clip: ["1", 1] },
        class_type: "CLIPTextEncode",
      },
      "6": {
        inputs: {
          seed: Number(seed),
          steps,
          cfg,
          sampler_name: sampler,
          scheduler,
          denoise,
          model: ["1", 0],
          positive: ["4", 0],
          negative: ["5", 0],
          latent_image: ["3", 0],
        },
        class_type: "KSampler",
      },
      "7": {
        inputs: { samples: ["6", 0], vae: ["1", 2] },
        class_type: "VAEDecode",
      },
      "8": {
        inputs: { filename_prefix: "SeriesLab", images: ["7", 0] },
        class_type: "SaveImage",
      },
    };
  }

  return {
    "1": {
      inputs: { ckpt_name: checkpoint },
      class_type: "CheckpointLoaderSimple",
    },
    "2": {
      inputs: { width, height, batch_size: 1 },
      class_type: "EmptyLatentImage",
    },
    "3": {
      inputs: { text: prompt, clip: ["1", 1] },
      class_type: "CLIPTextEncode",
    },
    "4": {
      inputs: { text: negativePrompt, clip: ["1", 1] },
      class_type: "CLIPTextEncode",
    },
    "5": {
      inputs: {
        seed: Number(seed),
        steps,
        cfg,
        sampler_name: sampler,
        scheduler,
        denoise: 1.0,
        model: ["1", 0],
        positive: ["3", 0],
        negative: ["4", 0],
        latent_image: ["2", 0],
      },
      class_type: "KSampler",
    },
    "6": {
      inputs: { samples: ["5", 0], vae: ["1", 2] },
      class_type: "VAEDecode",
    },
    "7": {
      inputs: { filename_prefix: "SeriesLab", images: ["6", 0] },
      class_type: "SaveImage",
    },
  };
}

export async function checkComfyUiStatus({ url = DEFAULT_COMFYUI_URL, fetch = globalThis.fetch } = {}) {
  const cleanUrl = String(url).replace(/\/+$/, "");
  try {
    const res = await fetch(`${cleanUrl}/system_stats`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { online: false, error: `HTTP ${res.status}` };
    const stats = await res.json();
    return {
      online: true,
      url: cleanUrl,
      devices: stats.devices?.map((d) => d.name) || [],
      vramFree: stats.devices?.[0]?.vram_free || null,
    };
  } catch (err) {
    return { online: false, error: err.message, url: cleanUrl };
  }
}

export async function comfyUiPrompt({
  prompt,
  image = null,
  mime = "image/png",
  seed,
  strength = 0.7,
  url = DEFAULT_COMFYUI_URL,
  fetch = globalThis.fetch,
  maxWaitMs = REQUEST_TIMEOUT_MS,
}) {
  const cleanUrl = String(url).replace(/\/+$/, "");
  let uploadedImageName = null;

  if (image) {
    const form = new FormData();
    const ext = mime === "image/jpeg" ? "jpg" : "png";
    const uploadFilename = `series-base-${Date.now()}.${ext}`;
    form.append("image", new Blob([image], { type: mime }), uploadFilename);
    form.append("overwrite", "true");

    const uploadRes = await fetch(`${cleanUrl}/upload/image`, {
      method: "POST",
      body: form,
    });
    if (!uploadRes.ok) throw new Error(`ComfyUI upload failed: ${await failText(uploadRes)}`);
    const uploadData = await uploadRes.json();
    uploadedImageName = uploadData.name || uploadFilename;
  }

  const clientId = randomUUID();
  const denoise = Math.max(0.05, Math.min(0.99, Number(strength) || 0.7));
  const workflow = buildComfyUiWorkflow({
    prompt,
    seed: seed != null ? Number(seed) : Math.floor(Math.random() * 1_000_000_000),
    inputImageName: uploadedImageName,
    denoise,
  });

  const promptRes = await fetch(`${cleanUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });
  if (!promptRes.ok) throw new Error(`ComfyUI queue failed: ${await failText(promptRes)}`);

  const promptData = await promptRes.json();
  const promptId = promptData.prompt_id;
  if (!promptId) throw new Error("ComfyUI: no prompt_id returned");

  const deadline = Date.now() + maxWaitMs;
  let finalImageMeta = null;

  while (Date.now() < deadline) {
    await sleep(1500);
    const histRes = await fetch(`${cleanUrl}/history/${promptId}`);
    if (!histRes.ok) continue;
    const history = await histRes.json();
    const item = history[promptId];
    if (!item) continue;

    if (item.status?.status_str === "error") {
      throw new Error(`ComfyUI execution error: ${JSON.stringify(item.status.messages || "unknown")}`);
    }

    const outputs = item.outputs;
    if (outputs) {
      for (const nodeKey of Object.keys(outputs)) {
        const imgs = outputs[nodeKey]?.images;
        if (Array.isArray(imgs) && imgs.length > 0) {
          finalImageMeta = imgs[0];
          break;
        }
      }
    }

    if (finalImageMeta) break;
  }

  if (!finalImageMeta) {
    throw new Error(`ComfyUI: execution timed out after ${Math.round(maxWaitMs / 1000)}s`);
  }

  const viewUrl = `${cleanUrl}/view?filename=${encodeURIComponent(finalImageMeta.filename)}&subfolder=${encodeURIComponent(
    finalImageMeta.subfolder || "",
  )}&type=${encodeURIComponent(finalImageMeta.type || "output")}`;

  const imgRes = await fetch(viewUrl);
  if (!imgRes.ok) throw new Error(`ComfyUI download failed: ${await failText(imgRes)}`);
  return Buffer.from(await imgRes.arrayBuffer());
}

// ============================================================================
// Local Automatic1111 / SD-WebUI Connector
// ============================================================================

export async function checkA1111Status({ url = DEFAULT_A1111_URL, fetch = globalThis.fetch } = {}) {
  const cleanUrl = String(url).replace(/\/+$/, "");
  try {
    const res = await fetch(`${cleanUrl}/sdapi/v1/progress`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { online: false, error: `HTTP ${res.status}` };
    const progress = await res.json();
    return {
      online: true,
      url: cleanUrl,
      jobCount: progress.state?.job_count ?? 0,
    };
  } catch (err) {
    return { online: false, error: err.message, url: cleanUrl };
  }
}

export async function a1111Run({
  prompt,
  image = null,
  seed,
  strength = 0.7,
  url = DEFAULT_A1111_URL,
  fetch = globalThis.fetch,
  steps = 25,
  width = 1024,
  height = 1024,
}) {
  const cleanUrl = String(url).replace(/\/+$/, "");
  const isImg2Img = Boolean(image);
  const endpoint = isImg2Img ? `${cleanUrl}/sdapi/v1/img2img` : `${cleanUrl}/sdapi/v1/txt2img`;

  const payload = {
    prompt,
    negative_prompt: "ugly, blurry, low quality, distorted, bad anatomy",
    steps,
    width,
    height,
    sampler_name: "Euler a",
    seed: seed != null ? Number(seed) : -1,
  };

  if (isImg2Img) {
    payload.init_images = [image.toString("base64")];
    payload.denoising_strength = Math.max(0.1, Math.min(0.95, Number(strength) || 0.7));
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Automatic1111: ${await failText(res)}`);
  }

  const json = await res.json();
  const b64 = json.images?.[0];
  if (!b64) throw new Error("Automatic1111: no image returned");
  return Buffer.from(b64, "base64");
}

// ============================================================================
// Engine Connectivity Diagnostic Tool
// ============================================================================

export async function testEngineConnection(engineName, env = process.env, fetch = globalThis.fetch) {
  const start = Date.now();
  const eng = String(engineName).toLowerCase();

  switch (eng) {
    case "mock": {
      return {
        engine: "mock",
        online: true,
        pingMs: 0,
        local: true,
        message: "Offline deterministic mock engine active ($0.00)",
      };
    }
    case "fal": {
      const key = env.FAL_KEY || env.FAL_API_KEY;
      if (!key) return { engine: eng, online: false, message: "Missing FAL_KEY in environment" };
      try {
        const res = await fetch("https://fal.run/fal-ai/flux/schnell", {
          method: "OPTIONS",
          headers: { Authorization: `Key ${key}` },
          signal: AbortSignal.timeout(4000),
        });
        const pingMs = Date.now() - start;
        return { engine: eng, online: res.status < 500, pingMs, message: "Fal.ai endpoint accessible" };
      } catch (err) {
        return { engine: eng, online: false, message: `Fal.ai ping failed: ${err.message}` };
      }
    }
    case "comfyui": {
      const url = env.COMFYUI_URL || DEFAULT_COMFYUI_URL;
      const stat = await checkComfyUiStatus({ url, fetch });
      const pingMs = Date.now() - start;
      return {
        engine: eng,
        online: stat.online,
        pingMs,
        local: true,
        message: stat.online ? `ComfyUI connected (${stat.devices?.join(", ") || "CPU/GPU"})` : `Offline: ${stat.error}`,
      };
    }
    case "a1111": {
      const url = env.A1111_URL || env.SD_WEBUI_URL || DEFAULT_A1111_URL;
      const stat = await checkA1111Status({ url, fetch });
      const pingMs = Date.now() - start;
      return {
        engine: eng,
        online: stat.online,
        pingMs,
        local: true,
        message: stat.online ? "Automatic1111 / WebUI connected" : `Offline: ${stat.error}`,
      };
    }
    case "replicate":
    case "kontext":
    case "schnell": {
      const token = env.REPLICATE_API_TOKEN;
      if (!token) return { engine: eng, online: false, message: "Missing REPLICATE_API_TOKEN" };
      try {
        const res = await fetch("https://api.replicate.com/v1/models", {
          headers: { Authorization: `Token ${token}` },
          signal: AbortSignal.timeout(4000),
        });
        return {
          engine: eng,
          online: res.ok,
          pingMs: Date.now() - start,
          message: res.ok ? "Replicate API connected" : `HTTP ${res.status}`,
        };
      } catch (err) {
        return { engine: eng, online: false, message: `Replicate connection error: ${err.message}` };
      }
    }
    case "openai": {
      const key = env.OPENAI_API_KEY;
      if (!key) return { engine: eng, online: false, message: "Missing OPENAI_API_KEY" };
      try {
        const res = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(4000),
        });
        return {
          engine: eng,
          online: res.ok,
          pingMs: Date.now() - start,
          message: res.ok ? "OpenAI API connected" : `HTTP ${res.status}`,
        };
      } catch (err) {
        return { engine: eng, online: false, message: `OpenAI connection error: ${err.message}` };
      }
    }
    case "stability": {
      const key = env.STABILITY_API_KEY;
      if (!key) return { engine: eng, online: false, message: "Missing STABILITY_API_KEY" };
      try {
        const res = await fetch("https://api.stability.ai/v1/user/account", {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(4000),
        });
        return {
          engine: eng,
          online: res.ok,
          pingMs: Date.now() - start,
          message: res.ok ? "Stability API connected" : `HTTP ${res.status}`,
        };
      } catch (err) {
        return { engine: eng, online: false, message: `Stability connection error: ${err.message}` };
      }
    }
    default:
      return { engine: eng, online: false, message: `Unknown engine "${eng}"` };
  }
}
