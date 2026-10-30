// R11 (BETA-REVIEW round 2): long tabs do not open with their «what to do» list unfolded, and the body text on Constructor and Recipes is
// not smaller than 13 px. Mock engine, no keys. Needs a Chrome/Chromium (CHROME_PATH or a standard install); without one the file is skipped.
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

describe("density: folded hints on long tabs, readable small text", { skip: CHROME ? false : "no Chrome/Chromium found (set CHROME_PATH)" }, () => {
  let studio;
  let browser;
  let page;
  before(async () => {
    studio = await startStudio({ extraEnv: { WELCOME_CREDITS: "100" } });
    const cookie = await studio.signIn();
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const context = await browser.newContext({ locale: "uk-UA", viewport: { width: 1400, height: 900 } });
    const [name, ...rest] = cookie.split("=");
    await context.addCookies([{ name, value: rest.join("="), url: `http://127.0.0.1:${studio.port}` }]);
    page = await context.newPage();
    await page.goto(`http://127.0.0.1:${studio.port}/studio/`);
    await page.waitForSelector("#o-name");
    await page.uncheck("#path-beginner");
  });
  after(async () => {
    await browser?.close();
    await studio?.stop();
  });

  const hintOpen = (tab) => page.evaluate((id) => !!document.querySelector(`#tab-${id} .hint details`)?.open, tab);

  it("the long tabs (Overview, Constructor) fold the «what to do» list, the short ones keep it open", async () => {
    for (const tab of ["home", "ctor"]) {
      await page.click(`nav [data-tab="${tab}"]`);
      assert.equal(await hintOpen(tab), false, `${tab}: the list is folded`);
    }
    for (const tab of ["base", "recipes", "render"]) {
      await page.click(`nav [data-tab="${tab}"]`);
      assert.equal(await hintOpen(tab), true, `${tab}: the list is open`);
    }
  });

  it("no text under 13 px on Constructor and Recipes (the header chrome apart)", async () => {
    for (const tab of ["ctor", "recipes"]) {
      await page.click(`nav [data-tab="${tab}"]`);
      await page.waitForTimeout(500);
      const small = await page.evaluate(() => {
        const out = new Set();
        const walker = document.createTreeWalker(document.querySelector(".tab.on") || document.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const el = n.parentElement;
          if (!n.textContent.trim() || !el?.offsetParent) continue;
          if (parseFloat(getComputedStyle(el).fontSize) < 13) out.add(`${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`);
        }
        return [...out];
      });
      assert.deepEqual(small, [], `${tab}: text under 13 px`);
    }
  });
});
