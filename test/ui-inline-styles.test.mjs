// QUALITY-REVIEW 17: layout lives in style.css, not in style="" attributes. Three inline styles stay on purpose, because the script drives them:
// the progress bar fill (its width), the triage "apply" button and the provenance result (shown by setting display).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("index.html keeps only the inline styles that the script drives", () => {
  const html = readFileSync(new URL("../server/ui/index.html", import.meta.url), "utf8");
  const inline = [...html.matchAll(/\sstyle="([^"]*)"/g)].map((m) => m[1].replace(/\s+/g, " ").trim());
  assert.deepEqual(inline.sort(), ["display:none", "margin-top:10px; display:none; background:rgba(99,102,241,0.06); border:1px solid rgba(99,102,241,0.2)", "width:0%; height:100%; background:var(--accent); transition:width 0.2s"].sort());
});

test("every u-* class the page uses is defined in style.css", () => {
  const html = readFileSync(new URL("../server/ui/index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../server/ui/style.css", import.meta.url), "utf8");
  const used = new Set([...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter((c) => /^(u|w)-/.test(c)));
  const missing = [...used].filter((c) => !css.includes(`.${c} {`));
  assert.deepEqual(missing, []);
});
