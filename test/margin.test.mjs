import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeAll, openDb } from "../src/platform/db.mjs";
import { recordPayment, deductCredits, completeWalletSignIn } from "../src/platform/billing.mjs";
import {
  apiUsdPerOp,
  estimatedApiCostUsd,
  grossMarginReport,
  netMarginReport,
  unitEconomicsModel,
  breakEvenSummary,
  monthlyFixedUsd,
  overheadBreakdown,
  planningScenarios,
} from "../src/platform/margin.mjs";

const dir = mkdtempSync(join(tmpdir(), "series-margin-"));
process.env.USERS_DB_PATH = join(dir, "users.db");
process.env.SERIES_DATA_DIR = dir;
process.env.WELCOME_REQUIRE_BALANCE = "0";
process.env.AUTH_SESSION_SECRET = "margin-test";
delete process.env.FIXED_MONTHLY_USD;
process.env.HOSTING_MONTHLY_USD = "8";
process.env.SAAS_MONTHLY_USD = "10";
process.env.PAYMENT_FEE_PCT = "1";
process.env.FX_FEE_PCT = "2";
process.env.RESOURCE_FX_PCT = "2";
process.env.LOCAL_GPU_CREDIT_COST = "1";

describe("margin / unit economics", () => {
  test("apiUsdPerOp uses tariff table by credits", () => {
    assert.equal(apiUsdPerOp("fal", 1), 0.003);
    assert.equal(apiUsdPerOp("fal", 2), 0.025);
    // Kontext Pro is priced by engine ($0.04), not by the cheaper Flux family table
    assert.equal(apiUsdPerOp("kontext", 1), 0.04);
    assert.equal(apiUsdPerOp("kontext", 3), 0.04);
    assert.equal(apiUsdPerOp("openai", 4), 0.042);
    assert.equal(apiUsdPerOp("openai", 8), 0.167);
    assert.equal(apiUsdPerOp("comfyui", 1), 0);
    assert.equal(apiUsdPerOp("a1111", 1), 0);
  });

  test("overhead = hosting + saas; FIXED overrides", () => {
    assert.equal(monthlyFixedUsd({ HOSTING_MONTHLY_USD: "8", SAAS_MONTHLY_USD: "10" }), 18);
    assert.equal(monthlyFixedUsd({ FIXED_MONTHLY_USD: "25", HOSTING_MONTHLY_USD: "8", SAAS_MONTHLY_USD: "10" }), 25);
    const oh = overheadBreakdown({ HOSTING_MONTHLY_USD: "8", SAAS_MONTHLY_USD: "10" });
    assert.equal(oh.fixed_monthly_usd, 18);
    assert.equal(oh.items.length, 2);
  });

  test("unit model: Pro cheapest $/cr, flux draft ≥ 60%, local support fee", () => {
    const m = unitEconomicsModel();
    assert.equal(m.cheapest_usd_per_credit, Math.round((29.99 / 1000) * 10000) / 10000);
    const flux = m.tariff_families.find((f) => f.id === "flux");
    assert.ok(flux.margin_at_cheapest_pack_pct.draft >= 60);
    const local = m.tariff_families.find((f) => f.id === "local");
    assert.ok(local);
    assert.equal(local.cogs_usd.draft, 0);
    assert.ok(local.margin_at_cheapest_pack_pct.draft >= 99);
    assert.equal(m.overhead.fixed_monthly_usd, 18);
    assert.ok(m.scenarios.length >= 4);
    const scen = planningScenarios({ fixedMonthly: 18 });
    const at20 = scen.rows.find((r) => r.pro_packs === 20);
    assert.ok(at20.net_usd > 0);
    assert.ok(at20.net_margin_pct > 15 && at20.net_margin_pct < 70);
  });

  test("gross and net margin from payments + debits", async () => {
    closeAll();
    const db = openDb(join(dir, "users.db"));
    const wallet = "0x1111111111111111111111111111111111111111";
    await completeWalletSignIn(wallet, { db, balanceCheck: async () => ({ ok: true }) });
    assert.equal(recordPayment("tx-m1", wallet, 100, 4.99, { db }), true);
    // Mark verified already done; debit 10 flux ops at 1 credit each.
    for (let i = 0; i < 10; i++) {
      assert.equal(deductCredits(wallet, 1, { engine: "fal", db }), true);
    }
    const gross = grossMarginReport(null, db);
    assert.equal(gross.revenue_usd, 4.99);
    assert.equal(gross.credits_sold, 100);
    assert.equal(gross.credits_debited, 10);
    assert.ok(gross.estimated_api_usd > 0);
    assert.ok(gross.gross_margin_pct == null || gross.gross_margin_pct > 50);
    const net = netMarginReport(null, { gross, db });
    assert.ok(net.payment_fee_usd > 0);
    assert.ok(net.fixed_cost_usd > 0);
    assert.ok(net.resource_fx_usd > 0);
    assert.equal(net.resource_fx_pct, 2);
    assert.equal(net.fixed_monthly_usd, 18);
    assert.equal(net.hosting_monthly_usd, 8);
    assert.equal(net.saas_monthly_usd, 10);
    // external-only view: never better than the all-payments view, and its revenue matches the gross report
    assert.equal(net.revenue_usd_external, gross.revenue_usd_external);
    assert.ok(net.net_profit_external_usd <= net.net_profit_usd);
    const be = breakEvenSummary({ db });
    assert.ok(be.contribution_usd > 0);
    assert.ok(be.break_even_count >= 1);
    assert.ok(be.fixed_effective_usd > be.fixed_monthly_usd);
  });

  test("estimatedApiCostUsd weights by per-op credits", () => {
    const cost = estimatedApiCostUsd([
      { engine: "fal", count: 10, credits_spent: 10 },
      { engine: "openai", count: 2, credits_spent: 8 },
    ]);
    assert.equal(Math.round(cost * 1000) / 1000, Math.round((10 * 0.003 + 2 * 0.042) * 1000) / 1000);
  });
});
