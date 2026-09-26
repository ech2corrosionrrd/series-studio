import { readFileSync } from "node:fs";

const app = readFileSync("./server/ui/app.js", "utf8");
const server = readFileSync("./server/index.mjs", "utf8");

// Extract POST bodies near known endpoints in UI and compare required fields in server
const endpoints = [
  ["/api/base/upload", ["data", "filename", "role"]],
  ["/api/base/wish", ["wish"]],
  ["/api/export/bundle", ["archive", "set"]],
  ["/api/export/dataset", ["archive", "set"]],
  ["/api/credits/sol/order", ["package"]],
  ["/api/credits/sol/prepare", ["package"]],
  ["/api/marks", ["dir", "edition", "mark"]],
  ["/api/preset/save", ["preset"]],
  ["/api/build", ["file"]],
  ["/api/generate", ["engine"]],
  ["/api/estimate", ["engine"]],
];

function snippetAround(src, needle, radius = 350) {
  const i = src.indexOf(needle);
  if (i < 0) return null;
  return src.slice(Math.max(0, i - 80), i + radius);
}

for (const [path, required] of endpoints) {
  const ui = snippetAround(app, path);
  const srv = snippetAround(server, `pathname === "${path}"`) || snippetAround(server, `pathname === '${path}'`);
  console.log("\n##", path);
  if (!ui) console.log("  UI: not found");
  else {
    const missing = required.filter((f) => !ui.includes(f));
    console.log("  UI snippet fields check missing:", missing.length ? missing.join(",") : "ok");
    // show likely wrong fields
    if (ui.includes("packId")) console.log("  WARN UI uses packId");
    if (ui.includes("images:") || ui.includes("images ")) console.log("  WARN UI may use images");
    if (path.includes("bundle") && ui.includes("dir:") && !ui.includes("set:")) console.log("  WARN bundle uses dir not set");
  }
  if (!srv) console.log("  SERVER: not found");
}

// Find help.s*.do / oops continuity
import uk from "../server/ui/locales/uk.js";
for (const step of ["s1","s2","s3","s4","s5","s6","s7","s8"]) {
  for (const kind of ["do", "oops"]) {
    const keys = [];
    for (let i = 1; i < 20; i++) {
      const k = `help.${step}.${kind}${i}`;
      if (!(k in uk)) break;
      keys.push(k);
    }
    // also check if do exists as non-numbered - no
    if (!keys.length) console.log(`MISSING help list help.${step}.${kind}*`);
  }
  for (const k of [`help.${step}.title`, `help.${step}.why`, `help.${step}.get`]) {
    if (!(k in uk)) console.log("MISSING", k);
  }
}

// Check duplicate keys in locale files (last wins in object literal)
function dupKeys(path) {
  const text = readFileSync(path, "utf8");
  const keys = [...text.matchAll(/^\s*"([^"]+)":/gm)].map((m) => m[1]);
  const seen = new Map();
  const dups = [];
  for (const k of keys) {
    if (seen.has(k)) dups.push(k);
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  return dups;
}
console.log("\n=== duplicate keys uk ===", dupKeys("./server/ui/locales/uk.js"));
console.log("=== duplicate keys en ===", dupKeys("./server/ui/locales/en.js"));
