import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  parseCriticJson,
  sanitizeCriticOutput,
  triageImageOffline,
  triageImageVision,
  triageBatch,
} from "../src/index.mjs";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const binPath = join(rootDir, "bin", "series.mjs");

function validPng() {
  const base = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  return Buffer.concat([base, Buffer.alloc(1100, 0)]);
}

describe("Wave 11: AI Auto-Triage & Smart Critic", () => {
  it("parseCriticJson and sanitizeCriticOutput validate and clamp scores & verdicts", () => {
    const rawFenced = "```json\n{\n  \"score\": 9,\n  \"verdict\": \"keep\",\n  \"issues\": [\"none\"],\n  \"reason\": \"Clean artwork.\"\n}\n```";
    const parsed = parseCriticJson(rawFenced);
    assert.ok(parsed);
    assert.equal(parsed.score, 9);
    assert.equal(parsed.verdict, "keep");
    assert.deepEqual(parsed.issues, ["none"]);
    assert.equal(parsed.reason, "Clean artwork.");

    // Test fallback / clamping
    const bad = sanitizeCriticOutput({ score: 99, verdict: "unknown" });
    assert.equal(bad.score, 10);
    assert.equal(bad.verdict, "keep");

    const badLow = sanitizeCriticOutput({ score: -5 });
    assert.equal(badLow.score, 1);
    assert.equal(badLow.verdict, "redo");
  });

  it("triageImageOffline detects missing files, corrupt images, and prompt lint hits", () => {
    const testDir = join(rootDir, "out", "test-triage-offline");
    mkdirSync(testDir, { recursive: true });

    // Missing file
    const missingRes = triageImageOffline({ imagePath: join(testDir, "999.png") });
    assert.equal(missingRes.verdict, "redo");
    assert.ok(missingRes.issues.includes("missing_file"));

    // Corrupt / tiny file
    const corruptPath = join(testDir, "corrupt.png");
    writeFileSync(corruptPath, Buffer.from("not-a-png"));
    const corruptRes = triageImageOffline({ imagePath: corruptPath });
    assert.equal(corruptRes.verdict, "redo");

    // Valid png image
    const validPath = join(testDir, "1.png");
    writeFileSync(validPath, validPng());
    const validRes = triageImageOffline({
      imagePath: validPath,
      recipe: { prompt: "A portrait of a subject with cap", traits: { head: "Cap" } },
    });
    assert.equal(validRes.verdict, "keep");
    assert.equal(validRes.score, 8);

    // Prompt with brand hit (Disney / Marvel)
    const lintRes = triageImageOffline({
      imagePath: validPath,
      recipe: { prompt: "Disney style character with helmet", traits: { head: "Helmet" } },
    });
    assert.equal(lintRes.verdict, "review");
    assert.ok(lintRes.issues.includes("prompt_lint_warning"));
  });

  it("triageImageVision performs multimodal evaluation and handles mock responses", async () => {
    const mockFetch = async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                score: 9,
                verdict: "keep",
                issues: ["none"],
                reason: "Perfect trait matching and crisp lines.",
              }),
            },
          },
        ],
      }),
    });

    const res = await triageImageVision({
      image: validPng(),
      recipe: { edition: 1, prompt: "test prompt" },
      apiKey: "sk-mock-key",
      provider: "openai",
      fetchFn: mockFetch,
    });

    assert.equal(res.score, 9);
    assert.equal(res.verdict, "keep");
    assert.equal(res.mode, "vision");
  });

  it("triageBatch processes multiple images with concurrency and preserves order", async () => {
    const testDir = join(rootDir, "out", "test-triage-batch");
    mkdirSync(testDir, { recursive: true });
    const img1 = join(testDir, "1.png");
    const img2 = join(testDir, "2.png");
    const img3 = join(testDir, "3.png");
    writeFileSync(img1, validPng());
    writeFileSync(img2, validPng());
    writeFileSync(img3, validPng());

    const items = [
      { edition: 1, imagePath: img1, recipe: { prompt: "Clean prompt 1" } },
      { edition: 2, imagePath: img2, recipe: { prompt: "Disney prompt 2" } },
      { edition: 3, imagePath: img3, recipe: { prompt: "Clean prompt 3" } },
    ];

    const progressCalls = [];
    const results = await triageBatch(items, {
      concurrency: 2,
      provider: "heuristic",
      onProgress: (p) => progressCalls.push(p.completed),
    });

    assert.equal(results.length, 3);
    assert.equal(results[0].edition, 1);
    assert.equal(results[0].verdict, "keep");
    assert.equal(results[1].edition, 2);
    assert.equal(results[1].verdict, "review");
    assert.equal(results[2].edition, 3);
    assert.equal(results[2].verdict, "keep");
    assert.equal(progressCalls.length, 3);
  });

  it("CLI triage command executes dry-run cleanly", async () => {
    const testDir = join(rootDir, "out", "test-cli-triage");
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "1.png"), validPng());
    writeFileSync(join(testDir, "2.png"), validPng());

    const { stdout, stderr } = await execFileAsync("node", [
      binPath,
      "triage",
      testDir,
      "--dry-run",
    ]);

    assert.equal(stderr, "");
    assert.ok(stdout.includes("Series Lab CLI Triage"));
    assert.ok(stdout.includes("2 images in"));
    assert.ok(stdout.includes("[DRY-RUN] Prepared 2 items for triage"));
  });
});
