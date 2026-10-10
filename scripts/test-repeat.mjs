#!/usr/bin/env node
// Finds flaky tests: runs the whole suite N times (default 3) and lists every test that failed in any run.
//   npm run test:repeat            3 runs
//   npm run test:repeat -- 5       5 runs
// Exit code 1 if any run failed (a test that fails now and then is a defect, in the test or in the code).
import { spawnSync } from "node:child_process";

const runs = Math.max(1, Number.parseInt(process.argv[2] || "3", 10) || 3);
const failed = new Map();
for (let i = 1; i <= runs; i++) {
  const r = spawnSync(process.execPath, ["--test"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout}\n${r.stderr}`;
  const names = [...out.matchAll(/^\s*✖ (.+?) \(\d/gm)].map((m) => m[1]);
  console.log(`run ${i}/${runs}: ${r.status === 0 ? "green" : `RED (${new Set(names).size} failing)`}`);
  for (const n of new Set(names)) failed.set(n, (failed.get(n) || 0) + 1);
}
if (failed.size) {
  console.log("\nFailed at least once:");
  for (const [n, c] of failed) console.log(`  ${c}/${runs}  ${n}`);
  process.exit(1);
}
console.log(`\nStable: ${runs}/${runs} green.`);
