/**
 * Admin → Ресурси: every service the project uses, balance alerts, and notes.
 *
 *   paid     OpenAI, Anthropic, Stability, Replicate, fal, Runware, Pollinations: the plan from `resources.mjs`
 *            plus an alert threshold per provider (Replicate, OpenAI, Anthropic and fal default to $5:
 *            auto-reload is off, Replicate runs dry first)
 *   infra    Alchemy, Solana RPC, Base RPC, Irys, Telegram bot, local GPU: no balance to top up, so they
 *            show whether they are configured plus a free-text note (quota usage, plan, remarks)
 *
 * Alerts: `node src/platform/resource-catalog.mjs --alerts [--dry]` (host cron, every 6 hours) sends one
 * Telegram message when a known balance is at or below its threshold, and repeats at most every
 * RESOURCE_ALERT_REPEAT_HOURS (24) until the balance recovers.
 */
import { pathToFileURL } from "node:url";
import { openDb, nowIso } from "./db.mjs";
import { resourcePlan } from "./resources.mjs";
import { stabilityBalance } from "./providers.mjs";
import { getTelegramConfig, sendTelegramNotification } from "../notifications.mjs";

const HOUR_MS = 3_600_000;

/** Built-in thresholds ($). A stored row (even "off") overrides them. */
export const DEFAULT_ALERT_USD = { replicate: 5, openai: 5, anthropic: 5, fal: 5 };

export const INFRA = [
  { id: "alchemy", name: "Alchemy", kind: "quota", url: "https://dashboard.alchemy.com/settings/billing", env: ["ALCHEMY_API_KEY"] },
  { id: "solana", name: "Solana RPC", kind: "rpc", url: "https://solana.com", env: ["SOLANA_RPC_URL", "ALCHEMY_API_KEY"], publicDefault: true },
  { id: "base", name: "Base RPC", kind: "rpc", url: "https://www.base.org", env: ["BASE_RPC_URL"], publicDefault: true },
  { id: "irys", name: "Irys (Arweave)", kind: "wallet", url: "https://irys.xyz", env: ["IRYS_PRIVATE_KEY"] },
  { id: "telegram", name: "Telegram-бот", kind: "bot", url: "https://t.me/BotFather", env: ["SERIES_TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_TOKEN"] },
  { id: "localgpu", name: "Локальний GPU (ComfyUI / A1111)", kind: "local", url: "", env: ["COMFYUI_URL", "A1111_URL", "COMFYUI_ENABLED", "A1111_ENABLED"] },
];

const PAID_IDS = ["openai", "anthropic", "stability", "replicate", "fal", "runware", "pollinations"];
const ALL_IDS = new Set([...PAID_IDS, ...INFRA.map((x) => x.id)]);

function has(env, key) {
  return Boolean(String(env[key] || "").trim());
}

function alertRows(db) {
  return Object.fromEntries(db.prepare("SELECT provider, below_usd, last_alert_at FROM resource_alerts").all().map((r) => [r.provider, r]));
}

function noteRows(db) {
  return Object.fromEntries(db.prepare("SELECT provider, note, updated_at FROM resource_notes").all().map((r) => [r.provider, r]));
}

/** Effective threshold: stored (number or null = off) beats the built-in default. */
export function effectiveThreshold(provider, rows) {
  const r = rows[provider];
  if (r) return { below_usd: r.below_usd, source: r.below_usd == null ? "off" : "custom" };
  if (DEFAULT_ALERT_USD[provider] != null) return { below_usd: DEFAULT_ALERT_USD[provider], source: "default" };
  return { below_usd: null, source: "off" };
}

export function setAlertThreshold(provider, belowUsd, { db = openDb() } = {}) {
  const id = String(provider || "").trim().toLowerCase();
  if (!PAID_IDS.includes(id)) throw Object.assign(new Error("unknown provider"), { status: 400 });
  let v = null;
  if (belowUsd !== null && belowUsd !== undefined && belowUsd !== "") {
    v = Number(belowUsd);
    if (!Number.isFinite(v) || v < 0 || v > 1_000_000) throw Object.assign(new Error("below_usd must be a number from 0"), { status: 400 });
    v = Math.round(v * 100) / 100;
  }
  db.prepare(
    "INSERT INTO resource_alerts (provider, below_usd, last_alert_at) VALUES (?, ?, NULL) ON CONFLICT(provider) DO UPDATE SET below_usd = excluded.below_usd, last_alert_at = NULL",
  ).run(id, v);
  return { provider: id, below_usd: v };
}

export function setResourceNote(provider, note, { db = openDb() } = {}) {
  const id = String(provider || "").trim().toLowerCase();
  if (!ALL_IDS.has(id)) throw Object.assign(new Error("unknown provider"), { status: 400 });
  const text = String(note ?? "").trim().slice(0, 300);
  if (!text) {
    db.prepare("DELETE FROM resource_notes WHERE provider = ?").run(id);
    return { provider: id, note: "" };
  }
  db.prepare(
    "INSERT INTO resource_notes (provider, note, updated_at) VALUES (?, ?, ?) ON CONFLICT(provider) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at",
  ).run(id, text, nowIso());
  return { provider: id, note: text };
}

function infraConfigured(item, env) {
  if (item.id === "telegram") return getTelegramConfig(env).configured;
  if (item.id === "localgpu") return item.env.some((k) => has(env, k) && (k.endsWith("_ENABLED") ? env[k] === "1" : true));
  if (item.publicDefault) return true; // works through a public endpoint even without a key
  return item.env.some((k) => has(env, k));
}

/** The whole tab: plan for the paid providers (with alerts and notes) plus the infrastructure services. */
export function resourceCatalog({ db = openDb(), env = process.env, now = new Date(), live = {} } = {}) {
  const plan = resourcePlan({ db, env, now, live });
  const alerts = alertRows(db);
  const notes = noteRows(db);
  const providers = plan.providers.map((p) => {
    const th = effectiveThreshold(p.id, alerts);
    const triggered = th.below_usd != null && p.balance_usd != null && p.balance_usd <= th.below_usd;
    const n = notes[p.id];
    return {
      ...p,
      kind: "paid",
      alert_below_usd: th.below_usd,
      alert_source: th.source,
      alert_triggered: triggered,
      last_alert_at: alerts[p.id]?.last_alert_at || null,
      note: n ? n.note : "",
      note_updated_at: n ? n.updated_at : null,
    };
  });
  const infra = INFRA.map((x) => {
    const n = notes[x.id];
    const on = infraConfigured(x, env);
    return {
      id: x.id,
      name: x.name,
      kind: x.kind,
      url: x.url,
      configured: on,
      public_default: Boolean(x.publicDefault) && !x.env.some((k) => has(env, k)),
      status: on ? "ok" : "off",
      note: n ? n.note : "",
      note_updated_at: n ? n.updated_at : null,
    };
  });
  return { ...plan, providers, infra };
}

export function formatAlertText(p) {
  const rec = p.recommended_usd > 0 ? ` (рекомендовано тримати $${p.recommended_usd})` : "";
  return `⚠️ Series Lab · ресурси\n${p.name}: баланс $${p.balance_usd} не вищий за поріг $${p.alert_below_usd}${rec}. Поповніть і оновіть баланс у Адмін → Ресурси.`;
}

/**
 * Sends (at most one message per provider per repeat window) for balances at or below their threshold.
 * `send` is injectable for tests; it must resolve to { ok }.
 */
export async function checkAlerts({ db = openDb(), env = process.env, now = new Date(), live = {}, send, dry = false } = {}) {
  const repeatMs = Math.max(1, Number.parseFloat(env.RESOURCE_ALERT_REPEAT_HOURS || "24") || 24) * HOUR_MS;
  const cat = resourceCatalog({ db, env, now, live });
  const tg = getTelegramConfig(env);
  const sender = send || (async (text) => (tg.configured ? sendTelegramNotification({ botToken: tg.botToken, chatId: tg.chatId, text, parseMode: null }) : { ok: false, message: "telegram not configured" }));
  const out = { triggered: [], sent: [], skipped: [], failed: [] };
  for (const p of cat.providers) {
    if (!p.alert_triggered) {
      // recovered: forget the last alert so the next crossing alerts at once
      if (p.last_alert_at && !dry) db.prepare("UPDATE resource_alerts SET last_alert_at = NULL WHERE provider = ?").run(p.id);
      continue;
    }
    out.triggered.push(p.id);
    const last = p.last_alert_at ? Date.parse(p.last_alert_at) : 0;
    if (last && now.getTime() - last < repeatMs) {
      out.skipped.push(p.id);
      continue;
    }
    if (dry) continue;
    const res = await sender(formatAlertText(p));
    if (res?.ok) {
      db.prepare(
        "INSERT INTO resource_alerts (provider, below_usd, last_alert_at) VALUES (?, ?, ?) ON CONFLICT(provider) DO UPDATE SET last_alert_at = excluded.last_alert_at",
      ).run(p.id, p.alert_below_usd, nowIso(now));
      out.sent.push(p.id);
    } else {
      out.failed.push(`${p.id}: ${res?.error || res?.message || "send failed"}`);
    }
  }
  return out;
}

async function main(argv = process.argv.slice(2), env = process.env) {
  if (!argv.includes("--alerts")) {
    console.log(JSON.stringify(resourceCatalog({ env }).providers.map((p) => ({ id: p.id, balance_usd: p.balance_usd, alert_below_usd: p.alert_below_usd, triggered: p.alert_triggered })), null, 2));
    return 0;
  }
  const live = {};
  if (String(env.STABILITY_API_KEY || "").trim()) {
    const credits = await stabilityBalance();
    if (credits != null) live.stability = Math.round(credits * 0.01 * 100) / 100;
  }
  const res = await checkAlerts({ env, live, dry: argv.includes("--dry") });
  console.log(JSON.stringify(res));
  return res.failed.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code), (e) => {
    console.error(`[resources] ${e.message}`);
    process.exit(1);
  });
}
