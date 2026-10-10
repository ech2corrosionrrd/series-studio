/**
 * Decision rule and weekly report for the business side of Series Lab.
 *
 * The rule answers one question honestly: during DECISION_DAYS from DECISION_START, did enough
 * EXTERNAL payers (not the operator, team or dogfood wallets) show up, and did some of them come back?
 *   met      >= DECISION_TARGET_PAYERS external payers AND >= DECISION_TARGET_REPEAT of them paid again
 *   active   the window is still open
 *   failed   the window is over and the targets are not met → move to the minimal-cost mode
 *
 * Everything is computed from the platform tables (payments, users), so it also works for the past.
 *
 * Weekly report: `node src/platform/decision.mjs --report [--dry]` (the host cron runs it inside the
 * container on Mondays) → three numbers for the last 7 days + progress of the rule, sent to Telegram.
 */
import { pathToFileURL } from "node:url";
import { openDb, nowIso } from "./db.mjs";
import { scopeSql } from "./ops.mjs";
import { getTelegramConfig, sendTelegramNotification } from "../notifications.mjs";
import { resourcePlan } from "./resources.mjs";

const DAY_MS = 86_400_000;

function envNum(env, key, def) {
  const n = Number.parseFloat(env[key] || "");
  return Number.isFinite(n) && n >= 0 ? n : def;
}

/** Window and targets from the environment (defaults: the rule agreed on 10.10.2026). */
export function decisionConfig(env = process.env) {
  const startRaw = String(env.DECISION_START || "2026-10-10").trim();
  const start = new Date(/^\d{4}-\d{2}-\d{2}$/.test(startRaw) ? `${startRaw}T00:00:00Z` : startRaw);
  const days = Math.max(1, Math.round(envNum(env, "DECISION_DAYS", 90)));
  return {
    start: Number.isNaN(start.getTime()) ? new Date("2026-10-10T00:00:00Z") : start,
    days,
    targetPayers: Math.max(1, Math.round(envNum(env, "DECISION_TARGET_PAYERS", 10))),
    targetRepeat: Math.max(0, Math.round(envNum(env, "DECISION_TARGET_REPEAT", 2))),
  };
}

export function decisionRule({ db = openDb(), env = process.env, now = new Date() } = {}) {
  const cfg = decisionConfig(env);
  const from = nowIso(cfg.start);
  const end = new Date(cfg.start.getTime() + cfg.days * DAY_MS);
  const ext = scopeSql("external", "wallet_address");
  const rows = db
    .prepare(`SELECT wallet_address AS w, COUNT(*) AS n, ROUND(SUM(amount_usd), 2) AS usd FROM payments WHERE created_at >= ?${ext.sql} GROUP BY wallet_address`)
    .all(from, ...ext.params);
  const payers = rows.length;
  const repeat = rows.filter((r) => r.n >= 2).length;
  const revenue = Math.round(rows.reduce((a, r) => a + r.usd, 0) * 100) / 100;
  const met = payers >= cfg.targetPayers && repeat >= cfg.targetRepeat;
  const started = now >= cfg.start;
  const daysLeft = Math.max(0, Math.ceil((end - now) / DAY_MS));
  const daysElapsed = started ? Math.min(cfg.days, Math.floor((now - cfg.start) / DAY_MS)) : 0;
  const status = met ? "met" : now > end ? "failed" : "active";
  return {
    status,
    start: cfg.start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    days: cfg.days,
    days_elapsed: daysElapsed,
    days_left: daysLeft,
    target_payers: cfg.targetPayers,
    target_repeat: cfg.targetRepeat,
    external_payers: payers,
    external_repeat_payers: repeat,
    external_revenue_usd: revenue,
  };
}

/** Last-7-day external numbers: payers, repeat purchases (not a wallet's first payment ever), revenue. */
export function weeklyNumbers({ db = openDb(), now = new Date() } = {}) {
  const since = nowIso(new Date(now.getTime() - 7 * DAY_MS));
  const ext = scopeSql("external", "wallet_address");
  // Payments in time order, ties broken by insertion order: two payments stamped in the same millisecond are still first and second.
  const all = db
    .prepare(`SELECT rowid AS id, wallet_address AS w, created_at AS at, amount_usd AS usd FROM payments WHERE 1 = 1${ext.sql} ORDER BY created_at, rowid`)
    .all(...ext.params);
  const firstId = new Map();
  for (const r of all) if (!firstId.has(r.w)) firstId.set(r.w, r.id);
  const week = all.filter((r) => r.at >= since);
  const payers = new Set(week.map((r) => r.w));
  const repeatPayers = new Set(week.filter((r) => r.id !== firstId.get(r.w)).map((r) => r.w));
  const revenue = Math.round(week.reduce((a, r) => a + r.usd, 0) * 100) / 100;
  const newUsers = db
    .prepare(`SELECT COUNT(*) AS n FROM users WHERE created_at >= ?${scopeSql("external").sql}`)
    .get(since, ...scopeSql("external").params).n;
  return { since, payers: payers.size, repeat_payers: repeatPayers.size, revenue_usd: revenue, new_users: Number(newUsers) };
}

const STATUS_UK = { met: "ЦІЛЬ ДОСЯГНУТО", active: "іде", failed: "ЦІЛЬ НЕ ДОСЯГНУТО" };

/** Lines about provider balances that need attention (low / critical, and how many balances are not entered). */
export function resourceAlertLines({ db = openDb(), env = process.env, now = new Date() } = {}) {
  try {
    const plan = resourcePlan({ db, env, now });
    const lines = plan.providers
      .filter((p) => p.status === "critical" || p.status === "low")
      .map((p) => `${p.name}: ${p.status === "critical" ? "критично" : "мало"}, лишилось ≈ ${p.runway_days == null ? "?" : Math.floor(p.runway_days)} дн., поповнити на $${p.top_up_usd}`);
    if (plan.totals.unknown_balances > 0) lines.push(`Не введено баланс у ${plan.totals.unknown_balances} провайдерів (Адмін → Ресурси)`);
    return lines;
  } catch {
    return [];
  }
}

/** Plain text (no Markdown, so no escaping problems) for Telegram. */
export function buildWeeklyReport({ db = openDb(), env = process.env, now = new Date() } = {}) {
  const w = weeklyNumbers({ db, now });
  const r = decisionRule({ db, env, now });
  const lines = [
    "Series Lab · тижневий звіт (останні 7 днів, лише зовнішні платники)",
    `Платники: ${w.payers}`,
    `Повторні покупки: ${w.repeat_payers}`,
    `Дохід: $${w.revenue_usd.toFixed(2)}`,
    `Нових користувачів: ${w.new_users}`,
    "",
    `Правило рішення (${r.start} → ${r.end}): ${STATUS_UK[r.status]}`,
    `Платників: ${r.external_payers} з ${r.target_payers}; повторних: ${r.external_repeat_payers} з ${r.target_repeat}; $${r.external_revenue_usd.toFixed(2)}`,
    r.status === "active" ? `Минуло ${r.days_elapsed} з ${r.days} днів, лишилось ${r.days_left}.` : r.status === "failed" ? "Строк вичерпано: перейти в режим мінімальних витрат." : "Можна інвестувати далі.",
  ];
  const res = resourceAlertLines({ db, env, now });
  if (res.length) lines.push("", "Ресурси (баланси провайдерів):", ...res);
  return lines.join("\n");
}

async function main(argv = process.argv.slice(2), env = process.env) {
  if (!argv.includes("--report")) {
    console.log(JSON.stringify(decisionRule({ env }), null, 2));
    return 0;
  }
  const text = buildWeeklyReport({ env });
  console.log(text);
  if (argv.includes("--dry")) return 0;
  const tg = getTelegramConfig(env);
  if (!tg.configured) {
    console.error("[report] Telegram is not configured (SERIES_TELEGRAM_BOT_TOKEN + SERIES_TELEGRAM_CHAT_ID): report printed only");
    return 0;
  }
  const res = await sendTelegramNotification({ botToken: tg.botToken, chatId: tg.chatId, text, parseMode: null });
  if (!res.ok) {
    console.error(`[report] Telegram send failed: ${res.error}`);
    return 1;
  }
  console.log("[report] sent");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code), (e) => {
    console.error(`[report] ${e.message}`);
    process.exit(1);
  });
}
