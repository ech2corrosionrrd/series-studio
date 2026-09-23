import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeOption,
  normalizeOptions,
  validateOptions,
  duplicateOption,
} from "../src/index.mjs";

test("normalizeOption trims value and coerces weight", () => {
  const o = normalizeOption({ value: "  Buzz  ", weight: "10", prompt: "a buzz cut" });
  assert.equal(o.value, "Buzz");
  assert.equal(o.weight, 10);
  assert.equal(o.prompt, "a buzz cut");
});

test("normalizeOption defaults bad weight to 1", () => {
  const o = normalizeOption({ value: "X", weight: "nope", prompt: "" });
  assert.equal(o.weight, 1);
});

test("normalizeOptions maps list and empty for non-array", () => {
  assert.deepEqual(normalizeOptions(null), []);
  const list = normalizeOptions([
    { value: "A", weight: 2, prompt: "a" },
    { value: "B", weight: 3, prompt: "b" },
  ]);
  assert.equal(list.length, 2);
  assert.equal(list[0].value, "A");
});

test("validateOptions requires weight > 0 and unique values", () => {
  const bad = validateOptions([
    { value: "", weight: 1, prompt: "x" },
    { value: "Same", weight: 0, prompt: "y" },
    { value: "Same", weight: 2, prompt: "" },
  ]);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /value required/.test(e)));
  assert.ok(bad.errors.some((e) => /weight must be > 0/.test(e)));
  assert.ok(bad.errors.some((e) => /duplicate value/.test(e)));
  assert.ok(bad.warnings.some((w) => /empty prompt/.test(w)));
});

test("validateOptions ok for clean list", () => {
  const ok = validateOptions([
    { value: "A", weight: 1, prompt: "a" },
    { value: "B", weight: 2.5, prompt: "b" },
  ]);
  assert.equal(ok.ok, true);
  assert.equal(ok.errors.length, 0);
  assert.equal(ok.warnings.length, 0);
});

test("validateOptions warns on empty prompt only", () => {
  const v = validateOptions([{ value: "Solo", weight: 1, prompt: "  " }]);
  assert.equal(v.ok, true);
  assert.equal(v.warnings.length, 1);
});

test("duplicateOption picks unique value", () => {
  const d = duplicateOption({ value: "Buzz", weight: 10, prompt: "p" }, ["Buzz", "Buzz copy"]);
  assert.equal(d.value, "Buzz copy 2");
  assert.equal(d.weight, 10);
  assert.equal(d.prompt, "p");
});
