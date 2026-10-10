// The workspace save is debounced (400 ms): closing the tab inside that window must still send it.
// Source-level contract (the browser path cannot be driven deterministically: saving a project restarts the studio).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../server/ui/app.js", import.meta.url), "utf8");

test("a pending workspace save is flushed with keepalive when the tab is hidden or closed", () => {
  assert.match(src, /window\.addEventListener\("pagehide", flushWorkspace\)/);
  assert.match(src, /visibilityState === "hidden"\) flushWorkspace\(\)/);
  assert.match(src, /saveWorkspace\(workspacePending, \{ keepalive: true \}\)/);
  assert.match(src, /\.\.\.\(keepalive \? \{ keepalive: true \} : \{\}\)/);
});

test("the pending marker is set when a save is scheduled and cleared when it is sent", () => {
  assert.match(src, /workspacePending = patch \|\| \{\};/);
  assert.match(src, /async function saveWorkspace\([^)]*\{ keepalive = false \} = \{\}\) \{\r?\n\s*workspacePending = null;/);
});
