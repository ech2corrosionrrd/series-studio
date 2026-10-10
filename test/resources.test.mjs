import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "series-resources-"));
process.env.USERS_DB_PATH = join(dir, "users.db");
process.env.SERIES_DATA_DIR = dir;
process.env.AUTH_SESSION_SECRET = "resources-test";
process.env.WELCOME_REQUIRE_BALANCE = "0";

const { closeAll, openDb, nowIso } = await import("../src/platform/db.mjs");
const { completeWalletSignIn } = await import("../src/platform/billing.mjs");
const res = await import("../src/platform/resources.mjs");

const W = (n) => `0x${String(n).padStart(40, "0")}`;
const OPERATOR = W(1);
const USER = W(2);
const okBalance = async () => ({ ok: true, message: "" });
const NOW = new Date("2026-10-20T12:00:00Z");
const daysAgo = (d) => nowIso(new Date(NOW.getTime() - d * 86_400_000));

after(() => {
  closeAll();
  rmSync(dir, { recursive: true, force: true });
});

function debit(db, wallet, engine, credits, n, when) {
  const st = db.prepare("INSERT INTO transactions (wallet_address, kind, credits, engine, note, created_at) VALUES (?, 'debit', ?, ?, '', ?)");
  for (let i = 0; i < n; i++) st.run(wallet, -credits, engine, when);
}

describe("resources: which provider an engine label is paid to", () => {
  test("maps ledger labels, ignores free engines", () => {
    const p = (e, env = {}) => res.providerOfEngine(e, env);
    assert.equal(p("kontext"), "replicate");
    assert.equal(p("Flux.1 (Replicate)"), "replicate");
    assert.equal(p("fal"), "fal");
    assert.equal(p("OpenAI gpt-image-1"), "openai");
    assert.equal(p("OpenAI DALL-E 3"), "openai");
    assert.equal(p("Stability AI (Core / SD3)"), "stability");
    assert.equal(p("pollinations"), "pollinations");
    assert.equal(p("LLM", {}), "openai", "LLM calls fall back to OpenAI without an Anthropic key");
    assert.equal(p("vision", { ANTHROPIC_API_KEY: "x" }), "anthropic");
    for (const free of ["mock", "comfyui", "a1111", "", "(unknown)", undefined]) assert.equal(p(free), null, String(free));
  });
});

describe("resources: recommended balance", () => {
  test("load, demand trend and credits already sold drive the recommendation", async () => {
    process.env.OPERATOR_WALLET = OPERATOR;
    const db = openDb(join(dir, "users.db"));
    for (const w of [OPERATOR, USER]) await completeWalletSignIn(w, { db, balanceCheck: okBalance });
    db.prepare("UPDATE users SET credits_balance = 1000 WHERE wallet_address = ?").run(USER);
    db.prepare("UPDATE users SET credits_balance = 0 WHERE wallet_address = ?").run(OPERATOR);
    // 10 OpenAI finals (8 cr, $0.167 each) this week by an outside user, 20 two weeks ago by the operator
    debit(db, USER, "OpenAI gpt-image-1", 8, 10, daysAgo(2));
    debit(db, OPERATOR, "OpenAI gpt-image-1", 8, 20, daysAgo(15));
    debit(db, USER, "mock", 0, 5, daysAgo(1));

    const env = { OPENAI_API_KEY: "x" };
    const plan = res.resourcePlan({ db, env, now: NOW });
    const o = plan.providers.find((x) => x.id === "openai");
    assert.equal(o.spend_7d_usd, 1.67);
    assert.equal(o.spend_30d_usd, 5.01);
    assert.equal(o.spend_30d_external_usd, 1.67, "the operator's testing is not external demand");
    assert.equal(o.ops_30d, 30);
    assert.equal(o.trend, 1.43, "this week's daily rate is 1.43x the 30-day rate");
    assert.ok(o.projected_per_day_usd > o.burn_per_day_usd, "growth raises the plan");
    assert.ok(o.exposure_usd > 20 && o.exposure_usd < 22, `exposure ${o.exposure_usd}`);
    assert.equal(o.recommended_usd, 10, "14 days of spend (≈4.8) + 25% of the exposure (≈5.2), rounded up to 5");
    assert.equal(o.status, "unknown", "no balance entered yet");
    assert.equal(o.top_up_usd, 10);
    for (const id of ["stability", "replicate", "fal"]) {
      const p = plan.providers.find((x) => x.id === id);
      assert.equal(p.recommended_usd, 0, `${id}: not configured and unused`);
      assert.equal(p.status, "off");
    }
  });

  test("a manual balance turns into runway, status and a top-up amount", () => {
    const db = openDb(join(dir, "users.db"));
    const env = { OPENAI_API_KEY: "x" };
    const at = (usd) => {
      res.setManualBalance("openai", usd, { db });
      return res.resourcePlan({ db, env, now: NOW }).providers.find((x) => x.id === "openai");
    };
    const crit = at(2);
    assert.equal(crit.status, "critical");
    assert.equal(crit.top_up_usd, 10, "8 short of 10, rounded up to the next 5");
    const belowRec = at(6);
    assert.equal(belowRec.status, "low", "enough days left (≈17) but below the recommended balance of 10");
    assert.ok(belowRec.runway_days > 14);
    const short = at(4);
    assert.equal(short.status, "low");
    assert.ok(short.runway_days > 3 && short.runway_days < 14, "fewer days than the cover period");
    const ok = at(40);
    assert.equal(ok.status, "ok");
    assert.equal(ok.top_up_usd, 0);
    assert.equal(ok.balance_source, "manual");
  });

  test("a live balance beats the manual one; a stale manual balance is flagged", () => {
    const db = openDb(join(dir, "users.db"));
    const env = { OPENAI_API_KEY: "x", STABILITY_API_KEY: "y" };
    res.setManualBalance("openai", 40, { db });
    db.prepare("UPDATE resource_balances SET updated_at = ? WHERE provider = 'openai'").run(daysAgo(30));
    const plan = res.resourcePlan({ db, env, now: NOW, live: { stability: 12.5 } });
    assert.equal(plan.providers.find((x) => x.id === "openai").balance_stale, true);
    const st = plan.providers.find((x) => x.id === "stability");
    assert.equal(st.balance_usd, 12.5);
    assert.equal(st.balance_source, "api");
    assert.equal(st.balance_stale, false);
  });

  test("setManualBalance validates, clears and rejects unknown providers", () => {
    const db = openDb(join(dir, "users.db"));
    assert.throws(() => res.setManualBalance("nope", 5, { db }), /unknown provider/);
    assert.throws(() => res.setManualBalance("fal", -1, { db }), /balance_usd/);
    assert.throws(() => res.setManualBalance("fal", "abc", { db }), /balance_usd/);
    assert.deepEqual(res.setManualBalance("fal", 12.345, { db }), { provider: "fal", balance_usd: 12.35 });
    assert.equal(res.manualBalances(db).fal.balance_usd, 12.35);
    assert.deepEqual(res.setManualBalance("fal", null, { db }), { provider: "fal", balance_usd: null });
    assert.equal(res.manualBalances(db).fal, undefined);
  });

  test("settings come from the environment with safe fallbacks", () => {
    assert.deepEqual(res.resourceSettings({}), { coverDays: 14, liabilityShare: 0.25, minUsd: 5, staleDays: 14 });
    const s = res.resourceSettings({ RESOURCE_COVER_DAYS: "30", RESOURCE_LIABILITY_SHARE: "9", RESOURCE_MIN_USD: "x", RESOURCE_BALANCE_STALE_DAYS: "-1" });
    assert.equal(s.coverDays, 30);
    assert.equal(s.liabilityShare, 1, "capped at 1");
    assert.equal(s.minUsd, 5);
    assert.equal(s.staleDays, 14);
  });
});
