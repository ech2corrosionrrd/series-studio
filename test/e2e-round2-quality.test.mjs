// BETA-REVIEW round 2, R5–R9 in a real browser: no raw JSON after a base is made, a Generate plan in the author's language
// with a pilot that fits the series, recipe rows that open their editor, trait cards that do not overlap.
// Mock engine, no keys, 0 credits. Needs a Chrome/Chromium (CHROME_PATH or a standard install); without one the file is skipped.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
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

describe("round 2: Base, Generate, Recipes and Constructor details", { skip: CHROME ? false : "no Chrome/Chromium found (set CHROME_PATH)" }, () => {
  let studio;
  let browser;
  let page;
  const pageErrors = [];
  before(async () => {
    studio = await startStudio({ extraEnv: { WELCOME_CREDITS: "100" } });
    const cookie = await studio.signIn();
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const context = await browser.newContext({ locale: "uk-UA", viewport: { width: 1400, height: 900 } });
    const [name, ...rest] = cookie.split("=");
    await context.addCookies([{ name, value: rest.join("="), url: `http://127.0.0.1:${studio.port}` }]);
    page = await context.newPage();
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.goto(`http://127.0.0.1:${studio.port}/studio/`);
    await page.waitForSelector("#o-name");
    await page.uncheck("#path-beginner");
  });
  after(async () => {
    await browser?.close();
    await studio?.stop();
  });

  const tab = (name) => page.click(`nav [data-tab="${name}"]`);

  it("trait cards keep the note, the name and the edit button apart, at desktop and phone width", async () => {
    await tab("ctor");
    await page.waitForSelector("#pack-checklist .pack-key");
    const overlaps = () => page.$$eval("#pack-checklist .pack-key", (cards) => cards.flatMap((card) => {
      const parts = [".pack-key-name", ".pack-key-label .muted", ".pack-key-edit"].map((s) => card.querySelector(s)?.getBoundingClientRect()).filter(Boolean);
      const bad = [];
      for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i], b = parts[j];
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) bad.push(card.textContent.trim().slice(0, 30));
      }
      return bad;
    }));
    assert.deepEqual(await overlaps(), [], "no two parts of a card overlap at 1400 px");
    await page.setViewportSize({ width: 390, height: 800 });
    assert.deepEqual(await overlaps(), [], "none overlap at 390 px either");
    await page.setViewportSize({ width: 1400, height: 900 });
  });

  it("a click on a recipe row opens its editor and brings it into view", async () => {
    await tab("recipes");
    await page.click("#r-build");
    await page.waitForFunction(() => document.querySelectorAll("#r-table tbody tr").length >= 4);
    await page.click("#r-table tbody tr:nth-child(3) td:nth-child(3)");
    await page.waitForFunction(() => !document.getElementById("r-editor").hidden);
    await page.waitForTimeout(700);
    assert.match(await page.textContent("#r-ed-title"), /#3/);
    assert.ok((await page.textContent("#r-prompt")).length > 20, "the full prompt is there");
    const box = await page.$eval("#r-editor", (e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, vh: innerHeight }; });
    assert.ok(box.top < box.vh && box.bottom > 0, `the editor is on screen: ${JSON.stringify(box)}`);
  });

  it("the pilot fits the series, its button says how many, and the plan is written in the author's language", async () => {
    await tab("render");
    const size = Number(await page.inputValue("#o-size"));
    const expected = Math.min(5, size);
    assert.equal(await page.inputValue("#g-pilot"), String(expected), "the pilot never exceeds the series and stays small");
    assert.match(await page.textContent("#g-pilots"), new RegExp(`\(${expected}\)`));
    await page.selectOption("#g-engine", "mock");
    await page.fill("#g-pilot", "2");
    assert.match(await page.textContent("#g-pilots"), /\(2\)/, "the button follows the number");
    await page.click("#g-estimate");
    await page.waitForFunction(() => /Згенерувати: 2/.test(document.getElementById("g-plan-out").textContent));
    const uk = await page.textContent("#g-plan-out");
    assert.match(uk, /Папка набору/);
    assert.doesNotMatch(uk, /Set folder|To generate|Estimate is free/);
    await page.click('.lang-btn[data-locale="en"]');
    await page.waitForFunction(() => /To generate: 2/.test(document.getElementById("g-plan-out").textContent));
    const en = await page.textContent("#g-plan-out");
    assert.doesNotMatch(en, /[А-Яа-яІіЇїЄє]/, `the English plan has no Cyrillic: ${en}`);
    assert.match(await page.textContent("#g-pilots"), /Pilot \(2\)/);
    await page.click('.lang-btn[data-locale="uk"]');
    await page.waitForFunction(() => /Згенерувати: 2/.test(document.getElementById("g-plan-out").textContent));
  });

  it("making a base from words shows one sentence, and the raw reply only behind a closed details block", async () => {
    await tab("base");
    await page.selectOption("#base-wish-engine", "mock");
    await page.fill("#base-wish", "a small lion cub, grey background");
    await page.click("#base-wish-gen");
    await page.waitForFunction(() => !document.getElementById("base-wish-details").hidden, null, { timeout: 30000 });
    assert.equal(await page.$eval("#base-wish-details", (d) => d.open), false, "closed by default");
    assert.equal(await page.isVisible("#base-wish-out"), false, "the JSON is not on screen");
    assert.match(await page.textContent("#base-wish-out"), /"ok": true/, "but it is there for whoever opens it");
  });

  it("no page errors", () => assert.deepEqual(pageErrors, []));
});
