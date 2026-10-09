import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Статичні імпорти app.js, i18n.js і їхніх залежностей мають бути в <link rel="modulepreload"> у index.html:
// інакше модулі вантажаться послідовним ланцюжком (app.js → i18n.js → переклади), а не паралельно.
const UI = "server/ui/";
const staticImports = (file) =>
  [...readFileSync(UI + file, "utf8").matchAll(/^import\s[^;]*?from\s+["']\.\/([^"']+)["']/gm)].map((m) => m[1]);

test("every statically imported UI module is preloaded in index.html", () => {
  const html = readFileSync(UI + "index.html", "utf8");
  const preloaded = new Set([...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1]));
  const wanted = new Set(["app.js"]);
  const queue = ["app.js"];
  while (queue.length) {
    for (const dep of staticImports(queue.pop())) {
      if (wanted.has(dep)) continue;
      wanted.add(dep);
      if (/\.m?js$/.test(dep)) queue.push(dep);
    }
  }
  const missing = [...wanted].filter((w) => !preloaded.has(w));
  assert.deepEqual(missing, [], `add <link rel="modulepreload" href="..."> to server/ui/index.html for: ${missing.join(", ")}`);
  for (const p of preloaded) assert.ok(wanted.has(p), `${p} is preloaded but nothing imports it`);
});
