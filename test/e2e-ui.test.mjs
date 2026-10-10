// End-to-end through the real browser UI (mock engine: free). Covers the main path a user takes and the state bugs
// that only a browser shows: overview → base → recipes → generation (estimate, force, charge) → selection → quality.
// Needs a Chrome/Chromium on the machine (CHROME_PATH or a standard install); without one the whole file is skipped.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { createMockPng } from "../src/mock-image.mjs";
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

async function waitFor(fn, { timeout = 30_000, step = 250, what = "condition" } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, step));
  }
  throw new Error(`timed out waiting for ${what}${last instanceof Error ? `: ${last.message}` : ""}`);
}

describe("studio in a real browser", { skip: CHROME ? false : "no Chrome/Chromium found (set CHROME_PATH)" }, () => {
  let studio;
  let browser;
  let page;
  const consoleErrors = [];
  const failedRequests = [];

  before(async () => {
    studio = await startStudio({ adminWallet: false });
    const cookie = await studio.signIn();
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const context = await browser.newContext({ locale: "uk-UA", viewport: { width: 1400, height: 900 } });
    const [name, ...rest] = cookie.split("=");
    await context.addCookies([{ name, value: rest.join("="), url: `http://127.0.0.1:${studio.port}` }]);
    page = await context.newPage();
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
    page.on("response", (r) => {
      if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
    });
    await page.goto(`http://127.0.0.1:${studio.port}/studio/`);
    await page.waitForSelector("#o-name");
  });

  after(async () => {
    await browser?.close();
    await studio?.stop();
  });

  const tab = (name) => page.click(`nav [data-tab="${name}"], [data-tab="${name}"]`);
  const balance = async () => (await studio.call("GET", "/api/me")).json.balance;

  it("uploads the primary base image", async () => {
    await tab("base");
    await page.selectOption("#base-role", { index: 0 });
    await page.setInputFiles("#base-file", { name: "primary.png", mimeType: "image/png", buffer: createMockPng({ seed: 7, title: "primary" }) });
    await waitFor(async () => !(await page.isDisabled("#base-upload")), { what: "upload button" });
    await page.click("#base-upload");
    const list = await waitFor(async () => {
      const r = await studio.call("GET", "/api/base/list");
      return r.json?.files?.some?.((f) => f.primary) || r.json?.some?.((f) => f.primary) || null;
    }, { what: "primary base on the server" });
    assert.ok(list);
  });

  it("saves a 4-frame preset on the mock engine", async () => {
    await tab("home");
    await page.fill("#o-name", "E2E Series");
    await page.fill("#o-id", "e2e-series");
    await page.fill("#o-size", "4");
    await page.selectOption("#o-engine", "mock");
    await page.click("#o-save");
    await waitFor(async () => /e2e-series\.json/.test(await page.textContent("#o-msg")), { what: "save message" });
  });

  it("builds the recipe texts for free", async () => {
    const before = await balance();
    await tab("recipes");
    await page.selectOption("#r-preset", { label: /E2E Series/ }).catch(async () => page.selectOption("#r-preset", "e2e-series.json"));
    await page.click("#r-build");
    await waitFor(async () => (await page.$$("#r-table tr")).length >= 4, { what: "recipe rows" });
    assert.equal(await balance(), before, "building texts costs no credits");
  });

  it("estimate and charge agree, and the regenerate switch is part of the estimate", async () => {
    await tab("render");
    await page.selectOption("#g-engine", "mock");
    await page.fill("#g-pilot", "4");
    await page.click("#g-estimate");
    await waitFor(async () => /To generate: 4/.test(await page.textContent("#g-plan-out")), { what: "estimate" });
    const plan = await page.textContent("#g-plan-out");
    const cost = Number(/Cost: (\d+) credits/.exec(plan)[1]);
    assert.equal(cost, 8);
    const before = await balance();
    await page.click("#g-run");
    await waitFor(async () => /100%/.test(await page.textContent("#g-progress-pct")) && (await page.$$("#g-thumbs img")).length === 4, { what: "generation" });
    assert.equal(before - (await balance()), cost, "the charge equals the estimate");

    await page.check("#g-force");
    await page.click("#g-estimate");
    await waitFor(async () => /FORCE re-render/.test(await page.textContent("#g-plan-out")), { what: "force estimate" });
    const forced = await page.textContent("#g-plan-out");
    assert.match(forced, /To generate: 4/);
    assert.match(forced, /Cost: 8 credits/, "with the switch on, the estimate shows what a re-render will charge");
    await page.uncheck("#g-force");
  });

  it("the GPU explanation stays hidden for cloud/mock engines", async () => {
    assert.equal(await page.isHidden("#local-gpu-panel"), true);
  });

  it("selection shows the 4 frames; quality is cleared when another set is opened", async () => {
    // a second set at another strength
    await tab("render");
    await page.evaluate(() => {
      const el = document.getElementById("g-strength");
      el.value = "0.6";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.fill("#g-pilot", "2");
    await page.click("#g-estimate");
    await waitFor(async () => /To generate: 2/.test(await page.textContent("#g-plan-out")), { what: "second estimate" });
    await page.click("#g-run");
    await waitFor(async () => /100%/.test(await page.textContent("#g-progress-pct")) && (await page.$$("#g-thumbs img")).length === 2, { what: "second generation" });

    await tab("gallery");
    const sets = await waitFor(async () => {
      const opts = await page.$$eval("#v-dir option", (os) => os.map((o) => o.value).filter(Boolean));
      return opts.length >= 2 ? opts : null;
    }, { what: "two sets in the selector" });
    const [a, b] = [sets.find((s) => s.includes("0.45")), sets.find((s) => s.includes("0.6"))];
    assert.ok(a && b, `sets: ${sets}`);

    await page.selectOption("#v-dir", a);
    await waitFor(async () => (await page.$$("#v-grid img")).length === 4, { what: "4 frames" });
    await page.click("#v-quality-run");
    await waitFor(async () => (await page.isVisible("#v-quality-out")) && (await page.textContent("#v-quality-out")).trim().length > 5, { what: "quality result" });

    await page.selectOption("#v-dir", b);
    await waitFor(async () => (await page.$$("#v-grid img")).length === 2, { what: "2 frames of the other set" });
    assert.equal(await page.isVisible("#v-quality-out"), false, "the previous set's quality verdict is gone");
  });

  it("switches the interface language", async () => {
    await page.click('button:has-text("EN")');
    await waitFor(async () => (await page.getAttribute("html", "lang")) === "en", { what: "html lang=en" });
    assert.match(await page.textContent('[data-tab="home"]'), /Overview/i);
  });

  it("the whole session produced no console errors, page exceptions or failed requests", () => {
    assert.deepEqual(failedRequests, [], "no request of a normal session may fail");
    assert.deepEqual(consoleErrors, []);
  });
});
