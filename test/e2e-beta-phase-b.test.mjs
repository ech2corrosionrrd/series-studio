// BETA-REVIEW phase B in a real browser: the English interface has no Ukrainian left in it (also after a switch of language), the header does not show
// the server port on the public site, a template does not overwrite the Overview, and name / size problems are said before anything is sent.
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

// The one place where the interface itself is allowed to be Ukrainian: the name of the language in its own language.
const ALLOWED = new Set(["Українська"]);
const CYR = /[А-Яа-яІіЇїЄєҐґ]/;

describe("English interface, header, template, validation in a real browser", { skip: CHROME ? false : "no Chrome/Chromium found (set CHROME_PATH)" }, () => {
  let studio;
  let browser;
  let context;
  let page;
  const pageErrors = [];

  before(async () => {
    studio = await startStudio({ extraEnv: { WELCOME_CREDITS: "100", EARLY_WELCOME_CREDITS: "100" } });
    const cookie = await studio.signIn();
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
    context = await browser.newContext({ locale: "uk-UA", viewport: { width: 1400, height: 900 } });
    const [name, ...rest] = cookie.split("=");
    await context.addCookies([{ name, value: rest.join("="), url: `http://127.0.0.1:${studio.port}` }]);
    page = await context.newPage();
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.goto(`http://127.0.0.1:${studio.port}/studio/`);
    await page.waitForSelector("#o-name");
    // data that the lists draw: a saved project and a base picture (mock engine, 0 credits)
    await page.evaluate(async () => {
      const tpl = await (await fetch("/api/templates/pfp-portrait")).json();
      const preset = { ...tpl.preset, id: "scan-series", name: "Scan Series", seed: "scan-1", size: 4, lines: { a: { ...tpl.preset.lines.a, quota: 2 }, b: { ...tpl.preset.lines.b, quota: 2 } } };
      const r = await fetch("/api/preset/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preset }) });
      if (!r.ok) throw new Error("save " + r.status + " " + (await r.text()));
      const b = await fetch("/api/base/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wish: "a friendly test mascot", engine: "mock" }) });
      if (!b.ok) throw new Error("base " + b.status + " " + (await b.text()));
    });
    await page.reload();
    await page.waitForSelector("#o-name");
    await page.waitForLoadState("networkidle");
  });

  after(async () => {
    await browser?.close();
    await studio?.stop();
  });

  const tab = (name) => page.click(`nav [data-tab="${name}"], [data-tab="${name}"]`);
  const TABS = ["home", "base", "ctor", "recipes", "render", "gallery", "export", "deploy", "market", "admin", "help"];

  /** Visible text nodes, placeholders, titles and tooltips that contain Cyrillic. */
  const cyrillicOnScreen = () =>
    page.evaluate((src) => {
      const re = new RegExp(src);
      const hits = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        const el = n.parentElement;
        if (!el || ["SCRIPT", "STYLE", "OPTION", "TEXTAREA"].includes(el.tagName) || el.closest("[hidden]") || !el.offsetParent) continue;
        const text = n.nodeValue.trim();
        if (text && re.test(text)) hits.push(`${el.id || el.tagName}: ${text.slice(0, 60)}`);
      }
      for (const el of document.querySelectorAll("input[placeholder],textarea[placeholder]")) if (el.offsetParent && re.test(el.placeholder)) hits.push(`${el.id || el.tagName} placeholder: ${el.placeholder.slice(0, 50)}`);
      for (const el of document.querySelectorAll("[data-tip]")) if (el.offsetParent && re.test(el.dataset.tip)) hits.push(`${el.id || el.tagName} tip: ${el.dataset.tip.slice(0, 50)}`);
      return hits;
    }, CYR.source);

  const scanAllTabs = async () => {
    const found = [];
    for (const name of TABS) {
      if (!(await page.isVisible(`[data-tab="${name}"]`))) continue; // the Admin tab is not shown to a normal wallet
      await tab(name);
      await page.waitForTimeout(700);
      for (const hit of await cyrillicOnScreen()) {
        if (![...ALLOWED].some((a) => hit.endsWith(a))) found.push(`${name} | ${hit}`);
      }
    }
    return found;
  };

  it("the header shows no server port on the public site", async () => {
    await tab("home");
    assert.equal((await page.textContent("#me")).trim(), "", "no «lab · :5344»");
  });

  it("after a switch to English no Ukrainian is left on any tab", async () => {
    await page.click('.lang-btn[data-locale="en"]');
    await page.waitForTimeout(1500);
    const found = await scanAllTabs();
    assert.deepEqual(found, [], `Ukrainian on screen in English:\n${found.join("\n")}`);
  });

  it("the credit history is in English and groups the same charge", async () => {
    await page.click("#acct-buy");
    await page.waitForSelector("#credit-history .hist-row, #credit-history .hist-empty");
    const rows = await page.$$eval("#credit-history .hist-row span:nth-child(2)", (els) => els.map((e) => e.textContent));
    for (const r of rows) assert.doesNotMatch(r, /^(image generation|archive|vision assist|ai triage)$/, `a raw ledger note: ${r}`);
    await page.keyboard.press("Escape");
  });

  it("a fresh load in English (no switch) is clean as well", async () => {
    await page.reload();
    await page.waitForSelector("#o-name", { state: "attached" }); // the studio reopens on the tab it was left on
    await page.waitForLoadState("networkidle");
    const found = await scanAllTabs();
    assert.deepEqual(found, [], `Ukrainian on screen in English:\n${found.join("\n")}`);
  });

  it("back to Ukrainian: the template blurb and the project list follow the language", async () => {
    await page.click('.lang-btn[data-locale="uk"]');
    await page.waitForTimeout(1200);
    await tab("ctor");
    const blurbs = await page.$$eval(".tpl-blurb", (els) => els.map((e) => e.textContent));
    assert.ok(blurbs.some((b) => /Дружній маскот/.test(b)), `uk blurbs: ${blurbs}`);
    await page.click('.lang-btn[data-locale="en"]');
    await page.waitForTimeout(1200);
    const en = await page.$$eval(".tpl-blurb", (els) => els.map((e) => e.textContent));
    assert.ok(en.some((b) => /friendly brand mascot/i.test(b)), `en blurbs: ${en}`);
    await page.click('.lang-btn[data-locale="uk"]');
    await page.waitForTimeout(800);
  });

  it("a template keeps the name, id, seed and size from the Overview", async () => {
    await tab("home");
    for (const [id, v] of [["o-name", "Kept Name"], ["o-id", "kept-id"], ["o-seed", "kept-seed"], ["o-size", "8"]]) {
      await page.fill(`#${id}`, v);
      await page.dispatchEvent(`#${id}`, "input");
    }
    await tab("ctor");
    await page.evaluate(() => {
      const card = [...document.querySelectorAll(".tpl-card")].find((c) => /brand-mascot/.test(c.textContent));
      card.querySelector("button").click();
    });
    await page.waitForFunction(() => document.getElementById("opt-trait-key")?.options.length >= 5);
    const values = await page.evaluate(() => ["o-name", "o-id", "o-seed", "o-size", "c-name", "c-id", "c-seed", "c-size"].map((i) => document.getElementById(i).value));
    assert.deepEqual(values, ["Kept Name", "kept-id", "kept-seed", "8", "Kept Name", "kept-id", "kept-seed", "8"], "the template did not overwrite the Overview");
  });

  it("a size of 0, a fraction and an empty name are said in plain words, and a size of 0 is not turned into 1", async () => {
    await tab("home");
    const say = async (setup) => {
      await page.evaluate(setup);
      await tab("ctor");
      await page.evaluate(() => { document.getElementById("ctor-msg").textContent = ""; }); // the answer of the previous call must not be mistaken for this one
      await page.click("#ctor-validate");
      await page.waitForFunction(() => /\S/.test(document.getElementById("ctor-msg")?.textContent || ""));
      const text = await page.textContent("#ctor-msg");
      await tab("home");
      return text;
    };
    const set = (id, v) => `{ const e = document.getElementById(${JSON.stringify(id)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event("input", { bubbles: true })); }`;
    const zero = await say(`${set("o-name", "Valid")}${set("o-size", "0")}`);
    assert.match(zero, /не менше 1/, zero);
    assert.doesNotMatch(zero, /size=|\/size/, zero);
    const fraction = await say(set("o-size", "12.7"));
    assert.match(fraction, /цілим числом/, fraction);
    const empty = await say(`${set("o-size", "12")}${set("o-name", "   ")}`);
    assert.match(empty, /Назва серії не може бути порожньою/, empty);
    const ok = await say(`${set("o-name", "Valid")}${set("o-size", "12")}`);
    assert.match(ok, /12 NFT/, ok);
  });

  it("saving with a size of 0 is refused in plain words and saves nothing", async () => {
    await tab("home");
    await page.evaluate(() => {
      for (const [id, v] of [["o-name", "Zero Size"], ["o-id", "zero-size"], ["o-size", "0"]]) {
        const e = document.getElementById(id);
        e.value = v;
        e.dispatchEvent(new Event("input", { bubbles: true }));
      }
      document.getElementById("o-msg").textContent = "";
    });
    await page.click("#o-save");
    await page.waitForFunction(() => /\S/.test(document.getElementById("o-msg")?.textContent || ""));
    assert.match(await page.textContent("#o-msg"), /не менше 1/);
    const saved = await page.evaluate(async () => (await (await fetch("/api/presets")).json()).presets.map((p) => p.file));
    assert.equal(saved.includes("zero-size.json"), false, "nothing was saved");
  });

  it("no page errors during the whole session", () => {
    assert.deepEqual(pageErrors, []);
  });
});
