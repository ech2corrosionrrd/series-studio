// A native alert() blocks the whole page (and browser automation) until it is dismissed.
// Errors must reach the author as a non-blocking toast, and an impossible preset must be a 4xx, not a 500.
// Source-level contract: the alert path itself cannot be driven without a real dialog.
import { test } from "node:test";
import { readUiSource } from "../scripts/ui-source.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ui = readUiSource();
const server = ["index.mjs", "routes/recipes.mjs"].map((f) => readFileSync(new URL(`../server/${f}`, import.meta.url), "utf8")).join("\n");

test("no error is shown through a blocking alert()", () => {
  assert.ok(!/alert\(e\.message\)/.test(ui), "alert(e.message) is back");
  assert.match(ui, /showToast\(e\.message\)/);
});

test("building an impossible preset answers 400 with the reason, not 500", () => {
  assert.match(server, /built = makeArchive\(preset\);[\s\S]{0,260}send\(res, 400, \{ ok: false, error: String\(e\.message \|\| e\), code: "build" \}\)/);
  assert.match(server, /code: "diff-seed" \}\)/);
});
