/**
 * Recommended balance per API provider (Admin → Ресурси).
 *
 * Most providers (OpenAI, Replicate, fal, Runware, Anthropic) have no balance API, so the plan is:
 *   recommended = max(minimum, projected daily spend × cover days + reserve for credits already sold)
 * and the owner types the current balance in once per top-up (stored in `resource_balances`).
 * Stability is read live from its API when the probe runs.
 *
 * Inputs (all from the platform ledger, no extra tracking):
 *   load    API cost of the debits of the last 7 and 30 days, per provider (estimate from the tariff table)
 *   demand  trend = last-7-day daily rate / 30-day daily rate (only growth raises the plan)
 *   promise credits already sold or granted but not spent yet: a share of their API cost is reserved
 * Settings: RESOURCE_COVER_DAYS (14), RESOURCE_LIABILITY_SHARE (0.25), RESOURCE_MIN_USD (5),
 * RESOURCE_BALANCE_STALE_DAYS (14).
 */
import { openDb, nowIso } from "./db.mjs";
import { scopeSql } from "./ops.mjs";
import { apiUsdPerOp } from "./margin.mjs";
import { PROVIDERS } from "./providers.mjs";

const DAY_MS = 86_400_000;
const STEP_USD = 5;

/** Providers that cost money per call and can be topped up (Irys and RPCs are separate). */
const PLAN_PROVIDERS = [
  ...PROVIDERS.filter((p) => ["openai", "anthropic", "stability", "replicate", "fal", "runware"].includes(p.id)),
  { id: "pollinations", name: "Pollinations", env: "POLLINATIONS_API_KEY", envAlt: "POLLINATIONS_TOKEN", url: "https://enter.pollinations.ai" },
];

function num(env, key, def, min = 0) {
  const n = Number.parseFloat(env[key] || "");
  return Number.isFinite(n) && n >= min ? n : def;
}

export function resourceSettings(env = process.env) {
  return {
    coverDays: Math.max(1, Math.round(num(env, "RESOURCE_COVER_DAYS", 14))),
    liabilityShare: Math.min(1, num(env, "RESOURCE_LIABILITY_SHARE", 0.25)),
    minUsd: num(env, "RESOURCE_MIN_USD", 5),
    staleDays: Math.max(1, Math.round(num(env, "RESOURCE_BALANCE_STALE_DAYS", 14))),
  };
}

/** Which provider an engine label from the ledger is paid to (null = free or unknown). */
export function providerOfEngine(label, env = process.env) {
  const e = String(label || "").trim().toLowerCase();
  if (!e || e === "(unknown)" || e === "mock" || e.includes("comfy") || e.includes("a1111") || e.includes("automatic")) return null;
  if (e.includes("replicate") || e === "kontext" || e === "schnell") return "replicate";
  if (e === "fal" || e.startsWith("fal ") || e.startsWith("fal.") || e.includes("fal.ai")) return "fal";
  if (e.includes("runware")) return "runware";
  if (e.includes("pollinations")) return "pollinations";
  if (e.includes("stability") || e.includes("sd3")) return "stability";
  if (e.includes("openai") || e.includes("gpt") || e.includes("dall")) return "openai";
  if (e === "llm" || e === "llm-polish" || e === "vision" || e.includes("claude") || e.includes("anthropic")) {
    return String(env.ANTHROPIC_API_KEY || "").trim() ? "anthropic" : "openai";
  }
  return null;
}

/** API cost and credits per provider for the last `days` days (scope: all | external). */
export function usageByProvider(days, { db = openDb(), scope = "all", env = process.env, now = new Date() } = {}) {
  const since = nowIso(new Date(now.getTime() - days * DAY_MS));
  const s = scopeSql(scope);
  const rows = db
    .prepare(
      `SELECT COALESCE(NULLIF(engine, ''), '(unknown)') AS eng, COUNT(*) AS n, COALESCE(SUM(-credits), 0) AS spent
       FROM transactions WHERE kind = 'debit' AND created_at >= ?${s.sql} GROUP BY eng`,
    )
    .all(since, ...s.params);
  const out = {};
  for (const r of rows) {
    const id = providerOfEngine(r.eng, env);
    if (!id) continue;
    const n = Number(r.n);
    const spent = Number(r.spent);
    const perOp = n ? Math.round(spent / n) : null;
    const slot = (out[id] ||= { usd: 0, credits: 0, ops: 0 });
    slot.usd += n * apiUsdPerOp(r.eng, perOp);
    slot.credits += spent;
    slot.ops += n;
  }
  return out;
}

/** Manual balances (USD) typed by the owner, plus the time they were set. */
export function manualBalances(db = openDb()) {
  return Object.fromEntries(
    db.prepare("SELECT provider, balance_usd, updated_at, note FROM resource_balances").all().map((r) => [r.provider, r]),
  );
}

export function setManualBalance(provider, balanceUsd, { note = "", db = openDb() } = {}) {
  const id = String(provider || "").trim().toLowerCase();
  if (!PLAN_PROVIDERS.some((p) => p.id === id)) throw Object.assign(new Error("unknown provider"), { status: 400 });
  if (balanceUsd === null || balanceUsd === undefined || balanceUsd === "") {
    db.prepare("DELETE FROM resource_balances WHERE provider = ?").run(id);
    return { provider: id, balance_usd: null };
  }
  const v = Number(balanceUsd);
  if (!Number.isFinite(v) || v < 0 || v > 1_000_000) throw Object.assign(new Error("balance_usd must be a number from 0"), { status: 400 });
  const usd = Math.round(v * 100) / 100;
  db.prepare(
    "INSERT INTO resource_balances (provider, balance_usd, updated_at, note) VALUES (?, ?, ?, ?) ON CONFLICT(provider) DO UPDATE SET balance_usd = excluded.balance_usd, updated_at = excluded.updated_at, note = excluded.note",
  ).run(id, usd, nowIso(), String(note || "").slice(0, 200));
  return { provider: id, balance_usd: usd };
}

const roundUp = (x) => Math.ceil(Math.max(0, x) / STEP_USD - 1e-9) * STEP_USD + 0; // + 0 turns -0 into 0
const r2 = (x) => Math.round(x * 100) / 100;

function configured(p, env) {
  return Boolean(String(env[p.env] || "").trim() || (p.envAlt && String(env[p.envAlt] || "").trim()));
}

/**
 * The plan. `live` = balances read from provider APIs ({ stability: usd }) when the probe ran.
 */
export function resourcePlan({ db = openDb(), env = process.env, now = new Date(), live = {} } = {}) {
  const set = resourceSettings(env);
  const u7 = usageByProvider(7, { db, env, now });
  const u30 = usageByProvider(30, { db, env, now });
  const u30e = usageByProvider(30, { db, env, now, scope: "external" });
  const manual = manualBalances(db);
  const outstanding = Number(db.prepare("SELECT COALESCE(SUM(credits_balance), 0) AS n FROM users").get().n) || 0;
  const credits30 = Object.values(u30).reduce((a, x) => a + x.credits, 0);

  const providers = PLAN_PROVIDERS.map((p) => {
    const isOn = configured(p, env);
    const a7 = u7[p.id] || { usd: 0, credits: 0, ops: 0 };
    const a30 = u30[p.id] || { usd: 0, credits: 0, ops: 0 };
    const per7 = a7.usd / 7;
    const per30 = a30.usd / 30;
    const burn = Math.max(per7, per30);
    const trend = per30 > 0 ? Math.min(2, Math.max(0.5, per7 / per30)) : 1;
    const projected = burn * Math.max(1, trend);
    const share = credits30 > 0 ? a30.credits / credits30 : 0;
    const usdPerCredit = a30.credits > 0 ? a30.usd / a30.credits : 0;
    const exposure = outstanding * share * usdPerCredit;
    const reserve = exposure * set.liabilityShare;
    const hasUsage = a30.ops > 0;
    const recommended = !isOn && !hasUsage ? 0 : roundUp(Math.max(set.minUsd, projected * set.coverDays + reserve));

    const m = manual[p.id];
    const liveUsd = live[p.id] != null ? Number(live[p.id]) : null;
    const balance = liveUsd != null ? liveUsd : m ? m.balance_usd : null;
    const balanceSource = liveUsd != null ? "api" : m ? "manual" : null;
    const ageDays = m && liveUsd == null ? Math.floor((now - new Date(m.updated_at)) / DAY_MS) : null;
    const stale = ageDays != null && ageDays > set.staleDays;
    const runway = balance != null && projected > 0 ? r2(balance / projected) : null;

    let status = "off";
    if (recommended > 0) {
      if (balance == null) status = "unknown";
      else if ((runway != null && runway < 3) || balance < recommended * 0.25) status = "critical";
      else if ((runway != null && runway < set.coverDays) || balance < recommended) status = "low";
      else status = "ok";
    }
    return {
      id: p.id,
      name: p.name,
      url: p.url,
      configured: isOn,
      spend_7d_usd: r2(a7.usd),
      spend_30d_usd: r2(a30.usd),
      spend_30d_external_usd: r2((u30e[p.id] || { usd: 0 }).usd),
      ops_30d: a30.ops,
      burn_per_day_usd: r2(burn),
      trend: r2(trend),
      projected_per_day_usd: r2(projected),
      exposure_usd: r2(exposure),
      reserve_usd: r2(reserve),
      recommended_usd: recommended,
      balance_usd: balance,
      balance_source: balanceSource,
      balance_updated_at: m ? m.updated_at : null,
      balance_stale: stale,
      runway_days: runway,
      top_up_usd: recommended > 0 ? (balance == null ? recommended : roundUp(recommended - balance)) : 0,
      status,
      low_data: !hasUsage,
    };
  });

  const totals = {
    recommended_usd: providers.reduce((a, x) => a + x.recommended_usd, 0),
    top_up_usd: providers.filter((x) => x.balance_usd != null).reduce((a, x) => a + x.top_up_usd, 0),
    unknown_balances: providers.filter((x) => x.status === "unknown").length,
    spend_30d_usd: r2(providers.reduce((a, x) => a + x.spend_30d_usd, 0)),
  };
  return {
    generated_at: nowIso(now),
    settings: { cover_days: set.coverDays, liability_share: set.liabilityShare, min_usd: set.minUsd, stale_days: set.staleDays },
    outstanding_credits: outstanding,
    providers,
    totals,
  };
}
