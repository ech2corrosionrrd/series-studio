/**
 * Multi-Engine Prompt Matrix & LoRA / Model Tag Transformer for Series Lab.
 * Generates tailored prompt variations for Flux, Midjourney, SDXL, Kontext, and OpenAI.
 */

export const ENGINE_MATRIX_PROFILES = {
  kontext: {
    id: "kontext",
    name: "Kontext / Reference-Anchor",
    format: (prompt, opts = {}) => {
      const prefix = opts.prefix ? `${opts.prefix.trim()} ` : "";
      const suffix = opts.suffix ? ` ${opts.suffix.trim()}` : "";
      return `${prefix}${prompt}${suffix}`.trim();
    },
  },
  openai: {
    id: "openai",
    name: "OpenAI DALL-E / GPT Image",
    format: (prompt, opts = {}) => {
      // Natural language, remove raw lora syntax or CLI flags
      let clean = prompt.replace(/<lora:[^>]+>/g, "").replace(/--[a-z0-9]+\s+[^\s]+/gi, "").trim();
      const prefix = opts.prefix ? `${opts.prefix.trim()} ` : "";
      const suffix = opts.suffix ? ` ${opts.suffix.trim()}` : "";
      return `${prefix}${clean}${suffix}`.trim();
    },
  },
  flux: {
    id: "flux",
    name: "Black Forest Labs Flux (LoRA / Trigger)",
    format: (prompt, opts = {}) => {
      const lora = opts.lora || opts.trigger ? `${(opts.lora || opts.trigger).trim()} ` : "";
      const prefix = opts.prefix ? `${opts.prefix.trim()} ` : "";
      const suffix = opts.suffix ? ` ${opts.suffix.trim()}` : "";
      return `${lora}${prefix}${prompt}${suffix}`.trim();
    },
  },
  sdxl: {
    id: "sdxl",
    name: "SDXL / Stability LoRA Syntax",
    format: (prompt, opts = {}) => {
      let loraTag = "";
      if (opts.lora) {
        const trimmed = opts.lora.trim();
        if (trimmed.startsWith("<lora:") && trimmed.endsWith(">")) {
          loraTag = `${trimmed} `;
        } else if (trimmed.includes(":")) {
          loraTag = `<lora:${trimmed}> `;
        } else {
          loraTag = `<lora:${trimmed}:1.0> `;
        }
      }
      const quality = opts.qualityTags || "masterpiece, highly detailed, sharp focus";
      const prefix = opts.prefix ? `${opts.prefix.trim()}, ` : "";
      const suffix = opts.suffix ? `, ${opts.suffix.trim()}` : "";
      return `${loraTag}${prefix}${prompt}${suffix}, ${quality}`.trim();
    },
  },
  midjourney: {
    id: "midjourney",
    name: "Midjourney v6 Parametric Syntax",
    format: (prompt, opts = {}) => {
      let clean = prompt.replace(/<lora:[^>]+>/g, "").trim();
      const prefix = opts.prefix ? `${opts.prefix.trim()} ` : "";
      const mjParams = opts.params || opts.suffix || "--v 6.1 --stylize 250 --ar 1:1";
      return `${prefix}${clean} ${mjParams.trim()}`.trim();
    },
  },
  pollinations: {
    id: "pollinations",
    name: "Pollinations Fast Engine",
    format: (prompt, opts = {}) => {
      const prefix = opts.prefix ? `${opts.prefix.trim()} ` : "";
      const suffix = opts.suffix ? ` ${opts.suffix.trim()}` : "";
      return `${prefix}${prompt}${suffix}`.trim();
    },
  },
};

/**
 * Format prompt for a specific engine using engine configs and LoRA tags.
 * @param {string} basePrompt
 * @param {string} engineKey
 * @param {object} [engineConfig={}]
 * @returns {string}
 */
export function formatEnginePrompt(basePromptOrRecipe, engineKey = "kontext", engineConfig = {}) {
  const basePrompt = typeof basePromptOrRecipe === "object" && basePromptOrRecipe !== null
    ? (basePromptOrRecipe.prompt || "")
    : String(basePromptOrRecipe || "");
  const profile = ENGINE_MATRIX_PROFILES[engineKey.toLowerCase()] || ENGINE_MATRIX_PROFILES.kontext;
  return profile.format(basePrompt, engineConfig);
}

/**
 * Generate a multi-engine prompt matrix for a single recipe.
 * @param {object} recipe
 * @param {object} [preset={}]
 * @param {string[]} [engineTargets=["kontext", "openai", "flux", "midjourney", "sdxl"]]
 * @returns {object} { [engineKey]: string }
 */
export function buildEnginePromptMatrix(recipe, preset = {}, engineTargets = ["kontext", "openai", "flux", "midjourney", "sdxl"]) {
  const basePrompt = recipe.prompt || "";
  const presetMatrix = preset?.engineMatrix || {};
  const matrix = {};

  for (const eng of engineTargets) {
    const config = presetMatrix[eng] || {};
    matrix[eng] = formatEnginePrompt(basePrompt, eng, config);
  }

  return matrix;
}

/**
 * Export CSV containing the multi-engine prompt matrix across all recipes.
 * @param {Array<object>} recipes
 * @param {object} [preset={}]
 * @param {string[]} [engineTargets=["kontext", "openai", "flux", "midjourney", "sdxl"]]
 * @returns {string} CSV string
 */
export function exportEngineMatrixCsv(recipes = [], preset = {}, engineTargets = ["kontext", "openai", "flux", "midjourney", "sdxl"]) {
  const escapeCell = (val) => {
    if (val == null) return "";
    const str = String(val);
    if (/[",\r\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const headers = ["edition", "dna", "base_prompt", ...engineTargets.map((e) => `prompt_${e}`)];
  const rows = [headers.map(escapeCell).join(",")];

  for (const r of recipes) {
    const matrix = buildEnginePromptMatrix(r, preset, engineTargets);
    const row = [
      String(r.edition ?? 1),
      r.dna || "",
      r.prompt || "",
      ...engineTargets.map((e) => matrix[e] || ""),
    ];
    rows.push(row.map(escapeCell).join(","));
  }

  return rows.join("\r\n") + "\r\n";
}
