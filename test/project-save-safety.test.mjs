// Saving a project must not silently replace another one, and a payment must not be taken twice for one project.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startStudio } from "./helpers/studio-server.mjs";

describe("project save safety", () => {
  let s;
  const basePreset = JSON.parse(readFileSync("presets/demo-series.json", "utf8"));
  const preset = (id, name = `Project ${id}`) => ({ ...basePreset, id, name });
  const save = (id, extra = {}, name) => s.call("POST", "/api/preset/save", { body: { preset: preset(id, name), ...extra } });
  const balance = async () => (await s.call("GET", "/api/me")).json.balance;
  const userDir = () => join(s.dir, "users", readdirSync(join(s.dir, "users"))[0]);
  const stored = (id) => JSON.parse(readFileSync(join(userDir(), "presets", `${id}.json`), "utf8"));

  before(async () => {
    s = await startStudio({ adminWallet: false, extraEnv: { WELCOME_CREDITS: "100", EARLY_WELCOME_CREDITS: "100", PROJECTS_FREE: "3", PROJECT_EXTRA_CREDITS: "30" } });
    await s.signIn();
    for (const id of ["alpha", "beta"]) assert.equal((await save(id)).status, 200);
  });
  after(async () => {
    await s?.stop();
  });

  it("saving under the id of another existing project asks first and changes nothing", async () => {
    // beta is the open project; "alpha" is a different, existing one
    const r = await save("alpha", {}, "Replaced by mistake");
    assert.equal(r.status, 409, r.text);
    assert.equal(r.json.code, "project_exists");
    assert.equal(stored("alpha").name, "Project alpha", "the file is untouched");
    assert.equal((await s.call("GET", "/api/projects")).json.projects.length, 2);
  });

  it("the open project and the file the editor loaded are normal edits", async () => {
    const open = await save("beta", {}, "Edited beta");
    assert.equal(open.status, 200, open.text);
    assert.equal(open.json.project.new, false);
    const loaded = await save("alpha", { editing: "alpha.json" }, "Edited alpha");
    assert.equal(loaded.status, 200, loaded.text);
    assert.equal(stored("alpha").name, "Edited alpha");
    assert.equal(loaded.json.project.charged, 0);
  });

  it("a confirmed overwrite replaces the project and keeps the previous version in the trash", async () => {
    const before = stored("alpha");
    const r = await save("alpha", { overwrite: true }, "Overwritten on purpose");
    assert.equal(r.status, 200, r.text);
    assert.equal(stored("alpha").name, "Overwritten on purpose");
    const trashRoot = join(userDir(), "projects");
    const trashed = [];
    const walk = (dir) => {
      if (!existsSync(dir)) return;
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/alpha\.json$/.test(e.name) && p.includes("trash")) trashed.push(p);
      }
    };
    walk(trashRoot);
    walk(join(userDir(), "out"));
    assert.ok(trashed.length > 0, "the previous alpha.json is in a trash folder");
    assert.ok(trashed.some((p) => JSON.parse(readFileSync(p, "utf8")).name === before.name));
  });

  it("a preset left on disk without a registry entry (a crash before registering) is charged once, not twice", async () => {
    for (const id of ["gamma"]) assert.equal((await save(id)).status, 200); // 3rd of 3 free
    // simulate a crash right after the file was written for a 4th project: file exists, registry does not know it
    writeFileSync(join(userDir(), "presets", "orphan.json"), JSON.stringify(preset("orphan")));
    const start = await balance();
    const asked = await save("orphan");
    assert.equal(asked.status, 402, asked.text);
    assert.equal(asked.json.code, "project_charge");
    assert.equal(await balance(), start, "nothing is debited before the confirmation");
    const paid = await save("orphan", { confirmCharge: true });
    assert.equal(paid.status, 200, paid.text);
    assert.equal(start - (await balance()), 30);
    const again = await save("orphan", { confirmCharge: true });
    assert.equal(again.json.project.charged, 0);
    assert.equal(start - (await balance()), 30, "no second charge");
    const list = (await s.call("GET", "/api/projects")).json;
    assert.equal(list.projects.filter((p) => p.id === "orphan").length, 1, "registered exactly once");
  });

  it("not enough credits: no project is registered and no preset is written", async () => {
    const poor = await startStudio({ adminWallet: false, extraEnv: { WELCOME_CREDITS: "20", EARLY_WELCOME_CREDITS: "20", PROJECTS_FREE: "1", PROJECT_EXTRA_CREDITS: "30" } });
    try {
      await poor.signIn();
      const mk = (id, extra = {}) => poor.call("POST", "/api/preset/save", { body: { preset: preset(id), ...extra } });
      assert.equal((await mk("one")).status, 200);
      const r = await mk("two", { confirmCharge: true });
      assert.equal(r.status, 402, r.text);
      assert.equal(r.json.code, "credits");
      assert.equal((await poor.call("GET", "/api/projects")).json.projects.length, 1);
      const dir = join(poor.dir, "users", readdirSync(join(poor.dir, "users"))[0], "presets");
      assert.equal(existsSync(join(dir, "two.json")), false, "the file was not written before the payment was possible");
    } finally {
      await poor.stop();
    }
  });
});
