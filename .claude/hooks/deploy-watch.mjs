#!/usr/bin/env node
// PostToolUse (Bash): після `git push ... main` чекає запуск Deploy site для цього коміту й повідомляє результат.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

let d = {};
try { d = JSON.parse(readFileSync(0, "utf8")); } catch { process.exit(0); }
const cmd = String(d.tool_input?.command || "");
if (!/\bgit push\b/.test(cmd) || /--delete|\s:/.test(cmd)) process.exit(0);

const cwd = d.cwd || process.cwd();
const run = (bin, args) => spawnSync(bin, args, { cwd, encoding: "utf8", shell: false });
const sha = run("git", ["rev-parse", "HEAD"]).stdout.trim();
if (run("git", ["branch", "--show-current"]).stdout.trim() !== "main" || !sha) process.exit(0);

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const say = (text) => {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: text } }));
  process.exit(0);
};

let found = null;
for (let i = 0; i < 6 && !found; i++) {
  const r = run("gh", ["run", "list", "--workflow", "deploy-site.yml", "--limit", "5", "--json", "databaseId,headSha,status,conclusion"]);
  try { found = JSON.parse(r.stdout).find((x) => x.headSha === sha); } catch { /* gh недоступний */ }
  if (!found) sleep(5000);
}
if (!found) say(`Hook: після push (${sha.slice(0, 7)}) запуску Deploy site не знайдено за 30 с - сайт не чіпали або gh недоступний.`);

run("gh", ["run", "watch", String(found.databaseId), "--exit-status"]);
const fin = JSON.parse(run("gh", ["run", "view", String(found.databaseId), "--json", "conclusion"]).stdout || "{}");
say(`Hook: Deploy site #${found.databaseId} для ${sha.slice(0, 7)} завершився: ${fin.conclusion || "невідомо"}. Перевір сайт через curl, якщо зачеплено сторінки.`);
