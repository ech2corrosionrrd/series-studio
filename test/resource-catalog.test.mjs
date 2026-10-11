import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "series-catalog-"));
process.env.USERS_DB_PATH = join(dir, "users.db");
process.env.SERIES_DATA_DIR = dir;
process.env.AUTH_SESSION_SECRET = "catalog-test";

const { closeAll, openDb } = await import("../src/platform/db.mjs");
const { setManualBalance } = await import("../src/platform/resources.mjs");
const cat = await import("../src/platform/resource-catalog.mjs");

const NOW = new Date("2026-10-20T12:00:00Z");
const hoursLater = (h) => new Date(NOW.getTime() + h * 3_600_000);
const ENV = { REPLICATE_API_TOKEN: "x", OPENAI_API_KEY: "x", ALCHEMY_API_KEY: "x" };

after(() => {
  closeAll();
  rmSync(dir, { recursive: true, force: true });
});

const replicate = (c) => c.providers.find((p) => p.id === "replicate");

describe("resource catalog: thresholds", () => {
  test("Replicate, OpenAI, Anthropic, fal and Stability have a built-in $5 threshold, others have none", () => {
    const db = openDb(join(dir, "users.db"));
    const c = cat.resourceCatalog({ db, env: ENV, now: NOW });
    assert.equal(replicate(c).alert_below_usd, 5);
    assert.equal(replicate(c).alert_source, "default");
    assert.equal(replicate(c).alert_triggered, false, "no balance entered, so nothing to compare");
    for (const id of ["openai", "anthropic", "fal"]) {
      const p = c.providers.find((x) => x.id === id);
      assert.equal(p.alert_below_usd, 5, id);
      assert.equal(p.alert_source, "default", id);
    }
    const stability = c.providers.find((p) => p.id === "stability");
    assert.equal(stability.alert_below_usd, 5);
    assert.equal(stability.alert_source, "default");
    for (const id of ["runware", "pollinations"]) {
      const p = c.providers.find((x) => x.id === id);
      assert.equal(p.alert_below_usd, null, id);
      assert.equal(p.alert_source, "off", id);
    }
  });

  test("triggers at or below the threshold only when a balance is known", () => {
    const db = openDb(join(dir, "users.db"));
    setManualBalance("replicate", 6.66, { db });
    assert.equal(replicate(cat.resourceCatalog({ db, env: ENV, now: NOW })).alert_triggered, false);
    setManualBalance("replicate", 5, { db });
    assert.equal(replicate(cat.resourceCatalog({ db, env: ENV, now: NOW })).alert_triggered, true, "equal counts");
    setManualBalance("replicate", 4.2, { db });
    assert.equal(replicate(cat.resourceCatalog({ db, env: ENV, now: NOW })).alert_triggered, true);
  });

  test("custom threshold, switching off, validation", () => {
    const db = openDb(join(dir, "users.db"));
    assert.deepEqual(cat.setAlertThreshold("openai", 12, { db }), { provider: "openai", below_usd: 12 });
    setManualBalance("openai", 10, { db });
    let c = cat.resourceCatalog({ db, env: ENV, now: NOW });
    assert.equal(c.providers.find((p) => p.id === "openai").alert_triggered, true);
    assert.equal(c.providers.find((p) => p.id === "openai").alert_source, "custom");
    cat.setAlertThreshold("replicate", null, { db }); // switched off on purpose: beats the default
    c = cat.resourceCatalog({ db, env: ENV, now: NOW });
    assert.equal(replicate(c).alert_below_usd, null);
    assert.equal(replicate(c).alert_source, "off");
    assert.equal(replicate(c).alert_triggered, false);
    assert.throws(() => cat.setAlertThreshold("nope", 5, { db }), /unknown provider/);
    assert.throws(() => cat.setAlertThreshold("fal", -1, { db }), /below_usd/);
    assert.throws(() => cat.setAlertThreshold("fal", "abc", { db }), /below_usd/);
    cat.setAlertThreshold("replicate", 5, { db });
    cat.setAlertThreshold("openai", null, { db });
  });
});

describe("resource catalog: alerts are sent once and repeat only after the window", () => {
  test("send, skip inside the window, repeat after it, reset when recovered", async () => {
    const db = openDb(join(dir, "users.db"));
    setManualBalance("replicate", 4.2, { db });
    const sent = [];
    const send = async (text) => {
      sent.push(text);
      return { ok: true };
    };
    const first = await cat.checkAlerts({ db, env: ENV, now: NOW, send });
    assert.deepEqual(first.sent, ["replicate"]);
    assert.match(sent[0], /Replicate: баланс \$4\.2 не вищий за поріг \$5/);
    assert.match(sent[0], /Адмін → Ресурси/);

    const again = await cat.checkAlerts({ db, env: ENV, now: hoursLater(6), send });
    assert.deepEqual(again.sent, []);
    assert.deepEqual(again.skipped, ["replicate"], "inside the 24 h window");

    const later = await cat.checkAlerts({ db, env: ENV, now: hoursLater(25), send });
    assert.deepEqual(later.sent, ["replicate"], "repeats after the window while still low");

    setManualBalance("replicate", 20, { db });
    const recovered = await cat.checkAlerts({ db, env: ENV, now: hoursLater(26), send });
    assert.deepEqual(recovered.triggered, []);
    setManualBalance("replicate", 3, { db });
    const crossed = await cat.checkAlerts({ db, env: ENV, now: hoursLater(27), send });
    assert.deepEqual(crossed.sent, ["replicate"], "a fresh crossing alerts at once after a recovery");
    assert.equal(sent.length, 3);
  });

  test("a failed send is reported and retried next time; dry run sends nothing", async () => {
    const db = openDb(join(dir, "users.db"));
    setManualBalance("replicate", 1, { db });
    db.prepare("UPDATE resource_alerts SET last_alert_at = NULL WHERE provider = 'replicate'").run();
    const bad = await cat.checkAlerts({ db, env: ENV, now: NOW, send: async () => ({ ok: false, error: "no network" }) });
    assert.deepEqual(bad.sent, []);
    assert.match(bad.failed[0], /replicate: no network/);
    const dry = await cat.checkAlerts({ db, env: ENV, now: NOW, dry: true, send: async () => assert.fail("dry run must not send") });
    assert.deepEqual(dry.triggered, ["replicate"]);
    const ok = await cat.checkAlerts({ db, env: ENV, now: NOW, send: async () => ({ ok: true }) });
    assert.deepEqual(ok.sent, ["replicate"], "the failed attempt did not mark it as alerted");
  });

  test("without Telegram configured nothing is sent and the failure is explained", async () => {
    const db = openDb(join(dir, "users.db"));
    db.prepare("UPDATE resource_alerts SET last_alert_at = NULL WHERE provider = 'replicate'").run();
    const res = await cat.checkAlerts({ db, env: { ...ENV, SERIES_TELEGRAM_BOT_TOKEN: "", TELEGRAM_BOT_TOKEN: "" }, now: NOW });
    assert.deepEqual(res.sent, []);
    assert.match(res.failed[0], /telegram not configured/);
  });
});

describe("resource catalog: reminder for stale hand-typed balances", () => {
  test("one reminder per window for stale balances with a threshold; none for fresh, off or live ones", async () => {
    const db = openDb(join(dir, "users.db"));
    cat.setAlertThreshold("openai", 5, { db }); // an earlier test switched it off on purpose
    db.prepare("UPDATE resource_alerts SET last_alert_at = NULL WHERE provider = '_stale_balances'").run();
    setManualBalance("openai", 30, { db });
    setManualBalance("replicate", 30, { db });
    // typed 20 days before NOW; the default staleness is 14 days
    db.prepare("UPDATE resource_balances SET updated_at = ? WHERE provider = 'openai'").run(new Date(NOW.getTime() - 20 * 86_400_000).toISOString());
    db.prepare("UPDATE resource_balances SET updated_at = ? WHERE provider = 'replicate'").run(new Date(NOW.getTime() - 2 * 86_400_000).toISOString());
    const sent = [];
    const send = async (text) => {
      sent.push(text);
      return { ok: true };
    };
    const first = await cat.checkAlerts({ db, env: ENV, now: NOW, send });
    assert.deepEqual(first.stale, ["openai"], "replicate is fresh");
    assert.equal(first.staleReminded, true);
    assert.equal(sent.length, 1);
    assert.match(sent[0], /OpenAI \(20 дн\.\)/);
    assert.doesNotMatch(sent[0], /Replicate/);
    assert.match(sent[0], /Адмін → Ресурси/);

    const inside = await cat.checkAlerts({ db, env: ENV, now: hoursLater(24), send });
    assert.equal(inside.staleReminded, false, "inside the 7-day window");
    assert.equal(sent.length, 1);

    const dry = await cat.checkAlerts({ db, env: ENV, now: hoursLater(24 * 8), dry: true, send: async () => assert.fail("dry run must not send") });
    assert.deepEqual(dry.stale, ["openai"]);

    const after = await cat.checkAlerts({ db, env: ENV, now: hoursLater(24 * 8), send });
    assert.equal(after.staleReminded, true, "reminds again after the window while still stale");
    assert.equal(sent.length, 2);

    // a threshold switched off means nothing depends on the number: no reminder
    cat.setAlertThreshold("openai", null, { db });
    db.prepare("UPDATE resource_alerts SET last_alert_at = NULL WHERE provider = '_stale_balances'").run();
    const off = await cat.checkAlerts({ db, env: ENV, now: hoursLater(24 * 9), send });
    assert.deepEqual(off.stale, []);
    assert.equal(sent.length, 2);
    cat.setAlertThreshold("openai", 5, { db });
    // typing a fresh balance ends the reminders
    setManualBalance("openai", 30, { db });
    const fresh = await cat.checkAlerts({ db, env: ENV, now: new Date(Date.now() + 3_600_000), send });
    assert.deepEqual(fresh.stale, []);
  });

  test("a failed send is reported and not marked as reminded", async () => {
    const db = openDb(join(dir, "users.db"));
    db.prepare("UPDATE resource_alerts SET last_alert_at = NULL WHERE provider = '_stale_balances'").run();
    db.prepare("UPDATE resource_balances SET updated_at = ? WHERE provider = 'openai'").run(new Date(NOW.getTime() - 20 * 86_400_000).toISOString());
    const bad = await cat.checkAlerts({ db, env: ENV, now: NOW, send: async () => ({ ok: false, error: "no network" }) });
    assert.equal(bad.staleReminded, false);
    assert.match(bad.failed.join(" "), /stale balances: no network/);
    const ok = await cat.checkAlerts({ db, env: ENV, now: NOW, send: async () => ({ ok: true }) });
    assert.equal(ok.staleReminded, true);
  });
});

describe("resource catalog: services without a balance", () => {
  test("lists every infrastructure service with its configuration state", () => {
    const db = openDb(join(dir, "users.db"));
    const c = cat.resourceCatalog({ db, env: { ALCHEMY_API_KEY: "x" }, now: NOW });
    assert.deepEqual(c.infra.map((x) => x.id), ["alchemy", "solana", "base", "irys", "telegram", "localgpu"]);
    const by = Object.fromEntries(c.infra.map((x) => [x.id, x]));
    assert.equal(by.alchemy.status, "ok");
    assert.equal(by.solana.status, "ok", "works through a public endpoint");
    assert.equal(by.base.public_default, true);
    assert.equal(by.irys.status, "off", "no server key");
    assert.equal(by.telegram.status, "off");
    assert.equal(by.localgpu.status, "off");
    const on = cat.resourceCatalog({ db, env: { IRYS_PRIVATE_KEY: "x", COMFYUI_ENABLED: "1", SERIES_TELEGRAM_BOT_TOKEN: "t", SERIES_TELEGRAM_CHAT_ID: "c", BASE_RPC_URL: "https://x" }, now: NOW });
    const byOn = Object.fromEntries(on.infra.map((x) => [x.id, x]));
    assert.equal(byOn.irys.status, "ok");
    assert.equal(byOn.localgpu.status, "ok");
    assert.equal(byOn.telegram.status, "ok");
    assert.equal(byOn.base.public_default, false);
  });

  test("notes are saved, shown for paid and infra services, trimmed and cleared", () => {
    const db = openDb(join(dir, "users.db"));
    assert.deepEqual(cat.setResourceNote("alchemy", "  Free: 0,93M / 30M CU  ", { db }), { provider: "alchemy", note: "Free: 0,93M / 30M CU" });
    cat.setResourceNote("replicate", "авто-поповнення не налаштовано", { db });
    const c = cat.resourceCatalog({ db, env: ENV, now: NOW });
    assert.equal(c.infra.find((x) => x.id === "alchemy").note, "Free: 0,93M / 30M CU");
    assert.ok(c.infra.find((x) => x.id === "alchemy").note_updated_at);
    assert.equal(replicate(c).note, "авто-поповнення не налаштовано");
    assert.equal(cat.setResourceNote("alchemy", "x".repeat(500), { db }).note.length, 300);
    assert.deepEqual(cat.setResourceNote("alchemy", "", { db }), { provider: "alchemy", note: "" });
    assert.equal(cat.resourceCatalog({ db, env: ENV, now: NOW }).infra.find((x) => x.id === "alchemy").note, "");
    assert.throws(() => cat.setResourceNote("nope", "x", { db }), /unknown provider/);
  });
});
