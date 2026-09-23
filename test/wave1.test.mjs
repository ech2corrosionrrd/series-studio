import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPrompt, buildRecipes } from "../src/recipes.mjs";
import { loadTraitsFromPreset, NONE } from "../src/traits.mjs";
import { lintPrompt, lintPrompts } from "../src/lint.mjs";
import { computeRarity, expectedShares } from "../src/rarity.mjs";
import { checkConflicts, collectConflicts, conflictMessage } from "../src/rules.mjs";
import { detectImageMagic, checkImageFile } from "../src/imageqa.mjs";
import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function loadDemo() {
  return JSON.parse(readFileSync(join(ROOT, "presets", "demo-series.json"), "utf8"));
}

describe("trait packs catalog", () => {
  it("ships packs for templates (+ pfp-core)", () => {
    const packs = readdirSync(join(ROOT, "libraries", "traits"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
    for (const id of ["pfp-core", "brand-mascot", "fine-art", "abstract-series"]) {
      assert.ok(packs.includes(id), `missing pack ${id}`);
    }
    const core = JSON.parse(
      readFileSync(join(ROOT, "libraries", "traits", "pfp-core.json"), "utf8"),
    );
    assert.ok(Array.isArray(core.rules?.conflicts));
    assert.ok(core.rules.conflicts.length >= 2);
  });
});

describe("styleLock", () => {
  it("appends Style lock paragraph and extraKeep into prompt", () => {
    const preset = loadDemo();
    preset.styleLock = {
      angle: "chest-up centered",
      light: "soft studio",
      mood: "calm",
      framing: "square portrait",
      extraKeep: ["no text", "no logo"],
    };
    const items = loadTraitsFromPreset(preset);
    const traits = Object.fromEntries(items.map((t) => [t.key, t.options[0].value]));
    traits.headwear = NONE;
    traits.mark = NONE;
    const prompt = buildPrompt("a", traits, preset);
    assert.ok(prompt.includes("no text"));
    assert.ok(prompt.includes("no logo"));
    assert.ok(prompt.includes("Style lock:"));
    assert.ok(prompt.includes("angle: chest-up centered"));
    assert.ok(prompt.includes("light: soft studio"));
  });
});

describe("lint", () => {
  it("allows clean prompts", () => {
    assert.equal(lintPrompt("soft studio portrait, calm mood").ok, true);
  });
  it("hits brand and franchise terms case-insensitively", () => {
    const r = lintPrompt("a Nike swoosh and BATMAN cape");
    assert.equal(r.ok, false);
    assert.ok(r.hits.some((h) => /nike/i.test(h)));
    assert.ok(r.hits.some((h) => /batman/i.test(h)));
  });
  it("lintPrompts unions hits", () => {
    const r = lintPrompts(["ok", "Disney castle", "ok2"]);
    assert.equal(r.ok, false);
    assert.ok(r.hits.length >= 1);
  });
});

describe("rarity", () => {
  it("expectedShares normalize weights", () => {
    const s = expectedShares([
      { value: "A", weight: 1 },
      { value: "B", weight: 3 },
    ]);
    assert.equal(s.A, 25);
    assert.equal(s.B, 75);
  });
  it("computeRarity reports actual vs expected", () => {
    const preset = loadDemo();
    const recipes = buildRecipes(preset);
    const rarity = computeRarity(preset, recipes);
    assert.ok(rarity.traits.length > 0);
    const hair = rarity.traits.find((t) => t.key === "hair");
    assert.ok(hair);
    const sumCount = hair.options.reduce((a, o) => a + o.count, 0);
    assert.equal(sumCount, recipes.length);
  });
});

describe("trait conflicts", () => {
  it("detects Beanie + Afro Short from demo rules", () => {
    const preset = loadDemo();
    const conflicts = collectConflicts(preset);
    assert.ok(conflicts.length >= 2);
    const bad = checkConflicts(
      { headwear: "Beanie", hair: "Afro Short", outfit: "Black Tee", neck: "Bare" },
      conflicts,
    );
    assert.equal(bad.ok, false);
    assert.ok(conflictMessage(bad.hits).includes("Beanie"));
    const good = checkConflicts(
      { headwear: "None", hair: "Afro Short", outfit: "Black Tee", neck: "Bare" },
      conflicts,
    );
    assert.equal(good.ok, true);
  });
});

describe("image qa", () => {
  it("detects png magic", () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Buffer.alloc(20),
    ]);
    assert.equal(detectImageMagic(png), "png");
    assert.equal(detectImageMagic(Buffer.from("not-an-image")), null);
  });
  it("flags tiny / missing files", () => {
    const dir = mkdtempSync(join(tmpdir(), "sl-qa-"));
    const tiny = join(dir, "tiny.png");
    writeFileSync(tiny, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const r = checkImageFile(tiny);
    assert.equal(r.ok, false);
    assert.ok(r.issues.includes("too-small"));
    const missing = checkImageFile(join(dir, "nope.png"));
    assert.equal(missing.ok, false);
    assert.ok(missing.issues.includes("missing"));
    unlinkSync(tiny);
  });
});
