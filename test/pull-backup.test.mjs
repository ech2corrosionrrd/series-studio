import { test } from "node:test";
import assert from "node:assert/strict";
import { newestSlot, pruneList } from "../scripts/pull-backup.mjs";

test("newestSlot picks the latest YYYYMMDD-HHMM slot and ignores noise", () => {
  assert.equal(newestSlot("20261004-0905/\n20261004-1945/\n20260930-0005\nlost+found\n"), "20261004-1945");
  assert.equal(newestSlot("junk\n"), "");
});

test("pruneList keeps the newest N pulled copies only", () => {
  const files = ["users-20261001-0005.db", "users-20261003-0005.db", "users-20261002-0005.db", "notes.txt"];
  assert.deepEqual(pruneList(files, 2), ["users-20261001-0005.db"]);
  assert.deepEqual(pruneList(files.slice(0, 2), 5), []);
});
