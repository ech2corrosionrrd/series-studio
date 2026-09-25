import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRecipes, diffArchives, duplicateGroups, spinoffPreset } from "../src/recipes.mjs";

const demo = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "presets", "demo-series.json"), "utf8"));

describe("user path helpers", () => {
  it("keeps a point edit when the archive is built again", () => {
    const base = buildRecipes(demo);
    const traits = { ...base[3].traits };
    const key = Object.keys(traits)[0];
    const other = base.find((r) => r.traits[key] && r.traits[key] !== traits[key]);
    assert.ok(other, "demo needs two values for the first trait");
    traits[key] = other.traits[key];
    const edited = buildRecipes(demo, { items: { 3: { traits, note: "keep this one" } } });
    assert.equal(edited[3].traits[key], other.traits[key]);
    assert.equal(edited[3].note, "keep this one");
    assert.equal(edited[0].dna, base[0].dna);
    assert.notEqual(edited[3].dna, base[3].dna);
  });

  it("reports stored DNA collisions", () => {
    const recipes = buildRecipes(demo);
    assert.equal(duplicateGroups(recipes).length, 0);
    const copy = structuredClone(recipes[1]);
    copy.edition = 99;
    assert.deepEqual(duplicateGroups([recipes[1], copy]), [[recipes[1].edition, 99]]);
  });

  it("diffs two archives by edition", () => {
    const a = { recipes: buildRecipes(demo) };
    const spun = spinoffPreset(demo, { suffix: "test" });
    const b = { recipes: buildRecipes(spun) };
    const diff = diffArchives(a, b);
    assert.ok(diff.changed.length > 0);
    assert.equal(diff.same + diff.changed.length, a.recipes.length);
    assert.equal(spinoffPreset(demo, { suffix: "test" }).seed, `${demo.seed}-spin-test`);
    assert.equal(spinoffPreset(demo, { suffix: "test" }).waves, null);
  });
});
