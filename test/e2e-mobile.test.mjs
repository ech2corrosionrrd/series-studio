// Phone width (BETA-REVIEW B12): no tab, the admin panel included, makes the page wider than a 390 px screen.
// Mock engine, no keys, 0 credits. Needs a Chrome/Chromium (CHROME_PATH or a standard install); without one the file is skipped.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { startStudio } from "./helpers/studio-server.mjs";

const CHROME = [
  process.env.CHROME_PATH,
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean).find((p) => existsSync(p)) || null;

describe("phone width", { skip: CHROME ? false : "no Chrome/Chromium found (set CHROME_PATH)" }, () => {
  let studio;
  let browser;
  let page;
  before(async () => {
    studio = await startStudio({ adminWallet: true, extraEnv: { WELCOME_CREDITS: "100" } });
    const cookie = await studio.signIn();
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const context = await browser.newContext({ locale: "uk-UA", viewport: { width: 390, height: 800 } });
    const [name, ...rest] = cookie.split("=");
    await context.addCookies([{ name, value: rest.join("="), url: `http://127.0.0.1:${studio.port}` }]);
    page = await context.newPage();
    await page.goto(`http://127.0.0.1:${studio.port}/studio/`);
    await page.waitForSelector("#o-name");
  });
  after(async () => {
    await browser?.close();
    await studio?.stop();
  });

  it("no tab is wider than the screen, and each shows exactly one visible h1", async () => {
    const tabs = await page.$$eval("nav [data-tab]", (b) => b.map((x) => x.dataset.tab));
    assert.ok(tabs.includes("admin"), "the admin tab is part of the pass");
    for (const tab of tabs) {
      await page.click(`nav [data-tab="${tab}"]`);
      await page.waitForTimeout(300);
      const { scroll, view, h1 } = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        view: document.documentElement.clientWidth,
        h1: [...document.querySelectorAll("h1")].filter((h) => h.offsetParent).length,
      }));
      assert.ok(scroll <= view, `tab ${tab}: the page is ${scroll} px wide on a ${view} px screen`);
      assert.equal(h1, 1, `tab ${tab}: one visible h1`);
    }
  });

  it("every overlay is a labelled modal dialog", async () => {
    const bad = await page.$$eval(".overlay", (els) => els
      .map((o) => ({ id: o.id, d: o.querySelector('[role="dialog"][aria-modal="true"][aria-labelledby]') }))
      .filter((x) => !x.d).map((x) => x.id));
    assert.deepEqual(bad, []);
  });
});
