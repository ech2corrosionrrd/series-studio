// Design and help debts (QUALITY-REVIEW 12, 17, 18) in a real browser: the help opens one section at a time, the options table has a caption,
// primary buttons are at least 44 px, and the Overview slider says when the preset's strength is not the product default.
// Mock engine, no keys, 0 credits. Needs a Chrome/Chromium (CHROME_PATH or a standard install); without one the file is skipped.
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

describe("help, captions and sizes in a real browser", { skip: CHROME ? false : "no Chrome/Chromium found (set CHROME_PATH)" }, () => {
  let studio;
  let browser;
  let page;
  const pageErrors = [];

  before(async () => {
    studio = await startStudio({ extraEnv: { WELCOME_CREDITS: "100", EARLY_WELCOME_CREDITS: "100" } });
    const cookie = await studio.signIn();
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const context = await browser.newContext({ locale: "uk-UA", viewport: { width: 1400, height: 900 } });
    const [name, ...rest] = cookie.split("=");
    await context.addCookies([{ name, value: rest.join("="), url: `http://127.0.0.1:${studio.port}` }]);
    page = await context.newPage();
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.goto(`http://127.0.0.1:${studio.port}/studio/`);
    await page.waitForSelector("#o-name");
  });

  after(async () => {
    await browser?.close();
    await studio?.stop();
  });

  const tab = (name) => page.click(`nav [data-tab="${name}"], [data-tab="${name}"]`);
  const visibleSections = () => page.$$eval("#help-body .help-sec", (els) => els.filter((e) => !e.hidden).map((e) => e.dataset.helpId));
  const allSections = () => page.$$eval("#help-body .help-sec", (els) => els.map((e) => e.dataset.helpId));

  it("the help opens on one section, with its entry marked in the contents", async () => {
    await tab("help");
    await page.waitForSelector("#help-body .help-sec", { state: "attached" });
    const all = await allSections();
    assert.ok(all.length > 3, `the help has several sections: ${all}`);
    const shown = await visibleSections();
    assert.equal(shown.length, 1, `only one section at a time: ${shown}`);
    assert.equal(shown[0], all[0]);
    assert.equal(await page.$eval(`#help-toc a[data-sec="${all[0]}"]`, (a) => a.classList.contains("active")), true);
  });

  it("a contents entry switches the section", async () => {
    const all = await allSections();
    const next = all[1];
    await page.click(`#help-toc a[data-sec="${next}"]`);
    assert.deepEqual(await visibleSections(), [next]);
    assert.equal(await page.$eval(`#help-toc a[data-sec="${next}"]`, (a) => a.classList.contains("active")), true);
    assert.equal(await page.$eval(`#help-toc a[data-sec="${all[0]}"]`, (a) => a.classList.contains("active")), false);
  });

  it("«show all» lifts the limit and can be switched back", async () => {
    const all = await allSections();
    await page.click("#help-all");
    assert.equal((await visibleSections()).length, all.length);
    assert.equal(await page.getAttribute("#help-all", "aria-pressed"), "true");
    await page.click("#help-all");
    assert.equal((await visibleSections()).length, 1);
    assert.equal(await page.getAttribute("#help-all", "aria-pressed"), "false");
  });

  it("the search still looks in every section, and clearing it returns to one", async () => {
    const all = await allSections();
    await page.fill("#help-search", "seed");
    const hits = await visibleSections();
    assert.ok(hits.length >= 1, "something matches «seed»");
    assert.ok(hits.length <= all.length);
    await page.fill("#help-search", "");
    assert.equal((await visibleSections()).length, 1, "no query: back to one section");
  });

  it("the options table has a caption for screen readers, hidden from the eye", async () => {
    await tab("ctor");
    const cap = await page.$eval("#opt-table caption", (c) => ({ text: c.textContent.trim(), hidden: getComputedStyle(c).position === "absolute" || c.classList.contains("visually-hidden") }));
    assert.ok(cap.text.length > 10, `the caption has text: ${cap.text}`);
    assert.equal(cap.hidden, true);
  });

  it("primary buttons are at least 44 px high", async () => {
    await tab("home");
    const heights = await page.$$eval("button.btn.primary", (els) => els.filter((e) => e.offsetParent !== null).map((e) => Math.round(e.getBoundingClientRect().height)));
    assert.ok(heights.length > 0, "the Overview has a primary button");
    assert.ok(heights.every((h) => h >= 44), `primary buttons: ${heights}`);
  });

  it("on a touch screen the secondary buttons and tabs are 44 px too, a mouse keeps the dense layout", async () => {
    const cookie = await studio.signIn();
    const [name, ...rest] = cookie.split("=");
    const touch = await browser.newContext({ locale: "uk-UA", viewport: { width: 420, height: 900 }, hasTouch: true, isMobile: true });
    await touch.addCookies([{ name, value: rest.join("="), url: `http://127.0.0.1:${studio.port}` }]);
    const tp = await touch.newPage();
    try {
      await tp.goto(`http://127.0.0.1:${studio.port}/studio/`);
      await tp.waitForSelector("nav#tabs button");
      assert.equal(await tp.evaluate(() => matchMedia("(pointer: coarse)").matches), true, "the emulated device is a touch screen");
      const sizes = await tp.$$eval("button.btn:not(.primary), nav#tabs button", (els) => els.filter((e) => e.offsetParent !== null).map((e) => Math.round(e.getBoundingClientRect().height)));
      assert.ok(sizes.length > 3, "there are secondary buttons and tabs to measure");
      assert.ok(sizes.every((h) => h >= 44), `touch targets: ${sizes}`);
    } finally {
      await touch.close();
    }
    const mouse = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--control-min").trim());
    assert.equal(mouse, "24px", "a mouse keeps the 24 px minimum");
  });

  it("the Overview slider says when its value is not the product default", async () => {
    await tab("home");
    if (await page.isHidden("#o-strength")) await page.click("#o-defaults > summary"); // the strength sits under "Додатково"
    await page.evaluate(() => {
      const el = document.getElementById("o-strength");
      el.value = "0.6";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert.equal(await page.isVisible("#o-strength-default"), true);
    assert.match(await page.textContent("#o-strength-default"), /0\.45/);
    await page.evaluate(() => {
      const el = document.getElementById("o-strength");
      el.value = "0.45";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert.equal(await page.isHidden("#o-strength-default"), true, "at the default there is nothing to explain");
  });

  it("no page errors during the whole session", () => {
    assert.deepEqual(pageErrors, []);
  });
});
