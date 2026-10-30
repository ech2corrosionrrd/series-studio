// Layers and the hybrid path in a real browser: upload a layers ZIP, paint it over model frames (preview and compose), the critical-trait gate,
// and the automatic alignment of a layer to a frame the model moved. Mock engine, no keys, no paid call (0 credits).
// Needs a Chrome/Chromium on the machine (CHROME_PATH or a standard install); without one the whole file is skipped.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import JSZip from "jszip";
import { decodePngRgba } from "../src/dupes.mjs";
import { warpRgba } from "../src/layer-align.mjs";
import { encodeRgbaPng } from "../src/png-fit.mjs";
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

const SIZE = 256;

/** Blocks of pseudo-random grey with a subject in the middle: plenty of edges for the aligner. `whole`: no dark border, an unrelated picture. */
function texturedRgba(seed = 1, whole = false) {
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const cell = 16;
  const grey = [];
  for (let i = 0; i < (SIZE / cell) ** 2; i += 1) grey.push(40 + Math.floor(rnd() * 180));
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const inside = whole || (x > 48 && x < 208 && y > 32 && y < 224);
      const g = inside ? grey[Math.floor(y / cell) * (SIZE / cell) + Math.floor(x / cell)] : 20;
      rgba.set([g, g, g, 255], (y * SIZE + x) * 4);
    }
  }
  return rgba;
}
const pngOf = (rgba) => encodeRgbaPng(SIZE, SIZE, rgba);

/** A transparent layer with one 10×10 red square at (100,100): easy to find again on the painted frame. */
function layerPng() {
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 100; y < 110; y += 1) for (let x = 100; x < 110; x += 1) rgba.set([220, 20, 20, 255], (y * SIZE + x) * 4);
  return pngOf(rgba);
}
const SQUARE_CENTRE = 104.5;

function findDir(root, name, depth = 7) {
  if (depth < 0 || !existsSync(root)) return null;
  for (const entry of readdirSync(root)) {
    const p = join(root, entry);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    if (entry === name && existsSync(join(p, "1.png"))) return p;
    const hit = findDir(p, name, depth - 1);
    if (hit) return hit;
  }
  return null;
}

const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

describe("layers and the hybrid path in a real browser", { skip: CHROME ? false : "no Chrome/Chromium found (set CHROME_PATH)" }, () => {
  let studio;
  let browser;
  let page;
  const consoleErrors = [];
  const failedRequests = [];
  const generateCalls = [];
  const baseRgba = texturedRgba(1);
  const ctx = {};

  before(async () => {
    studio = await startStudio({ extraEnv: { WELCOME_CREDITS: "100", EARLY_WELCOME_CREDITS: "100" } });
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
    page.on("request", (r) => {
      if (new URL(r.url()).pathname === "/api/generate") generateCalls.push(Date.now());
    });
    await page.goto(`http://127.0.0.1:${studio.port}/studio/`);
    await page.waitForSelector("#o-name");
    // The beginner path hides the engine picker. This file switches engines, so it leaves the path.
    await page.uncheck("#path-beginner");
  });

  after(async () => {
    await browser?.close();
    await studio?.stop();
  });

  const tab = (name) => page.click(`nav [data-tab="${name}"], [data-tab="${name}"]`);
  const waitReload = async (action) => {
    const loaded = page.waitForEvent("load");
    await action();
    await loaded;
    await page.waitForSelector("#o-id", { state: "attached" });
    await waitFor(async () => (await page.$$("#projects-list li")).length > 0, { what: "the studio to boot again" });
  };
  const text = (sel) => page.textContent(sel).then((t) => (t || "").replace(/\s+/g, " ").trim());

  /** Selects the trait in the Constructor and returns it, with its "Додатково" block open. */
  async function openTrait(key) {
    await tab("ctor");
    await waitFor(async () => (await page.$$("#opt-trait-key option")).length > 0, { what: "the trait list" });
    await page.selectOption("#opt-trait-key", key);
    await page.evaluate(() => {
      const d = document.getElementById("opt-layer-only").closest("details");
      if (d) d.open = true;
    });
  }
  const saveTraits = async () => {
    await page.click("#ctor-save");
    await waitFor(async () => /\S/.test(await text("#ctor-msg")), { what: "the save message" });
  };

  /** Paints a frame in the hybrid preview and reads it back: the message and the position of the red square. */
  async function preview(edition, over = ctx.set) {
    await tab("render");
    await page.selectOption("#g-compose-over", over);
    await page.fill("#g-compose-preview-n", String(edition));
    await page.evaluate(() => {
      document.getElementById("g-compose-preview-msg").textContent = "";
    });
    await page.click("#g-compose-preview");
    await waitFor(async () => /\S/.test(await text("#g-compose-preview-msg")) && !/Зачекайте|please wait|working/i.test(await text("#g-compose-preview-msg")), { what: "the preview message" });
    const msg = await text("#g-compose-preview-msg");
    const box = await page.evaluate(async () => {
      const img = document.getElementById("g-compose-preview-img");
      if (img && !img.hidden) await img.decode().catch(() => {});
      if (!img || img.hidden || !img.complete || !img.naturalWidth) return null;
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          const i = (y * c.width + x) * 4;
          if (Math.abs(d[i] - 220) <= 6 && Math.abs(d[i + 1] - 20) <= 6 && Math.abs(d[i + 2] - 20) <= 6) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      return x1 < 0 ? { found: false, w: c.width, h: c.height } : { found: true, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: c.width, h: c.height };
    });
    return { msg, box };
  }
  const paintedCount = (msg) => Number(/(?:накладено|layers painted)\D*(\d+)|(\d+)\s+layers painted/i.exec(msg)?.slice(1).find(Boolean) ?? -1);

  it("uploads a textured base, saves a 4-frame mock series and builds its frames", async () => {
    await tab("base");
    await page.selectOption("#base-role", { index: 0 });
    await page.setInputFiles("#base-file", { name: "primary.png", mimeType: "image/png", buffer: pngOf(baseRgba) });
    await waitFor(async () => !(await page.isDisabled("#base-upload")), { what: "upload button" });
    await page.click("#base-upload");
    await waitFor(async () => (await studio.call("GET", "/api/base/list")).json?.files?.some?.((f) => f.primary), { what: "the base on the server" });

    await tab("home");
    await page.fill("#o-name", "E2E Layers");
    await page.fill("#o-id", "e2e-layers");
    await page.fill("#o-size", "4");
    await page.click("#o-defaults > summary");
    await page.selectOption("#o-engine", "mock");
    await waitReload(() => page.click("#o-save"));
    await waitFor(async () => /e2e-layers\.json/.test(await text("#o-msg")), { what: "save message" });

    await tab("recipes");
    await page.selectOption("#r-preset", "e2e-layers.json");
    await page.click("#r-build");
    await waitFor(async () => (await page.$$("#r-table tr")).length >= 4, { what: "recipe rows" });

    await tab("render");
    await page.selectOption("#g-engine", "mock");
    await page.fill("#g-pilot", "4");
    await page.click("#g-estimate");
    await waitFor(async () => /Згенерувати: 4/.test(await text("#g-plan-out")), { what: "estimate" });
    await page.click("#g-run");
    await waitFor(async () => /100%/.test(await text("#g-progress-pct")) && (await page.$$("#g-thumbs img")).length === 4, { what: "4 frames" });

    const sets = (await studio.call("GET", "/api/sets")).json.sets;
    assert.equal(sets.length, 1);
    ctx.set = sets[0].dir;
    ctx.setDir = findDir(studio.dir, ctx.set);
    assert.ok(ctx.setDir, `the frames of ${ctx.set} are on disk`);
    const archive = (await studio.call("GET", "/api/archive/latest")).json.archive;
    ctx.recipes = archive.recipes;
    ctx.value = ctx.recipes[0].traits.hair;
    ctx.withLayer = ctx.recipes.filter((r) => r.traits.hair === ctx.value).map((r) => r.edition);
    ctx.without = ctx.recipes.find((r) => r.traits.hair !== ctx.value)?.edition ?? null;
    assert.ok(ctx.value && ctx.value !== "None", "edition 1 has a hair value to draw a layer for");
  });

  it("Constructor: a layers ZIP uploads and the card shows what it covers", async () => {
    await tab("ctor");
    const zip = new JSZip();
    zip.file(`hair/${ctx.value}.png`, layerPng());
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    await page.setInputFiles("#ctor-layers-file", { name: "layers.zip", mimeType: "application/zip", buffer });
    await waitFor(async () => !(await page.isDisabled("#ctor-layers-upload")), { what: "the ZIP upload button" });
    await page.click("#ctor-layers-upload");
    await waitFor(async () => (await studio.call("GET", "/api/layers/status")).json?.files === 1, { what: "the layer on the server" });
    await waitFor(async () => /\S/.test(await text("#ctor-layers-status")), { what: "the coverage card" });
    const status = (await studio.call("GET", "/api/layers/status")).json;
    assert.equal(status.exists, true);
    assert.equal(status.files, 1);
  });

  it("Generate: the same layers show there, and «Paint over» offers the base and the series set", async () => {
    await tab("render");
    await waitFor(async () => /\S/.test(await text("#g-layers-status")), { what: "the layers card on the Generate tab" });
    const values = await page.$$eval("#g-compose-over option", (os) => os.map((o) => o.value));
    assert.ok(values.includes(""), "the base image is the first choice");
    assert.ok(values.includes(ctx.set), `the set ${ctx.set} can be painted over: ${values}`);
  });

  it("hybrid preview: a frame whose trait has a layer gets it painted, the others stay as the model drew them", async () => {
    const hit = await preview(ctx.withLayer[0]);
    assert.equal(paintedCount(hit.msg), 1, hit.msg);
    assert.ok(hit.box?.found, "the red square is on the preview");
    // the model frames are bigger than the 256 px layer: it is scaled to the frame, so the square scales with it
    const k = hit.box.w / SIZE;
    assert.ok(Math.abs(hit.box.cx - SQUARE_CENTRE * k) <= k + 1 && Math.abs(hit.box.cy - SQUARE_CENTRE * k) <= k + 1, `the layer sits where it was drawn, scaled to the frame: ${JSON.stringify(hit.box)}`);
    if (ctx.without) {
      const miss = await preview(ctx.without);
      assert.equal(paintedCount(miss.msg), 0, miss.msg);
      assert.equal(miss.box?.found, false, "no layer file for this frame's trait, nothing painted");
    }
  });

  it("hybrid compose writes a new set and never touches the source frames", async () => {
    const before = [1, 2, 3, 4].map((n) => sha(join(ctx.setDir, `${n}.png`)));
    await tab("render");
    await page.selectOption("#g-compose-over", ctx.set);
    await page.click("#g-compose");
    await waitFor(async () => /\S/.test(await text("#g-compose-msg")) && !/Зачекайте|please wait|working|…$/i.test(await text("#g-compose-msg")), { what: "the compose message (not the progress line)" });
    const msg = await text("#g-compose-msg");
    assert.match(msg, new RegExp(`${ctx.set}-layers`), msg);
    const sets = (await studio.call("GET", "/api/sets")).json.sets.map((s) => s.dir);
    assert.ok(sets.includes(`${ctx.set}-layers`), `new set listed: ${sets}`);
    const out = findDir(studio.dir, `${ctx.set}-layers`);
    assert.ok(out && existsSync(join(out, "dna.json")), "frames and dna.json written");
    const report = JSON.parse(readFileSync(join(out, "dna.json"), "utf8"));
    assert.equal(report.over, ctx.set);
    assert.equal(report.painted, ctx.withLayer.length, "only frames whose trait has a layer are changed");
    assert.deepEqual([1, 2, 3, 4].map((n) => sha(join(ctx.setDir, `${n}.png`))), before, "the source set is untouched");
  });

  it("Review says which set the layers version came from, and the original says which versions exist", async () => {
    await tab("gallery");
    await waitFor(async () => (await page.$$eval("#v-dir option", (os) => os.map((o) => o.value))).includes(`${ctx.set}-layers`), { what: "the layers set in the selector" });
    await page.selectOption("#v-dir", `${ctx.set}-layers`);
    await waitFor(async () => /змінено|changed/i.test(await text("#v-lineage")), { what: "the origin line of the layers set" });
    const from = await text("#v-lineage");
    assert.ok(from.includes(ctx.set), `names the source set: ${from}`);
    assert.match(from, new RegExp(`${ctx.withLayer.length}`), "says how many frames were changed");
    await page.selectOption("#v-dir", ctx.set);
    await waitFor(async () => (await text("#v-lineage")).includes(`${ctx.set}-layers`), { what: "the versions line on the source set" });
  });

  it("a frame can have its own layer offset, saved with the set, applied in the preview and cleared again", async () => {
    const edition = ctx.withLayer[0];
    const base = await preview(edition);
    assert.ok(base.box?.found, base.msg);
    assert.equal(await page.isEnabled("#g-frame-off-save"), true, "painting over a set: the offset can be saved");
    await page.fill("#g-frame-off-x", "6");
    await page.fill("#g-frame-off-y", "4");
    await page.click("#g-frame-off-save");
    await waitFor(async () => /\S/.test(await text("#g-frame-off-msg")) && !/Зачекайте|please wait|working/i.test(await text("#g-frame-off-msg")), { what: "the saved message" });
    const stored = JSON.parse(readFileSync(join(ctx.setDir, "layer-offsets.json"), "utf8"));
    assert.deepEqual(stored[String(edition)], { x: 6, y: 4 }, "kept with the set, not with the preset");
    const moved = await preview(edition);
    assert.ok(Math.abs(moved.box.cx - base.box.cx - 6) <= 1 && Math.abs(moved.box.cy - base.box.cy - 4) <= 1, `the layer moved by (6, 4): ${JSON.stringify(base.box)} -> ${JSON.stringify(moved.box)}`);
    assert.equal(await page.inputValue("#g-frame-off-x"), "6", "the preview shows the offset it applied");
    const other = ctx.withLayer[1];
    if (other) {
      const untouched = await preview(other);
      assert.ok(Math.abs(untouched.box.cx - base.box.cx) <= 1 && Math.abs(untouched.box.cy - base.box.cy) <= 1, "another frame is not moved");
    }
    await preview(edition);
    await page.fill("#g-frame-off-x", "0");
    await page.fill("#g-frame-off-y", "0");
    await page.click("#g-frame-off-save");
    await waitFor(async () => !("" + readFileSync(join(ctx.setDir, "layer-offsets.json"), "utf8")).includes(`"${edition}"`), { what: "the offset cleared" });
    const back = await preview(edition);
    assert.ok(Math.abs(back.box.cx - base.box.cx) <= 1 && Math.abs(back.box.cy - base.box.cy) <= 1, "0/0 puts the layer back");
  });

  it("painting over the base needs a layer for every trait: the preview says so instead of drawing half a frame", async () => {
    await tab("render");
    await page.selectOption("#g-compose-over", "");
    await page.fill("#g-compose-preview-n", "1");
    await page.click("#g-compose-preview");
    await waitFor(async () => /\S/.test(await text("#g-compose-preview-msg")) && !/Зачекайте|please wait|working/i.test(await text("#g-compose-preview-msg")), { what: "the preview message" });
    assert.match(await text("#g-compose-preview-msg"), /missing layer|бракує|відсутн/i);
    assert.equal(await page.isHidden("#g-compose-preview-img") || (await page.getAttribute("#g-compose-preview-img", "src")) === null, true);
  });

  it("a critical trait without its layer file stops a paid run until the author confirms", async () => {
    await openTrait("mark");
    await page.check("#opt-layer-only");
    await saveTraits();
    await tab("render");
    await waitFor(async () => /\S/.test(await text("#g-layers-status")), { what: "the layers card" });
    await page.selectOption("#g-engine", "fal");
    await page.click("#g-estimate");
    await waitFor(async () => /\S/.test(await text("#g-plan-out")), { what: "the estimate" });
    const calls = generateCalls.length;
    await page.click("#g-run");
    await waitFor(async () => page.isVisible("#g-critical-gate"), { what: "the critical-trait warning" });
    assert.match(await text("#g-critical-gate-body"), /mark/);
    assert.equal(generateCalls.length, calls, "nothing was sent to /api/generate");
    await page.selectOption("#g-engine", "mock");
    await openTrait("mark");
    await page.uncheck("#opt-layer-only");
    await saveTraits();
  });

  it("layerAlign: a layer drawn on the base follows a frame the model moved; without the flag it stays put", async () => {
    // the model "moved" the picture: replace the frames on disk by the base shifted by (12, -8) and zoomed by 1.05
    const moved = pngOf(warpRgba(baseRgba, SIZE, SIZE, { dx: 12, dy: -8, scale: 1.05 }));
    for (const n of [1, 2, 3, 4]) writeFileSync(join(ctx.setDir, `${n}.png`), moved);
    const edition = ctx.withLayer[0];

    const plain = await preview(edition);
    assert.ok(plain.box?.found, plain.msg);
    assert.ok(Math.abs(plain.box.cx - SQUARE_CENTRE) <= 1 && Math.abs(plain.box.cy - SQUARE_CENTRE) <= 1, `no flag: the layer stays where it was drawn ${JSON.stringify(plain.box)}`);
    assert.doesNotMatch(plain.msg, /підігнано|aligned/i);

    await openTrait("hair");
    await page.check("#opt-layer-align");
    await saveTraits();
    const aligned = await preview(edition);
    const m = /(-?\d+),\s*(-?\d+)\s*px/.exec(aligned.msg);
    assert.ok(m, `the preview reports the move found: ${aligned.msg}`);
    assert.ok(Math.abs(Number(m[1]) - 12) <= 4 && Math.abs(Number(m[2]) + 8) <= 4, `shift ~(12, -8): ${aligned.msg}`);
    const want = [127.5 + 1.05 * (SQUARE_CENTRE - 127.5) + 12, 127.5 + 1.05 * (SQUARE_CENTRE - 127.5) - 8];
    assert.ok(aligned.box?.found, aligned.msg);
    assert.ok(Math.abs(aligned.box.cx - want[0]) <= 5 && Math.abs(aligned.box.cy - want[1]) <= 5, `the layer moved with the frame: got ${JSON.stringify(aligned.box)}, want ~${want.map((v) => v.toFixed(1))}`);
  });

  it("layerAlign: an unrelated frame leaves the layer where it was drawn and says why", async () => {
    const unrelated = pngOf(texturedRgba(99, true));
    for (const n of [1, 2, 3, 4]) writeFileSync(join(ctx.setDir, `${n}.png`), unrelated);
    const r = await preview(ctx.withLayer[0]);
    assert.match(r.msg, /пропущено|skipped/i, r.msg);
    assert.ok(r.box?.found && Math.abs(r.box.cx - SQUARE_CENTRE) <= 1 && Math.abs(r.box.cy - SQUARE_CENTRE) <= 1, `the layer was not moved: ${JSON.stringify(r.box)}`);
  });

  it("the whole session stayed clean: no page errors, no server errors", () => {
    assert.deepEqual(consoleErrors.filter((e) => /pageerror/.test(e)), []);
    const serverErrors = failedRequests.filter((r) => /^5\d\d /.test(r));
    assert.deepEqual(serverErrors, []);
  });
});
