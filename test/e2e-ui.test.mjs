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
    studio = await startStudio({ adminWallet: false, extraEnv: { WELCOME_CREDITS: "100", EARLY_WELCOME_CREDITS: "100", PROJECTS_FREE: "2", PROJECT_EXTRA_CREDITS: "30" } });
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
  // Creating, opening or restoring a project restarts the studio on it (its base, layers and frame sets are its own).
  const waitReload = async (action) => {
    const loaded = page.waitForEvent("load");
    await action();
    await loaded;
    await page.waitForSelector("#o-id", { state: "attached" });
    await waitFor(async () => (await page.$$("#projects-list li")).length > 0, { what: "the studio to boot again" });
  };
  const balance = async () => (await studio.call("GET", "/api/me")).json.balance;

  it("a first visit opens on the portrait template, not on an arbitrary alphabetical preset", async () => {
    await waitFor(async () => (await page.inputValue("#o-id")) === "pfp-portrait", { what: "portrait template" });
  });

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
    await waitReload(() => page.click("#o-save"));
    await waitFor(async () => /e2e-series\.json/.test(await page.textContent("#o-msg")), { what: "save message after the restart" });
    const mine = (await studio.call("GET", "/api/projects")).json;
    assert.equal(mine.active, "e2e-series.json");
    assert.equal(mine.projects[0].assets.hasBase, true, "the base uploaded before the first project moved into it");
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

  it("one current series: the Export and Recipes selectors follow it; frame URLs carry a version", async () => {
    assert.equal(await page.inputValue("#x-file"), "e2e-series.json", "Export selector = the series built in Recipes");
    assert.equal(await page.inputValue("#r-preset"), "e2e-series.json");
    // a second series: switching back to the first must move the Export selector too (it used to stay on the other one)
    await tab("home");
    await page.fill("#o-name", "E2E Second");
    await page.fill("#o-id", "e2e-second");
    await page.fill("#o-size", "4");
    await waitReload(() => page.click("#o-save"));
    assert.equal((await studio.call("GET", "/api/projects")).json.active, "e2e-second.json");
    assert.equal((await studio.call("GET", "/api/sets")).json.sets.length, 0, "the new project does not see the first project's frames");
    assert.equal((await studio.call("GET", "/api/base/list")).json.files.length, 0, "nor its base image");
    await tab("recipes");
    await page.click("#r-build");
    await waitFor(async () => (await page.inputValue("#x-file")) === "e2e-second.json", { what: "Export follows the second series" });
    await waitReload(() => page.selectOption("#r-preset", "e2e-series.json"));
    await waitFor(async () => (await page.inputValue("#x-file")) === "e2e-series.json", { what: "Export follows the switch back" });
    await waitFor(async () => (await page.inputValue("#o-id")) === "e2e-series", { what: "Overview follows the switch too" });
    assert.equal((await studio.call("GET", "/api/sets")).json.sets.length, 2, "the first project's frames are back");
    await tab("gallery");
    const srcs = await page.$$eval("#v-grid img", (imgs) => imgs.map((i) => i.getAttribute("src")));
    assert.ok(srcs.length > 0 && srcs.every((s) => /\?v=\d+$/.test(s)), `frame URLs: ${srcs.slice(0, 2)}`);
  });

  it("after a reload the studio reopens on the series the user was working on", async () => {
    assert.equal((await studio.call("GET", "/api/projects")).json.active, "e2e-series.json", "the server remembers the open project");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("#o-id", { state: "attached" }); // the studio reopens on the last tab, Overview may be hidden
    await page.waitForTimeout(2500);
    assert.equal(await page.inputValue("#o-id"), "e2e-series", "the series chosen last is restored, not the alphabetical first");
    assert.equal(await page.inputValue("#r-preset"), "e2e-series.json");
    assert.equal(await page.inputValue("#x-file"), "e2e-series.json", "no stale archive in the Export selector");
  });

  it("projects: the card lists them, a new one beyond the free ones asks first and charges only on the second click", async () => {
    await tab("home");
    await waitFor(async () => (await page.$$("#projects-list li")).length === 2, { what: "two projects listed" });
    assert.match(await page.textContent("#projects-quota"), /2/);
    const box = await page.locator("#projects-card").boundingBox();
    assert.ok(box && box.y < 450, `the projects card must be visible without scrolling, it is at y=${box?.y}`);
    const before = await balance();
    await page.fill("#o-name", "E2E Third");
    await page.fill("#o-id", "e2e-third");
    await page.fill("#o-size", "4");
    await page.click("#o-save");
    await waitFor(async () => /30/.test(await page.textContent("#o-msg")), { what: "confirmation notice" });
    assert.equal(await balance(), before, "nothing is charged by the first click");
    assert.equal((await page.$$("#projects-list li")).length, 2);
    await waitReload(() => page.click("#o-save"));
    await waitFor(async () => /e2e-third\.json/.test(await page.textContent("#o-msg")), { what: "third project saved" });
    assert.equal(before - (await balance()), 30, "the second click charges once");
    await waitFor(async () => (await page.$$("#projects-list li")).length === 3, { what: "three projects listed" });
    assert.equal((await page.$$("#projects-list .badge.paid")).length, 1);
    await page.click("#o-save");
    await waitFor(async () => /e2e-third\.json/.test(await page.textContent("#o-msg")), { what: "resave" });
    assert.equal(before - (await balance()), 30, "saving the same project again is free");
  });

  it("projects: delete asks twice and goes to the trash, restore at the limit asks to confirm and charges once", async () => {
    await tab("home");
    await waitFor(async () => (await page.$$("#projects-list li")).length === 3, { what: "three projects" });
    const del = '[data-project-delete="e2e-second.json"]';
    await page.click(del);
    assert.equal((await page.$$("#projects-list li")).length, 3, "the first click only arms the button");
    await page.click(del);
    await waitFor(async () => (await page.$$("#projects-list li")).length === 2, { what: "project removed from the list" });
    await waitFor(async () => !(await page.isHidden("#projects-deleted-wrap")), { what: "deleted block shown" });
    assert.equal((await page.$$("#projects-deleted li")).length, 1);
    assert.equal((await studio.call("GET", "/api/presets")).json.presets.some((p) => p.file === "e2e-second.json"), false);

    const before = await balance();
    await page.click("#projects-deleted [data-restore]");
    await waitFor(async () => /30/.test(await page.textContent("#projects-msg")), { what: "restore asks to confirm" });
    assert.equal(await balance(), before, "the first restore click charges nothing");
    await waitReload(() => page.click("#projects-deleted [data-restore]"));
    await waitFor(async () => (await page.$$("#projects-list li")).length === 3, { what: "project restored" });
    assert.equal(before - (await balance()), 30, "restoring beyond the limit is a new project: charged once");
    assert.equal(await page.isHidden("#projects-deleted-wrap"), true);
  });

  it("switches the interface language", async () => {
    await page.click('button:has-text("EN")');
    await waitFor(async () => (await page.getAttribute("html", "lang")) === "en", { what: "html lang=en" });
    assert.match(await page.textContent('[data-tab="home"]'), /Overview/i);
  });

  it("modal windows keep Tab inside, Escape closes them and focus goes back to the button that opened them", async () => {
    await page.click("#acct-data");
    await page.waitForSelector("#data-overlay:not([hidden])");
    const inside = () => page.evaluate(() => document.getElementById("data-overlay").contains(document.activeElement));
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("Tab");
      assert.equal(await inside(), true, `focus left the window after ${i + 1} Tab presses`);
    }
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("Shift+Tab");
      assert.equal(await inside(), true, `focus left the window after ${i + 1} Shift+Tab presses`);
    }
    await page.keyboard.press("Escape");
    await page.waitForSelector("#data-overlay", { state: "hidden" });
    assert.equal(await page.evaluate(() => document.activeElement?.id), "acct-data", "focus returns to the opener");
  });

  it("the whole session produced no console errors, page exceptions or failed requests", () => {
    // the one expected refusal is the "confirm the paid project" answer (402) that the projects test provoked on purpose
    const isAsk = (r) => r === "402 POST /api/preset/save" || r === "402 POST /api/projects/restore";
    assert.equal(failedRequests.filter(isAsk).length, 2, "the save and the restore each asked once");
    assert.deepEqual(failedRequests.filter((r) => !isAsk(r)), [], "no other request of a normal session may fail");
    assert.deepEqual(consoleErrors.filter((m) => !/status of 402/.test(m)), [], "the browser logs the deliberate 402 itself; nothing else may be logged");
  });
});
