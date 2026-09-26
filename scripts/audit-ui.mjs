import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const html = readFileSync("./server/ui/index.html", "utf8");
const app = readFileSync("./server/ui/app.js", "utf8");
const idx = readFileSync("./server/index.mjs", "utf8");

const htmlIds = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((m) => m[1]);
const uniq = [...new Set(htmlIds)];
// Panels such as local GPU and the Telegram test button are built with innerHTML
// in app.js (id="…"), not declared in index.html. Those are not missing.
const dynamicIds = [...new Set([...app.matchAll(/\bid=["']([^"']+)["']/g)].map((m) => m[1]))];
const known = new Set([...uniq, ...dynamicIds]);
const usedInApp = [...app.matchAll(/\$\(["']([^"']+)["']\)/g)].map((m) => m[1]);
const usedSet = new Set(usedInApp);
const missingInHtml = [...usedSet].filter((id) => !known.has(id)).sort();
const dynamicOnly = dynamicIds.filter((id) => !uniq.includes(id) && usedSet.has(id)).sort();
const neverInApp = uniq.filter((id) => !app.includes(id)).sort();

console.log("=== HTML ids referenced in $() but missing in HTML and not created in app.js ===");
missingInHtml.forEach((i) => console.log("MISSING", i));
console.log("count", missingInHtml.length);

console.log("\n=== ids created in app.js (innerHTML), absent from index.html — not missing ===");
dynamicOnly.forEach((i) => console.log("DYNAMIC", i));
console.log("dynamic count", dynamicOnly.length);

console.log("\n=== HTML ids never mentioned in app.js (sample) ===");
neverInApp.filter((i) => /^(base|g-|ctor|export|v-|recipes|acct|topup|sol)/.test(i)).forEach((i) => console.log("UNUSED?", i));

// g-run enable logic
const gRun = app.includes('run.disabled') || app.includes('g-run").disabled');
console.log("\n=== g-run ===");
const around = app.split("\n").map((l, i) => ({ i: i + 1, l }));
around.filter((x) => x.l.includes("g-run") || x.l.includes("locked") && x.l.includes("run")).slice(0, 30).forEach((x) => console.log(x.i + ":" + x.l.trim()));

// FAQ order via tList
const uk = readFileSync("./server/ui/locales/uk.js", "utf8");
const faqQs = [...uk.matchAll(/"help\.faq\.q(\d+)":/g)].map((m) => Number(m[1]));
console.log("\n=== FAQ q numbers in uk.js order ===", faqQs.join(","));
console.log("sorted?", faqQs.join(",") === [...faqQs].sort((a,b)=>a-b).join(","));

// Check how tList works
const tListSrc = app.match(/function tList[\s\S]*?^}/m)?.[0];
console.log("\n=== tList ===\n", tListSrc?.slice(0, 500));

// user-facing .env / FAL_KEY remaining outside admin
for (const file of ["uk.js", "en.js", "tips.mjs"]) {
  const p = `./server/ui/locales/${file}`;
  const text = readFileSync(p, "utf8");
  const lines = text.split("\n");
  lines.forEach((l, i) => {
    if (/\.env|FAL_KEY|SERIES_SPEND|PINATA_JWT|API key|потрібен ключ/i.test(l) && !/^\s*\/\//.test(l)) {
      // skip admin/res/econ keys
      if (/"(res\.|admin\.|econ\.|help\.localgpu\.env|trash\.hint|nav\.res)/.test(l)) return;
      if (l.includes("admin.tab") || l.includes("res.")) return;
      console.log(`USERTECH ${file}:${i + 1} ${l.trim().slice(0, 120)}`);
    }
  });
}

// Check export bundle body from UI
const bundleSnip = around.filter((x) => x.l.includes("export/bundle") || x.l.includes("export/dataset") || x.l.includes("onlyKeep"));
console.log("\n=== export related UI lines ===");
bundleSnip.slice(0, 40).forEach((x) => console.log(x.i + ":" + x.l.trim()));
