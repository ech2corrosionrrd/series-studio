import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseEnv, loadKeys, keyPresence } from "../src/keys.mjs";

test("parseEnv skips comments and blank lines", () => {
  const out = parseEnv("# comment\n\nFOO=bar\n  # another\nBAZ=qux\n");
  assert.deepEqual(out, { FOO: "bar", BAZ: "qux" });
});

test("parseEnv comment with Ukrainian apostrophe does not swallow next KEY=value", () => {
  const text = [
    "# ключі обов'язкові для генерації",
    "OPENAI_API_KEY=sk-test-123",
    "REPLICATE_API_TOKEN=r8_test",
  ].join("\n");
  const out = parseEnv(text);
  assert.equal(out.OPENAI_API_KEY, "sk-test-123");
  assert.equal(out.REPLICATE_API_TOKEN, "r8_test");
});

test("parseEnv handles quoted values", () => {
  const out = parseEnv("A=\"hello world\"\nB='single quoted'\nC=plain # trailing comment\n");
  assert.equal(out.A, "hello world");
  assert.equal(out.B, "single quoted");
  assert.equal(out.C, "plain");
});

test("parseEnv supports export FOO=bar", () => {
  const out = parseEnv("export FOO=bar\nexport BAZ=\"qux\"\n");
  assert.equal(out.FOO, "bar");
  assert.equal(out.BAZ, "qux");
});

test("loadKeys reads temp .env, returns path, does not override existing env", () => {
  const dir = mkdtempSync(join(tmpdir(), "series-keys-"));
  const envPath = join(dir, ".env");
  writeFileSync(envPath, "NEW_KEY=from-file\nEXISTING_KEY=from-file\n", "utf8");
  try {
    const env = { EXISTING_KEY: "keep-me", SERIES_KEYS_FILE: envPath };
    const loaded = loadKeys(undefined, env);
    assert.equal(loaded, envPath);
    assert.equal(env.NEW_KEY, "from-file");
    assert.equal(env.EXISTING_KEY, "keep-me");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadKeys is self-contained: ignores SERIES_PLATFORM_ENV", () => {
  const dir = mkdtempSync(join(tmpdir(), "series-keys-self-"));
  const cwdEnv = join(dir, ".env");
  const foreign = join(dir, "foreign.env");
  writeFileSync(cwdEnv, `SERIES_PLATFORM_ENV=${foreign.replace(/\\/g, "/")}\nLAB_ONLY=1\n`, "utf8");
  writeFileSync(
    foreign,
    "HELIO_PAYLINK_START=aa11bb22\nOPENAI_API_KEY=should-not-load\nTELEGRAM_BOT_TOKEN=nope\n",
    "utf8",
  );
  const prev = process.cwd();
  try {
    process.chdir(dir);
    const env = { SERIES_PLATFORM_ENV_SILENCE: "1" };
    const loaded = loadKeys(undefined, env);
    assert.equal(loaded, cwdEnv);
    assert.equal(env.LAB_ONLY, "1");
    assert.equal(env.HELIO_PAYLINK_START, undefined);
    assert.equal(env.OPENAI_API_KEY, undefined);
    assert.equal(env.TELEGRAM_BOT_TOKEN, undefined);
  } finally {
    process.chdir(prev);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("keyPresence reports present/missing without exposing values", () => {
  const env = { A: "x", B: "  ", C: undefined };
  assert.deepEqual(keyPresence(["A", "B", "C"], env), [
    { name: "A", present: true },
    { name: "B", present: false },
    { name: "C", present: false },
  ]);
});
