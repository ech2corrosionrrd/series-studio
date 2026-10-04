/**
 * AI Auto-Triage & Smart Critic for Series Lab.
 * Evaluates generated edition images against recipe traits, prompts, and style rules.
 * Supports fast offline heuristics and multimodal LLM Vision (GPT-4o / Claude).
 */

import { existsSync, readFileSync } from "node:fs";
import { checkImageFile } from "./imageqa.mjs";
import { lintPrompt } from "./lint.mjs";
import { mapConcurrent } from "./pool.mjs";

const CRITIC_SYSTEM_PROMPT = `You are an expert generative art director and QA curator for an NFT series collection.
Your job is to inspect the provided generated edition image against its intended prompt and style rules.

Assess:
1. Visual fidelity: sharp, coherent composition, absence of severe visual artifacts, glitching, or anatomical distortion.
2. Trait fidelity: check if key requested traits and accessories are visible.
3. Framing & style: consistency with the series look.

Scoring guide:
- 8-10: "keep" — High quality, clean composition, key traits visible, no major defects.
- 5-7: "review" — Acceptable but has minor issues (slight blur, trait ambiguity, slight crop).
- 1-4: "redo" — Significant defects, distorted features, missing major traits, severe artifacts, or unusable result.

Output MUST be a single valid JSON object with EXACTLY this structure:
{
  "score": <number from 1 to 10>,
  "verdict": "keep" | "redo" | "review",
  "issues": ["<tag1>", "<tag2>"],
  "missingTraits": ["<trait key that is not visible>"],
  "reason": "1-2 concise sentences explaining the verdict and key observations."
}

missingTraits lists recipe trait keys you cannot see in the image, key for key with the Traits object. Use [] when every listed trait is visible or when you cannot tell. Do not invent keys.

Allowed issue tags: "none", "distorted_face", "bad_anatomy", "missing_trait", "blurry", "bad_crop", "glitch", "style_mismatch", "prompt_violation".
Do not include any other markdown or commentary outside the JSON object.`;

/**
 * Sanitize and validate triage/critic output.
 * @param {object} data
 * @returns {{ score: number, verdict: 'keep'|'redo'|'review', issues: string[], reason: string }}
 */
export function sanitizeCriticOutput(data, traitKeys = null) {
  let rawScore = Number(data?.score);
  if (!Number.isFinite(rawScore)) rawScore = 6;
  const score = Math.max(1, Math.min(10, Math.round(rawScore)));

  let verdict = String(data?.verdict || "").toLowerCase().trim();
  if (verdict !== "keep" && verdict !== "redo" && verdict !== "review") {
    if (score >= 8) verdict = "keep";
    else if (score <= 4) verdict = "redo";
    else verdict = "review";
  }

  const rawIssues = Array.isArray(data?.issues) ? data.issues : [];
  const issues = rawIssues
    .filter((s) => s != null)
    .map((s) => String(s).trim().toLowerCase())
    .filter(Boolean);

  if (issues.length === 0) {
    issues.push(verdict === "keep" ? "none" : "unspecified");
  }

  const reason = String(data?.reason || "").trim() ||
    (verdict === "keep" ? "High quality output matching prompt and style." : "Requires review or regeneration.");

  const allow = Array.isArray(traitKeys) ? new Set(traitKeys.map((k) => String(k))) : null;
  const missingTraits = [...new Set(
    (Array.isArray(data?.missingTraits) ? data.missingTraits : [])
      .filter((s) => s != null)
      .map((s) => String(s).trim())
      .filter(Boolean)
      .filter((k) => !allow || allow.has(k)),
  )];
  if (missingTraits.length && !issues.includes("missing_trait")) issues.push("missing_trait");

  return { score, verdict, issues, missingTraits, reason };
}

/**
 * Extract clean JSON object from LLM response text.
 * @param {string} text
 * @returns {object|null}
 */
export function parseCriticJson(text, traitKeys = null) {
  if (!text) return null;
  const raw = String(text).trim();
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const target = jsonMatch ? jsonMatch[1].trim() : raw;
  try {
    const parsed = JSON.parse(target);
    if (parsed && typeof parsed === "object") {
      return sanitizeCriticOutput(parsed, traitKeys);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fast 100% offline rule-based triage.
 * @param {object} params
 * @param {string} params.imagePath
 * @param {object} [params.recipe]
 * @param {object} [params.preset]
 * @returns {{ score: number, verdict: 'keep'|'redo'|'review', issues: string[], reason: string, mode: 'heuristic' }}
 */
export function triageImageOffline({ imagePath, recipe, preset }) {
  if (!imagePath || !existsSync(imagePath)) {
    return {
      score: 1,
      verdict: "redo",
      issues: ["missing_file"],
      missingTraits: [],
      reason: "Image file is missing from disk.",
      mode: "heuristic",
    };
  }

  const qa = checkImageFile(imagePath);
  if (!qa.ok) {
    return {
      score: 2,
      verdict: "redo",
      issues: qa.issues.map((i) => `file_${i}`),
      missingTraits: [],
      reason: `Image file integrity check failed (${qa.issues.join(", ")}).`,
      mode: "heuristic",
    };
  }

  const prompt = recipe?.prompt || "";
  if (prompt) {
    const lint = lintPrompt(prompt);
    if (!lint.ok) {
      return {
        score: 5,
        verdict: "review",
        issues: ["prompt_lint_warning"],
        missingTraits: [],
        reason: `Prompt triggered brand/franchise lint warning (${lint.hits.join(", ")}). Offline mode does not decide whether a trait is visible.`,
        mode: "heuristic",
      };
    }
  }

  return {
    score: 8,
    verdict: "keep",
    issues: ["none"],
    missingTraits: [],
    reason: `Image passed file QA (${qa.format}, ${Math.round(qa.bytes / 1024)} KB). Offline mode does not check whether traits are visible.`,
    mode: "heuristic",
  };
}

/** How many triage rows name a missing trait. Does not block a ZIP. */
export function countMissingTraitFrames(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const editions = [];
  for (const row of list) {
    const missing = Array.isArray(row?.missingTraits) ? row.missingTraits : [];
    const issues = Array.isArray(row?.issues) ? row.issues : [];
    if (missing.length || issues.includes("missing_trait")) {
      if (row?.edition != null) editions.push(row.edition);
    }
  }
  return { frames: editions.length, editions };
}

/**
 * AI Multimodal Vision triage for a single edition image.
 * @param {object} params
 * @param {Buffer} params.image
 * @param {string} [params.mime]
 * @param {string} [params.imagePath]
 * @param {object} [params.recipe]
 * @param {object} [params.preset]
 * @param {string} [params.apiKey]
 * @param {string} [params.provider]
 * @param {typeof fetch} [params.fetchFn]
 */
export async function triageImageVision({
  image,
  mime = "image/png",
  imagePath,
  recipe = {},
  preset = {},
  apiKey,
  provider = "openai",
  fetchFn = globalThis.fetch,
}) {
  if (!apiKey) {
    const fallback = triageImageOffline({ imagePath, recipe, preset });
    return { ...fallback, reason: `${fallback.reason} (offline heuristic)` };
  }

  let imgBuf = image;
  if (!imgBuf && imagePath && existsSync(imagePath)) {
    imgBuf = readFileSync(imagePath);
  }
  if (!imgBuf) {
    return triageImageOffline({ imagePath, recipe, preset });
  }

  const b64Image = imgBuf.toString("base64");
  const promptContext = [
    recipe.edition ? `Edition: #${recipe.edition}` : "",
    recipe.prompt ? `Intended Prompt: "${recipe.prompt}"` : "",
    recipe.traits ? `Traits: ${JSON.stringify(recipe.traits)}` : "",
    preset.styleLock ? `Style Lock Rules: ${JSON.stringify(preset.styleLock)}` : "",
  ].filter(Boolean).join("\n");

  const userPrompt = `Evaluate this generated NFT edition image.\n${promptContext}\n\nAssess quality and trait compliance. Output pure JSON.`;

  try {
    if (provider === "anthropic") {
      const mediaType = mime === "image/webp" ? "image/webp" : mime === "image/jpeg" ? "image/jpeg" : "image/png";
      const res = await fetchFn("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 600,
          system: CRITIC_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: mediaType, data: b64Image } },
                { type: "text", text: userPrompt },
              ],
            },
          ],
        }),
      });

      if (!res.ok) {
        throw new Error(`Anthropic Vision HTTP ${res.status}`);
      }

      const json = await res.json();
      const content = json.content?.[0]?.text;
      const parsed = parseCriticJson(content, Object.keys(recipe?.traits || {}));
      if (parsed) return { ...parsed, mode: "vision", provider: "anthropic" };
    } else {
      // Default: OpenAI
      const res = await fetchFn("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            { role: "system", content: CRITIC_SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: userPrompt },
                { type: "image_url", image_url: { url: `data:${mime};base64,${b64Image}`, detail: "low" } },
              ],
            },
          ],
          max_tokens: 600,
          temperature: 0.2,
          response_format: { type: "json_object" },
        }),
      });

      if (!res.ok) {
        throw new Error(`OpenAI Vision HTTP ${res.status}`);
      }

      const json = await res.json();
      const content = json.choices?.[0]?.message?.content;
      const parsed = parseCriticJson(content, Object.keys(recipe?.traits || {}));
      if (parsed) return { ...parsed, mode: "vision", provider: "openai" };
    }
  } catch (err) {
    const fallback = triageImageOffline({ imagePath, recipe, preset });
    return {
      ...fallback,
      reason: `${fallback.reason} (Vision check failed: ${err.message || err})`,
    };
  }

  return triageImageOffline({ imagePath, recipe, preset });
}

/**
 * Batch triage runner for multiple edition images with concurrency.
 * @param {Array<{ edition: number, imagePath: string, recipe?: object }>} items
 * @param {object} [opts]
 * @param {number} [opts.concurrency=2]
 * @param {string} [opts.provider='heuristic'] - 'heuristic' | 'openai' | 'anthropic'
 * @param {string} [opts.apiKey]
 * @param {object} [opts.preset]
 * @param {Function} [opts.onProgress]
 * @param {typeof fetch} [opts.fetchFn]
 */
export async function triageBatch(items = [], opts = {}) {
  const concurrency = Math.max(1, Math.min(4, Number(opts.concurrency) || 2));
  const provider = opts.provider || "heuristic";
  const apiKey = opts.apiKey;
  const preset = opts.preset || {};

  return mapConcurrent(
    items,
    concurrency,
    async (item) => {
      let result;
      if (provider === "heuristic" || !apiKey) {
        result = triageImageOffline({
          imagePath: item.imagePath,
          recipe: item.recipe,
          preset,
        });
      } else {
        result = await triageImageVision({
          imagePath: item.imagePath,
          recipe: item.recipe,
          preset,
          apiKey,
          provider,
          fetchFn: opts.fetchFn,
        });
      }
      return {
        edition: item.edition,
        ...result,
      };
    },
    opts.onProgress,
  );
}
