// R2 (BETA-REVIEW round 2): a style belongs to the fixed prompt ("Keep", the style lock, the suffix), not to every trait option.
// With "flat vector" in 48 option prompts, an author who rewrote "Keep" for a soft 3D mascot still got "Change: flat vector ... mint green".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const STYLE = /\b(flat vector|photoreal(istic)?|3d render|watercolou?r|oil paint(ing)?|pixel art|anime|isometric|hand-drawn|cel[- ]shaded|low[- ]poly)\b/i;

function optionPrompts(dir, pick) {
  const out = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const data = JSON.parse(readFileSync(join(dir, f), "utf8"));
    for (const t of pick(data)) for (const o of t.options || []) out.push({ file: `${dir}/${f}`, trait: t.key, value: o.value, prompt: o.prompt || "" });
  }
  return out;
}

/** A trait whose whole purpose is the style (fine-art "medium": watercolour, oil...) may name it. */
const STYLE_TRAITS = new Set(["medium", "style", "technique"]);

const all = [
  ...optionPrompts("templates", (d) => d.traits?.items || []),
  ...optionPrompts("libraries/traits", (d) => d.items || []),
];

test("the shipped templates and trait packs carry options to compare", () => {
  assert.ok(all.length > 100, `${all.length} options`);
});

test("no trait option prompt names an art style", () => {
  const bad = all.filter((o) => !STYLE_TRAITS.has(o.trait) && STYLE.test(o.prompt)).map((o) => `${o.file} ${o.trait}/${o.value}: ${o.prompt}`);
  assert.deepEqual(bad, []);
});

test("a template that sets a style says it once, in the fixed prompt", () => {
  const tpl = JSON.parse(readFileSync("templates/brand-mascot.json", "utf8"));
  assert.match(tpl.promptTemplate.keep.join(" "), /flat vector/i);
});
