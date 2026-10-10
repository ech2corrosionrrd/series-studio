// Projects: every collection is its own project; the first PROJECTS_FREE are free, each further one costs credits once.
// Unit tests for the registry rules and server tests for the gate (save, spin-off, confirmation, refund, admin).
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admitProject, describeProjects, loadProjects, projectQuota, projectsConfig, registerProject } from "../src/projects.mjs";
import { startStudio } from "./helpers/studio-server.mjs";

describe("projects registry", () => {
  const dir = mkdtempSync(join(tmpdir(), "series-projects-"));
  const paths = { presets: join(dir, "presets"), workspace: join(dir, "workspace") };
  const templates = new Set(["abstract-series.json", "demo-series.json", "pfp-portrait.json"]);
  before(() => {
    mkdirSync(paths.presets, { recursive: true });
    for (const f of [...templates, "my-lions.json", "old-work.json"]) writeFileSync(join(paths.presets, f), JSON.stringify({ id: f.replace(".json", ""), name: f, size: 12 }));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("config: 3 free and 30 credits by default, overridable, bad values fall back", () => {
    assert.deepEqual(projectsConfig({}), { free: 3, extraCredits: 30 });
    assert.deepEqual(projectsConfig({ PROJECTS_FREE: "5", PROJECT_EXTRA_CREDITS: "50" }), { free: 5, extraCredits: 50 });
    assert.deepEqual(projectsConfig({ PROJECTS_FREE: "-1", PROJECT_EXTRA_CREDITS: "x" }), { free: 3, extraCredits: 30 });
    assert.equal(projectsConfig({ PROJECT_EXTRA_CREDITS: "0" }).extraCredits, 0, "0 switches the charge off");
  });

  it("the first use imports the user's own presets and never the shipped templates", () => {
    const list = loadProjects(paths, templates);
    assert.deepEqual(list.map((p) => p.file), ["my-lions.json", "old-work.json"]);
    assert.ok(list.every((p) => p.imported && !p.paid));
    assert.ok(existsSync(join(paths.workspace, "projects.json")));
    // a later template file does not appear: the registry is the source of truth now
    writeFileSync(join(paths.presets, "new-template.json"), "{}");
    assert.equal(loadProjects(paths, templates).length, 2);
  });

  it("editing a known project is free; a new one is free within the limit and charged beyond it", () => {
    let list = loadProjects(paths, templates);
    assert.deepEqual(admitProject(list, "my-lions.json"), { isNew: false, charge: 0 });
    assert.deepEqual(admitProject(list, "third.json"), { isNew: true, charge: 0 }, "the 3rd of 3 free");
    list = registerProject(paths, list, "third.json", { charge: 0 });
    assert.deepEqual(admitProject(list, "fourth.json"), { isNew: true, charge: 30 });
    assert.equal(projectQuota(list).used, 3);
    assert.equal(projectQuota(list).freeLeft, 0);
    assert.equal(projectQuota(list).needsCharge, true);
    list = registerProject(paths, list, "fourth.json", { charge: 30 });
    assert.equal(list.at(-1).paid, true);
    assert.deepEqual(admitProject(list, "fourth.json"), { isNew: false, charge: 0 }, "a paid project stays editable for free");
    assert.equal(registerProject(paths, list, "fourth.json", { charge: 30 }).length, list.length, "no double registration");
  });

  it("a zero extra price means unlimited free projects", () => {
    const list = Array.from({ length: 10 }, (_, i) => ({ file: `p${i}.json` }));
    assert.equal(admitProject(list, "p10.json", { free: 3, extraCredits: 0 }).charge, 0);
  });

  it("describes projects for the UI, even when the preset file is gone", () => {
    const rows = describeProjects(paths, [{ file: "my-lions.json", createdAt: "x", paid: false }, { file: "gone.json", paid: true, credits: 30 }]);
    assert.equal(rows[0].name, "my-lions.json");
    assert.equal(rows[0].size, 12);
    assert.equal(rows[1].id, "gone");
    assert.equal(rows[1].paid, true);
  });
});

describe("project gate on the server", () => {
  let s;
  const basePreset = JSON.parse(readFileSync("presets/demo-series.json", "utf8"));
  const preset = (id) => ({ ...basePreset, id, name: `Project ${id}` });
  const save = (id, extra = {}) => s.call("POST", "/api/preset/save", { body: { preset: preset(id), ...extra } });
  const balance = async () => (await s.call("GET", "/api/me")).json.balance;

  before(async () => {
    s = await startStudio({ adminWallet: false, extraEnv: { WELCOME_CREDITS: "100", EARLY_WELCOME_CREDITS: "100", PROJECTS_FREE: "3", PROJECT_EXTRA_CREDITS: "30" } });
    await s.signIn();
  });
  after(async () => {
    await s?.stop();
  });

  it("the shipped templates are not projects: a new wallet starts with 0 of 3", async () => {
    const r = await s.call("GET", "/api/projects");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.projects, []);
    assert.equal(r.json.quota.free, 3);
    assert.equal(r.json.quota.used, 0);
    assert.equal((await s.call("GET", "/api/me")).json.projects.free, 3);
  });

  it("three projects are free and cost nothing", async () => {
    const before = await balance();
    for (const id of ["p-one", "p-two", "p-three"]) {
      const r = await save(id);
      assert.equal(r.status, 200, r.text);
      assert.equal(r.json.project.new, true);
      assert.equal(r.json.project.charged, 0);
    }
    assert.equal(await balance(), before);
    assert.equal((await s.call("GET", "/api/projects")).json.quota.used, 3);
  });

  it("editing an existing project is always free, also when the limit is reached", async () => {
    const before = await balance();
    const r = await save("p-two");
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.project.new, false);
    assert.equal(await balance(), before);
  });

  it("the 4th project asks for confirmation first and charges nothing until it is given", async () => {
    const before = await balance();
    const r = await save("p-four");
    assert.equal(r.status, 402, r.text);
    assert.equal(r.json.code, "project_charge");
    assert.equal(r.json.cost, 30);
    assert.equal(r.json.used, 3);
    assert.equal(await balance(), before, "nothing is debited before the confirmation");
    assert.equal((await s.call("GET", "/api/projects")).json.projects.length, 3, "the project was not created");
  });

  it("with the confirmation the 4th project is created and 30 credits are debited once", async () => {
    const before = await balance();
    const r = await save("p-four", { confirmCharge: true });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.project.charged, 30);
    assert.equal(before - (await balance()), 30);
    const list = (await s.call("GET", "/api/projects")).json;
    assert.equal(list.projects.length, 4);
    assert.equal(list.projects.find((p) => p.id === "p-four").paid, true);
    // reopening and saving it again is free, with or without the flag
    const again = await save("p-four", { confirmCharge: true });
    assert.equal(again.json.project.charged, 0);
    assert.equal(before - (await balance()), 30, "no second charge");
  });

  it("a spin-off is a new project and goes through the same gate", async () => {
    const before = await balance();
    const blocked = await s.call("POST", "/api/preset/spinoff", { body: { file: "p-one.json" } });
    assert.equal(blocked.status, 402, blocked.text);
    assert.equal(blocked.json.code, "project_charge");
    assert.equal(await balance(), before);
    const ok = await s.call("POST", "/api/preset/spinoff", { body: { file: "p-one.json", confirmCharge: true } });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(before - (await balance()), 30);
  });

  it("without enough credits nothing is created and nothing is debited", async () => {
    // spend the balance down below 30 through the ledger-safe way: a fresh wallet with 20 credits
    const poor = await startStudio({ adminWallet: false, extraEnv: { WELCOME_CREDITS: "20", EARLY_WELCOME_CREDITS: "20", PROJECTS_FREE: "1", PROJECT_EXTRA_CREDITS: "30" } });
    try {
      await poor.signIn();
      const pp = (id, extra = {}) => poor.call("POST", "/api/preset/save", { body: { preset: preset(id), ...extra } });
      assert.equal((await pp("only-free")).status, 200);
      const before = (await poor.call("GET", "/api/me")).json.balance;
      const r = await pp("too-expensive", { confirmCharge: true });
      assert.equal(r.status, 402, r.text);
      assert.equal(r.json.code, "credits");
      assert.equal((await poor.call("GET", "/api/me")).json.balance, before);
      assert.equal((await poor.call("GET", "/api/projects")).json.projects.length, 1);
    } finally {
      await poor.stop();
    }
  });

  it("an admin wallet is exempt from the charge", async () => {
    const admin = await startStudio({ adminWallet: true, extraEnv: { WELCOME_CREDITS: "100", EARLY_WELCOME_CREDITS: "100", PROJECTS_FREE: "1", PROJECT_EXTRA_CREDITS: "30" } });
    try {
      await admin.signIn();
      const before = (await admin.call("GET", "/api/me")).json.balance;
      for (const id of ["a1", "a2", "a3"]) {
        const r = await admin.call("POST", "/api/preset/save", { body: { preset: preset(id) } });
        assert.equal(r.status, 200, r.text);
        assert.equal(r.json.project.charged, 0);
      }
      assert.equal((await admin.call("GET", "/api/me")).json.balance, before);
      assert.equal((await admin.call("GET", "/api/projects")).json.quota.exempt, true);
    } finally {
      await admin.stop();
    }
  });
});

describe("deleting and restoring a project", () => {
  let s;
  const basePreset = JSON.parse(readFileSync("presets/demo-series.json", "utf8"));
  const preset = (id) => ({ ...basePreset, id, name: `Project ${id}` });
  const save = (id, extra = {}) => s.call("POST", "/api/preset/save", { body: { preset: preset(id), ...extra } });
  const del = (file, extra = { confirm: true }) => s.call("POST", "/api/projects/delete", { body: { file, ...extra } });
  const projects = async () => (await s.call("GET", "/api/projects")).json;
  const balance = async () => (await s.call("GET", "/api/me")).json.balance;

  before(async () => {
    s = await startStudio({ adminWallet: false, extraEnv: { WELCOME_CREDITS: "200", EARLY_WELCOME_CREDITS: "200", PROJECTS_FREE: "2", PROJECT_EXTRA_CREDITS: "30" } });
    await s.signIn();
    for (const id of ["d-one", "d-two"]) assert.equal((await save(id)).status, 200);
    assert.equal((await s.call("POST", "/api/build", { body: { file: "d-two.json" } })).status, 200, "an archive exists for d-two");
  });
  after(async () => {
    await s?.stop();
  });

  it("refuses without confirmation, for an unknown project and for a bad name", async () => {
    assert.equal((await del("d-two.json", {})).status, 400);
    assert.equal((await del("nope.json")).status, 404);
    assert.equal((await del("../x.json")).status, 400);
    assert.equal((await del("")).status, 400);
    assert.equal((await projects()).projects.length, 2);
  });

  it("deleting moves the preset and its archive to the trash, frees the slot and lists it as deleted", async () => {
    const r = await del("d-two.json");
    assert.equal(r.status, 200, r.text);
    assert.ok(r.json.trashId);
    assert.equal(r.json.quota.used, 1);
    const list = await projects();
    assert.deepEqual(list.projects.map((p) => p.file), ["d-one.json"]);
    assert.equal(list.deleted.length, 1);
    assert.equal(list.deleted[0].file, "d-two.json");
    assert.equal((await s.call("GET", "/api/presets")).json.presets.some((p) => p.file === "d-two.json"), false, "the preset file is gone from the working folder");
    const trash = (await s.call("GET", "/api/trash")).json.items.find((i) => i.reason === "project:d-two.json");
    assert.ok(trash, "the trash holds it");
    assert.ok(trash.files.some((f) => f.from.endsWith("presets/d-two.json")));
    assert.ok(trash.files.some((f) => f.from.endsWith("out/d-two.json")), "the archive went with it");
  });

  it("the freed slot is free again: a new project costs nothing", async () => {
    const before = await balance();
    const r = await save("d-three");
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.project.charged, 0);
    assert.equal(await balance(), before);
  });

  it("restoring is a new project for the limit: at the limit it asks first and charges once", async () => {
    const trashId = (await projects()).deleted[0].trashId;
    const before = await balance();
    const blocked = await s.call("POST", "/api/projects/restore", { body: { id: trashId } });
    assert.equal(blocked.status, 402, blocked.text);
    assert.equal(blocked.json.code, "project_charge");
    assert.equal(await balance(), before);
    const ok = await s.call("POST", "/api/projects/restore", { body: { id: trashId, confirmCharge: true } });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(before - (await balance()), 30);
    const list = await projects();
    assert.deepEqual(list.projects.map((p) => p.file).sort(), ["d-one.json", "d-three.json", "d-two.json"]);
    assert.equal(list.deleted.length, 0);
    assert.equal((await s.call("GET", "/api/presets")).json.presets.some((p) => p.file === "d-two.json"), true);
    assert.equal((await s.call("POST", "/api/estimate", { body: { file: "d-two.json", engine: "mock", mode: "first", first: 1 } })).status, 200, "the archive came back too");
  });

  it("the generic trash restore also goes through the project gate", async () => {
    assert.equal((await del("d-three.json")).status, 200);
    const trashId = (await projects()).deleted[0].trashId;
    // 2 projects remain and the limit is 2, so putting the deleted one back is a new project: it must ask first
    const blocked = await s.call("POST", "/api/trash/restore", { body: { id: trashId } });
    assert.equal(blocked.status, 402, blocked.text);
    assert.equal(blocked.json.code, "project_charge");
    assert.equal((await projects()).projects.length, 2);
    const before = await balance();
    const r = await s.call("POST", "/api/trash/restore", { body: { id: trashId, confirmCharge: true } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.project.charged, 30);
    assert.equal(before - (await balance()), 30);
    assert.equal((await projects()).projects.length, 3);
  });

  it("restoring over an existing file is a 409, never an overwrite", async () => {
    assert.equal((await del("d-one.json")).status, 200);
    assert.equal((await save("d-one", { confirmCharge: true })).status, 200, "the user created a new d-one meanwhile");
    const trashId = (await projects()).deleted.find((d) => d.file === "d-one.json").trashId;
    const r = await s.call("POST", "/api/projects/restore", { body: { id: trashId, confirmCharge: true } });
    assert.equal(r.status, 409, r.text);
  });

  it("restore refuses things that are not deleted projects", async () => {
    assert.equal((await s.call("POST", "/api/projects/restore", { body: { id: "19990101T000000-abcdef" } })).status, 404);
    assert.equal((await s.call("POST", "/api/projects/restore", { body: {} })).status, 400);
  });
});
