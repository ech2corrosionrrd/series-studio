// R1 (BETA-REVIEW round 2) in a real browser: "Start the series" with a new ID must not copy the project that is open.
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

describe("a new series starts neutral", { skip: CHROME ? false : "no Chrome/Chromium found (set CHROME_PATH)" }, () => {
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

  const traitKeys = () => page.$$eval("#opt-trait-key option", (o) => o.map((x) => x.value));

  it("the open project has its own prompt and traits, and a new ID does not take them", async () => {
    const before = { keep: await page.inputValue("#c-keep"), traits: await traitKeys() };
    assert.ok(before.traits.length > 1, `the seeded project has several traits: ${before.traits}`);

    await page.fill("#o-name", "Нова Тестова Серія");
    await page.fill("#o-id", "nova-testova");
    await page.fill("#o-size", "4");
    await page.click("#o-start");
    await page.waitForFunction(() => /#base/.test(location.hash));

    assert.match(await page.textContent("#o-msg"), /нейтральних налаштувань/, "the author is told what happened");
    await page.click('nav [data-tab="ctor"]');
    const keep = await page.inputValue("#c-keep");
    assert.notEqual(keep, before.keep, "the prompt of the open project is not copied");
    assert.match(keep, /Edit this image of a \{who\}/);
    assert.deepEqual(await traitKeys(), ["expression"], "only the neutral trait is there");
    assert.equal(await page.inputValue("#c-id"), "nova-testova");
    assert.equal(await page.inputValue("#c-size"), "4");
  });

  it("starting the same ID again keeps the author's edits", async () => {
    await page.fill("#c-keep", "Edit this image of a {who}. Keep: my own words");
    await page.click('nav [data-tab="home"]');
    await page.click("#o-start");
    await page.waitForFunction(() => /#base/.test(location.hash));
    await page.waitForTimeout(300);
    assert.doesNotMatch(await page.textContent("#o-msg"), /нейтральних налаштувань/, "an edit of the open series is not a fresh start");
    await page.click('nav [data-tab="ctor"]');
    assert.match(await page.inputValue("#c-keep"), /my own words/);
  });

  it("a size of 0 still gets its message and does not start a series", async () => {
    await page.click('nav [data-tab="home"]');
    await page.fill("#o-name", "Нуль");
    await page.fill("#o-id", "nul-test");
    await page.fill("#o-size", "0");
    await page.click("#o-start");
    await page.waitForTimeout(300);
    assert.match(await page.textContent("#o-msg"), /не менше 1/);
    assert.equal(await page.inputValue("#o-size"), "0", "the 0 is not turned into 1");
  });

  it("no page errors", () => assert.deepEqual(pageErrors, []));
});
