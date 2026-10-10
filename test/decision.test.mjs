import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "series-decision-"));
process.env.USERS_DB_PATH = join(dir, "users.db");
process.env.SERIES_DATA_DIR = dir;
process.env.AUTH_SESSION_SECRET = "decision-test";
process.env.WELCOME_REQUIRE_BALANCE = "0";

const { closeAll, openDb, nowIso } = await import("../src/platform/db.mjs");
const { completeWalletSignIn, recordPayment } = await import("../src/platform/billing.mjs");
const { decisionConfig, decisionRule, weeklyNumbers, buildWeeklyReport, resourceAlertLines } = await import("../src/platform/decision.mjs");

const W = (n) => `0x${String(n).padStart(40, "0")}`;
const OPERATOR = W(1);
const okBalance = async () => ({ ok: true, message: "" });

after(() => {
  closeAll();
  rmSync(dir, { recursive: true, force: true });
});

const env = (extra = {}) => ({ ...process.env, DECISION_START: "2020-01-01", ...extra });

describe("decision rule and weekly report", () => {
  test("defaults and bad values fall back to the agreed rule", () => {
    const d = decisionConfig({});
    assert.equal(d.start.toISOString().slice(0, 10), "2026-10-10");
    assert.equal(d.days, 90);
    assert.equal(d.targetPayers, 10);
    assert.equal(d.targetRepeat, 2);
    const bad = decisionConfig({ DECISION_START: "not a date", DECISION_DAYS: "-5", DECISION_TARGET_PAYERS: "x" });
    assert.equal(bad.start.toISOString().slice(0, 10), "2026-10-10");
    assert.equal(bad.days, 90);
    assert.equal(bad.targetPayers, 10);
  });

  test("counts only external payers and repeats, and tracks the status", async () => {
    process.env.OPERATOR_WALLET = OPERATOR;
    const db = openDb(join(dir, "users.db"));
    for (const w of [OPERATOR, W(2), W(3), W(4)]) await completeWalletSignIn(w, { db, balanceCheck: okBalance });
    recordPayment("op-1", OPERATOR, 100, 4.99, { db });
    recordPayment("op-2", OPERATOR, 100, 4.99, { db });
    recordPayment("a-1", W(2), 100, 4.99, { db });
    recordPayment("a-2", W(2), 400, 14.99, { db });
    recordPayment("b-1", W(3), 100, 4.99, { db });

    const mid = decisionRule({ db, env: env({ DECISION_TARGET_PAYERS: "3", DECISION_TARGET_REPEAT: "1", DECISION_DAYS: "36500" }) });
    assert.equal(mid.status, "active", "2 external payers < target 3");
    assert.equal(mid.external_payers, 2, "the operator's payments do not count");
    assert.equal(mid.external_repeat_payers, 1, "only W(2) paid twice");
    assert.equal(mid.external_revenue_usd, 24.97);

    const met = decisionRule({ db, env: env({ DECISION_TARGET_PAYERS: "2", DECISION_TARGET_REPEAT: "1", DECISION_DAYS: "36500" }) });
    assert.equal(met.status, "met");

    const failed = decisionRule({ db, env: env({ DECISION_TARGET_PAYERS: "10", DECISION_DAYS: "1" }) });
    assert.equal(failed.status, "failed", "the window is over and the targets are missed");
    assert.equal(failed.days_left, 0);
  });

  test("a window that has not started yet counts nothing as elapsed", () => {
    const db = openDb(join(dir, "users.db"));
    const future = decisionRule({ db, env: env({ DECISION_START: "2999-01-01" }) });
    assert.equal(future.status, "active");
    assert.equal(future.days_elapsed, 0);
    assert.equal(future.external_payers, 0);
  });

  test("weekly numbers and the text of the report", () => {
    const db = openDb(join(dir, "users.db"));
    const w = weeklyNumbers({ db });
    assert.equal(w.payers, 2);
    assert.equal(w.repeat_payers, 1, "W(2)'s second payment this week is a repeat purchase");
    assert.equal(w.revenue_usd, 24.97);
    const text = buildWeeklyReport({ db, env: env({ DECISION_TARGET_PAYERS: "10", DECISION_DAYS: "36500" }) });
    assert.match(text, /тижневий звіт/);
    assert.match(text, /Платники: 2/);
    assert.match(text, /Повторні покупки: 1/);
    assert.match(text, /Дохід: \$24\.97/);
    assert.match(text, /Платників: 2 з 10; повторних: 1 з 2/);
    assert.ok(!/[*_`]/.test(text.replace(/_/g, "")), "plain text: nothing Telegram Markdown could choke on");
  });

  test("the report adds provider balances that need attention", () => {
    const db = openDb(join(dir, "users.db"));
    const st = db.prepare("INSERT INTO transactions (wallet_address, kind, credits, engine, note, created_at) VALUES (?, 'debit', -8, 'OpenAI gpt-image-1', '', ?)");
    for (let i = 0; i < 30; i++) st.run(W(2), nowIso(new Date(Date.now() - 2 * 86_400_000)));
    const env2 = { ...env(), OPENAI_API_KEY: "x" };
    const unknown = resourceAlertLines({ db, env: env2 });
    assert.ok(unknown.some((l) => /Не введено баланс/.test(l)), unknown.join(" | "));
    db.prepare("INSERT OR REPLACE INTO resource_balances (provider, balance_usd, updated_at, note) VALUES ('openai', 1, ?, '')").run(nowIso());
    const low = resourceAlertLines({ db, env: env2 });
    assert.ok(low.some((l) => /OpenAI: критично/.test(l) && /поповнити на \$/.test(l)), low.join(" | "));
    assert.match(buildWeeklyReport({ db, env: env2 }), /Ресурси \(баланси провайдерів\):/);
  });
});
