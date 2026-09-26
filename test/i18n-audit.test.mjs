import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("audit:i18n — locales match and UI strings are keyed", () => {
  const r = spawnSync(process.execPath, ["scripts/audit-i18n.mjs"], { encoding: "utf8" });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
});
