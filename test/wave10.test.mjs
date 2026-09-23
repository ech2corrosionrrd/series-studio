import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const binPath = join(rootDir, "bin", "series.mjs");
const presetPath = join(rootDir, "presets", "demo-series.json");

describe("Wave 10: Headless CLI Render Pipeline", () => {
  it("executes dry-run render successfully with cost estimation and lint summary", async () => {
    const { stdout, stderr } = await execFileAsync("node", [
      binPath,
      "render",
      presetPath,
      "--dry-run",
    ]);

    assert.equal(stderr, "");
    assert.ok(stdout.includes("Series Lab CLI Render"));
    assert.ok(stdout.includes("Demo Studio Portraits"));
    assert.ok(stdout.includes("Engine: kontext"));
    assert.ok(stdout.includes("Estimated cost:"));
    assert.ok(stdout.includes("[DRY-RUN] Prepared 48 recipes. API calls skipped."));
  });

  it("respects CLI flags for limit, engine, strength, and output directory in dry-run", async () => {
    const { stdout, stderr } = await execFileAsync("node", [
      binPath,
      "render",
      presetPath,
      "--limit",
      "4",
      "-e",
      "gpt4o",
      "-s",
      "0.30",
      "-o",
      "out/custom-test-dir",
      "--dry-run",
    ]);

    assert.equal(stderr, "");
    assert.ok(stdout.includes("Engine: gpt4o"));
    assert.ok(stdout.includes("Strength: 0.3"));
    assert.ok(stdout.includes("Count: 4"));
    assert.ok(stdout.includes("custom-test-dir"));
    assert.ok(stdout.includes("[DRY-RUN] Prepared 4 recipes"));
  });

  it("fails gracefully with non-zero exit code if preset does not exist", async () => {
    await assert.rejects(
      async () => {
        await execFileAsync("node", [
          binPath,
          "render",
          "presets/non-existent-preset.json",
          "--dry-run",
        ]);
      },
      (err) => {
        return err.code !== 0;
      },
    );
  });
});
