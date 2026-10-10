#!/usr/bin/env node
// PostToolUse (Edit|Write): після правки коду/конфігів ганяє docs:check, щоб розбіжність з документами було видно одразу.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

let d = {};
try { d = JSON.parse(readFileSync(0, "utf8")); } catch { process.exit(0); }
const file = String(d.tool_input?.file_path || "").replaceAll(String.fromCharCode(92), "/");
if (!/\/(src|server|bin|scripts)\/|\/\.env\.example$|\/package\.json$|\/docs\/[^/]+\.md$/.test(file)) process.exit(0);

const r = spawnSync(process.execPath, ["scripts/check-docs.mjs"], { cwd: d.cwd || process.cwd(), encoding: "utf8" });
if (r.status !== 0) {
  // Не блокуємо: розбіжність може закритися наступною правкою в тому ж завданні.
  process.stderr.write(`docs:check показує розбіжності після правки ${file} (закрити до коміту):\n${(r.stdout || "") + (r.stderr || "")}`.slice(0, 2000));
  process.exit(1);
}
