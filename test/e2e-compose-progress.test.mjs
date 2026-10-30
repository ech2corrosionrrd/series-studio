// R12 (BETA-REVIEW round 3) in a real browser: "Compose layers" shows its progress, the Stop button stops it between frames
// and says how many frames are done, and a second run finishes the series.
// Mock engine, no keys, 0 credits. Needs a Chrome/Chromium (CHROME_PATH or a standard install); without one the file is skipped.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import JSZip from "jszip";
import { createMockPng } from "../src/mock-image.mjs";
import { newSeriesStarter } from "../server/ui/series-starter.js";
import { startStudio } from "./helpers/studio-server.mjs";

const CHROME = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean).find((p) => existsSync(p)) || null;

const VALUES = ["v1", "v2", "v3", "v4", "v5", "v6"];
const KEYS = ["body", "hat", "prop"];
const SIZE = 150;

describe("compose layers: progress and Stop", { skip: CHROME ? false : "no Chrome/Chromium found (set CHROME_PATH)" }, () => {
  let studio;
  let browser;
  let page;
  const pageErrors = [];
  before(async () => {
    studio = await startStudio({ extraEnv: { WELCOME_CREDITS: "100" } });
    const cookie = await studio.signIn();
    const items = KEYS.map((key) => ({ key, type: key, options: VALUES.map((value) => ({ value, weight: 1, prompt: `${key} ${value}` })) }));
    const preset = {
      ...newSeriesStarter({ id: "cmp", name: "Cmp", seed: "cmp", size: SIZE }),
      promptTemplate: { keep: ["Edit this image of a {who}."], changeKeys: KEYS, extraKeys: [], suffix: "No text." },
      traits: { items },
    };
    await studio.call("POST", "/api/preset/save", { body: { preset } });
    await studio.call("POST", "/api/build", { body: { file: "cmp.json" } });
    const base = createMockPng({ width: 512, height: 512, seed: 9 });
    await studio.call("POST", "/api/base/upload", { body: { filename: "primary.png", role: "primary", data: base.toString("base64") } });
    const zip = new JSZip();
    for (const key of KEYS) VALUES.forEach((v, i) => zip.file(`${key}/${v}.png`, createMockPng({ width: 512, height: 512, seed: i * 31 + key.length })));
    await studio.call("POST", "/api/layers/upload", { body: await zip.generateAsync({ type: "nodebuffer" }), raw: true });

    browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const context = await browser.newContext({ locale: "uk-UA", viewport: { width: 1400, height: 900 } });
    const [name, ...rest] = cookie.split("=");
    await context.addCookies([{ name, value: rest.join("="), url: `http://127.0.0.1:${studio.port}` }]);
    page = await context.newPage();
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.goto(`http://127.0.0.1:${studio.port}/studio/`);
    await page.waitForSelector("#o-name");
    await page.uncheck("#path-beginner");
    await page.click('nav [data-tab="render"]');
    await page.waitForFunction(() => document.querySelectorAll("#g-compose-over option").length >= 1);
  });
  after(async () => {
    await browser?.close();
    await studio?.stop();
  });

  const msg = () => page.textContent("#g-compose-msg").then((s) => (s || "").trim());

  it("shows progress while composing, and Stop ends it with the number of frames done", async () => {
    assert.equal(await page.isHidden("#g-compose-stop"), true, "Stop is not there before a run");
    await page.click("#g-compose");
    await page.waitForFunction(() => /Складено \d+ з 150/.test(document.getElementById("g-compose-msg").textContent), null, { timeout: 30000 });
    assert.equal(await page.isVisible("#g-compose-stop"), true, "Stop appears while composing");
    await page.click("#g-compose-stop");
    await page.waitForFunction(() => /Зупинено: складено \d+ з 150/.test(document.getElementById("g-compose-msg").textContent), null, { timeout: 30000 });
    const done = Number(/складено (\d+) з/.exec(await msg())[1]);
    assert.ok(done >= 1 && done < SIZE, `stopped part-way: ${done} of ${SIZE}`);
    assert.equal(await page.isHidden("#g-compose-stop"), true, "Stop goes away once it is over");
    await page.waitForFunction(() => !document.getElementById("g-compose").disabled);
  });

  it("a second run finishes the series and says so", async () => {
    // the stopped job may still be finishing its current frame on the server: the button is free again, a busy answer would say so
    let text = "";
    for (let i = 0; i < 30; i++) {
      await page.click("#g-compose");
      await page.waitForFunction(() => !document.getElementById("g-compose").disabled, null, { timeout: 120000 });
      text = await msg();
      if (!/вже йде/.test(text)) break;
      await page.waitForTimeout(300);
    }
    assert.match(text, /Складено 150|150/, text);
    assert.doesNotMatch(text, /Зупинено|Помилка/);
  });

  it("Check quality (streamed) ends with the report and no Stop button left", async () => {
    await page.click('nav [data-tab="gallery"]');
    await page.waitForFunction(() => document.querySelectorAll("#v-dir option").length >= 1);
    await page.selectOption("#v-dir", "layers");
    await page.waitForFunction(() => document.querySelectorAll("#v-grid .tile").length >= 1);
    assert.equal(await page.isHidden("#v-quality-stop"), true);
    await page.click("#v-quality-run");
    await page.waitForFunction(() => /\S/.test(document.getElementById("v-quality-out")?.textContent || ""), null, { timeout: 60000 });
    assert.equal(await page.isHidden("#v-quality-stop"), true, "Stop goes away once the check is over");
    assert.equal(await page.isEnabled("#v-quality-run"), true);
    assert.doesNotMatch(await page.textContent("#v-quality-status"), /Перевірено \d+ з/);
  });

  it("the rarity simulation shows its table (R17)", async () => {
    await page.click('nav [data-tab="recipes"]');
    await page.waitForSelector("#r-simulate");
    await page.evaluate(() => { document.getElementById("r-rarity").hidden = true; document.getElementById("r-rarity").open = false; });
    await page.click("#r-simulate");
    await page.waitForFunction(() => !document.getElementById("r-rarity").hidden, null, { timeout: 30000 });
    assert.equal(await page.$eval("#r-rarity", (e) => e.open), true, "the card is opened");
    assert.ok((await page.$$eval("#r-rarity-table tbody tr", (r) => r.length)) >= 6, "a row per option");
    assert.match(await page.textContent("#r-simulate-msg"), /Сухий прогін/);
  });

  it("no page errors", () => assert.deepEqual(pageErrors, []));
});
