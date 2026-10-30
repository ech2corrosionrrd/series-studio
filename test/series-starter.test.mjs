// R1 (BETA-REVIEW round 2): a brand-new series starts from a neutral preset, not from the one that is open.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newSeriesStarter, STARTER_ENGINE, STARTER_STRENGTH } from "../server/ui/series-starter.js";
import { DEFAULT_STRENGTH } from "../src/reference.mjs";
import { validatePreset, validatePresetSemantics } from "../src/validate.mjs";

const starter = newSeriesStarter({ id: "beta-levy-31", name: "Бета Леви 31", seed: "beta-levy-31-v1", size: 6, genesis: true });

test("the starter is a valid preset, so the Overview can save it as it is", () => {
  assert.deepEqual(validatePreset(starter), { ok: true });
  assert.deepEqual(validatePresetSemantics(starter), { ok: true });
});

test("the starter carries the author's identity and nothing of another series", () => {
  assert.equal(starter.id, "beta-levy-31");
  assert.equal(starter.name, "Бета Леви 31");
  assert.equal(starter.size, 6);
  assert.equal(starter.genesis, true);
  assert.equal(starter.lines.a.quota, 6);
  assert.doesNotMatch(JSON.stringify(starter), /gremlin|pointed ears|mother\.png|flat vector/i);
  assert.deepEqual(starter.promptTemplate.changeKeys, ["expression"]);
});

test("the starter's engine and strength are the product defaults", () => {
  assert.equal(STARTER_ENGINE, "kontext");
  assert.equal(STARTER_STRENGTH, DEFAULT_STRENGTH);
  assert.equal(starter.engine.strength, DEFAULT_STRENGTH);
});
