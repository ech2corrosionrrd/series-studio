/**
 * Unit economics & gross/net margin — port of Промт `services/margin_report.py`
 * (+ `stats.overview`). Reads the same `users.db` ledger.
 *
 * API $/op are list-price orientirs (Aug 2026), not invoices. Margin floor in
 * billing: cheapest pack ≈ $0.03/cr must cover 1.5 × provider cost.
 *
 * Fixed overhead (hosting + SaaS) defaults to a lean Hetzner stack; override via
 * HOSTING_MONTHLY_USD / SAAS_MONTHLY_USD / FIXED_MONTHLY_USD.
 */
import { PACKAGES, creditCost, localGpuCreditCost } from "./billing.mjs";
import { openDb } from "./db.mjs";
import { ENGINES } from "../engines.mjs";
import { scopeSql } from "./ops.mjs";
import { overview, creditsByKindSince } from "./stats.mjs";
import { stageLedgerReport, listStagePrices } from "./stage-pricing.mjs";

/** USD per API op by (family, credits charged) — same table as Промт. */
export const API_USD_BY_TARIFF = {
  openai: { 4: 0.042, 6: 0.062, 8: 0.167, 10: 0.187 },
  stability: { 1: 0.03, 2: 0.035, 3: 0.035 },
  flux: { 1: 0.003, 2: 0.025, 3: 0.025 },
  local: { 1: 0, 2: 0, 3: 0 },
};
export const API_USD_PER_OP = {
  openai: 0.042,
  stability: 0.03,
  flux: 0.003,
  local: 0,
  LLM: 0.0003,
  vision: 0.02,
};
const DEFAULT_API_USD = 0.01;

/** Lean monthly ops (USD) — used when FIXED_MONTHLY_USD unset. */
export const DEFAULT_HOSTING_MONTHLY_USD = 8; // Hetzner CX/CPX + backups slice
export const DEFAULT_SAAS_MONTHLY_USD = 10; // Pinata/Alchemy/DNS buffer (free tiers → raise when paid)

const ENGINE_FAMILY = {
  openai: "openai",
  stability: "stability",
  kontext: "flux", fal: "flux", schnell: "flux", runware: "flux", pollinations: "flux",
  comfyui: "local", a1111: "local",
  vision: "vision", LLM: "LLM",
};

export function engineFamily(engine) {
  const e = String(engine || "").toLowerCase();
  if (ENGINE_FAMILY[e]) return ENGINE_FAMILY[e];
  if (e.includes("gpt") || e.includes("openai") || e.includes("dall")) return "openai";
  if (e.includes("stability") || e.includes("sd3")) return "stability";
  if (e.includes("comfy") || e.includes("a1111") || e.includes("automatic")) return "local";
  if (e.includes("flux") || e.includes("fal") || e.includes("schnell") || e.includes("runware")) return "flux";
  return e || "unknown";
}

export function apiUsdPerOp(engine, creditsPerOp = null) {
  const family = engineFamily(engine);
  if (family === "local") return 0;
  if (creditsPerOp != null) {
    const table = API_USD_BY_TARIFF[family];
    const price = table?.[Number(creditsPerOp)];
    if (price != null) return price;
  }
  if (API_USD_PER_OP[family] != null) return API_USD_PER_OP[family];
  const listed = ENGINES[engine]?.costUsd;
  if (Number.isFinite(listed) && listed >= 0) return listed;
  return DEFAULT_API_USD;
}

function envFloat(name, def, env = process.env) {
  const n = Number.parseFloat(env[name] || "");
  return Number.isFinite(n) ? n : def;
}

/** Hosting + SaaS subscriptions → monthly fixed. FIXED_MONTHLY_USD wins if set. */
export function monthlyFixedUsd(env = process.env) {
  if (env.FIXED_MONTHLY_USD != null && String(env.FIXED_MONTHLY_USD).trim() !== "") {
    return envFloat("FIXED_MONTHLY_USD", 0, env);
  }
  return envFloat("HOSTING_MONTHLY_USD", DEFAULT_HOSTING_MONTHLY_USD, env)
    + envFloat("SAAS_MONTHLY_USD", DEFAULT_SAAS_MONTHLY_USD, env);
}

export function overheadBreakdown(env = process.env) {
  const hosting = envFloat("HOSTING_MONTHLY_USD", DEFAULT_HOSTING_MONTHLY_USD, env);
  const saas = envFloat("SAAS_MONTHLY_USD", DEFAULT_SAAS_MONTHLY_USD, env);
  const fixedOverride = env.FIXED_MONTHLY_USD != null && String(env.FIXED_MONTHLY_USD).trim() !== "";
  const fixed = monthlyFixedUsd(env);
  return {
    hosting_monthly_usd: hosting,
    saas_monthly_usd: saas,
    fixed_monthly_usd: fixed,
    fixed_from_override: fixedOverride,
    items: fixedOverride
      ? [{ id: "fixed", label: "Фікс (FIXED_MONTHLY_USD)", usd: fixed }]
      : [
        { id: "hosting", label: "Хостинг (VPS / backups)", usd: hosting },
        { id: "saas", label: "Підписки ресурсів (Pinata / RPC / DNS…)", usd: saas },
      ],
  };
}

function cutoffIso(days) {
  if (days == null || !(days > 0)) return null;
  return new Date(Date.now() - days * 86_400_000).toISOString().replace(/\.(\d{3})Z$/, ".$1000+00:00");
}

function paymentTotals(db, since, scope = "all") {
  const s = scopeSql(scope);
  const row = since
    ? db.prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(credits), 0) AS cr, COUNT(*) AS n
       FROM payments WHERE created_at >= ?${s.sql}`,
    ).get(since, ...s.params)
    : db.prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(credits), 0) AS cr, COUNT(*) AS n
       FROM payments WHERE 1 = 1${s.sql}`,
    ).get(...s.params);
  return { usd: Number(row.usd), credits: Number(row.cr), count: Number(row.n) };
}

export function generationsForPeriod(days = null, db = openDb()) {
  const since = cutoffIso(days);
  const rows = since
    ? db.prepare(
      `SELECT COALESCE(NULLIF(engine, ''), '(unknown)') AS eng, COUNT(*) AS n,
              COALESCE(SUM(-credits), 0) AS spent
       FROM transactions WHERE kind = 'debit' AND created_at >= ?
       GROUP BY eng ORDER BY spent DESC`,
    ).all(since)
    : db.prepare(
      `SELECT COALESCE(NULLIF(engine, ''), '(unknown)') AS eng, COUNT(*) AS n,
              COALESCE(SUM(-credits), 0) AS spent
       FROM transactions WHERE kind = 'debit'
       GROUP BY eng ORDER BY spent DESC`,
    ).all();
  return rows.map((r) => ({ engine: r.eng, count: Number(r.n), credits_spent: Number(r.spent) }));
}

export function creditsDebitedForPeriod(days = null, db = openDb()) {
  const since = cutoffIso(days);
  const row = since
    ? db.prepare("SELECT COALESCE(SUM(-credits), 0) AS n FROM transactions WHERE kind = 'debit' AND created_at >= ?").get(since)
    : db.prepare("SELECT COALESCE(SUM(-credits), 0) AS n FROM transactions WHERE kind = 'debit'").get();
  return Number(row.n);
}

export function estimatedApiCostUsd(generations) {
  let total = 0;
  for (const row of generations || []) {
    const count = Number(row.count) || 0;
    if (count <= 0) continue;
    const spent = Number(row.credits_spent) || 0;
    const perOp = spent ? Math.round(spent / count) : null;
    total += count * apiUsdPerOp(row.engine, perOp);
  }
  return total;
}

function dataSpanDays(db) {
  const row = db.prepare("SELECT MIN(created_at) AS m FROM payments").get();
  if (!row?.m) return 30;
  const t = Date.parse(row.m);
  if (Number.isNaN(t)) return 30;
  return Math.max(1, Math.ceil((Date.now() - t) / 86_400_000));
}

export function grossMarginReport(days = null, db = openDb()) {
  const ov = overview(db);
  const since = cutoffIso(days);
  const all = paymentTotals(db, since, "all");
  const ext = paymentTotals(db, since, "external");
  let avgRev = all.usd;
  let avgSold = all.credits;
  if (days != null && avgSold === 0) {
    const forever = paymentTotals(db, null, "all");
    avgRev = forever.usd;
    avgSold = forever.credits;
  }
  const byEngine = generationsForPeriod(days, db);
  const debited = creditsDebitedForPeriod(days, db);
  const apiCost = estimatedApiCostUsd(byEngine);
  const avg = avgSold > 0 ? avgRev / avgSold : 0;
  const revOnDeb = debited * avg;
  const arpu = all.count > 0 ? Math.round((all.usd / all.count) * 100) / 100 : null;
  const marginPct = revOnDeb > 0 ? Math.round(10 * (100 * (1 - apiCost / revOnDeb))) / 10 : null;
  const utilization = ov.credits_sold > 0 ? Math.round((1000 * debited) / ov.credits_sold) / 10 : null;
  const outstandingRatio = ov.credits_sold > 0
    ? Math.round((1000 * ov.credits_outstanding) / ov.credits_sold) / 10
    : null;

  let stabSpent = 0;
  for (const r of byEngine) {
    if (engineFamily(r.engine) === "stability") stabSpent += r.credits_spent;
  }
  const stabilityShare = debited > 0 ? Math.round((1000 * stabSpent) / debited) / 10 : null;

  const engineCosts = byEngine.map((r) => {
    const perOp = r.count ? Math.round(r.credits_spent / r.count) : null;
    return {
      engine: r.engine,
      ops: r.count,
      credits_spent: r.credits_spent,
      api_usd: Math.round(r.count * apiUsdPerOp(r.engine, perOp) * 10000) / 10000,
    };
  });

  const welcomeNet = creditsByKindSince(days, db).welcome || 0;

  return {
    period: days ? `${days}d` : "all",
    revenue_usd: Math.round(all.usd * 100) / 100,
    revenue_usd_external: Math.round(ext.usd * 100) / 100,
    revenue_usd_internal: Math.round((all.usd - ext.usd) * 100) / 100,
    payments_count_external: ext.count,
    credits_sold: all.credits,
    payments_count: all.count,
    arpu_usd: arpu,
    welcome_credits_net: welcomeNet,
    credits_debited: debited,
    credits_outstanding: ov.credits_outstanding,
    avg_usd_per_credit: Math.round(avg * 10000) / 10000,
    estimated_api_usd: Math.round(apiCost * 10000) / 10000,
    actual_api_usd: null,
    api_delta_usd: null,
    estimated_revenue_on_debited_usd: Math.round(revOnDeb * 100) / 100,
    gross_margin_pct: marginPct,
    actual_gross_margin_pct: null,
    has_actual_imports: false,
    credits_utilization_pct: utilization,
    outstanding_ratio_pct: outstandingRatio,
    stability_share_pct: stabilityShare,
    by_engine_cost: engineCosts,
    actual_by_provider: [],
  };
}

/** Crypto → USD when paying fiat invoices (API / VPS / SaaS). Default ~2% CEX spread+fee. */
export function resourceFxPct(env = process.env) {
  return envFloat("RESOURCE_FX_PCT", 2, env);
}

export function netMarginReport(days = null, { gross, db = openDb() } = {}) {
  const r = gross || grossMarginReport(days, db);
  const revenue = r.revenue_usd;
  const apiCost = r.actual_api_usd != null ? r.actual_api_usd : r.estimated_api_usd;
  const payPct = envFloat("PAYMENT_FEE_PCT", 0);
  const fxPct = envFloat("FX_FEE_PCT", 2); // inbound: USDC → ops USD (exchange/OTC spread)
  const resFxPct = resourceFxPct(); // outbound: crypto → USD for resource bills
  const oh = overheadBreakdown();
  const fixedMonthly = oh.fixed_monthly_usd;
  const periodDays = days != null ? days : dataSpanDays(db);
  const paymentFee = Math.round(revenue * payPct) / 100;
  const fxFee = Math.round(revenue * fxPct) / 100;
  const fixedCost = Math.round((fixedMonthly * periodDays) / 30 * 100) / 100;
  const resourceSpend = apiCost + fixedCost;
  const resourceFx = Math.round(resourceSpend * resFxPct) / 100;
  const netProfit = Math.round(
    (revenue - apiCost - paymentFee - fxFee - fixedCost - resourceFx) * 100,
  ) / 100;
  const netMarginPct = revenue > 0 ? Math.round((1000 * netProfit) / revenue) / 10 : null;
  return {
    revenue_usd: Math.round(revenue * 100) / 100,
    api_cost_usd: Math.round(apiCost * 10000) / 10000,
    payment_fee_usd: paymentFee,
    fx_fee_usd: fxFee,
    resource_fx_usd: resourceFx,
    fixed_cost_usd: fixedCost,
    net_profit_usd: netProfit,
    net_margin_pct: netMarginPct,
    payment_fee_pct: payPct,
    fx_fee_pct: fxPct,
    resource_fx_pct: resFxPct,
    fixed_monthly_usd: fixedMonthly,
    hosting_monthly_usd: oh.hosting_monthly_usd,
    saas_monthly_usd: oh.saas_monthly_usd,
    period_days: periodDays,
  };
}

function blendedApiPerCredit(db) {
  const byEngine = generationsForPeriod(null, db);
  const debited = creditsDebitedForPeriod(null, db);
  if (debited <= 0) return 0.0105; // model blend: 70% flux + 15% openai + 15% local
  return estimatedApiCostUsd(byEngine) / debited;
}

export function breakEvenSummary({
  packagePrice = PACKAGES.start.usd,
  packageCredits = PACKAGES.start.credits,
  db = openDb(),
} = {}) {
  const fixed = monthlyFixedUsd();
  const inFees = envFloat("PAYMENT_FEE_PCT", 0) / 100 + envFloat("FX_FEE_PCT", 2) / 100;
  const resFx = resourceFxPct() / 100;
  const blended = blendedApiPerCredit(db);
  const api = packageCredits * blended;
  // API paid in USD → inflate by resource FX; inbound fees on pack price
  const contribution = Math.round(
    (packagePrice - api * (1 + resFx) - packagePrice * inFees) * 100,
  ) / 100;
  const fixedEffective = fixed * (1 + resFx);
  const needed = fixedEffective > 0 && contribution > 0
    ? Math.ceil(fixedEffective / contribution)
    : 0;
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const month = paymentTotals(db, monthStart, "all");
  return {
    package_price: packagePrice,
    package_credits: packageCredits,
    fixed_monthly_usd: Math.round(fixed * 100) / 100,
    fixed_effective_usd: Math.round(fixedEffective * 100) / 100,
    resource_fx_pct: resourceFxPct(),
    blended_api_per_credit: Math.round(blended * 1e5) / 1e5,
    contribution_usd: contribution,
    break_even_count: needed,
    payments_this_month: month.count,
    revenue_this_month: Math.round(month.usd * 100) / 100,
    remaining: needed > 0 ? Math.max(0, needed - month.count) : 0,
    covered_pct: needed > 0 ? Math.round((100 * month.count) / needed) : null,
  };
}

/** Blended mix for planning: mostly budget flux, some OpenAI, some local GPU. */
const PLAN_MIX = [
  { id: "flux", share: 0.7, cr_per_op: 2, api_usd: 0.025 },
  { id: "openai", share: 0.15, cr_per_op: 6, api_usd: 0.07 },
  { id: "local", share: 0.15, cr_per_op: 1, api_usd: 0 },
];

export function planningScenarios({ fixedMonthly = monthlyFixedUsd(), cheapestPerCr = null } = {}) {
  const packs = Object.values(PACKAGES);
  const cheap = cheapestPerCr ?? Math.min(...packs.map((p) => p.usd / p.credits));
  const inFees = envFloat("PAYMENT_FEE_PCT", 0) / 100 + envFloat("FX_FEE_PCT", 2) / 100;
  const resFx = resourceFxPct() / 100;
  const apiPerCr = PLAN_MIX.reduce((s, m) => s + m.share * (m.api_usd / m.cr_per_op), 0);
  const pro = PACKAGES.pro;
  const rows = [5, 10, 20, 40].map((n) => {
    const rev = n * pro.usd;
    const cr = n * pro.credits;
    let api = 0;
    for (const m of PLAN_MIX) api += ((cr * m.share) / m.cr_per_op) * m.api_usd;
    const feeUsd = rev * inFees;
    const resourceFxUsd = (api + fixedMonthly) * resFx;
    const net = rev - api - feeUsd - fixedMonthly - resourceFxUsd;
    return {
      pro_packs: n,
      revenue_usd: Math.round(rev * 100) / 100,
      api_usd: Math.round(api * 100) / 100,
      fees_usd: Math.round(feeUsd * 100) / 100,
      resource_fx_usd: Math.round(resourceFxUsd * 100) / 100,
      fixed_usd: fixedMonthly,
      net_usd: Math.round(net * 100) / 100,
      net_margin_pct: rev > 0 ? Math.round((1000 * net) / rev) / 10 : null,
    };
  });
  return {
    blended_api_per_credit: Math.round(apiPerCr * 1e5) / 1e5,
    cheapest_usd_per_credit: Math.round(cheap * 10000) / 10000,
    resource_fx_pct: resourceFxPct(),
    rows,
  };
}

/** Static unit-economics card: packages, tariff grid, COGS vs credit price, overhead. */
export function unitEconomicsModel() {
  const packs = Object.entries(PACKAGES).map(([id, p]) => ({
    id,
    label: p.label,
    usd: p.usd,
    credits: p.credits,
    usd_per_credit: Math.round((p.usd / p.credits) * 10000) / 10000,
    recommended: !!p.recommended,
    note: p.note,
  }));
  const cheapest = Math.min(...packs.map((p) => p.usd_per_credit));
  const lgCr = localGpuCreditCost();
  const families = [
    { id: "flux", label: "Flux / kontext / fal / schnell", draft: 1, final: 2, ref: 2, refFinal: 3 },
    { id: "stability", label: "Stability", draft: 1, final: 2, ref: 2, refFinal: 3 },
    { id: "openai", label: "OpenAI gpt-image", draft: 4, final: 8, ref: 6, refFinal: 10 },
    { id: "local", label: "Local GPU (ComfyUI / A1111)", draft: lgCr, final: lgCr, ref: lgCr, refFinal: lgCr },
  ].map((f) => {
    const table = API_USD_BY_TARIFF[f.id] || {};
    const cogs = {
      draft: table[f.draft] ?? 0,
      final: table[f.final] ?? 0,
      ref: table[f.ref] ?? 0,
      refFinal: table[f.refFinal] ?? 0,
    };
    const rev = (cr) => cr * cheapest;
    const margin = (cr, cost) => (rev(cr) > 0 ? Math.round(1000 * (1 - cost / rev(cr))) / 10 : null);
    return {
      ...f,
      cogs_usd: cogs,
      margin_at_cheapest_pack_pct: {
        draft: margin(f.draft, cogs.draft),
        final: margin(f.final, cogs.final),
        ref: margin(f.ref, cogs.ref),
        refFinal: margin(f.refFinal, cogs.refFinal),
      },
    };
  });

  const engines = Object.entries(ENGINES)
    .filter(([id, e]) => e.costUsd > 0 || id === "comfyui" || id === "a1111")
    .map(([id, e]) => {
      const cr = creditCost(id, { reference: true, costUsd: e.costUsd });
      const api = id === "comfyui" || id === "a1111" ? 0 : e.costUsd;
      const floor = Math.ceil((e.costUsd || 0) * 50 - 1e-9);
      const rev = cr * cheapest;
      return {
        id,
        cost_usd: api,
        credits_ref: cr,
        margin_floor_credits: id === "comfyui" || id === "a1111" ? cr : Math.max(floor, 1),
        revenue_at_cheapest_usd: Math.round(rev * 10000) / 10000,
        est_margin_pct: rev > 0 ? Math.round(1000 * (1 - api / rev)) / 10 : null,
        support_fee: id === "comfyui" || id === "a1111",
      };
    })
    .sort((a, b) => a.cost_usd - b.cost_usd || a.id.localeCompare(b.id));

  const tight = engines.filter((e) => !e.support_fee && e.est_margin_pct != null);
  const minGross = tight.length ? Math.min(...tight.map((e) => e.est_margin_pct)) : null;
  const oh = overheadBreakdown();
  const plan = planningScenarios({ fixedMonthly: oh.fixed_monthly_usd, cheapestPerCr: cheapest });
  const warnings = [];
  if (minGross != null && minGross < 20) warnings.push(`Найжорсткіший рушій: валова маржа ${minGross}% < 20%`);
  else if (minGross != null && minGross < 35) {
    warnings.push(`Невелика валова на найжорсткішому рушії: ${minGross}% (норма ≥25%)`);
  }
  if (lgCr < 1) warnings.push("LOCAL_GPU_CREDIT_COST < 1 — підтримка Lab занадто низька");

  return {
    target_gross_margin_pct: "≥25% на найжорсткіших (kontext ~33%); blended ~45–60%",
    target_net_margin_pct: "невелика додатна після фіксу; ~15%+ уже з ~5× Pro/міс при lean overhead",
    cheapest_usd_per_credit: cheapest,
    margin_floor_rule: "ceil(costUsd × 50) so 1 credit @ $0.03 covers ≥ 1.5 × provider $",
    packages: packs,
    tariff_families: families,
    engines,
    min_engine_gross_margin_pct: minGross,
    overhead: oh,
    scenarios: plan.rows,
    blended_api_per_credit: plan.blended_api_per_credit,
    warnings,
    fees_defaults: {
      payment_fee_pct: envFloat("PAYMENT_FEE_PCT", 0),
      fx_fee_pct: envFloat("FX_FEE_PCT", 2),
      resource_fx_pct: resourceFxPct(),
      fixed_monthly_usd: oh.fixed_monthly_usd,
      hosting_monthly_usd: oh.hosting_monthly_usd,
      saas_monthly_usd: oh.saas_monthly_usd,
      local_gpu_credit_cost: lgCr,
    },
  };
}

/** Full admin payload for one period. */
export function economyReport(days = null, db = openDb()) {
  const gross = grossMarginReport(days, db);
  const net = netMarginReport(days, { gross, db });
  return {
    overview: overview(db),
    gross,
    net,
    break_even: breakEvenSummary({ db }),
    model: unitEconomicsModel(),
    funnel_30d: null,
    stages: stageLedgerReport(db, days, {
      apiUsd: apiUsdPerOp,
      avgUsdPerCredit: gross.avg_usd_per_credit,
    }),
    stage_prices: listStagePrices(),
  };
}
