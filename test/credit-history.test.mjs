// BETA-REVIEW B7: the credit history showed the ledger's English notes ("image generation -3", "archive -1") in the Ukrainian interface,
// one row per frame (21 identical rows in a row). The labels now follow the language and a batch is one row.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { groupHistory, historyLabel } from "../server/ui/history.js";

const load = async (f) => {
  const mod = await import(pathToFileURL(new URL(`../server/ui/locales/${f}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")).href);
  return mod.default || Object.values(mod)[0];
};
const uk = await load("uk.js");
const en = await load("en.js");
const tr = (dict) => ({
  t: (key, vars = {}) => {
    let s = dict[key] ?? key;
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  },
  hasKey: (key) => key in dict,
});

// the notes the server really writes: stage notes come from chargeStage (stage name with spaces), the others from the routes
const SERVER_NOTES = ["image generation", "archive", "arweave upload", "deploy kit", "marketplace kit", "vision assist", "ai triage"];

describe("historyLabel", () => {
  it("every note the server writes has a label in both languages", () => {
    for (const [name, dict] of [["uk", uk], ["en", en]]) {
      const { t, hasKey } = tr(dict);
      for (const note of SERVER_NOTES) {
        const label = historyLabel({ note }, t, hasKey);
        assert.notEqual(label, note, `${name}: «${note}» is still shown raw`);
      }
    }
  });
  it("the English labels have no Cyrillic", () => {
    const e = tr(en);
    for (const note of SERVER_NOTES) assert.doesNotMatch(historyLabel({ note }, e.t, e.hasKey), /[А-Яа-яІіЇїЄє]/);
  });
  it("a refund names what was refunded, also when it failed", () => {
    const { t, hasKey } = tr(uk);
    assert.equal(historyLabel({ note: "refund: image generation" }, t, hasKey), "Повернення: Генерація картинок");
    assert.equal(historyLabel({ note: "refund: archive failed" }, t, hasKey), "Повернення: Збирання ZIP");
    const e = tr(en);
    assert.equal(historyLabel({ note: "refund: ai triage" }, e.t, e.hasKey), "Refund: Auto-select (AI)");
  });
  it("a row without a note is named by its kind; an unknown note stays as it is", () => {
    const { t, hasKey } = tr(uk);
    assert.equal(historyLabel({ kind: "welcome", note: "" }, t, hasKey), "Вітальні кредити");
    assert.equal(historyLabel({ kind: "payment", note: "" }, t, hasKey), "Поповнення");
    assert.equal(historyLabel({ kind: "debit", note: "something new" }, t, hasKey), "something new");
    assert.equal(historyLabel({ kind: "mystery", note: "" }, t, hasKey), "mystery");
  });
});

describe("groupHistory", () => {
  const row = (credits, at, note = "image generation", kind = "debit") => ({ kind, note, credits, created_at: at });
  it("twenty-one charges in one minute are one row with the total", () => {
    const rows = Array.from({ length: 21 }, (_, i) => row(-3, `2026-10-29T19:42:${String(i).padStart(2, "0")}`));
    const grouped = groupHistory(rows);
    assert.equal(grouped.length, 1);
    assert.equal(grouped[0].count, 21);
    assert.equal(grouped[0].credits, -63);
  });
  it("a different note, a different minute or the other sign starts a new row", () => {
    const rows = [row(-3, "2026-10-29T19:42:10"), row(-1, "2026-10-29T19:42:20", "archive"), row(-3, "2026-10-29T19:43:00"), row(3, "2026-10-29T19:43:05", "refund: image generation", "refund")];
    assert.equal(groupHistory(rows).length, 4);
    const sign = groupHistory([row(-3, "2026-10-29T19:42:10"), row(3, "2026-10-29T19:42:11")]);
    assert.equal(sign.length, 2, "a charge and its refund are not merged");
  });
  it("does not change the rows it is given, and copes with nothing", () => {
    const rows = [row(-3, "2026-10-29T19:42:10"), row(-3, "2026-10-29T19:42:11")];
    groupHistory(rows);
    assert.equal(rows[0].credits, -3);
    assert.deepEqual(groupHistory([]), []);
    assert.deepEqual(groupHistory(undefined), []);
  });
});

describe("the notes in the server code", () => {
  it("the stage notes the server writes are all known to the history labels", () => {
    // chargeStage writes the stage name with spaces; list the stages from the pricing table and check each has a label or is deliberately raw
    const pricing = readFileSync(new URL("../src/platform/stage-pricing.mjs", import.meta.url), "utf8");
    // the image generation is charged per frame by the engine with the note "image generation"; its stage is only the quote
    const stages = [...pricing.matchAll(/^\s+([a-z_]+): \{/gm)].map((m) => (m[1] === "generation" ? "image generation" : m[1].replaceAll("_", " ")));
    assert.ok(stages.length >= 3, `stages found: ${stages}`);
    const known = new Set(SERVER_NOTES);
    const unlabelled = stages.filter((s) => !known.has(s) && !["curation", "layers"].includes(s));
    assert.deepEqual(unlabelled, [], "a stage that charges credits needs a history label");
  });
});
