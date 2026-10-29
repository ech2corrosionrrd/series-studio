// Обхід усіх вкладок і адмін-панелей у справжньому Chrome від імені оператора: жодного винятку сторінки, жодного помилкового
// запиту до власного API, кожна вкладка показується. Страхує розрізаний на модулі app.js (app-*.js): пропущений імпорт
// проявився б ReferenceError саме на тій вкладці, яку ніхто не відкрив. Рушій mock, 0 кредитів; без Chrome файл пропускається.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { startStudio } from "./helpers/studio-server.mjs";

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) || null;
}
const CHROME = findChrome();

describe("every tab opens without errors (real browser)", { skip: CHROME ? false : "no Chrome/Chromium found (set CHROME_PATH)" }, () => {
  let studio;
  let browser;
  let page;
  const pageErrors = [];
  const consoleErrors = [];
  const badResponses = [];

  before(async () => {
    studio = await startStudio({ adminWallet: true, extraEnv: { WELCOME_CREDITS: "100", EARLY_WELCOME_CREDITS: "100" } });
    const cookie = await studio.signIn();
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const context = await browser.newContext({ locale: "uk-UA", viewport: { width: 1400, height: 900 } });
    const [name, ...rest] = cookie.split("=");
    await context.addCookies([{ name, value: rest.join("="), url: `http://127.0.0.1:${studio.port}` }]);
    page = await context.newPage();
    page.on("pageerror", (e) => pageErrors.push(e.message));
    page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
    page.on("response", (r) => r.status() >= 500 && badResponses.push(`${r.status()} ${r.url()}`));
    await page.goto(`http://127.0.0.1:${studio.port}/studio/`);
    await page.waitForSelector("#o-name");
  });

  after(async () => {
    await browser?.close();
    await studio?.stop();
  });

  const settle = () => page.waitForTimeout(400);

  it("each main tab becomes the visible one", async () => {
    const tabs = await page.$$eval("nav [data-tab]", (els) => els.filter((e) => !e.hidden).map((e) => e.dataset.tab));
    assert.ok(tabs.length >= 10, `the navigation lists the tabs: ${tabs}`);
    for (const name of tabs) {
      await page.click(`nav [data-tab="${name}"]`);
      await settle();
      const on = await page.$eval(`#tab-${name}`, (el) => el.classList.contains("on"));
      assert.equal(on, true, `tab ${name} is shown`);
    }
  });

  it("each admin panel opens", async () => {
    await page.click('nav [data-tab="admin"]');
    const panes = await page.$$eval("[data-admin]", (els) => els.map((e) => e.dataset.admin));
    assert.ok(panes.length >= 5, `the admin tab lists its panels: ${panes}`);
    for (const pane of panes) {
      await page.click(`[data-admin="${pane}"]`);
      await settle();
      assert.equal(await page.$eval(`#admin-${pane}`, (el) => el.classList.contains("on")), true, `admin panel ${pane} is shown`);
    }
  });

  it("the page produced no exceptions, console errors or server errors", () => {
    assert.deepEqual(pageErrors, [], `page exceptions: ${pageErrors.join(" | ")}`);
    assert.deepEqual(consoleErrors.filter((m) => !/favicon|Failed to load resource.*(401|403|404)/.test(m)), [], "console errors");
    assert.deepEqual(badResponses, [], "5xx responses");
  });
});
