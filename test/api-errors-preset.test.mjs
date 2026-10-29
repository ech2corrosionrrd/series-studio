// BETA-REVIEW B6: preset problems reached the author as raw English schema paths ("/size must be integer", "/lines/a/quota must be >= 0").
// This test makes the real validators produce their messages and checks that the UI translator says each one in uk and en, with no raw path left.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { translateApiError, presentApiError } from "../server/ui/api-errors.js";
import { validatePreset, validatePresetSemantics } from "../src/validate.mjs";
import { presetLimitIssues } from "../src/quota.mjs";

const load = async (f) => {
  const mod = await import(pathToFileURL(new URL(`../server/ui/locales/${f}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")).href);
  return mod.default || Object.values(mod)[0];
};
const uk = await load("uk.js");
const en = await load("en.js");
const translator = (dict) => (key, vars = {}) => {
  let s = dict[key] ?? key;
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
};

const base = () => JSON.parse(readFileSync(new URL("../templates/pfp-portrait.json", import.meta.url), "utf8"));

/** The messages the real validators give for one broken preset, in the shape the API sends: { ok: false, errors: [ ... ] }. */
function issuesOf(preset, cfg) {
  const out = [];
  const schema = validatePreset(preset);
  if (!schema.ok) out.push(String(schema.errors));
  const sem = validatePresetSemantics(preset);
  if (!sem.ok) out.push(String(sem.errors));
  if (cfg) out.push(...presetLimitIssues(preset, cfg));
  return out;
}
const broken = (fn, cfg) => {
  const p = base();
  fn(p);
  return issuesOf(p, cfg);
};

const CASES = {
  "size is not a whole number": [(p) => { p.size = 12.7; }, /цілим числом/, /whole number/],
  "size below one": [(p) => { p.size = -5; }, /не менше 1/, /at least 1/],
  "empty name": [(p) => { p.name = ""; }, /Назва серії не може бути порожньою/, /name cannot be empty/],
  "empty seed": [(p) => { p.seed = ""; }, /Зерно не може бути порожнім/, /seed cannot be empty/],
  "an id that is not a file name": [(p) => { p.id = "my heroes"; }, /«my heroes» не підходить/, /"my heroes" is not allowed/],
  "line quotas that do not add up": [(p) => { p.lines.a.quota = 1; }, /Частки ліній у сумі дають/, /line shares add up to/],
  "a trait without options": [(p) => { p.traits.items[0].options = []; }, /немає варіантів/, /has no options/],
  "a trait with zero weight": [(p) => { for (const o of p.traits.items[0].options) o.weight = 0; }, /нульова вага/, /zero weight/],
  "a prompt that mentions a missing trait": [(p) => { p.promptTemplate.changeKeys = ["no-such-trait"]; }, /якої немає/, /does not exist/],
  "a repeated trait": [(p) => { p.traits.items.push(structuredClone(p.traits.items[0])); }, /повторюється/, /appears twice/],
};

describe("preset problems are said in the author's language", () => {
  for (const [name, [mutate, reUk, reEn]] of Object.entries(CASES)) {
    it(name, () => {
      const errors = broken(mutate);
      assert.ok(errors.length > 0, "the validators report a problem");
      const ukText = translateApiError({ ok: false, errors }, translator(uk));
      const enText = translateApiError({ ok: false, errors }, translator(en));
      assert.match(ukText, reUk, `uk: ${ukText}`);
      assert.match(enText, reEn, `en: ${enText}`);
      assert.doesNotMatch(ukText, /\/(size|name|seed|lines|id)\b/, `no raw schema path in uk: ${ukText}`);
      assert.doesNotMatch(enText, /\/(size|name|seed|lines|id)\b/, `no raw schema path in en: ${enText}`);
    });
  }

  it("the quota limits of a normal wallet are translated with their numbers", () => {
    const errors = broken(() => {}, { presetSize: 10, presetTraits: 1, presetOptions: 2, presetBytes: 50 });
    const ukText = translateApiError({ ok: false, errors }, translator(uk));
    assert.match(ukText, /перевищує ліміт серії: 10/);
    assert.match(ukText, /Рис \d+, а ліміт 1/);
    assert.match(ukText, /варіантів, а ліміт 2/);
    assert.match(ukText, /байт, а ліміт 50/);
    const enText = translateApiError({ ok: false, errors }, translator(en));
    assert.match(enText, /above the limit per series: 10/);
  });

  it("several problems are joined, and an unknown one stays as it is", () => {
    const text = translateApiError({ ok: false, errors: ["/size must be integer; something new and unknown"] }, translator(uk));
    assert.match(text, /цілим числом/);
    assert.match(text, /something new and unknown/);
  });

  it("an unknown schema path still gets a localized wrapper", () => {
    const text = translateApiError({ ok: false, errors: ["/engine/strength must be <= 1"] }, translator(uk));
    assert.equal(text, "Поле /engine/strength: must be <= 1");
  });

  it("an answer without a list of problems is not touched by this", () => {
    assert.equal(translateApiError({ error: "bad path" }, translator(uk)), uk["api.badPath"]);
    assert.equal(presentApiError({ ok: false, errors: ["/size must be integer"], error: "x" }, translator(uk)), uk["api.preset.sizeInteger"]);
  });
});
