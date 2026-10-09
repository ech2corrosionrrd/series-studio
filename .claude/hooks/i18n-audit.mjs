#!/usr/bin/env node
// PostToolUse (Edit|Write): після правки локалей одразу ганяє audit:i18n.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

let d = {};
try { d = JSON.parse(readFileSync(0, "utf8")); } catch { process.exit(0); }
const file = String(d.tool_input?.file_path || "").replaceAll(String.fromCharCode(92), "/");
if (!/server\/ui\/locales\/(uk|en)\.js$/.test(file)) process.exit(0);

const r = spawnSync(process.execPath, ["scripts/audit-i18n.mjs"], { cwd: d.cwd || process.cwd(), encoding: "utf8" });
if (r.status !== 0) {
  process.stderr.write(`audit:i18n червоний після правки ${file}:\n${(r.stdout || "") + (r.stderr || "")}`.slice(0, 2000));
  process.exit(2);
}
