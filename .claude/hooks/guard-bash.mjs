#!/usr/bin/env node
// PreToolUse (Bash): блокує незворотне й платне без явної згоди власника.
// Власник може виконати таку команду сам через `! <команда>`.
import { readFileSync } from "node:fs";

let d = {};
try { d = JSON.parse(readFileSync(0, "utf8")); } catch { process.exit(0); }
const cmd = String(d.tool_input?.command || "");

const RULES = [
  [/\bgit\s+push\b[^\n;&|]*(--force\b|--force-with-lease\b|\s-f\b)/, "примусовий push"],
  [/\bgit\s+reset\s+--hard\b/, "git reset --hard"],
  [/\bgit\s+clean\s+-[a-z]*f/, "git clean -f"],
  [/--no-verify\b/, "обхід git-хуків (--no-verify)"],
  [/\brm\s+-[a-z]*r[a-z]*f?\s+(\/|~|\.\.?(\s|$)|\*|\.git\b|data\b|out\b)/, "рекурсивне видалення даних"],
  [/\b(node\s+bin\/series\.mjs|series)\s+(upload|mint)\b/, "платне завантаження в Arweave або мінт"],
  [/\bnpm\s+run\s+smoke:stage\b/, "smoke зі справжньою генерацією (платні виклики)"],
  [/\bSERIES_SPEND_CAP_USD=off\b/, "вимкнення ліміту витрат"],
  [/\bDROP\s+TABLE\b|\bdocker\s+(system|volume)\s+prune\b/i, "видалення даних на сервері"],
];

for (const [re, what] of RULES) {
  if (re.test(cmd)) {
    process.stderr.write(`Заблоковано: ${what}. За CLAUDE.md це потребує прямої згоди власника; він може виконати команду сам через "! <команда>".\n`);
    process.exit(2);
  }
}
