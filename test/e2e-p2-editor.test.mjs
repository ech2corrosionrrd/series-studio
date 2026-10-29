// ROADMAP P2 items from 29.10.2026 in a real browser: delete a whole trait, edit the "who" of each line, the genesis note next to the ZIP button,
// the NFT name prefix following the series name, and the header balance re-read after a write.
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

describe("constructor and export details in a real browser", { skip: CHROME ? false : "no Chrome/Chromium found (set CHROME_PATH)" }, () => {
  let studio;
  let browser;
  let page;
  const pageErrors = [];
  const meCalls = [];

  before(async () => {
    studio = await startStudio({ extraEnv: { WELCOME_CREDITS: "100", EARLY_WELCOME_CREDITS: "100" } });
    const cookie = await studio.signIn();
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const context = await browser.newContext({ locale: "uk-UA", viewport: { width: 1400, height: 900 } });
    const [name, ...rest] = cookie.split("=");
    await context.addCookies([{ name, value: rest.join("="), url: `http://127.0.0.1:${studio.port}` }]);
    page = await context.newPage();
    page.on("pageerror", (e) => pageErrors.push(e.message));
    page.on("request", (r) => {
      if (new URL(r.url()).pathname === "/api/me") meCalls.push(Date.now());
    });
    await page.goto(`http://127.0.0.1:${studio.port}/studio/`);
    await page.waitForSelector("#o-name");
  });

  after(async () => {
    await browser?.close();
    await studio?.stop();
  });

  const tab = (name) => page.click(`nav [data-tab="${name}"], [data-tab="${name}"]`);
  const setValue = (id, value) =>
    page.evaluate(
      ([i, v]) => {
        const el = document.getElementById(i);
        el.value = v;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      },
      [id, value],
    );

  it("the genesis note shows the supply N + 1 next to the ZIP button, and only with the genesis option on", async () => {
    await setValue("o-size", "24");
    await page.evaluate(() => {
      const g = document.getElementById("o-genesis");
      g.checked = false;
      g.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await tab("export");
    await page.waitForSelector("#x-bundle");
    assert.equal(await page.isHidden("#x-genesis-note"), true, "no note without genesis");
    await page.evaluate(() => {
      const g = document.getElementById("o-genesis");
      g.checked = true;
      g.dispatchEvent(new Event("change", { bubbles: true }));
    });
    assert.equal(await page.isVisible("#x-genesis-note"), true);
    const text = await page.textContent("#x-genesis-note");
    assert.match(text, /24 \+ 1 = 25/, text);
  });

  it("the NFT name prefix follows the series name until the author types their own", async () => {
    await setValue("o-name", "Gremlins Test");
    await tab("home");
    await tab("export");
    await page.waitForSelector("#x-namePrefix");
    assert.equal(await page.inputValue("#x-namePrefix"), "Gremlins Test #");
    await setValue("o-name", "Another Series");
    await tab("home");
    await tab("export");
    assert.equal(await page.inputValue("#x-namePrefix"), "Another Series #", "an untouched prefix follows a renamed series");
    await page.fill("#x-namePrefix", "My Own #");
    await setValue("o-name", "Third Series");
    await tab("home");
    await tab("export");
    assert.equal(await page.inputValue("#x-namePrefix"), "My Own #", "the author's prefix is not overwritten");
  });

  it("a trait can be deleted with all its options (two clicks), and the who of each line can be edited and saved", async () => {
    await setValue("o-name", "P2 Editor");
    await setValue("o-id", "p2-editor");
    await setValue("o-size", "4");
    await tab("ctor");
    await page.waitForSelector("#opt-trait-key");
    // start from a template so that there are traits and lines
    await page.evaluate(() => {
      const card = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Використати" && /brand-mascot/.test(b.closest("div,article,li")?.textContent || ""));
      if (!card) throw new Error("no brand-mascot template card");
      card.click();
    });
    await page.waitForFunction(() => document.getElementById("opt-trait-key")?.options.length >= 5);
    // applying a template overwrites the Overview fields: put ours back
    await setValue("o-name", "P2 Editor");
    await setValue("o-id", "p2-editor");
    await setValue("o-size", "4");
    const before = await page.$$eval("#opt-trait-key option", (o) => o.map((x) => x.value));
    assert.ok(before.includes("pose"), `the template has a pose trait: ${before}`);

    await page.selectOption("#opt-trait-key", "pose");
    assert.equal(await page.isVisible("#opt-trait-del"), true);
    await page.click("#opt-trait-del");
    assert.deepEqual(await page.$$eval("#opt-trait-key option", (o) => o.map((x) => x.value)), before, "the first click only asks");
    assert.match(await page.textContent("#opt-trait-del"), /Точно видалити/);
    await page.click("#opt-trait-del");
    const after = await page.$$eval("#opt-trait-key option", (o) => o.map((x) => x.value));
    assert.deepEqual(after, before.filter((k) => k !== "pose"), "the second click deletes the trait");

    assert.equal(await page.isVisible("#c-who-wrap"), true, "the who fields are shown for a preset with lines");
    const whoInputs = await page.$$("#c-who-lines input[data-who-line]");
    assert.ok(whoInputs.length >= 1, "one field per line");
    await page.fill('#c-who-lines input[data-who-line="a"]', "mischievous cartoon gremlin");

    await page.click("#ctor-save");
    await page.waitForFunction(() => /p2-editor/.test(document.getElementById("ctor-msg")?.textContent || document.body.innerText));
    const saved = await page.evaluate(async () => (await fetch("/api/preset?file=p2-editor.json")).json());
    assert.equal(saved.preset.lines.a.who, "mischievous cartoon gremlin");
    assert.equal(saved.preset.traits.items.some((i) => i.key === "pose"), false, "the deleted trait is gone from the saved preset");
    assert.equal(saved.preset.traits.items.length, before.length - 1);
  });

  it("a write that can charge makes the header re-read the balance; the autosave does not", async () => {
    await tab("recipes");
    await page.waitForSelector("#r-build");
    await page.waitForTimeout(1500);
    const quiet = meCalls.length;
    await page.evaluate(() => fetch("/api/workspace", { method: "GET" }));
    await page.waitForTimeout(1200);
    assert.equal(meCalls.length, quiet, "reading the workspace does not re-read the balance");
    await page.selectOption("#r-preset", "p2-editor.json");
    await page.click("#r-build");
    await page.waitForTimeout(2500); // the header read is debounced by 800 ms
    assert.ok(meCalls.length > quiet, `the balance was re-read after the build (${quiet} -> ${meCalls.length})`);
  });

  it("no page errors during the whole session", () => {
    assert.deepEqual(pageErrors, []);
  });
});
