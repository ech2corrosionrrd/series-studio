// tintBackdrop re-colours a smooth studio backdrop found from the frame border and never guesses: a textured, bright
// or whole-frame "backdrop" leaves the frame alone and says why. An option with `backdrop` does it inside composeEdition.
import { describe, it } from "node:test";
import { readUiSource } from "../scripts/ui-source.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { composeEdition } from "../src/layers.mjs";
import { parseBackdropColor, tintBackdrop } from "../src/backdrop-tint.mjs";
import { decodePngRgba } from "../src/dupes.mjs";
import { encodeRgbaPng } from "../src/png-fit.mjs";
import { traitsFromCsv, traitsToCsv } from "../src/traits-import.mjs";

const W = 80;
const H = 80;
const NAVY = [20, 24, 27];
const FUR = [200, 160, 90];

/** A dark smooth backdrop with a bright subject (a rectangle, 37% of the frame) in the middle. */
function frame({ backdrop = NAVY, subject = true, noise = 0 } = {}) {
  const rgba = Buffer.alloc(W * H * 4);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) - 0.5;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const inside = subject && x >= 20 && x < 60 && y >= 10 && y < 70;
      const c = inside ? FUR : backdrop;
      const j = noise && !inside ? Math.round(rnd() * noise) : 0;
      rgba.set([c[0] + j, c[1] + j, c[2] + j, 255], (y * W + x) * 4);
    }
  }
  return rgba;
}
const at = (rgba, x, y) => [...rgba.subarray((y * W + x) * 4, (y * W + x) * 4 + 3)];

describe("parseBackdropColor", () => {
  it("accepts #rrggbb only", () => {
    assert.deepEqual(parseBackdropColor("#0d9aa0"), [13, 154, 160]);
    assert.deepEqual(parseBackdropColor(" #FFFFFF "), [255, 255, 255]);
    for (const bad of ["0d9aa0", "#fff", "#12345g", "teal", "", null, undefined, 12]) assert.equal(parseBackdropColor(bad), null, String(bad));
  });
});

describe("tintBackdrop", () => {
  it("re-colours the backdrop, keeps its brightness range, leaves the subject and the input alone", () => {
    const input = frame();
    const copy = Buffer.from(input);
    const r = tintBackdrop(input, W, H, "#0d9aa0");
    assert.equal(r.applied, true);
    // the backdrop is 62.5% of the frame; the 3 px next to the subject fail the smoothness test on purpose (the feather covers them)
    assert.ok(r.share > 0.45 && r.share < 0.65, `share ${r.share}`);
    assert.ok(input.equals(copy), "the input buffer is not changed");
    const corner = at(r.rgba, 2, 2);
    assert.ok(corner[1] > corner[0] + 10 && corner[2] > corner[0] + 10, `corner is teal-ish: ${corner}`);
    assert.ok(Math.max(...corner) < 120, "a dark backdrop stays dark");
    assert.deepEqual(at(r.rgba, 40, 40), FUR, "the subject core is untouched");
  });

  it("does not guess: a bright, a textured and a whole-frame backdrop come back unchanged with a reason", () => {
    const bright = frame({ backdrop: [200, 210, 220] });
    assert.deepEqual({ a: tintBackdrop(bright, W, H, "#0d9aa0").applied, why: tintBackdrop(bright, W, H, "#0d9aa0").reason }, { a: false, why: "no_backdrop" });
    const noisy = tintBackdrop(frame({ noise: 40 }), W, H, "#0d9aa0");
    assert.deepEqual({ a: noisy.applied, why: noisy.reason }, { a: false, why: "not_smooth" });
    const empty = tintBackdrop(frame({ subject: false }), W, H, "#0d9aa0");
    assert.deepEqual({ a: empty.applied, why: empty.reason }, { a: false, why: "whole_frame" });
    const bad = tintBackdrop(frame(), W, H, "teal");
    assert.deepEqual({ a: bad.applied, why: bad.reason }, { a: false, why: "bad_color" });
  });
});

describe("composeEdition with an option backdrop", () => {
  const base = encodeRgbaPng(W, H, frame());
  const item = (backdrop) => [{ key: "background", options: [{ value: "None" }, { value: "Teal", ...(backdrop ? { backdrop } : {}) }] }];
  const run = (items, traits = { background: "Teal" }, basePng = base) =>
    composeEdition({ recipe: { edition: 1, line: "a", traits }, items, basePng, layerDir: "/none", skipMissing: true });

  it("tints the frame backdrop and lists it; without the field the bytes are the old ones", () => {
    const tinted = run(item("#0d9aa0"));
    assert.ok(tinted.layers.includes("tint:background/Teal"));
    const px = decodePngRgba(tinted.png).rgba;
    assert.ok(at(px, 2, 2)[1] > at(px, 2, 2)[0] + 10);
    const plain = run(item(null));
    assert.deepEqual(plain.layers, ["base"]);
    assert.ok(decodePngRgba(plain.png).rgba.equals(frame()), "no backdrop field: the frame is the model's");
  });

  it("an option that is not chosen does nothing, and an unusable frame lists the skip instead of painting", () => {
    assert.deepEqual(run(item("#0d9aa0"), { background: "None" }).layers, ["base"]);
    const textured = run(item("#0d9aa0"), undefined, encodeRgbaPng(W, H, frame({ noise: 40 })));
    assert.deepEqual(textured.layers, ["base"]);
    assert.ok(textured.skipped.some((s) => s.startsWith("tint:background/Teal") && s.includes("not_smooth")), textured.skipped.join(","));
  });
});

describe("CSV and the editor carry backdrop", () => {
  it("backdrop round-trips through CSV and a bad colour names its row", () => {
    const csv = traitsToCsv([{ key: "background", options: [{ value: "Teal", weight: 5, backdrop: "#0d9aa0" }] }]);
    assert.ok(csv.split("\r\n")[0].endsWith(",backdrop"));
    assert.equal(traitsFromCsv(csv).items[0].options[0].backdrop, "#0d9aa0");
    const bad = traitsFromCsv("trait,value,backdrop\nbackground,Teal,teal\n");
    assert.equal(bad.errors[0].row, 2);
    assert.match(bad.errors[0].message, /backdrop/);
  });

  it("editing weight or prompt keeps the option fields the editor does not own", () => {
    const app = readUiSource();
    assert.match(app, /function optionExtras\(raw\)/);
    assert.equal((app.match(/\.\.\.optionExtras\(trait\.options\[idx\]\), \.\.\.normalizeOptionClient/g) || []).length, 3, "weight, prompt and updateOptionField");
  });
});
