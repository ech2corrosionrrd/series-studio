/**
 * FLUX.1 [dev] weight licence notice.
 * Warns before a credit charge. Does not disable an engine and does not edit LEGAL.md.
 * Studio kontext is Pro. Schnell is a hosted API. Neither is this warning.
 */

const DEV_MODEL = /flux[/.-]dev|flux-kontext-dev|kontext-dev/i;
const SAFE_MODEL = /schnell|kontext-pro|flux-pro|flux\.1-pro|flux1-pro/i;

const TEXT = {
  uk: "Ваги FLUX.1 [dev] мають некомерційну ліцензію. Комерційне використання самих ваг потребує окремої ліцензії BFL. Вивід можна використовувати комерційно, якщо його переглянула людина: позначка «Лишити» і є цей перегляд. Series Lab не підписує юридичний висновок.",
  en: "FLUX.1 [dev] weights use a non-commercial licence. Commercial use of the weights needs a separate BFL licence. The output may be used commercially when a person reviews it: Keep is that review. Series Lab does not sign a legal conclusion.",
};

/**
 * @param {string} engine
 * @param {string} [model]
 * @param {{ fluxDevWeights?: boolean }} [opts]
 * @returns {{ code: string, model: string, uk: string, en: string } | null}
 */
export function licenseWarning(engine, model, opts = {}) {
  const eng = String(engine || "").toLowerCase();
  const mod = String(model || "");
  const localMark = Boolean(opts.fluxDevWeights) && (eng === "comfyui" || eng === "a1111" || eng === "comfy");
  if (localMark) return body(mod || "comfyui:flux.1-dev");
  if (SAFE_MODEL.test(mod)) return null;
  if (DEV_MODEL.test(mod)) return body(mod);
  if (eng === "fal" && !mod) return body("fal-ai/flux/dev/image-to-image");
  return null;
}

function body(model) {
  return { code: "flux-dev", model, uk: TEXT.uk, en: TEXT.en };
}

/** Model id the studio edit/txt path actually calls. */
export function engineModelId(engine, mode = "edit") {
  const id = String(engine || "");
  if (mode === "txt") {
    if (id === "fal") return "fal-ai/flux/schnell";
    if (id === "flux" || id === "replicate") return "black-forest-labs/flux-schnell";
    return null;
  }
  if (id === "fal") return "fal-ai/flux/dev/image-to-image";
  if (id === "kontext") return "black-forest-labs/flux-kontext-pro";
  return null;
}

/** Platform Flux model. Reference defaults to Kontext [dev], not Pro or Schnell. */
export function platformFluxModel({ reference = false, env = process.env } = {}) {
  if (reference) return env?.FLUX_I2I_MODEL || "black-forest-labs/flux-kontext-dev";
  return env?.FLUX_MODEL || "black-forest-labs/flux-schnell";
}
