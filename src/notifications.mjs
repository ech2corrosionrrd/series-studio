/**
 * Batch Generation Notifications & Webhook Dispatcher.
 * Handles Telegram bot notifications, webhooks, and summary formatting.
 */

/**
 * Formats a clean, readable text summary for completed batch render / triage.
 * @param {object} info
 * @param {string} [info.presetId]
 * @param {string} [info.presetName]
 * @param {number} [info.total]
 * @param {number} [info.success]
 * @param {number} [info.failed]
 * @param {number} [info.durationMs]
 * @param {object} [info.triage] - { keep: number, redo: number, avgScore: number }
 * @param {string} [info.provenanceHash]
 * @returns {string} Formatted markdown/plain message
 */
export function formatBatchSummary(info = {}) {
  const name = info.presetName || info.presetId || "Series Collection";
  const total = Number(info.total || 0);
  const success = Number(info.success ?? total);
  const failed = Number(info.failed ?? 0);
  const durationSec = info.durationMs ? (info.durationMs / 1000).toFixed(1) : null;

  const lines = [
    `🎨 *Series Lab — Генерація завершена!*`,
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
      `🤖 *AI Auto-Triage*: 🟢 Keep: ${keep} | 🔴 Redo: ${redo}${score ? ` | ⭐ Сер. бал: ${score}/10` : ""}`
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
 *
 * @param {object} params
 * @param {string} params.botToken - Telegram Bot Token (e.g. 123456:ABC-DEF...)
 * @param {string|number} params.chatId - Telegram Chat ID
 * @param {string} params.text - Message text (Markdown supported)
 * @param {string} [params.parseMode='Markdown']
 * @returns {Promise<{ ok: boolean, error?: string, result?: object }>}
 */
export async function sendTelegramNotification(params = {}) {
  const { botToken, chatId, text, parseMode = "Markdown" } = params;

  if (!botToken || !chatId || !text) {
    return { ok: false, error: "Missing required parameters: botToken, chatId, or text" };
  }

  const cleanToken = String(botToken).trim();
  const cleanChatId = String(chatId).trim();
  const url = `https://api.telegram.org/bot${cleanToken}/sendMessage`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: cleanChatId,
        text,
        parse_mode: parseMode,
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.ok) {
      return { ok: false, error: data?.description || `HTTP ${res.status}` };
    }

    return { ok: true, result: data.result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Checks presence of Telegram credentials in environment or keys map.
 * @param {object} [env=process.env]
 * @returns {{ configured: boolean, botToken?: string, chatId?: string }}
 */
export function getTelegramConfig(env = process.env) {
  const botToken = env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_TOKEN || "";
  const chatId = env.TELEGRAM_CHAT_ID || env.TELEGRAM_ADMIN_CHAT_ID || "";
  const configured = Boolean(botToken && chatId);
  return {
    configured,
    botToken: configured ? botToken : undefined,
    chatId: configured ? chatId : undefined,
  };
}

/**
 * High-level dispatcher: sends notification if Telegram is configured.
 * @param {object} batchInfo
 * @param {object} [env=process.env]
 * @returns {Promise<{ sent: boolean, error?: string }>}
 */
export async function dispatchBatchNotification(batchInfo = {}, env = process.env) {
  const config = getTelegramConfig(env);
  if (!config.configured) {
    return { sent: false, error: "Telegram notifications not configured (missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID)" };
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
