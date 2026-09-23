import test from "node:test";
import assert from "node:assert/strict";
import { formatEnginePrompt } from "../src/matrix.mjs";

test("Wave 21: formatEnginePrompt live transformation for preview", (t) => {
  const recipe = {
    edition: 1,
    who: "neon cyberpunk android",
    traits: {
      hairstyle: "Buzz Cut",
      outfit: "Cyber Jacket",
    },
    prompt: "neon cyberpunk android with buzz cut, cyber jacket, soft studio lighting",
  };

  const preset = {
    name: "Cyber Series",
  };

  // Flux preview
  const fluxPrompt = formatEnginePrompt(recipe, "flux", preset);
  assert.ok(fluxPrompt.includes("neon cyberpunk android"));

  // SDXL preview (LoRA syntax / quality tags)
  const sdxlPrompt = formatEnginePrompt(recipe, "sdxl", preset);
  assert.ok(sdxlPrompt.includes("masterpiece") || sdxlPrompt.includes("cyber jacket"));

  // Midjourney preview (flags)
  const mjPrompt = formatEnginePrompt(recipe, "midjourney", preset);
  assert.ok(mjPrompt.includes("--v 6.1"));
  assert.ok(mjPrompt.includes("--stylize"));

  // Kontext preview (reference anchor)
  const kontextPrompt = formatEnginePrompt(recipe, "kontext", preset);
  assert.ok(kontextPrompt.includes("neon cyberpunk android"));

  // OpenAI prose preview
  const openaiPrompt = formatEnginePrompt(recipe, "openai", preset);
  assert.ok(openaiPrompt.length > 0);
});

test("Wave 21: Trait Co-occurrence calculation simulates correctly", (t) => {
  const recipes = [
    { edition: 1, traits: { hair: "Blue", outfit: "Jacket" } },
    { edition: 2, traits: { hair: "Blue", outfit: "Jacket" } },
    { edition: 3, traits: { hair: "Red", outfit: "Armor" } },
  ];

  const cooccurrence = {};
  for (const r of recipes) {
    const traits = Object.entries(r.traits || {}).filter(([, v]) => v && v !== "None");
    for (let i = 0; i < traits.length; i++) {
      for (let j = i + 1; j < traits.length; j++) {
        const pairKey = `${traits[i][0]}:${traits[i][1]} | ${traits[j][0]}:${traits[j][1]}`;
        cooccurrence[pairKey] = (cooccurrence[pairKey] || 0) + 1;
      }
    }
  }

  assert.equal(cooccurrence["hair:Blue | outfit:Jacket"], 2);
  assert.equal(cooccurrence["hair:Red | outfit:Armor"], 1);
});
