// The Constructor asks whether the uploaded PNG layers cover the saved preset, before any recipes exist.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { startStudio } from "./helpers/studio-server.mjs";

describe("layers status against a saved preset", () => {
  let s;
  const demo = JSON.parse(readFileSync("presets/demo-series.json", "utf8"));
  const preset = { ...demo, id: "cov-series", name: "Coverage series" };
  const trait = preset.traits.items[0];
  const userDir = () => join(s.dir, "users", readdirSync(join(s.dir, "users"))[0]);

  before(async () => {
    s = await startStudio({ adminWallet: false, extraEnv: { WELCOME_CREDITS: "100", EARLY_WELCOME_CREDITS: "100" } });
    await s.signIn();
    assert.equal((await s.call("POST", "/api/preset/save", { body: { preset } })).status, 200);
  });
  after(async () => {
    await s?.stop();
  });

  it("no layers: nothing exists, and the coverage says that none of the variants has a file", async () => {
    const r = await s.call("GET", "/api/layers/status?preset=cov-series.json");
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.exists, false);
    assert.equal(r.json.coverage.present, 0);
    assert.ok(r.json.coverage.expected > 0);
  });

  it("with one layer file the coverage counts what is present and lists what is missing", async () => {
    const dir = join(userDir(), "projects", "cov-series", "layers", trait.key);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${trait.options[0].value}.png`), Buffer.from("png"));
    const r = await s.call("GET", "/api/layers/status?preset=cov-series.json");
    assert.equal(r.json.exists, true);
    const expected = preset.traits.items.reduce((n, t) => n + t.options.filter((o) => o.value && o.value !== "None").length, 0);
    assert.deepEqual([r.json.coverage.expected, r.json.coverage.present], [expected, 1]);
    assert.equal(r.json.coverage.missingCount, expected - 1);
    assert.ok(r.json.coverage.missing.length > 0);
  });

  it("an unknown preset name does not fail the request", async () => {
    const r = await s.call("GET", "/api/layers/status?preset=does-not-exist.json");
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.coverage ?? null, null);
  });
});
