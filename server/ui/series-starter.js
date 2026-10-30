/**
 * The preset a brand-new series starts from (BETA-REVIEW, round 2, R1).
 * "Start the series" used to save whatever the Constructor held, so a new ID copied the prompt, traits, lines and engine
 * of the project that happened to be open. This one is neutral: nothing of another series, but valid against the schema
 * (it needs one trait with options), so the Overview can save it and the Constructor can replace it with a template.
 */
export const STARTER_ENGINE = "kontext";
/** The product default reference strength; the same number as DEFAULT_STRENGTH in src/reference.mjs (a test pins them). */
export const STARTER_STRENGTH = 0.45;

export function newSeriesStarter({ id, name, seed, size, genesis = false }) {
  return {
    schema: "series-preset/v0",
    id,
    name: name || id,
    seed: seed || id,
    size,
    genesis: Boolean(genesis),
    base: { path: "input/primary.png" },
    lines: { a: { who: "series subject", base: "input/primary.png", quota: size } },
    promptTemplate: {
      keep: ["Edit this image of a {who}. Keep: the same character, face and proportions"],
      changeKeys: ["expression"],
      extraKeys: [],
      suffix: "No text, no logos, no watermark; single character.",
    },
    traits: {
      items: [
        {
          key: "expression",
          type: "Expression",
          options: [
            { value: "Calm", weight: 1, prompt: "a calm, relaxed expression" },
            { value: "Happy", weight: 1, prompt: "a warm, happy smile" },
            { value: "Curious", weight: 1, prompt: "a curious look with raised eyebrows" },
          ],
        },
      ],
    },
    rules: { forbiddenPairs: [] },
    engine: { default: STARTER_ENGINE, strength: STARTER_STRENGTH },
    waves: null,
  };
}
