/**
 * Batch Generation Notifications & Webhook Dispatcher.
 * Telegram messages are branded as Series Lab (own bot via SERIES_TELEGRAM_* or TELEGRAM_*).
 */

export const PROJECT_TG_NAME = "Series Lab";

/**
 * Prefer Lab-specific Telegram credentials so Promt's bot is never implied.
 * SERIES_TELEGRAM_* → TELEGRAM_* → legacy aliases.
 */
export function getTelegramConfig(env = process.env) {
  const botToken = String(
    env.SERIES_TELEGRAM_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_TOKEN || "",
  ).trim();
  const chatId = String(
    env.SERIES_TELEGRAM_CHAT_ID || env.TELEGRAM_CHAT_ID || env.TELEGRAM_ADMIN_CHAT_ID || "",
  ).trim();
  const configured = Boolean(botToken && chatId);
  return {
    configured,
    botToken: configured ? botToken : undefined,
    chatId: configured ? chatId : undefined,
    source: env.SERIES_TELEGRAM_BOT_TOKEN
      ? "SERIES_TELEGRAM_*"
      : env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_TOKEN
        ? "TELEGRAM_*"
        : null,
  };
}

/** Prefix operator/batch text with Series Lab identity (idempotent). */
export function brandOperatorText(text, project = PROJECT_TG_NAME) {
  const body = String(text || "").trim();
  if (!body) return `*${project}*`;
  if (body.includes(project) || body.startsWith("🎨 *Series Lab") || body.startsWith("🔔 *Series Lab")) {
    return body;
  }
  return `🔔 *${project}*\n${body}`;
}

/**
 * Formats a clean, readable text summary for completed batch render / triage.
 */
export function formatBatchSummary(info = {}) {
  const name = info.presetName || info.presetId || "Series Collection";
  const total = Number(info.total || 0);
  const success = Number(info.success ?? total);
  const failed = Number(info.failed ?? 0);
  const durationSec = info.durationMs ? (info.durationMs / 1000).toFixed(1) : null;

  const lines = [
    `🎨 *${PROJECT_TG_NAME} — Генерація завершена!*`,
    `📁 Серія: *${name}*`,
    `📊 Всього токенів: *${total}* (✅ Успішно: ${success}${failed > 0 ? `, ❌ Помилок: ${failed}` : ""})`,
  ];

  if (durationSec) {
    lines.push(`⏱ Час рендерингу: ${durationSec}с`);
  }

  if (info.triage) {
    const keep = info.triage.keep ?? 0;
    const redo = info.triage.redo ?? 0;
    const score = info.triage.avgScore ? Number(info.triage.avgScore).toFixed(1) : null;
    lines.push(
      `🤖 *AI Auto-Triage*: 🟢 Keep: ${keep} | 🔴 Redo: ${redo}${score ? ` | ⭐ Сер. бал: ${score}/10` : ""}`,
    );
  }

  if (info.provenanceHash) {
    lines.push(`🔐 Provenance: \`${info.provenanceHash.slice(0, 16)}...\``);
  }

  if (info.outputDir) {
    lines.push(`💾 Папка: \`${info.outputDir}\``);
  }

  return lines.join("\n");
}

/**
 * Sends a message via Telegram Bot API.
 * Gracefully resolves without crashing if keys are missing or network fails.
 */
export async function sendTelegramNotification(params = {}) {
  const { botToken, chatId, text, parseMode = "Markdown" } = params;

  if (!botToken || !chatId || !text) {
    return { ok: false, error: "Missing required parameters: botToken, chatId, or text" };
  }

  const cleanToken = String(botToken).trim();
  const cleanChatId = String(chatId).trim();
  const url = `https://api.telegram.org/bot${cleanToken}/sendMessage`;
  const payload = {
    chat_id: cleanChatId,
    text,
  };
  if (parseMode) payload.parse_mode = parseMode;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      return { ok: false, error: data?.description || `HTTP ${res.status}` };
    }

    return { ok: true, result: data.result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * High-level dispatcher: sends notification if Telegram is configured.
 */
export async function dispatchBatchNotification(batchInfo = {}, env = process.env) {
  const config = getTelegramConfig(env);
  if (!config.configured) {
    return { sent: false, error: "Telegram notifications not configured (set SERIES_TELEGRAM_BOT_TOKEN + SERIES_TELEGRAM_CHAT_ID)" };
  }

  const text = formatBatchSummary(batchInfo);
  const result = await sendTelegramNotification({
    botToken: config.botToken,
    chatId: config.chatId,
    text,
  });

  return {
    sent: result.ok,
    error: result.error,
  };
}

/** Admin test ping branded as Series Lab. */
export async function sendTelegramTest(env = process.env) {
  const config = getTelegramConfig(env);
  if (!config.configured) {
    return { ok: false, error: "not_configured", configured: false };
  }
  // Plain text — avoid Markdown parse errors on underscores in SERIES_TELEGRAM_*.
  const text = [
    `🔔 ${PROJECT_TG_NAME}`,
    `Тестове сповіщення · ${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC`,
    `Джерело ключів: ${config.source || "TELEGRAM"}`,
  ].join("\n");
  const result = await sendTelegramNotification({
    botToken: config.botToken,
    chatId: config.chatId,
    text,
    parseMode: null,
  });
  return { ...result, configured: true, source: config.source };
}
