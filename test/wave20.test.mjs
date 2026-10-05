import test from "node:test";
import assert from "node:assert/strict";
import {
  formatBatchSummary,
  sendTelegramNotification,
  getTelegramConfig,
  dispatchBatchNotification,
  brandOperatorText,
} from "../src/notifications.mjs";

test("Wave 20: formatBatchSummary formats informative markdown message", (t) => {
  const summary = formatBatchSummary({
    presetId: "cyber-gremlins",
    presetName: "Cyber Gremlins Series",
    total: 24,
    success: 24,
    failed: 0,
    durationMs: 45200,
    triage: {
      keep: 22,
      redo: 2,
      avgScore: 8.7,
    },
    provenanceHash: "abcdef1234567890abcdef1234567890",
    outputDir: "out/cyber-gremlins-s0.45",
  });

  assert.ok(summary.includes("Cyber Gremlins Series"));
  assert.ok(summary.includes("Series Lab"));
  assert.ok(summary.includes("24"));
  assert.ok(summary.includes("45.2с"));
  assert.ok(summary.includes("Keep: 22"));
  assert.ok(summary.includes("Redo: 2"));
  assert.ok(summary.includes("8.7/10"));
  assert.ok(summary.includes("abcdef1234567890"));
  assert.ok(summary.includes("out/cyber-gremlins-s0.45"));
});

test("Wave 20: getTelegramConfig detects presence of credentials", (t) => {
  const emptyConf = getTelegramConfig({});
  assert.equal(emptyConf.configured, false);
  assert.equal(emptyConf.botToken, undefined);

  const filledConf = getTelegramConfig({
    TELEGRAM_BOT_TOKEN: "123:ABC",
    TELEGRAM_CHAT_ID: "998877",
  });
  assert.equal(filledConf.configured, true);
  assert.equal(filledConf.botToken, "123:ABC");
  assert.equal(filledConf.chatId, "998877");
  assert.equal(filledConf.source, "TELEGRAM_*");

  const seriesWins = getTelegramConfig({
    SERIES_TELEGRAM_BOT_TOKEN: "lab:TOK",
    SERIES_TELEGRAM_CHAT_ID: "-1001",
    TELEGRAM_BOT_TOKEN: "lab:TOK",
    TELEGRAM_CHAT_ID: "999",
  });
  assert.equal(seriesWins.botToken, "lab:TOK");
  assert.equal(seriesWins.chatId, "-1001");
  assert.equal(seriesWins.source, "SERIES_TELEGRAM_*");
});

test("Wave 20: brandOperatorText prefixes Series Lab once", () => {
  const branded = brandOperatorText("hello");
  assert.ok(branded.startsWith("🔔 *Series Lab*"));
  assert.ok(branded.includes("hello"));
  const again = brandOperatorText(branded);
  assert.equal(again, branded);
});

test("Wave 20: sendTelegramNotification returns error for missing parameters", async (t) => {
  const resNoToken = await sendTelegramNotification({ chatId: "123", text: "hi" });
  assert.equal(resNoToken.ok, false);
  assert.ok(resNoToken.error.includes("Missing required parameters"));

  const resNoChat = await sendTelegramNotification({ botToken: "tok", text: "hi" });
  assert.equal(resNoChat.ok, false);
  assert.ok(resNoChat.error.includes("Missing required parameters"));
});

test("Wave 20: dispatchBatchNotification skips gracefully when unconfigured", async (t) => {
  const res = await dispatchBatchNotification({ presetName: "Test" }, {});
  assert.equal(res.sent, false);
  assert.ok(res.error.includes("not configured"));
});
