import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRecipes } from "../src/recipes.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const TRAITS = join(ROOT, "libraries", "traits");

const PACK_IDS = ["pfp-core", "brand-mascot", "fine-art", "abstract-series"];

function loadPack(id) {
  return JSON.parse(readFileSync(join(TRAITS, `${id}.json`), "utf8"));
}

function keySet(pack) {
  return new Set((pack.items || []).map((t) => t.key));
}

describe("wave4 distinct trait packs", () => {
  it("each pack has distinct key sets (no shared identical catalog)", () => {
    const packs = PACK_IDS.map((id) => ({ id, pack: loadPack(id) }));
    for (const { id, pack } of packs) {
      assert.equal(pack.id, id);
      assert.ok(Array.isArray(pack.items));
      assert.ok(pack.items.length >= 6 && pack.items.length <= 12, `${id} key count`);
      for (const item of pack.items) {
        assert.ok(item.key);
        assert.ok(Array.isArray(item.options));
        assert.ok(
          item.options.length >= 5 && item.options.length <= 10,
          `${id}.${item.key} options ${item.options.length}`,
        );
      }
      assert.ok(Array.isArray(pack.rules?.conflicts));
      assert.ok(pack.rules.conflicts.length >= 2, `${id} needs conflicts`);
    }

    // Pairwise: key sets must not be equal
    for (let i = 0; i < packs.length; i++) {
      for (let j = i + 1; j < packs.length; j++) {
        const a = [...keySet(packs[i].pack)].sort().join(",");
        const b = [...keySet(packs[j].pack)].sort().join(",");
        assert.notEqual(
          a,
          b,
          `${packs[i].id} and ${packs[j].id} must not share identical key sets`,
        );
      }
    }
  });

  it("pfp-core keeps portrait spine; others omit character hair/outfit", () => {
    const pfp = keySet(loadPack("pfp-core"));
    for (const k of ["hair", "hairColor", "outfit", "skinTone", "background"]) {
      assert.ok(pfp.has(k), `pfp-core missing ${k}`);
    }
    const mascot = keySet(loadPack("brand-mascot"));
    for (const k of ["silhouette", "primaryColor", "accentColor", "pose", "prop", "backgroundSimple"]) {
      assert.ok(mascot.has(k), `brand-mascot missing ${k}`);
    }
    assert.equal(mascot.has("hair"), false);
    assert.equal(mascot.has("outfit"), false);

    const art = keySet(loadPack("fine-art"));
    for (const k of ["medium", "palette", "brushwork", "composition", "subject", "lightingArt"]) {
      assert.ok(art.has(k), `fine-art missing ${k}`);
    }
    assert.equal(art.has("hair"), false);

    const abs = keySet(loadPack("abstract-series"));
    for (const k of ["shape", "motif", "colorField", "texture", "rhythm", "contrast"]) {
      assert.ok(abs.has(k), `abstract-series missing ${k}`);
    }
    assert.equal(abs.has("hair"), false);
    assert.equal(abs.has("outfit"), false);
  });

  it("defaults.changeKeys/extraKeys reference real item keys", () => {
    for (const id of PACK_IDS) {
      const pack = loadPack(id);
      const keys = keySet(pack);
      for (const k of pack.defaults?.changeKeys || []) {
        assert.ok(keys.has(k), `${id} changeKey ${k}`);
      }
      for (const k of pack.defaults?.extraKeys || []) {
        assert.ok(keys.has(k), `${id} extraKey ${k}`);
      }
    }
  });

  it("conflict refs use real key:value pairs", () => {
    for (const id of PACK_IDS) {
      const pack = loadPack(id);
      const byKey = Object.fromEntries(
        (pack.items || []).map((t) => [t.key, new Set(t.options.map((o) => o.value))]),
      );
      for (const c of pack.rules.conflicts) {
        for (const ref of [c.a, c.b]) {
          const i = ref.indexOf(":");
          assert.ok(i > 0, `${id} bad conflict ref ${ref}`);
          const key = ref.slice(0, i);
          const value = ref.slice(i + 1);
          assert.ok(byKey[key], `${id} conflict unknown key ${key}`);
          assert.ok(byKey[key].has(value), `${id} conflict unknown ${key}:${value}`);
        }
      }
    }
  });

  it("each pack builds recipes without error (mini preset)", () => {
    for (const id of PACK_IDS) {
      const pack = loadPack(id);
      const changeKeys = pack.defaults?.changeKeys || pack.items.map((t) => t.key);
      const extraKeys = pack.defaults?.extraKeys || [];
      const preset = {
        schema: "series-preset/v0",
        id: `smoke-${id}`,
        seed: `wave4-${id}`,
        size: 4,
        base: { path: "input/primary.png" },
        lines: {
          a: { who: "series subject", base: "input/primary.png", quota: 4 },
        },
        promptTemplate: {
          keep: ["Edit this image of a {who}."],
          changeKeys,
          extraKeys,
          suffix: "No text.",
        },
        traits: { items: pack.items },
        rules: pack.rules,
        engine: { default: "kontext", strength: 0.5 },
        waves: null,
      };
      const recipes = buildRecipes(preset);
      assert.equal(recipes.length, 4, id);
      const prompt = recipes[0].prompt;
      assert.ok(typeof prompt === "string" && prompt.length > 10, id);
    }
  });

  it("catalog lists exactly the four packs", () => {
    const files = readdirSync(TRAITS).filter((f) => f.endsWith(".json"));
    assert.deepEqual(files.sort(), PACK_IDS.map((id) => `${id}.json`).sort());
  });
});
