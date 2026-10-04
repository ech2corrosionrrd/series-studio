import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

test("documentation matches the code (CLI, API routes, env, docs index, version)", () => {
  let out = "";
  try {
    out = execFileSync(process.execPath, [resolve("scripts/check-docs.mjs")], { encoding: "utf8", stdio: "pipe" });
  } catch (e) {
    assert.fail(`${e.stderr || e.stdout}`);
  }
  assert.match(out, /docs ok/);
});
