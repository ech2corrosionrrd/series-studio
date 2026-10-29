// BETA-REVIEW phase A in a real browser: the Help tells the truth and says where to write, code in the Help is code (no raw backticks),
// the quick start uses a Latin id, and an id typed with Cyrillic or spaces is turned into a valid one.
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

describe("Help truth and the id field in a real browser", { skip: CHROME ? false : "no Chrome/Chromium found (set CHROME_PATH)" }, () => {
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
  const openHelpAll = async () => {
    await tab("help");
    await page.waitForSelector("#help-body .help-sec", { state: "attached" });
    if ((await page.getAttribute("#help-all", "aria-pressed")) !== "true") await page.click("#help-all");
  };
  const helpText = () => page.$eval("#help-body", (b) => b.textContent);
  const setId = async (value) => {
    await page.fill("#o-id", value);
    await page.dispatchEvent("#o-id", "change");
  };

  it("the Help has a Support section with the address and the legal links", async () => {
    await openHelpAll();
    assert.equal(await page.$$eval("#help-toc a", (a) => a.some((x) => x.dataset.sec === "support")), true, "the contents lists it");
    const mail = await page.$$eval("#help-support a[href^='mailto:']", (a) => a.map((x) => x.getAttribute("href")));
    assert.deepEqual(mail, ["mailto:w3ir@pm.me"]);
    const legal = await page.$$eval("#help-support a[href*='/terms/'], #help-support a[href*='/privacy/']", (a) => a.map((x) => x.getAttribute("href")));
    assert.deepEqual(legal, ["/terms/", "/privacy/"]);
  });

  it("a search for «підтримка» finds that section", async () => {
    await page.fill("#help-search", "підтримка");
    const shown = await page.$$eval("#help-body .help-sec", (els) => els.filter((e) => !e.hidden).map((e) => e.dataset.helpId));
    assert.ok(shown.includes("support"), `shown: ${shown}`);
    await page.fill("#help-search", "");
  });

  it("code in the Help is rendered as code: no raw backticks anywhere, in both languages", async () => {
    await openHelpAll();
    assert.equal((await helpText()).includes("`"), false, "uk help has no raw backticks");
    assert.ok((await page.$$("#help-body code")).length >= 10, "the commands are in <code>");
    await page.click('.lang-btn[data-locale="en"]');
    await openHelpAll();
    assert.equal((await helpText()).includes("`"), false, "en help has no raw backticks");
    await page.click('.lang-btn[data-locale="uk"]');
    await openHelpAll();
  });

  it("the Help says that Delete in Review erases a frame for good, and nothing says the opposite", async () => {
    await openHelpAll();
    const all = await helpText();
    assert.match(all, /стирає кадр назавжди/);
    assert.doesNotMatch(all, /переносить кадр у кошик/);
    assert.doesNotMatch(all, /Відновити» на цій вкладці/);
  });

  it("the quick start writes the id in Latin letters, the Help does not call the studio «на вашому ПК, без інтернету»", async () => {
    await openHelpAll();
    const step = await page.$eval("#help-quick li:nth-child(2)", (li) => li.textContent);
    assert.match(step, /ID test/);
    assert.doesNotMatch(step, /ID тест/);
    const all = await helpText();
    assert.doesNotMatch(all, /без інтернету/);
    assert.match(all, /двома способами/, "it says the studio works on the site and on the PC");
  });

  it("an id typed in Cyrillic or with spaces becomes a valid one, and the author is told", async () => {
    await tab("home");
    await setId("тест");
    assert.equal(await page.inputValue("#o-id"), "test");
    assert.match(await page.textContent("#o-msg"), /«тест».*«test»/);
    await setId("my heroes");
    assert.equal(await page.inputValue("#o-id"), "my-heroes");
    await setId("Valid_Id.1");
    assert.equal(await page.inputValue("#o-id"), "Valid_Id.1", "a valid id is left alone");
    await setId("!!!");
    assert.equal(await page.inputValue("#o-id"), "");
    assert.match(await page.textContent("#o-msg"), /не вдалося утворити/);
  });

  it("a Ukrainian name makes a Latin id while the id is untouched", async () => {
    await page.reload();
    await page.waitForSelector("#o-name");
    await page.waitForLoadState("networkidle"); // the saved workspace is restored after the first paint
    await page.evaluate(() => {
      delete document.getElementById("o-id").dataset.touched;
      delete document.getElementById("o-seed").dataset.touched;
    });
    await page.fill("#o-name", "Мої герої");
    await page.dispatchEvent("#o-name", "input");
    assert.equal(await page.inputValue("#o-id"), "moi-heroi");
  });

  it("the server refuses a preset id that is not a file name", async () => {
    const res = await page.evaluate(async () => {
      const r = await fetch("/api/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file: "demo-series.json", preset: null }) });
      return r.status;
    });
    assert.ok(res >= 200, "the endpoint answers");
    const bad = await page.evaluate(async () => {
      const demo = await (await fetch("/api/preset?file=demo-series.json")).json();
      const preset = { ...demo.preset, id: "my heroes" };
      const r = await fetch("/api/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preset }) });
      return { status: r.status, text: await r.text() };
    });
    assert.equal(bad.status, 400);
    assert.match(bad.text, /preset id/);
  });

  it("no page errors during the whole session", () => {
    assert.deepEqual(pageErrors, []);
  });
});
