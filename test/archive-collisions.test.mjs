// The same character in two different collections. diffArchives compares one series with its own rebuild by
// edition number; collideArchives ignores numbers and lines and looks at the trait values.
import { describe, it } from "node:test";
import { readUiSource } from "../scripts/ui-source.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { collideArchives } from "../src/recipes.mjs";

const recipe = (edition, traits, line = "a") => ({ edition, line, traits });

describe("collideArchives", () => {
  it("finds identical trait sets under different numbers and lines, and lists every edition of each side", () => {
    const a = { recipes: [recipe(1, { hat: "Cap", eyes: "Blue" }), recipe(2, { hat: "Cap", eyes: "Blue" }), recipe(3, { hat: "Beret", eyes: "Green" })] };
    const b = { recipes: [recipe(40, { eyes: "Blue", hat: "Cap" }, "z"), recipe(41, { hat: "Cap", eyes: "Red" })] };
    const r = collideArchives(a, b);
    assert.deepEqual({ countA: r.countA, countB: r.countB, shared: r.shared }, { countA: 3, countB: 2, shared: 2 });
    assert.equal(r.collisions.length, 1);
    assert.deepEqual(r.collisions[0], { traits: { eyes: "Blue", hat: "Cap" }, editionsA: [1, 2], editionsB: [40] });
  });

  it("a None or missing trait counts as absent, so collections with different trait lists still compare", () => {
    const a = { recipes: [recipe(1, { hat: "Cap", mark: "None" })] };
    const b = { recipes: [recipe(9, { hat: "Cap" })] };
    assert.equal(collideArchives(a, b).collisions.length, 1);
    const c = { recipes: [recipe(9, { hat: "Cap", mark: "Scar" })] };
    assert.equal(collideArchives(a, c).collisions.length, 0, "a real extra trait makes it a different character");
  });

  it("no overlap, empty and missing archives give an empty result, not an error", () => {
    assert.deepEqual(collideArchives({ recipes: [recipe(1, { hat: "Cap" })] }, { recipes: [recipe(1, { hat: "Beret" })] }).collisions, []);
    assert.deepEqual(collideArchives({ recipes: [] }, undefined), { countA: 0, countB: 0, shared: 0, collisions: [] });
  });

  it("is symmetric in what it finds", () => {
    const a = { recipes: [recipe(1, { x: "1" }), recipe(2, { x: "2" })] };
    const b = { recipes: [recipe(5, { x: "2" }), recipe(6, { x: "3" })] };
    assert.equal(collideArchives(a, b).shared, collideArchives(b, a).shared);
  });

  it("sorts the result by the first edition of the first archive", () => {
    const a = { recipes: [recipe(7, { x: "b" }), recipe(2, { x: "a" })] };
    const b = { recipes: [recipe(1, { x: "b" }), recipe(2, { x: "a" })] };
    assert.deepEqual(collideArchives(a, b).collisions.map((c) => c.editionsA[0]), [2, 7]);
  });
});

describe("wiring", () => {
  const server = readFileSync(new URL("../server/routes/recipes.mjs", import.meta.url), "utf8");
  const ui = readUiSource();
  it("the route refuses the same archive twice and the button reuses the diff selects", () => {
    assert.match(server, /pathname === "\/api\/archive\/collisions"/);
    assert.match(server, /left\.file === right\.file\) return send\(res, 400/);
    assert.match(ui, /\$\("r-archive-collide"\)\?\.addEventListener/);
    assert.match(ui, /"\/api\/archive\/collisions"/);
  });
});
