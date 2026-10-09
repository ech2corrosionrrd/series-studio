#!/usr/bin/env node
/**
 * Documentation freshness check. Run before every commit (`npm run docs:check`,
 * also wired into .githooks/pre-commit). Offline, read-only.
 *
 * It cannot judge prose, but it fails on the drift that happens most:
 *   1. a CLI command in `series --help` that README/GUIDE never mention;
 *   2. an /api route in server/index.mjs that docs/API.md never lists;
 *   3. an .env.example variable that no document mentions;
 *   4. a docs/*.md file missing from docs/README.md;
 *   5. a package.json version that docs/README.md does not state;
 *   6. a removed provider (Pinata) still named in live docs or code;
 *   7. code changed in this commit but neither CHANGELOG.md nor any docs file (staged check, hook only).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const problems = [];
const fail = (msg) => problems.push(msg);

const docsDir = join(root, "docs");
const docFiles = readdirSync(docsDir).filter((f) => f.endsWith(".md"));
const allDocs = [read("README.md"), ...docFiles.map((f) => read(`docs/${f}`))].join("\n");

// 1. CLI commands
const usage = execFileSync(process.execPath, [join(root, "bin/series.mjs"), "--help"], { encoding: "utf8" });
const cliDocs = read("README.md") + read("docs/GUIDE.md");
const commands = [...new Set([...usage.matchAll(/^\s{2}series ([a-z][a-z0-9-]*)\b/gm)].map((m) => m[1]))];
for (const c of commands) {
  if (!new RegExp(`series(?:\\.mjs)? ${c}\\b|\`${c}\``).test(cliDocs)) fail(`CLI command "series ${c}" is not documented in README.md or docs/GUIDE.md`);
}

// 2. API routes
const server = read("server/index.mjs");
const api = read("docs/API.md");
const routes = [...new Set([...server.matchAll(/pathname === "(\/api\/[^"]+)"/g)].map((m) => m[1]))];
for (const r of routes) if (!api.includes(r)) fail(`route ${r} is not listed in docs/API.md`);

// 3. env variables
const envKeys = [...read(".env.example").matchAll(/^#?\s*([A-Z][A-Z0-9_]{3,})=/gm)].map((m) => m[1]);
for (const k of new Set(envKeys)) if (!allDocs.includes(k)) fail(`${k} (.env.example) is not mentioned in README.md or docs/`);

// 4. docs index
const index = read("docs/README.md");
for (const f of docFiles) if (f !== "README.md" && !index.includes(f)) fail(`docs/${f} is missing from docs/README.md`);

// 5. version
const version = JSON.parse(read("package.json")).version;
if (!index.includes(`v${version}`)) fail(`docs/README.md does not state the current version v${version}`);
if (!read("CHANGELOG.md").includes("## [Unreleased]")) fail("CHANGELOG.md has no [Unreleased] section");

// 6. removed provider
const LIVE = ["README.md", ".env.example", "bin/series.mjs", ...docFiles.map((f) => `docs/${f}`)];
const HISTORY = new Set(["docs/ROADMAP.md", "docs/RECOMMENDATIONS.md", "docs/QUALITY-REVIEW.md"]);
for (const f of LIVE) {
  if (HISTORY.has(f)) continue;
  if (/pinata(?!Config)/i.test(read(f))) fail(`${f} still names Pinata (removed from the project)`);
}
for (const dir of ["src", "server"]) {
  const walk = (d) => readdirSync(join(root, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  for (const f of walk(dir)) {
    if (!/\.(mjs|js|html|md)$/.test(f)) continue;
    if (/pinata(?!Config)/i.test(read(f))) fail(`${f.replaceAll("\\", "/")} still names Pinata`);
  }
}

// 7. staged changes (hook mode only)
if (process.argv.includes("--staged")) {
  let staged = [];
  try {
    staged = execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    staged = [];
  }
  const code = staged.filter((f) => /^(src|server|bin|scripts)\//.test(f) || f === "package.json");
  const docs = staged.filter((f) => f === "CHANGELOG.md" || f === "README.md" || f.startsWith("docs/"));
  if (code.length && !docs.length) {
    fail("code changed but no documentation is staged: update CHANGELOG.md and the affected docs/ (or commit with SKIP_DOCS_CHECK=1 for a pure refactor)");
  }
  if (code.length && !staged.includes("CHANGELOG.md")) {
    fail("code changed but CHANGELOG.md is not staged: add a line under [Unreleased]");
  }
}

if (problems.length) {
  console.error(`Documentation is out of date (${problems.length}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`docs ok: ${commands.length} CLI commands, ${routes.length} routes, ${new Set(envKeys).size} env vars, ${docFiles.length} documents`);
