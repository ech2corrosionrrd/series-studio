import test from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { isInsideDir } from "../src/fs-safe.mjs";

test("isInsideDir accepts the root and anything below it, with the platform's own separators", () => {
  const root = resolve("project-root");
  assert.equal(isInsideDir(root, root), true);
  assert.equal(isInsideDir(root, resolve(root, "layers")), true);
  assert.equal(isInsideDir(root, join(root, "layers", "hair", "bob.png")), true);
  assert.equal(isInsideDir(root, resolve(root, "..foo")), true, "a folder named ..foo is inside");
});

test("isInsideDir rejects escapes and siblings", () => {
  const root = resolve("project-root");
  assert.equal(isInsideDir(root, resolve(root, "..")), false);
  assert.equal(isInsideDir(root, resolve(root, "..", "other")), false);
  assert.equal(isInsideDir(root, resolve(root, "layers", "..", "..", "etc")), false);
  assert.equal(isInsideDir(root, resolve("project-root-evil")), false, "prefix match is not containment");
});
