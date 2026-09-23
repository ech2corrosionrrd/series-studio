import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatEnginePrompt,
  buildEnginePromptMatrix,
  exportEngineMatrixCsv,
  ENGINE_MATRIX_PROFILES,
} from "../src/index.mjs";

test("Wave 17 — formatEnginePrompt across different engines", () => {
  const basePrompt = "Keep base character, change hairstyle to mohawk, dark cyber theme";

  // Flux with trigger word
  const fluxPrompt = formatEnginePrompt(basePrompt, "flux", {
    trigger: "gremlin_girl_v2",
    suffix: "8k photorealistic",
  });
  assert.ok(fluxPrompt.startsWith("gremlin_girl_v2"));
  assert.ok(fluxPrompt.endsWith("8k photorealistic"));

  // SDXL with LoRA syntax and quality tags
  const sdxlPrompt = formatEnginePrompt(basePrompt, "sdxl", {
    lora: "cyber_gremlin:0.85",
    qualityTags: "masterpiece, highly detailed",
  });
  assert.ok(sdxlPrompt.startsWith("<lora:cyber_gremlin:0.85>"));
  assert.ok(sdxlPrompt.includes("masterpiece, highly detailed"));

  // Midjourney with parametric CLI flags
  const mjPrompt = formatEnginePrompt(basePrompt, "midjourney", {
    params: "--v 6.1 --stylize 300 --ar 1:1",
  });
  assert.ok(mjPrompt.endsWith("--v 6.1 --stylize 300 --ar 1:1"));

  // OpenAI / DALL-E strips LoRA tags and flags
  const rawWithLora = "Keep character, <lora:bad:1.0> change hair --v 6.0";
  const openaiPrompt = formatEnginePrompt(rawWithLora, "openai");
  assert.ok(!openaiPrompt.includes("<lora:"));
  assert.ok(!openaiPrompt.includes("--v"));
});

test("Wave 17 — buildEnginePromptMatrix creates complete engine matrix", () => {
  const recipe = {
    edition: 1,
    dna: "LINE1-MOHAWK-NEON",
    prompt: "A cybernetic gremlin with glowing neon eyes",
  };

  const preset = {
    engineMatrix: {
      flux: { trigger: "FLUX_GREMLIN" },
      sdxl: { lora: "<lora:sdxl_grem:0.9>" },
      midjourney: { params: "--v 6.1 --stylize 250" },
    },
  };

  const matrix = buildEnginePromptMatrix(recipe, preset, ["kontext", "openai", "flux", "midjourney", "sdxl"]);
  assert.ok(matrix.kontext.includes("cybernetic gremlin"));
  assert.ok(matrix.flux.startsWith("FLUX_GREMLIN"));
  assert.ok(matrix.sdxl.startsWith("<lora:sdxl_grem:0.9>"));
  assert.ok(matrix.midjourney.endsWith("--v 6.1 --stylize 250"));
});

test("Wave 17 — exportEngineMatrixCsv generates valid CSV", () => {
  const recipes = [
    { edition: 1, dna: "D1", prompt: "Cyberpunk Gremlin #1" },
    { edition: 2, dna: "D2", prompt: "Steampunk Gremlin #2" },
  ];

  const preset = {
    engineMatrix: {
      flux: { trigger: "FLUX_HERO" },
      midjourney: { params: "--v 6.1" },
    },
  };

  const csv = exportEngineMatrixCsv(recipes, preset, ["flux", "midjourney"]);
  const lines = csv.trim().split("\r\n");

  assert.equal(lines[0], "edition,dna,base_prompt,prompt_flux,prompt_midjourney");
  assert.ok(lines[1].includes("FLUX_HERO"));
  assert.ok(lines[1].includes("--v 6.1"));
});
