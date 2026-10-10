// Review deletes frames and versions for good: the trash is only for whole projects.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createMockPng } from "../src/mock-image.mjs";
import { startStudio } from "./helpers/studio-server.mjs";

const trashItems = (root) => {
  const found = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const p = join(d, e.name);
      if (e.name === "trash") found.push(...readdirSync(p).filter((n) => existsSync(join(p, n, "item.json"))));
      else walk(p);
    }
  };
  walk(root);
  return found;
};

describe("selection deletes for good", () => {
  let s;
  const basePreset = JSON.parse(readFileSync("presets/demo-series.json", "utf8"));
  before(async () => {
    s = await startStudio({ adminWallet: false, extraEnv: { WELCOME_CREDITS: "500", EARLY_WELCOME_CREDITS: "500" } });
    await s.signIn();
  });
  after(async () => {
    await s?.stop();
  });

  it("a deleted frame is gone, leaves no trash item and its mark is cleared", async () => {
    assert.equal((await s.call("POST", "/api/preset/save", { body: { preset: { ...basePreset, id: "sel", name: "Sel" }, confirmCharge: true } })).status, 200);
    const png = Buffer.from(createMockPng({ seed: 1, title: "base" }));
    assert.equal((await s.call("POST", "/api/base/upload", { body: { data: png.toString("base64"), filename: "primary.png", role: "primary" } })).status, 200);
    assert.equal((await s.call("POST", "/api/build", { body: { file: "sel.json" } })).status, 200);
    const gen = await s.call("POST", "/api/generate", { body: { engine: "mock", mode: "first", first: 3 } });
    assert.equal(gen.status, 200, gen.text);
    const dir = (await s.call("GET", "/api/sets")).json.sets[0].dir;
    const before = (await s.call("GET", `/api/set?dir=${encodeURIComponent(dir)}`)).json.images;
    assert.equal(before.length, 3);
    const edition = before[0].edition;
    const del = await s.call("POST", "/api/set/delete", { body: { dir, edition } });
    assert.equal(del.status, 200, del.text);
    assert.equal(del.json.trashId, undefined, "no trash id is returned");
    const after = (await s.call("GET", `/api/set?dir=${encodeURIComponent(dir)}`)).json.images;
    assert.equal(after.length, 2);
    assert.ok(!after.some((i) => i.edition === edition));
    assert.deepEqual(trashItems(s.dir), [], "nothing was moved to a file trash");
    assert.equal((await s.call("POST", "/api/set/delete", { body: { dir, edition } })).status, 400, "already gone");
  });
});
