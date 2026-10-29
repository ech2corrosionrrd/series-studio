// The route modules in server/routes/ were cut out of server/index.mjs. A name that stayed behind (an import nobody carried over, a helper
// that is not in `ctx`) is a ReferenceError that only shows when that one route runs. This test reads the sources and catches it early:
//   1. every name a module uses that the project defines or exports anywhere must be available in the module
//      (its own imports, the `ctx` it destructures, or a local declaration);
//   2. every name a module takes from `ctx` must be passed by the call in server/index.mjs;
//   3. every relative path it imports, statically or with `import("...")`, must point at a file.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const IMPORT = /^import\s+([\s\S]*?)\s+from\s+"([^"]+)";/gm;

function importedNames(text) {
  const out = new Set();
  for (const m of text.matchAll(IMPORT)) {
    const clause = m[1];
    const braces = /\{([\s\S]*?)\}/.exec(clause);
    if (braces) for (const part of braces[1].split(",")) if (part.trim()) out.add(part.trim().split(" as ").pop().trim());
    const def = /^([A-Za-z_$][\w$]*)\s*(,|$)/.exec(clause);
    if (def && !clause.trim().startsWith("{") && !clause.trim().startsWith("*")) out.add(def[1]);
    const ns = /^\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause);
    if (ns) out.add(ns[1]);
  }
  return out;
}

/** The code of a source text with comments and string contents removed; `${...}` inside a template literal stays, it is code. */
function codeOnly(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  function skipString(q) {
    i += 1;
    while (i < n && src[i] !== q) i += src[i] === "\\" ? 2 : 1;
    i += 1;
    out += '""';
  }
  function template() {
    // called after the opening backtick: skip the text, keep each ${ ... } as code
    while (i < n && src[i] !== "`") {
      if (src[i] === "\\") i += 2;
      else if (src[i] === "$" && src[i + 1] === "{") {
        i += 2;
        let depth = 1;
        out += " ";
        while (i < n) {
          const c = src[i];
          if (c === "{") depth += 1;
          else if (c === "}") {
            depth -= 1;
            if (depth === 0) break;
          }
          if (c === "`") {
            i += 1;
            template();
            out += " ";
          } else if (c === '"' || c === "'") skipString(c);
          else {
            out += c;
            i += 1;
          }
        }
        i += 1;
        out += " ";
      } else i += 1;
    }
    i += 1;
  }
  while (i < n) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i += 1;
    } else if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
    } else if (c === '"' || c === "'") skipString(c);
    else if (c === "`") {
      i += 1;
      template();
      out += " ";
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

function topLevelNames(text) {
  const out = new Set();
  for (const m of text.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) out.add(m[1]);
  for (const m of text.matchAll(/^(?:export\s+)?(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) out.add(m[1]);
  for (const m of text.matchAll(/^(?:export\s+)?(?:const|let|var)\s+\{([^}]*)\}/gm)) {
    for (const p of m[1].split(",")) if (p.trim()) out.add(p.split(":").pop().split("=")[0].trim());
  }
  return out;
}

function localNames(code) {
  const out = new Set();
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
  for (const m of code.matchAll(/\b(?:const|let|var)\s+\{([^}]*)\}/g)) for (const p of m[1].split(",")) if (p.trim()) out.add(p.split(":").pop().split("=")[0].trim());
  for (const m of code.matchAll(/\b(?:const|let|var)\s+\[([^\]]*)\]/g)) for (const p of m[1].split(",")) if (p.trim()) out.add(p.split("=")[0].trim());
  for (const m of code.matchAll(/\bfunction\s*([A-Za-z_$][\w$]*)?\s*\(([^()]*)\)/g)) {
    if (m[1]) out.add(m[1]);
    for (const p of m[2].match(/[A-Za-z_$][\w$]*/g) || []) out.add(p);
  }
  for (const m of code.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
  for (const m of code.matchAll(/\(([^()]*)\)\s*=>/g)) for (const p of m[1].match(/[A-Za-z_$][\w$]*/g) || []) out.add(p);
  for (const m of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*=>/g)) out.add(m[1]);
  for (const m of code.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+(?:\[([^\]]*)\]|\{([^}]*)\}|([A-Za-z_$][\w$]*))/g)) {
    for (const g of m.slice(1)) if (g) for (const p of g.match(/[A-Za-z_$][\w$]*/g) || []) out.add(p);
  }
  return out;
}

function usedNames(code) {
  // `name:` is an object key and `.name` a property: neither is a variable
  const bare = code.replace(/\.\.\./g, " ");
  return new Set([...bare.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)(?![\w$])(?!\s*:(?!:))/g)].map((m) => m[1]));
}

function sourceFiles(dir, out = []) {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (["vendor", "ui", "site", "node_modules"].includes(e.name)) continue;
      sourceFiles(join(dir, e.name), out);
    } else if (e.name.endsWith(".mjs")) out.push(join(dir, e.name));
  }
  return out;
}

describe("server route modules", () => {
  const index = read("server/index.mjs");
  const universe = new Set([...topLevelNames(index), ...importedNames(index)]);
  for (const f of [...sourceFiles("src"), ...readdirSync(join(ROOT, "server")).filter((n) => n.endsWith(".mjs")).map((n) => `server/${n}`)]) {
    for (const n of topLevelNames(read(f))) universe.add(n);
  }
  const modules = readdirSync(join(ROOT, "server/routes")).filter((n) => n.endsWith(".mjs"));

  it("there are route modules to check", () => {
    assert.ok(modules.length >= 7, `found ${modules.join(", ")}`);
  });

  for (const file of modules) {
    const text = read(`server/routes/${file}`);
    const ctx = /const \{([^}]*)\} = ctx;/.exec(text);
    const ctxNames = new Set(ctx ? ctx[1].split(",").map((s) => s.trim()).filter(Boolean) : []);
    const code = codeOnly(text.replace(IMPORT, ""));

    it(`${file}: every project name it uses is imported, taken from ctx or declared`, () => {
      const have = new Set([...importedNames(text), ...ctxNames, ...localNames(code), ...topLevelNames(text), "req", "res", "url", "pathname"]);
      const missing = [...usedNames(code)].filter((n) => universe.has(n) && !have.has(n)).sort();
      assert.deepEqual(missing, [], `${file} uses ${missing.join(", ")} but neither imports it nor receives it in ctx`);
    });

    it(`${file}: every relative import path, static or dynamic, points at a file`, () => {
      // a path copied from index.mjs keeps one "../" too few: a static one crashes the server at start, a dynamic one only answers 500 when its route runs
      const specs = [...text.matchAll(IMPORT)].map((m) => m[2]);
      for (const m of text.matchAll(/\bimport\(\s*(["'])([^"']+)\1\s*\)/g)) specs.push(m[2]);
      const broken = specs.filter((s) => s.startsWith(".") && !existsSync(resolve(dirname(join(ROOT, "server/routes", file)), s)));
      assert.deepEqual(broken, [], `${file} imports ${broken.join(", ")}, which do not exist relative to server/routes/`);
    });

    it(`${file}: index.mjs passes every name the module takes from ctx`, () => {
      if (!ctxNames.size) return;
      const handler = /export async function (\w+)\(ctx\)/.exec(text)?.[1];
      assert.ok(handler, "the module exports its handler");
      const call = new RegExp(`await ${handler}\\(\\{([\\s\\S]*?)\\}\\)`).exec(index);
      assert.ok(call, `index.mjs calls ${handler}`);
      const passed = new Set([...call[1].matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
      const notPassed = [...ctxNames].filter((n) => !passed.has(n));
      assert.deepEqual(notPassed, [], `${handler} expects ${notPassed.join(", ")} in ctx`);
    });
  }
});
