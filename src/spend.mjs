/**
 * Render log + daily spend cap.
 *
 *   out/render-log.jsonl — one JSON line per paid call attempt:
 *     { at, source, kind, engine, set?, edition?, v?, ok, costUsd, seed?, error? }
 *
 * The cap is a local safety net: a runaway batch (or a forgotten "force")
 * cannot spend more than SERIES_SPEND_CAP_USD per calendar day (local time).
 * Adapted from gremlin-nft src/spend.mjs + render-log.jsonl.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

/** Cap in USD from env value, or null (no cap). "", "off", "0" → no cap. */
export function spendCap(envValue) {
  const v = String(envValue ?? "").trim().toLowerCase();
  if (v === "" || v === "off") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`SERIES_SPEND_CAP_USD: expected a number or "off", got "${envValue}"`);
  }
  return n === 0 ? null : n;
}

export function localDay(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function appendRenderLog(file, entry, now = new Date()) {
  mkdirSync(dirname(file), { recursive: true });
  const line = { at: now.toISOString(), ...entry };
  appendFileSync(file, JSON.stringify(line) + "\n", "utf8");
  return line;
}

export function readRenderLog(file) {
  if (!existsSync(file)) return [];
  const out = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip torn line */ }
  }
  return out;
}

/** Sum of costUsd for successful calls on the same local day as `now`. */
export function spentToday(file, now = new Date()) {
  const day = localDay(now);
  let usd = 0;
  for (const e of readRenderLog(file)) {
    if (e.ok && localDay(new Date(e.at)) === day) usd += Number(e.costUsd) || 0;
  }
  return Math.round(usd * 1000) / 1000;
}

/** Spend per engine for today (for Resources / estimate views). */
export function spendByEngineToday(file, now = new Date()) {
  const day = localDay(now);
  const by = {};
  for (const e of readRenderLog(file)) {
    if (!e.ok || localDay(new Date(e.at)) !== day) continue;
    const k = e.engine || "unknown";
    by[k] = Math.round(((by[k] || 0) + (Number(e.costUsd) || 0)) * 1000) / 1000;
  }
  return by;
}

/** Refusal text, or null when the run fits under the cap. */
export function capError({ cap, spent, planned }) {
  if (cap === null || cap === undefined || planned === 0) return null;
  if (planned === null || planned === undefined || !Number.isFinite(planned)) {
    return "Cannot estimate the cost of this run — refused because a daily spend cap is set.";
  }
  if (spent + planned <= cap + 1e-9) return null;
  const left = Math.max(0, cap - spent);
  return `Daily spend cap $${cap.toFixed(2)}: today ≈ $${spent.toFixed(2)} spent, this run ≈ $${planned.toFixed(2)}, ` +
    `$${left.toFixed(2)} left. Reduce the selection, wait until tomorrow, or raise SERIES_SPEND_CAP_USD.`;
}
