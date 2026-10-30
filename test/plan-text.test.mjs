// R6 (BETA-REVIEW round 2): the plan of "Estimate (free)" is written from the structured answer, in the author's language.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPlan } from "../server/ui/plan-text.js";
import uk from "../server/ui/locales/uk.js";
import en from "../server/ui/locales/en.js";

const lookup = (dict) => (key, vars = {}) => {
  let s = dict[key] ?? key;
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
};

const publicPlan = {
  ok: true, file: "beta.json", engine: "kontext", strength: 0.45, set: "kontext-s0.45", mode: "pilot", force: false,
  editions: [1, 2, 3], skippedExisting: [], count: 3, creditsNeeded: 9, creditsBalance: 802, capError: null, lint: { ok: true, hits: [] },
  text: "Archive: beta.json …",
};

test("a public-mode plan names the credits, the set and the mode in Ukrainian", () => {
  const out = formatPlan(publicPlan, lookup(uk));
  assert.match(out, /Архів: beta\.json/);
  assert.match(out, /Двигун: kontext · сила 0\.45/);
  assert.match(out, /Режим: пілот/);
  assert.match(out, /Згенерувати: 3 → #1, #2, #3/);
  assert.match(out, /Вартість: 9 кр \(3 кр\/кадр\) · ваш баланс: 802 кр/);
  assert.doesNotMatch(out, /Set folder|To generate|Estimate is free/);
});

test("the same plan in English has no Cyrillic, and a forced re-render says so", () => {
  const out = formatPlan({ ...publicPlan, force: true }, lookup(en));
  assert.doesNotMatch(out, /[А-Яа-яІіЇїЄє]/);
  assert.match(out, /To generate: 3/);
  assert.match(out, /Cost: 9 credits \(3 cr\/frame\)/);
  assert.match(out, /FORCE re-render/);
});

test("a local plan shows dollars and the daily cap; a cap error and a lint warning are carried over", () => {
  const local = { ...publicPlan, creditsNeeded: null, creditsBalance: null, costUsd: 0.12, unitCostUsd: 0.04, spentTodayUsd: 1.5, capUsd: 5, capError: "over the cap", lint: { ok: false, hits: ["logo"] } };
  const out = formatPlan(local, lookup(uk));
  assert.match(out, /Орієнтовна вартість: ~\$0\.12 \(\$0\.04\/кадр\)/);
  assert.match(out, /Витрачено сьогодні: ~\$1\.5 із \$5 за день/);
  assert.match(out, /⛔ over the cap/);
  assert.match(out, /Перевірка промптів знайшла проблему.*logo/);
});

test("an answer without the structured fields falls back to the server text", () => {
  assert.equal(formatPlan({ text: "plain" }, lookup(uk)), "plain");
  assert.equal(formatPlan(null, lookup(uk)), "");
});
