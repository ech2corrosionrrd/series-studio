// The wallet window on the login page keeps Tab inside, closes on Escape and gives focus back to the button that opened it.
// Real browser (two stub wallets make the window open); skipped without a Chrome/Chromium (CHROME_PATH or a standard install).
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { startStudio } from "./helpers/studio-server.mjs";

const CHROME = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean).find((p) => existsSync(p)) || null;

describe("login page: wallet window focus", { skip: CHROME ? false : "no Chrome/Chromium found (set CHROME_PATH)" }, () => {
  let studio;
  let browser;
  let page;

  before(async () => {
    studio = await startStudio({ adminWallet: false });
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const context = await browser.newContext({ locale: "uk-UA", viewport: { width: 1280, height: 900 } });
    // Two injected wallets: with more than one the page lets the user choose, which opens the window.
    await context.addInitScript(() => {
      window.ethereum = { providers: [{ isMetaMask: true, request: async () => [] }, { isCoinbaseWallet: true, request: async () => [] }] };
    });
    page = await context.newPage();
    await page.goto(`http://127.0.0.1:${studio.port}/login`);
    await page.waitForSelector("#connect");
  });

  after(async () => {
    await browser?.close();
    await studio?.stop();
  });

  const inside = () => page.evaluate(() => document.getElementById("modal").contains(document.activeElement));

  it("Tab and Shift+Tab stay inside the open window", async () => {
    await page.click("#connect");
    await page.waitForSelector("#modal.on");
    assert.equal(await inside(), true, "focus moves into the window when it opens");
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press("Tab");
      assert.equal(await inside(), true, `focus left the window after ${i + 1} Tab presses`);
    }
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press("Shift+Tab");
      assert.equal(await inside(), true, `focus left the window after ${i + 1} Shift+Tab presses`);
    }
  });

  it("Escape closes it and focus returns to the connect button", async () => {
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.getElementById("modal").classList.contains("on"));
    assert.equal(await page.evaluate(() => document.activeElement?.id), "connect");
  });
});
