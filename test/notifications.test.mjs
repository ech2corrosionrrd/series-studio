import test from "node:test";
import assert from "node:assert/strict";
import {
  brandOperatorText, dispatchBatchNotification, formatBatchSummary, getTelegramConfig,
  sendTelegramNotification, sendTelegramTest,
} from "../src/notifications.mjs";

const FAKE = { SERIES_TELEGRAM_BOT_TOKEN: "111:fake", SERIES_TELEGRAM_CHAT_ID: "42" };

/** Replace global fetch for one test; never reaches the real Telegram API. */
async function withFetch(impl, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return impl(url, init); };
  try { return await fn(calls); } finally { globalThis.fetch = real; }
}
const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

test("telegram config: Lab keys win, legacy aliases work, partial config is not configured", () => {
  assert.equal(getTelegramConfig({}).configured, false);
  assert.equal(getTelegramConfig({ SERIES_TELEGRAM_BOT_TOKEN: "t" }).configured, false);
  const lab = getTelegramConfig({ ...FAKE, TELEGRAM_BOT_TOKEN: "other", TELEGRAM_CHAT_ID: "9" });
  assert.equal(lab.source, "SERIES_TELEGRAM_*");
  assert.equal(lab.botToken, "111:fake");
  const legacy = getTelegramConfig({ TELEGRAM_TOKEN: "t2", TELEGRAM_ADMIN_CHAT_ID: "7" });
  assert.deepEqual([legacy.configured, legacy.source, legacy.chatId], [true, "TELEGRAM_*", "7"]);
});

test("brandOperatorText: prefixes once and handles empty text", () => {
  assert.equal(brandOperatorText(""), "*Series Lab*");
  const once = brandOperatorText("done");
  assert.equal(once, "🔔 *Series Lab*\ndone");
  assert.equal(brandOperatorText(once), once);
});

test("formatBatchSummary: counts, duration, triage, provenance and folder", () => {
  const text = formatBatchSummary({
    presetName: "Frogs", total: 10, success: 8, failed: 2, durationMs: 12_340,
    triage: { keep: 6, redo: 2, avgScore: 7.25 }, provenanceHash: "a".repeat(64), outputDir: "out/frogs",
  });
  for (const part of ["Frogs", "*10*", "✅ Успішно: 8", "❌ Помилок: 2", "12.3с", "Keep: 6", "Redo: 2", "7.3/10", "a".repeat(16), "out/frogs"]) {
    assert.ok(text.includes(part), part);
  }
  const bare = formatBatchSummary();
  assert.ok(bare.includes("Series Collection") && !bare.includes("Помилок") && !bare.includes("Provenance"));
});

test("sendTelegramNotification: missing params, success, API error, network error", async () => {
  assert.equal((await sendTelegramNotification({ botToken: "t" })).ok, false);
  await withFetch(() => reply({ ok: true, result: { message_id: 1 } }), async (calls) => {
    const r = await sendTelegramNotification({ botToken: " 111:fake ", chatId: "42", text: "hi" });
    assert.deepEqual([r.ok, r.result.message_id], [true, 1]);
    assert.equal(calls[0].url, "https://api.telegram.org/bot111:fake/sendMessage");
    assert.equal(JSON.parse(calls[0].init.body).parse_mode, "Markdown");
  });
  await withFetch(() => reply({ ok: false, description: "chat not found" }, 400), async () => {
    assert.equal((await sendTelegramNotification({ botToken: "t", chatId: "1", text: "x" })).error, "chat not found");
  });
  await withFetch(() => { throw new Error("offline"); }, async () => {
    assert.equal((await sendTelegramNotification({ botToken: "t", chatId: "1", text: "x" })).error, "offline");
  });
  await withFetch(() => ({ ok: false, status: 502, json: async () => { throw new Error("bad json"); } }), async () => {
    assert.equal((await sendTelegramNotification({ botToken: "t", chatId: "1", text: "x" })).error, "HTTP 502");
  });
});

test("dispatchBatchNotification: not configured makes no request, configured sends the summary", async () => {
  await withFetch(() => reply({ ok: true }), async (calls) => {
    const none = await dispatchBatchNotification({ total: 1 }, {});
    assert.equal(none.sent, false);
    assert.match(none.error, /not configured/);
    assert.equal(calls.length, 0);
    const sent = await dispatchBatchNotification({ presetName: "P", total: 3 }, FAKE);
    assert.equal(sent.sent, true);
    assert.ok(JSON.parse(calls[0].init.body).text.includes("P"));
  });
});

test("sendTelegramTest: plain text ping, no parse_mode", async () => {
  assert.deepEqual(await sendTelegramTest({}), { ok: false, error: "not_configured", configured: false });
  await withFetch(() => reply({ ok: true, result: {} }), async (calls) => {
    const r = await sendTelegramTest(FAKE);
    assert.deepEqual([r.ok, r.configured, r.source], [true, true, "SERIES_TELEGRAM_*"]);
    assert.equal("parse_mode" in JSON.parse(calls[0].init.body), false);
  });
});
