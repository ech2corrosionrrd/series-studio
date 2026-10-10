// The CLI commands that had no test of their own: diff-seed, provenance, dataset, repair-png, upscale, notify, c2pa.
// Every run is isolated: temp cwd, project .env ignored, no API keys, no Telegram (a test must never send a message).
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { createMockPng } from "../src/mock-image.mjs";

const BIN = resolve("bin/series.mjs");
const PRESET = resolve("presets/demo-series.json");
const cwd = mkdtempSync(join(tmpdir(), "series-cli-"));
const env = { ...process.env, SERIES_SKIP_DOTENV: "1", SERIES_KEYS_FILE: join(cwd, "none.env"), OFFLINE: "1" };
for (const k of Object.keys(env)) if (/TELEGRAM|API_KEY|_TOKEN|FAL_KEY|PRIVATE_KEY|REPLICATE|STABILITY/i.test(k)) delete env[k];

function run(...args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, env, encoding: "utf8", timeout: 90_000 });
  return { code: r.status, out: String(r.stdout || ""), err: String(r.stderr || ""), all: `${r.stdout || ""}${r.stderr || ""}` };
}
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const isPng = (file) => readFileSync(file).subarray(0, 4).equals(PNG_MAGIC);

before(() => {
  mkdirSync(join(cwd, "input"), { recursive: true });
  writeFileSync(join(cwd, "input", "primary.png"), createMockPng({ seed: 7, title: "primary" }));
});
after(() => rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

describe("series diff-seed", () => {
  it("the same seed gives identical DNA", () => {
    const r = run("diff-seed", PRESET);
    assert.equal(r.code, 0, r.all);
    assert.match(r.out, /48 DNA identical/);
  });
  it("a missing preset is a clean error with a non-zero exit", () => {
    const r = run("diff-seed", join(cwd, "nope.json"));
    assert.notEqual(r.code, 0);
  });
});

describe("render (mock) → provenance → dataset", () => {
  let setDir;
  it("renders 4 mock frames for free", () => {
    const r = run("render", PRESET, "-e", "mock", "--limit", "4");
    assert.equal(r.code, 0, r.all);
    const sets = readdirSync(join(cwd, "out")).filter((n) => n.startsWith("mock-"));
    assert.equal(sets.length, 1);
    setDir = join("out", sets[0]);
    assert.equal(readdirSync(join(cwd, setDir)).filter((f) => /^\d+\.png$/.test(f)).length, 4);
  });
  it("provenance prints a sha256 over the 4 images and is repeatable", () => {
    const a = run("provenance", setDir);
    assert.equal(a.code, 0, a.all);
    assert.match(a.out, /for 4 images/);
    const hash = /Provenance Hash\s*:\s*([0-9a-f]{64})/.exec(a.out)?.[1];
    assert.ok(hash, a.out);
    assert.equal(/Provenance Hash\s*:\s*([0-9a-f]{64})/.exec(run("provenance", setDir).out)?.[1], hash);
  });
  it("provenance of a missing folder fails", () => {
    assert.notEqual(run("provenance", join(cwd, "missing")).code, 0);
  });
  it("dataset writes a ZIP of image+caption pairs", () => {
    assert.equal(run("build", PRESET, "-o", "a.json").code, 0);
    const r = run("dataset", "a.json", "--images", setDir, "-o", "ds");
    assert.equal(r.code, 0, r.all);
    assert.match(r.out, /4 pairs/);
  });
  it("dataset without an images folder fails with a clear message", () => {
    const r = run("dataset", "a.json", "--images", join(cwd, "missing"));
    assert.notEqual(r.code, 0);
    assert.match(r.all, /images directory does not exist/);
  });
});

describe("series repair-png", () => {
  const dir = join(cwd, "jpg-as-png");
  before(async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "1.png"), await sharp(createMockPng({ seed: 3, title: "c" })).jpeg().toBuffer());
    writeFileSync(join(dir, "2.png"), createMockPng({ seed: 4, title: "d" }));
  });
  it("--dry-run reports but changes nothing", () => {
    const r = run("repair-png", dir, "--dry-run");
    assert.equal(r.code, 0, r.all);
    assert.match(r.out, /would convert 1/);
    assert.equal(isPng(join(dir, "1.png")), false);
  });
  it("converts a JPEG saved as .png into a real PNG, and a second run has nothing to do", () => {
    const r = run("repair-png", dir);
    assert.equal(r.code, 0, r.all);
    assert.match(r.out, /converted 1/);
    assert.equal(isPng(join(dir, "1.png")), true);
    assert.match(run("repair-png", dir).out, /converted 0/);
  });
});

describe("series upscale", () => {
  const src = join(cwd, "to-upscale");
  before(() => {
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, "1.png"), createMockPng({ seed: 11, title: "u" }));
  });
  it("never overwrites the originals by default: the result goes to <dir>-2x", async () => {
    const before = readFileSync(join(src, "1.png"));
    const r = run("upscale", src);
    assert.equal(r.code, 0, r.all);
    assert.ok(readFileSync(join(src, "1.png")).equals(before), "the original is untouched");
    const out = `${src}-2x`;
    assert.ok(existsSync(join(out, "1.png")), "the 2x copy exists next to it");
    const a = await sharp(before).metadata();
    const b = await sharp(readFileSync(join(out, "1.png"))).metadata();
    assert.equal(b.width, a.width * 2);
  });
  it("upscales in place only when -o names the same folder on purpose", async () => {
    const r = run("upscale", src, "-o", src);
    assert.equal(r.code, 0, r.all);
    const meta = await sharp(readFileSync(join(src, "1.png"))).metadata();
    assert.ok(meta.width >= 2 * 64);
  });
  it("a missing folder is a non-zero exit", () => {
    assert.notEqual(run("upscale", join(cwd, "missing")).code, 0);
  });
});

describe("series notify", () => {
  it("without Telegram configured it fails loudly (exit 1) and sends nothing", () => {
    const r = run("notify");
    assert.equal(r.code, 1, r.all);
    assert.match(r.all, /not configured/);
  });
  it("with a custom message and no Telegram it also fails (the message is not silently dropped)", () => {
    const r = run("notify", "hello from a test");
    assert.equal(r.code, 1, r.all);
    assert.match(r.all, /not configured/);
  });
});

describe("series c2pa", () => {
  const dir = join(cwd, "c2pa-set");
  before(() => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "1.png"), createMockPng({ seed: 21, title: "x" }));
    writeFileSync(join(dir, "2.png"), createMockPng({ seed: 22, title: "y" }));
  });
  it("--dry-run lists the frames it would sign and signs nothing", () => {
    const r = run("c2pa", dir, "--cert", "chain.pem", "--key", "key.pem", "--dry-run");
    assert.equal(r.code, 0, r.all);
    assert.match(r.out, /Would sign 2 frames/);
    assert.equal(existsSync(`${dir}-c2pa`), false);
  });
  it("without the signing library or the key files it stops with a hint, not a crash", () => {
    const r = run("c2pa", dir, "--cert", "chain.pem", "--key", "key.pem");
    assert.notEqual(r.code, 0, "an unsigned run must not look like success");
    assert.match(r.all, /c2pa-node|not found|ENOENT|cert|key/i);
  });
});
