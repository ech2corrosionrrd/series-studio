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
