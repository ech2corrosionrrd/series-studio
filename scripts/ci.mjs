#!/usr/bin/env node
// Локальна перевірка замість GitHub CI: усі кроки з CLAUDE.md одним запуском.
//   npm run ci            тести, документація, i18n, UI, API
//   npm run ci -- --audit додатково npm audit (лише попередження)
// Код виходу 0 — усе зелене, 1 — є червоний крок.
import { spawnSync } from "node:child_process";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`Потрібен Node >=22.13, зараз ${process.versions.node}.`);
  process.exit(1);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const steps = [
  ["npm test + поріг покриття src/", ["run", "coverage"]],
  ["docs:check", ["run", "docs:check"]],
  ["audit:i18n", ["run", "audit:i18n"]],
  ["audit:ui", ["run", "audit:ui"]],
  ["audit:help", ["run", "audit:help"]],
  ["audit:api", ["run", "audit:api"]],
];
const informational = process.argv.includes("--audit")
  ? [["npm audit (попередження)", ["audit", "--omit=dev", "--audit-level=high"]]]
  : [];

const run = (args) => spawnSync(npm, args, { stdio: "inherit", shell: process.platform === "win32" }).status;

const results = [];
for (const [name, args] of steps) {
  console.log(`\n▶ ${name}`);
  const t0 = Date.now();
  results.push({ name, ok: run(args) === 0, sec: ((Date.now() - t0) / 1000).toFixed(1) });
}
for (const [name, args] of informational) {
  console.log(`\n▶ ${name}`);
  results.push({ name, ok: true, warn: run(args) !== 0, sec: "-" });
}

console.log("\nПідсумок:");
for (const r of results) console.log(`  ${r.ok ? (r.warn ? "⚠" : "✓") : "✗"} ${r.name} (${r.sec} с)`);
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\nЧервоних кроків: ${failed.length}` : "\nУсе зелене.");
process.exit(failed.length ? 1 : 0);
