/**
 * Vision Assist: analyze base image to extract styleLock and suggested traits.
 * Inspired by W3IR Prompt vision analyzer.
 * Keys loaded from server env (OPENAI_API_KEY or ANTHROPIC_API_KEY).
 */
import { anthropicModel } from "./models.mjs";

/**
 * Room for the whole JSON answer. The Claude 5 models write longer trait lists than the old 1500 tokens allowed: the reply
 * was cut off in the middle of the JSON, failed to parse and silently fell back to the heuristic.
 */
const VISION_MAX_TOKENS = 4096;

const SYSTEM_PROMPT = `You are an expert art director and generative NFT series prompt engineer.
Analyze the provided base image and produce a structured JSON configuration for generating consistent variations of this character/subject.

Output MUST be a single valid JSON object with EXACTLY this structure:
{
  "styleLock": {
    "angle": "camera angle (e.g. front close-up portrait, dynamic 3/4 angle, side profile)",
    "light": "lighting style (e.g. dramatic rim lighting, soft studio lighting, cyberpunk neon glow)",
    "mood": "atmosphere/mood (e.g. confident, brooding, whimsical, intense)",
    "framing": "framing/crop (e.g. bust-up shot, centered headshot, full body)",
    "extraKeep": ["2-3 key visual anchors to preserve in every generation, e.g. 'sharp angular jawline', 'clean vector artstyle'"]
  },
  "suggestedTraits": [
    {
      "key": "hair",
      "type": "Hair Style",
      "options": [
        { "value": "Original", "weight": 10, "prompt": "hair style as in base" },
        { "value": "Buzz", "weight": 8, "prompt": "a sharp clean buzz cut" },
        { "value": "Wavy Long", "weight": 8, "prompt": "flowing wavy long hair" }
      ]
    },
    {
      "key": "eyewear",
      "type": "Eyewear",
      "options": [
        { "value": "None", "weight": 20, "prompt": "" },
        { "value": "Cyber Visor", "weight": 6, "prompt": "a glowing neon cyber visor across the eyes" },
        { "value": "Dark Shades", "weight": 8, "prompt": "sleek minimalist dark sunglasses" }
      ]
    },
    {
      "key": "expression",
      "type": "Expression",
      "options": [
        { "value": "Neutral", "weight": 15, "prompt": "a calm focused expression" },
        { "value": "Smirk", "weight": 10, "prompt": "a confident subtle smirk" },
        { "value": "Intense", "weight": 8, "prompt": "a sharp intense gaze" }
      ]
    }
  ],
  "summary": "Short 1-2 sentence visual description of the core aesthetic and recommendations."
}

Do not include any other text, markdown explanations, or commentary outside the JSON object.`;

/**
 * Extract clean JSON object from LLM response text (handles ```json fences).
 * @param {string} text
 * @returns {object|null}
 */
export function parseVisionJson(text) {
  if (!text) return null;
  const raw = String(text).trim();
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const target = jsonMatch ? jsonMatch[1].trim() : raw;
  try {
    const parsed = JSON.parse(target);
    if (parsed && typeof parsed === "object") {
      return sanitizeVisionOutput(parsed);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Sanitize and validate vision output shape.
 * @param {object} data
 * @returns {object}
 */
export function sanitizeVisionOutput(data) {
  const lock = data?.styleLock || {};
  const styleLock = {
    angle: String(lock.angle || "").trim(),
    light: String(lock.light || "").trim(),
    mood: String(lock.mood || "").trim(),
    framing: String(lock.framing || "").trim(),
    extraKeep: Array.isArray(lock.extraKeep)
      ? lock.extraKeep.filter((s) => s != null).map((s) => String(s).trim()).filter(Boolean)
      : [],
  };

  const rawTraits = Array.isArray(data?.suggestedTraits) ? data.suggestedTraits : [];
  const suggestedTraits = rawTraits
    .filter((t) => t && typeof t === "object" && t.key)
    .map((t) => {
      const key = String(t.key).replace(/[^a-zA-Z0-9_-]/g, "");
      const type = String(t.type || key);
      const rawOpts = Array.isArray(t.options) ? t.options : [];
      const options = rawOpts
        .filter((o) => o && typeof o === "object" && o.value)
        .map((o) => ({
          value: String(o.value).trim(),
          weight: Math.max(1, Number(o.weight) || 1),
          prompt: String(o.prompt ?? "").trim(),
        }));
      return { key, type, options };
    })
    .filter((t) => t.options.length > 0);

  const summary = String(data?.summary || "").trim();

  return { styleLock, suggestedTraits, summary };
}

/**
 * Fallback heuristic extractor when no AI key is provided.
 * @returns {object}
 */
export function fallbackVisionOutput() {
  return {
    styleLock: {
      angle: "front close-up portrait",
      light: "studio rim lighting",
      mood: "focused, distinctive character",
      framing: "centered head and shoulders",
      extraKeep: ["preserve core facial features", "match overall color palette"],
    },
    suggestedTraits: [
      {
        key: "expression",
        type: "Expression",
        options: [
          { value: "Neutral", weight: 15, prompt: "a calm neutral gaze" },
          { value: "Slight Smile", weight: 10, prompt: "a subtle warm smile" },
          { value: "Determined", weight: 8, prompt: "a determined intense expression" },
        ],
      },
      {
        key: "eyewear",
        type: "Eyewear",
        options: [
          { value: "None", weight: 20, prompt: "" },
          { value: "Dark Glasses", weight: 8, prompt: "stylish dark glasses" },
          { value: "Clear Frames", weight: 6, prompt: "modern clear glass frames" },
        ],
      },
      {
        key: "headwear",
        type: "Headwear",
        options: [
          { value: "None", weight: 20, prompt: "" },
          { value: "Beanie", weight: 8, prompt: "a fitted knit beanie" },
          { value: "Cap", weight: 6, prompt: "a classic fitted baseball cap" },
        ],
      },
    ],
    summary: "Standard portrait base preset configuration.",
  };
}

/**
 * Call OpenAI Vision API.
 */
async function callOpenAiVision(b64Image, mime, apiKey, fetchFn) {
  const url = "https://api.openai.com/v1/chat/completions";
  const body = {
    model: "gpt-4o",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Analyze this NFT base image and extract the style lock and starter trait variations." },
          {
            type: "image_url",
            image_url: { url: `data:${mime};base64,${b64Image}` },
          },
        ],
      },
    ],
    max_tokens: VISION_MAX_TOKENS,
    temperature: 0.3,
    response_format: { type: "json_object" },
  };

  const res = await fetchFn(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenAI Vision HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }

  const json = await res.json();
  if (json.choices?.[0]?.finish_reason === "length") throw new Error("OpenAI Vision reply was cut off (max_tokens)");
  const content = json.choices?.[0]?.message?.content;
  return parseVisionJson(content);
}

/**
 * Call Anthropic Vision API.
 */
async function callAnthropicVision(b64Image, mime, apiKey, fetchFn, model) {
  const url = "https://api.anthropic.com/v1/messages";
  const mediaType = mime === "image/png" ? "image/png" : mime === "image/webp" ? "image/webp" : "image/jpeg";
  const body = {
    model,
    max_tokens: VISION_MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType,
              data: b64Image,
            },
          },
          {
            type: "text",
            text: "Analyze this NFT base image and extract the style lock and starter trait variations.",
          },
        ],
      },
    ],
  };

  const res = await fetchFn(url, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Anthropic Vision HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }

  const json = await res.json();
  if (json.stop_reason === "max_tokens") throw new Error("Anthropic Vision reply was cut off (max_tokens)");
  const content = json.content?.[0]?.text;
  return parseVisionJson(content);
}

/**
 * Main Vision Assist entry point.
 * @param {{ image: Buffer, mime?: string }} input
 * @param {{ env?: Record<string, string>, fetch?: Function }} [ctx]
 * @returns {Promise<{ ok: true, provider: string, data: object } | { ok: false, error: string }>}
 */
export async function analyzeBaseImage({ image, mime = "image/png" }, ctx = {}) {
  const env = ctx.env || process.env || {};
  const fetchFn = ctx.fetch || globalThis.fetch;
  const b64 = Buffer.isBuffer(image) ? image.toString("base64") : String(image || "");

  if (!b64) {
    return { ok: false, error: "Image data is required for vision analysis" };
  }

  // 1. Try OpenAI if key present
  if (env.OPENAI_API_KEY) {
    try {
      const result = await callOpenAiVision(b64, mime, env.OPENAI_API_KEY, fetchFn);
      if (result) {
        return { ok: true, provider: "openai (gpt-4o)", data: result };
      }
      console.warn("OpenAI Vision answered without usable JSON");
    } catch (e) {
      console.warn("OpenAI Vision failed:", e.message || e);
    }
  }

  // 2. Try Anthropic if key present
  if (env.ANTHROPIC_API_KEY) {
    try {
      const model = anthropicModel(env);
      const result = await callAnthropicVision(b64, mime, env.ANTHROPIC_API_KEY, fetchFn, model);
      if (result) {
        return { ok: true, provider: `anthropic (${model})`, data: result };
      }
      console.warn("Anthropic Vision answered without usable JSON");
    } catch (e) {
      console.warn("Anthropic Vision failed:", e.message || e);
    }
  }

  // 3. Fallback heuristic
  return {
    ok: true,
    provider: "heuristic (no vision API key)",
    data: fallbackVisionOutput(),
  };
}
