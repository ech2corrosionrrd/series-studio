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

describe("two tabs saving the same project", () => {
  let s;
  const basePreset = JSON.parse(readFileSync("presets/demo-series.json", "utf8"));
  const preset = (id, name) => ({ ...basePreset, id, name });
  const save = (id, name, extra = {}) => s.call("POST", "/api/preset/save", { body: { preset: preset(id, name), ...extra } });
  const open = async (file) => (await s.call("GET", `/api/preset?file=${file}`)).json;
  const userDir = () => join(s.dir, "users", readdirSync(join(s.dir, "users"))[0]);
  const stored = (id) => JSON.parse(readFileSync(join(userDir(), "presets", `${id}.json`), "utf8"));

  before(async () => {
    s = await startStudio({ adminWallet: false, extraEnv: { WELCOME_CREDITS: "100", EARLY_WELCOME_CREDITS: "100" } });
    await s.signIn();
    assert.equal((await save("shared", "Original")).status, 200);
  });
  after(async () => {
    await s?.stop();
  });

  it("opening and saving return a revision that changes with the content", async () => {
    const a = await open("shared.json");
    assert.match(a.rev, /^[0-9a-f]{16}$/);
    const saved = await save("shared", "Original", { baseRev: a.rev });
    assert.equal(saved.status, 200, saved.text);
    assert.equal(saved.json.rev, a.rev, "same content, same revision");
    const edited = await save("shared", "Edited by tab A", { baseRev: a.rev });
    assert.equal(edited.status, 200, edited.text);
    assert.notEqual(edited.json.rev, a.rev);
    assert.equal((await open("shared.json")).rev, edited.json.rev);
  });

  it("a tab that opened the old revision cannot silently drop the other tab's change", async () => {
    const tabB = (await open("shared.json")).rev; // both tabs open the same revision
    const tabA = tabB;
    const a = await save("shared", "Tab A edit", { baseRev: tabA });
    assert.equal(a.status, 200, a.text);
    const b = await save("shared", "Tab B edit", { baseRev: tabB });
    assert.equal(b.status, 409, b.text);
    assert.equal(b.json.code, "project_stale");
    assert.equal(b.json.rev, a.json.rev, "the error carries the current revision");
    assert.equal(stored("shared").name, "Tab A edit", "tab A's change survives");
  });

  it("after reloading, tab B saves normally; a confirmed overwrite keeps the other version in the trash", async () => {
    const fresh = (await open("shared.json")).rev;
    assert.equal((await save("shared", "Tab B after reload", { baseRev: fresh })).status, 200);
    const stale = fresh; // now stale again
    const forced = await save("shared", "Tab A forced", { baseRev: stale, overwrite: true });
    assert.equal(forced.status, 200, forced.text);
    assert.equal(stored("shared").name, "Tab A forced");
    const found = [];
    const walk = (dir) => {
      if (!existsSync(dir)) return;
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/shared\.json$/.test(e.name) && p.includes("trash")) found.push(JSON.parse(readFileSync(p, "utf8")).name);
      }
    };
    walk(userDir());
    assert.ok(found.includes("Tab B after reload"), `the replaced version is in the trash: ${found.join(", ")}`);
  });

  it("a client without baseRev (CLI, old page) is not checked, and a new project needs none", async () => {
    assert.equal((await save("shared", "No revision sent")).status, 200);
    const fresh = await save("brand-new", "Fresh", { baseRev: "0123456789abcdef" });
    assert.equal(fresh.status, 200, "a file that does not exist yet has nothing to be stale against");
  });
});
