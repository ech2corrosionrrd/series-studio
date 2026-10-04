/**
 * Per-stage price = real cost + a small fixed margin.
 * Credits use the documented floor of $0.03 / credit (cheapest pack in ECONOMY.md)
 * unless STAGE_USD_PER_CREDIT is set. Nothing here moves USDC or touches keys.
 *
 * Generation and AI curation keep the existing credit tables (creditCost /
 * VISION_CREDIT_COST). This module only prices them for the quote and the
 * economy report. Archive, deploy kit, and marketplace kit are new flat fees.
 */
import { creditCost } from "./billing.mjs";
import { ENGINES } from "../engines.mjs";

export const LIST_USD_PER_CREDIT = 0.03;

export const STAGE_IDS = ["generation", "curation", "archive", "deploy_kit", "marketplace_kit"];

/** Defaults are conservative: local file work has ~$0 marginal infra, so the fee is a small fixed margin. Arweave upload has a real Irys-shaped cost the owner can replace. */
export const STAGE_DEFAULTS = {
  generation: {
    label: "Generation / render",
    basis: "engine tariff (creditCost) and ENGINES[].costUsd",
  },
  curation: {
    label: "Curation",
    costUsd: 0,
    marginUsd: 0,
    aiCostUsd: 0.02,
  },
  archive: {
    label: "Archive export",
    costUsd: 0,
    marginUsd: 0.03,
    storageCostUsd: 0.05,
    storageMarginUsd: 0.01,
  },
  deploy_kit: {
    label: "Deploy kit",
    costUsd: 0,
    marginUsd: 0.06,
  },
  marketplace_kit: {
    label: "Marketplace kit",
    costUsd: 0,
    marginUsd: 0.06,
  },
};

const ENV_KEYS = {
  archive: ["STAGE_ARCHIVE_COST_USD", "STAGE_ARCHIVE_MARGIN_USD"],
  deploy_kit: ["STAGE_DEPLOY_KIT_COST_USD", "STAGE_DEPLOY_KIT_MARGIN_USD"],
  marketplace_kit: ["STAGE_MARKET_KIT_COST_USD", "STAGE_MARKET_KIT_MARGIN_USD"],
  curation: ["STAGE_CURATION_COST_USD", "STAGE_CURATION_MARGIN_USD"],
};

function num(env, name, def) {
  if (env?.[name] == null || String(env[name]).trim() === "") return def;
  const n = Number(env[name]);
  return Number.isFinite(n) && n >= 0 ? n : def;
}

export function usdPerCredit(env = process.env) {
  return num(env, "STAGE_USD_PER_CREDIT", LIST_USD_PER_CREDIT) || LIST_USD_PER_CREDIT;
}

function jsonOverrides(env) {
  try {
    const parsed = JSON.parse(env?.STAGE_PRICING_JSON || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function pair(stage, env) {
  const base = STAGE_DEFAULTS[stage] || { costUsd: 0, marginUsd: 0 };
  const over = jsonOverrides(env)[stage] || {};
  const [costKey, marginKey] = ENV_KEYS[stage] || [];
  return {
    costUsd: over.costUsd != null ? Number(over.costUsd) : num(env, costKey, base.costUsd ?? 0),
    marginUsd: over.marginUsd != null ? Number(over.marginUsd) : num(env, marginKey, base.marginUsd ?? 0),
  };
}

export function creditsForUsd(priceUsd, env = process.env) {
  const rate = usdPerCredit(env);
  if (!(priceUsd > 0)) return 0;
  return Math.ceil(priceUsd / rate - 1e-9);
}

function round4(n) {
  return Math.round(Number(n) * 10000) / 10000;
}

function quoteShape(stage, { costUsd, marginUsd, credits, assumptions, note, count = 1 }, env) {
  const priceUsd = round4(costUsd + marginUsd);
  return {
    stage,
    label: STAGE_DEFAULTS[stage]?.label || stage,
    count,
    costUsd: round4(costUsd),
    marginUsd: round4(marginUsd),
    priceUsd,
    usdPerCredit: usdPerCredit(env),
    credits,
    formula: "credits = ceil((costUsd + marginUsd) / usdPerCredit)",
    assumptions,
    note,
  };
}

/**
 * Price shown before the action. `env` is explicit so tests do not depend on process.env.
 * @param {string} stage
 * @param {object} [opts]
 * @param {object} [env]
 */
export function quoteStage(stage, opts = {}, env = process.env) {
  const id = STAGE_IDS.includes(stage) ? stage : null;
  if (!id) {
    const err = new Error(`Unknown stage: ${stage}`);
    err.status = 400;
    throw err;
  }
  const count = Math.max(0, Number(opts.count) || 0);
  const rate = usdPerCredit(env);

  if (id === "generation") {
    const n = Math.max(1, count || 1);
    const engine = String(opts.engine || "kontext");
    const unitCost = Number.isFinite(Number(opts.costUsd))
      ? Number(opts.costUsd)
      : Number(ENGINES[engine]?.costUsd ?? 0);
    const unitCredits = creditCost(engine, {
      reference: Boolean(opts.reference),
      final: Boolean(opts.final),
      costUsd: unitCost,
    });
    const costUsd = unitCost * n;
    const credits = unitCredits * n;
    const marginUsd = Math.max(0, credits * rate - costUsd);
    return quoteShape(id, {
      costUsd,
      marginUsd,
      credits,
      count: n,
      note: "Existing engine tariff. Mock is 0. The 1.5× floor lives in creditCost (ceil(costUsd × 50)).",
      assumptions: [
        `engine=${engine}`,
        `unitCostUsd=${unitCost} from ENGINES or the request`,
        `unitCredits=${unitCredits} from creditCost`,
        `usdPerCredit=${rate} (STAGE_USD_PER_CREDIT or ${LIST_USD_PER_CREDIT})`,
      ],
    }, env);
  }

  if (id === "curation") {
    const provider = String(opts.provider || "heuristic").toLowerCase();
    const n = Math.max(1, count || 1);
    if (!provider || provider === "heuristic") {
      const p = pair("curation", env);
      const credits = creditsForUsd((p.costUsd + p.marginUsd) * (count ? n : 1), env);
      return quoteShape(id, {
        costUsd: p.costUsd,
        marginUsd: p.marginUsd,
        credits,
        count: count || 1,
        note: "Heuristic triage has no provider bill. Defaults are $0 so the existing free review stays free.",
        assumptions: [
          "provider=heuristic",
          "STAGE_CURATION_COST_USD / STAGE_CURATION_MARGIN_USD (default 0 / 0)",
        ],
      }, env);
    }
    const per = Math.max(0, Number.parseInt(env.VISION_CREDIT_COST || "1", 10) || 0);
    const aiUnit = num(env, "STAGE_CURATION_AI_COST_USD", STAGE_DEFAULTS.curation.aiCostUsd);
    const credits = per * n;
    const costUsd = aiUnit * n;
    const marginUsd = Math.max(0, credits * rate - costUsd);
    return quoteShape(id, {
      costUsd,
      marginUsd,
      credits,
      count: n,
      note: "AI triage already charges VISION_CREDIT_COST per image. This quote matches that charge.",
      assumptions: [
        `provider=${provider}`,
        `VISION_CREDIT_COST=${per} per image`,
        `STAGE_CURATION_AI_COST_USD=${aiUnit} (API orientir, default ${STAGE_DEFAULTS.curation.aiCostUsd})`,
      ],
    }, env);
  }

  if (id === "archive") {
    // `storage` = upload to Arweave (Irys). `ipfs` is the legacy name of the same option.
    const storage = opts.storage ?? opts.ipfs;
    const zipOn = opts.zip !== false && storage !== "only";
    const storageOn = Boolean(storage);
    const zip = pair("archive", env);
    const over = jsonOverrides(env).archive || {};
    const storageCost = num(env, "STAGE_STORAGE_COST_USD", num(env, "STAGE_IPFS_COST_USD", over.storageCostUsd ?? over.ipfsCostUsd ?? STAGE_DEFAULTS.archive.storageCostUsd));
    const storageMargin = num(env, "STAGE_STORAGE_MARGIN_USD", num(env, "STAGE_IPFS_MARGIN_USD", over.storageMarginUsd ?? over.ipfsMarginUsd ?? STAGE_DEFAULTS.archive.storageMarginUsd));
    const costUsd = (zipOn ? zip.costUsd : 0) + (storageOn ? storageCost : 0);
    const marginUsd = (zipOn ? zip.marginUsd : 0) + (storageOn ? storageMargin : 0);
    return quoteShape(id, {
      costUsd,
      marginUsd,
      credits: creditsForUsd(costUsd + marginUsd, env),
      count: 1,
      note: storageOn && !zipOn
        ? "Arweave upload only. Zip export is a separate fee."
        : "Local zip marginal infra is treated as $0; the credit is the fixed margin. The Arweave upload is added only when you upload.",
      assumptions: [
        `zip=${zipOn} cost ${zip.costUsd} + margin ${zip.marginUsd} (STAGE_ARCHIVE_COST_USD / STAGE_ARCHIVE_MARGIN_USD)`,
        `storage=${storageOn} cost ${storageCost} + margin ${storageMargin} (STAGE_STORAGE_COST_USD / STAGE_STORAGE_MARGIN_USD; legacy STAGE_IPFS_*)`,
        "Not a live Irys invoice — replace the storage numbers when your plan changes.",
      ],
    }, env);
  }

  const p = pair(id, env);
  return quoteShape(id, {
    costUsd: p.costUsd,
    marginUsd: p.marginUsd,
    credits: creditsForUsd(p.costUsd + p.marginUsd, env),
    count: 1,
    note: id === "deploy_kit"
      ? "We only prepare files and CLI steps. Chain fees are the deploy-cost estimate, paid from your wallet, not this credit."
      : "We only prepare checklists, texts, and sized images. Listing is done from your marketplace account.",
    assumptions: [
      `${ENV_KEYS[id][0]}=${p.costUsd}`,
      `${ENV_KEYS[id][1]}=${p.marginUsd}`,
      `usdPerCredit=${rate}`,
    ],
  }, env);
}

export function listStagePrices(env = process.env) {
  return STAGE_IDS.map((stage) => quoteStage(stage, stage === "generation" ? { engine: "kontext", count: 1, reference: true } : { provider: "heuristic" }, env));
}

export function stageOfDebit(engine, note) {
  const e = String(engine || "");
  if (e.startsWith("stage:")) return e.slice("stage:".length);
  const n = String(note || "").toLowerCase();
  if (n.includes("triage") || n.includes("curation")) return "curation";
  return "generation";
}

function cutoffIso(days) {
  if (days == null || !(days > 0)) return null;
  return new Date(Date.now() - days * 86_400_000).toISOString().replace(/\.(\d{3})Z$/, ".$1000+00:00");
}

/**
 * Cost vs revenue per stage from the ledger.
 * Generation cost uses `apiUsd(engine, creditsPerOp)`. Other stages use the configured cost basis
 * (the margin stays in the credit price, so revenue − cost is the margin).
 * @param {import("node:sqlite").DatabaseSync} db
 */
export function stageLedgerReport(db, days = null, { apiUsd = () => 0, avgUsdPerCredit = 0, env = process.env } = {}) {
  const since = cutoffIso(days);
  const rows = since
    ? db.prepare(
      `SELECT engine, note, COUNT(*) AS n, COALESCE(SUM(-credits), 0) AS spent
       FROM transactions WHERE kind = 'debit' AND created_at >= ?
       GROUP BY engine, note`,
    ).all(since)
    : db.prepare(
      `SELECT engine, note, COUNT(*) AS n, COALESCE(SUM(-credits), 0) AS spent
       FROM transactions WHERE kind = 'debit'
       GROUP BY engine, note`,
    ).all();

  const buckets = Object.fromEntries(STAGE_IDS.map((id) => [id, {
    stage: id,
    label: STAGE_DEFAULTS[id].label,
    ops: 0,
    credits_spent: 0,
    cost_usd: 0,
  }]));

  for (const row of rows) {
    const stage = buckets[stageOfDebit(row.engine, row.note)] ? stageOfDebit(row.engine, row.note) : "generation";
    const bucket = buckets[stage];
    const ops = Number(row.n) || 0;
    const spent = Number(row.spent) || 0;
    bucket.ops += ops;
    bucket.credits_spent += spent;
    if (stage === "generation") {
      const perOp = ops ? Math.round(spent / ops) : null;
      bucket.cost_usd += ops * (apiUsd(row.engine, perOp) || 0);
    } else if (stage === "curation") {
      const ai = num(env, "STAGE_CURATION_AI_COST_USD", STAGE_DEFAULTS.curation.aiCostUsd);
      const heuristic = pair("curation", env).costUsd;
      const note = String(row.note || "").toLowerCase();
      bucket.cost_usd += ops * (note.includes("triage") && !note.includes("heuristic") ? ai : heuristic);
    } else if (stage === "archive") {
      const zip = pair("archive", env);
      const storageCost = num(env, "STAGE_STORAGE_COST_USD", num(env, "STAGE_IPFS_COST_USD", STAGE_DEFAULTS.archive.storageCostUsd));
      const note = String(row.note || "").toLowerCase();
      // older ledger rows say "ipfs pin"; new ones "arweave upload"
      bucket.cost_usd += ops * (note.includes("ipfs") || note.includes("arweave") ? storageCost : zip.costUsd);
    } else {
      bucket.cost_usd += ops * pair(stage, env).costUsd;
    }
  }

  const realized = Number(avgUsdPerCredit) > 0 ? Number(avgUsdPerCredit) : 0;
  const list = usdPerCredit(env);
  const rate = realized > 0 ? realized : list;
  const stages = STAGE_IDS.map((id) => {
    const b = buckets[id];
    const revenue = round4(b.credits_spent * rate);
    const cost = round4(b.cost_usd);
    return {
      ...b,
      cost_usd: cost,
      revenue_usd: revenue,
      margin_usd: round4(revenue - cost),
    };
  });
  return {
    period: days ? `${days}d` : "all",
    usd_per_credit: round4(rate),
    usd_per_credit_basis: realized > 0 ? "payments" : "list",
    list_usd_per_credit: list,
    formula: "revenue_usd = credits_spent × usd_per_credit; cost_usd = configured cost basis (generation: API orientir); margin_usd = revenue_usd − cost_usd",
    stages,
  };
}
