import { test } from "node:test";
import assert from "node:assert/strict";
import { auditHelp, loadInputs, SEARCH_QUERIES } from "../scripts/audit-help.mjs";
import { helpMatches } from "../server/ui/help-search.js";

test("Довідка проходить аудит", async () => {
  assert.deepEqual(auditHelp(await loadInputs()), []);
});

test("аудит ловить вигадану назву кнопки, зайву зворотну лапку й вкладку без кроку", async () => {
  const input = await loadInputs();
  const bad = {
    ...input,
    uk: { ...input.uk, "help.money.li1": "Натисніть «Кнопка, якої немає» і `код." },
    en: { ...input.en, "help.money.li1": "Press \"A button that does not exist\"." },
    html: `${input.html}<button data-tab="ghost">x</button>`,
  };
  const errors = auditHelp(bad).join("\n");
  assert.match(errors, /uk help\.money\.li1: «Кнопка, якої немає»/);
  assert.match(errors, /uk help\.money\.li1: unbalanced backtick/);
  assert.match(errors, /en help\.money\.li1: «A button that does not exist»/);
  assert.match(errors, /tab "ghost" has no step in Help/);
});

test("пошук знаходить за основою слова і за кількома словами", () => {
  assert.ok(helpMatches("Поповнення кредитів", "поповнити"));
  assert.ok(helpMatches("Ліцензії та ШІ", "ліцензія"));
  assert.ok(helpMatches("Як видалити свої дані?", "видалити дані"));
  assert.ok(!helpMatches("Поповнення кредитів", "genesis"));
  assert.ok(!helpMatches("Поповнення кредитів", "поповнити genesis"));
  assert.ok(SEARCH_QUERIES.uk.length >= 8 && SEARCH_QUERIES.en.length >= 8);
});

// R3 (BETA-REVIEW round 2): the Help said "stages 1–4, 6 and 7 never charge" while the ZIP of stage 7 costs a credit.
import { quoteStage } from "../src/platform/stage-pricing.mjs";

const PAID_STAGE_TAB = { archive: 7, deploy_kit: 8, marketplace_kit: 9 };

/** "1–4 і 6" / "1–4 and 6" → [1,2,3,4,6] */
function stageNumbers(text) {
  const nums = new Set();
  for (const part of text.split(/,|\bі\b|\band\b/)) {
    const m = /(\d+)\s*[–-]\s*(\d+)|(\d+)/.exec(part);
    if (!m) continue;
    if (m[3]) nums.add(Number(m[3]));
    else for (let i = Number(m[1]); i <= Number(m[2]); i++) nums.add(i);
  }
  return nums;
}

test("Довідка не називає безкоштовним етап, що коштує кредити", async () => {
  const { uk, en } = await loadInputs();
  const free = [
    stageNumbers(/Етапи ([^:]+?) не списують/.exec(uk["help.zero.li1"])[1]),
    stageNumbers(/Stages ([^:]+?) never charge/.exec(en["help.zero.li1"])[1]),
  ];
  assert.ok(free.every((s) => s.size >= 4), "the claim names its stages");
  for (const [stage, tab] of Object.entries(PAID_STAGE_TAB)) {
    const credits = quoteStage(stage, {}, {}).credits;
    assert.ok(credits > 0, `${stage} has a price by default`);
    for (const set of free) assert.ok(!set.has(tab), `stage ${tab} (${stage}, ${credits} cr) is not listed as free`);
  }
});

test("Швидкий старт на mock називає єдину плату проходу: ZIP", async () => {
  const { uk, en } = await loadInputs();
  assert.match(uk["help.quick.title"], /1 кр/);
  assert.match(en["help.quick.title"], /1 cr/);
  assert.match(uk["help.quick.li8"], /єдина плата/);
});
