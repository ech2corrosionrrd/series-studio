import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseVisionJson,
  sanitizeVisionOutput,
  fallbackVisionOutput,
  analyzeBaseImage,
} from "../src/index.mjs";

describe("Wave 7: Vision parsing and sanitization", () => {
  it("parses raw JSON correctly", () => {
    const jsonStr = JSON.stringify({
      styleLock: {
        angle: "front portrait",
        light: "cyberpunk neon",
        mood: "bold",
        framing: "close up",
        extraKeep: ["sharp eyes", "angular jaw"],
      },
      suggestedTraits: [
        {
          key: "eyewear",
          type: "Eyewear",
          options: [
            { value: "Visor", weight: 10, prompt: "neon visor" },
            { value: "Shades", weight: 5, prompt: "black shades" },
          ],
        },
      ],
      summary: "Clean cyberpunk character.",
    });

    const parsed = parseVisionJson(jsonStr);
    assert.ok(parsed);
    assert.equal(parsed.styleLock.angle, "front portrait");
    assert.equal(parsed.suggestedTraits.length, 1);
    assert.equal(parsed.suggestedTraits[0].key, "eyewear");
    assert.equal(parsed.suggestedTraits[0].options.length, 2);
  });

  it("handles markdown code fences in LLM output", () => {
    const md = `Here is the analysis of the base image:
\`\`\`json
{
  "styleLock": {
    "angle": "3/4 profile",
    "light": "soft sunlight",
    "mood": "warm",
    "framing": "bust",
    "extraKeep": ["freckles"]
  },
  "suggestedTraits": [
    {
      "key": "hair",
      "type": "Hair",
      "options": [{ "value": "Wavy", "weight": 5, "prompt": "wavy brown hair" }]
    }
  ],
  "summary": "Warm natural portrait."
}
\`\`\`
Hope this helps!`;

    const parsed = parseVisionJson(md);
    assert.ok(parsed);
    assert.equal(parsed.styleLock.angle, "3/4 profile");
    assert.equal(parsed.suggestedTraits[0].key, "hair");
  });

  it("sanitizes malformed or empty fields safely", () => {
    const sanitized = sanitizeVisionOutput({
      styleLock: {
        angle: "  side view  ",
        extraKeep: [" item 1 ", "", null],
      },
      suggestedTraits: [
        { key: "good-key!", options: [{ value: "Opt1", weight: -5 }] },
        { key: "", options: [] },
      ],
    });

    assert.equal(sanitized.styleLock.angle, "side view");
    assert.deepEqual(sanitized.styleLock.extraKeep, ["item 1"]);
    assert.equal(sanitized.suggestedTraits.length, 1);
    assert.equal(sanitized.suggestedTraits[0].key, "good-key");
    assert.equal(sanitized.suggestedTraits[0].options[0].weight, 1);
  });
});

describe("Wave 7: Fallback and analyzeBaseImage offline execution", () => {
  it("returns structured fallback when no API keys are present", async () => {
    const dummyImage = Buffer.from("fake-png-data");
    const res = await analyzeBaseImage(
      { image: dummyImage, mime: "image/png" },
      { env: {} }
    );
    assert.equal(res.ok, true);
    assert.ok(res.data.styleLock);
    assert.ok(Array.isArray(res.data.suggestedTraits));
    assert.ok(res.provider.includes("heuristic"));
  });

  it("fallbackVisionOutput provides standard defaults", () => {
    const fb = fallbackVisionOutput();
    assert.ok(fb.styleLock.angle);
    assert.ok(fb.suggestedTraits.length >= 2);
  });
});
