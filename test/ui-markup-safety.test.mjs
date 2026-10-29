// A dictionary string reaches the page as HTML only through innerHTML. It must go through escapeHtml, so that
// markup that ever lands in a translation (or a value a translation is filled with) cannot run in the studio.
// The restore path must not write to the console on success. Source-level contract.
import { test } from "node:test";
import { readUiSource } from "../scripts/ui-source.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readUiSource();

test("no innerHTML line interpolates a bare t(...) call", () => {
  const bad = src
    .split(/\r?\n/)
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => line.includes("innerHTML") && /\$\{\s*t\(/.test(line));
  assert.deepEqual(bad.map((b) => `${b.n}: ${b.line.trim().slice(0, 90)}`), []);
});

test("a successful workspace restore is silent", () => {
  assert.ok(!/console\.info\(/.test(src), "console.info is back");
});
