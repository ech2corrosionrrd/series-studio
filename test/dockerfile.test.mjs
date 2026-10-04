import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

function* walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(mjs|js)$/.test(f)) yield p;
  }
}

test("every scripts/ module the image code imports is COPY'd by the Dockerfile", () => {
  const docker = readFileSync(join(ROOT, "Dockerfile"), "utf8");
  const copied = new Set();
  for (const m of docker.matchAll(/^COPY\s+(.+?)\s+\.\/scripts\/?(\S*)\s*$/gm)) {
    for (const src of m[1].split(/\s+/)) copied.add(src.replace(/^scripts\//, ""));
  }
  const needed = new Set();
  for (const dir of ["bin", "src", "server"]) {
    for (const file of walk(join(ROOT, dir))) {
      for (const m of readFileSync(file, "utf8").matchAll(/from\s+"(?:\.\.?\/)+scripts\/([\w.-]+\.mjs)"/g)) needed.add(m[1]);
    }
  }
  // Transitive: a copied scripts module may import another scripts module.
  for (const f of [...needed]) {
    for (const m of readFileSync(join(ROOT, "scripts", f), "utf8").matchAll(/from\s+"\.\/([\w.-]+\.mjs)"/g)) needed.add(m[1]);
  }
  const missing = [...needed].filter((f) => !copied.has(f));
  assert.deepEqual(missing, [], `Dockerfile must COPY scripts/${missing.join(", scripts/")}`);
});
