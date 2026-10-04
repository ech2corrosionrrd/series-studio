import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { nodeVersionOk, MIN_NODE } from "../src/require-node.mjs";

test("nodeVersionOk follows package.json engines", () => {
  assert.deepEqual(MIN_NODE, [22, 13]);
  for (const v of ["22.13.0", "22.20.1", "24.21.0", "26.0.0"]) assert.equal(nodeVersionOk(v), true, v);
  for (const v of ["20.19.0", "21.7.3", "22.12.9", "18.0.0"]) assert.equal(nodeVersionOk(v), false, v);
});

test("CLI and server import the guard before anything else", async () => {
  const { readFileSync } = await import("node:fs");
  for (const f of ["bin/series.mjs", "server/index.mjs"]) {
    const src = readFileSync(resolve(f), "utf8");
    const imports = src.split("\n").filter((l) => l.startsWith("import "));
    assert.match(imports[0], /require-node\.mjs/, `${f} must import require-node.mjs first`);
  }
  // and it does not get in the way on a supported Node
  const out = execFileSync(process.execPath, [resolve("bin/series.mjs"), "--help"], { encoding: "utf8" });
  assert.match(out, /Series Lab CLI/);
});
