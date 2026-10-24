// The registry and the active-project file are read on every request: they are parsed once and reused while the file
// is unchanged, and a changed file is never served stale.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileCacheStats, forgetProjectFiles, loadProjects, readActiveProject, registerProject, saveProjects, writeActiveProject } from "../src/projects.mjs";

describe("projects registry cache", () => {
  let root;
  let paths;
  const registry = () => join(paths.workspace, "projects.json");

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "projects-cache-"));
    paths = { root, presets: join(root, "presets"), workspace: join(root, "workspace") };
    mkdirSync(paths.presets, { recursive: true });
    mkdirSync(paths.workspace, { recursive: true });
    forgetProjectFiles();
  });

  it("serves the parsed registry while the file is unchanged", () => {
    saveProjects(paths, [{ file: "a.json" }]);
    forgetProjectFiles();
    assert.equal(loadProjects(paths).length, 1);
    const parsed = fileCacheStats.parses;
    for (let i = 0; i < 50; i++) loadProjects(paths);
    assert.equal(fileCacheStats.parses, parsed, "50 more loads of an unchanged file parse nothing");
  });

  it("a file that changed on disk is read again", () => {
    saveProjects(paths, [{ file: "a.json" }]);
    assert.equal(loadProjects(paths).length, 1);
    writeFileSync(registry(), JSON.stringify({ projects: [{ file: "a.json" }, { file: "b.json" }, { file: "c.json" }] }));
    assert.deepEqual(loadProjects(paths).map((p) => p.file), ["a.json", "b.json", "c.json"]);
  });

  it("a registration made by this process is visible at once", () => {
    let list = loadProjects(paths); // builds the registry from the presets folder (empty)
    assert.equal(list.length, 0);
    list = registerProject(paths, list, "new.json", { charge: 0 });
    assert.deepEqual(loadProjects(paths).map((p) => p.file), ["new.json"]);
  });

  it("changing the returned list does not change what the next call sees", () => {
    saveProjects(paths, [{ file: "a.json" }]);
    const first = loadProjects(paths);
    first.push({ file: "ghost.json" });
    assert.deepEqual(loadProjects(paths).map((p) => p.file), ["a.json"]);
  });

  it("a corrupt or missing registry is rebuilt from the presets, as before", () => {
    writeFileSync(join(paths.presets, "mine.json"), "{}");
    saveProjects(paths, [{ file: "a.json" }]);
    assert.equal(loadProjects(paths).length, 1);
    writeFileSync(registry(), "{ not json");
    assert.deepEqual(loadProjects(paths).map((p) => p.file), ["mine.json"]);
  });

  it("the active project: written, cached, and re-read after an outside change", () => {
    assert.equal(readActiveProject(paths), null);
    writeActiveProject(paths, "a.json");
    assert.equal(readActiveProject(paths), "a.json");
    writeFileSync(join(paths.workspace, "active-project.json"), JSON.stringify({ file: "another-longer-name.json" }));
    assert.equal(readActiveProject(paths), "another-longer-name.json");
    writeFileSync(join(paths.workspace, "active-project.json"), "garbage");
    assert.equal(readActiveProject(paths), null);
  });
});

describe("projects registry backup and recovery", () => {
  let root;
  let paths;
  const registry = () => join(paths.workspace, "projects.json");
  const quiet = (fn) => {
    const real = console.warn;
    const lines = [];
    console.warn = (...a) => lines.push(a.join(" "));
    try {
      return { result: fn(), lines };
    } finally {
      console.warn = real;
    }
  };
  const preset = (f) => writeFileSync(join(paths.presets, f), "{}");

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "projects-backup-"));
    paths = { root, presets: join(root, "presets"), workspace: join(root, "workspace") };
    mkdirSync(paths.presets, { recursive: true });
    mkdirSync(paths.workspace, { recursive: true });
    forgetProjectFiles();
  });

  it("every save leaves the previous good registry as a backup", () => {
    saveProjects(paths, [{ file: "a.json" }]);
    assert.equal(existsSync(`${registry()}.bak`), false, "nothing to back up on the very first save");
    saveProjects(paths, [{ file: "a.json" }, { file: "b.json" }]);
    assert.deepEqual(JSON.parse(readFileSync(`${registry()}.bak`, "utf8")).projects.map((p) => p.file), ["a.json"]);
  });

  it("a corrupt registry is restored from the backup with its paid flags, and the broken file is kept", () => {
    preset("a.json");
    preset("paid.json");
    saveProjects(paths, [{ file: "a.json", paid: false }]);
    saveProjects(paths, [{ file: "a.json", paid: false }, { file: "paid.json", paid: true, credits: 30 }]);
    saveProjects(paths, [{ file: "a.json", paid: false }, { file: "paid.json", paid: true, credits: 30 }]); // backup = same content
    writeFileSync(registry(), "{ broken");
    forgetProjectFiles();
    const { result, lines } = quiet(() => loadProjects(paths));
    const paid = result.find((p) => p.file === "paid.json");
    assert.deepEqual([paid.paid, paid.credits], [true, 30], "the payment history survives");
    assert.ok(lines.some((l) => /corrupt/.test(l) && /restored 2/.test(l)), lines.join("|"));
    assert.ok(readdirSync(paths.workspace).some((f) => f.startsWith("projects.json.corrupt-")), "the broken file is kept for inspection");
    assert.equal(JSON.parse(readFileSync(registry(), "utf8")).projects.length, 2, "and a good registry is written back");
  });

  it("a missing registry is restored the same way; a preset the backup does not know comes back as an imported one", () => {
    preset("a.json");
    saveProjects(paths, [{ file: "a.json", paid: true, credits: 30 }]);
    saveProjects(paths, [{ file: "a.json", paid: true, credits: 30 }]);
    preset("later.json");
    rmSync(registry());
    forgetProjectFiles();
    const { result, lines } = quiet(() => loadProjects(paths));
    assert.deepEqual(result.map((p) => [p.file, p.paid, Boolean(p.imported)]), [["a.json", true, false], ["later.json", false, true]]);
    assert.ok(lines.some((l) => /missing/.test(l)));
  });

  it("a project deleted since the backup is not brought back as a ghost", () => {
    preset("keep.json");
    saveProjects(paths, [{ file: "keep.json" }, { file: "gone.json", paid: true, credits: 30 }]);
    saveProjects(paths, [{ file: "keep.json" }, { file: "gone.json", paid: true, credits: 30 }]); // gone.json has no preset file
    rmSync(registry());
    forgetProjectFiles();
    const { result } = quiet(() => loadProjects(paths));
    assert.deepEqual(result.map((p) => p.file), ["keep.json"]);
  });

  it("without a backup the registry is rebuilt from the presets, and a corrupt one is reported", () => {
    preset("mine.json");
    const first = quiet(() => loadProjects(paths));
    assert.deepEqual(first.result.map((p) => p.file), ["mine.json"]);
    assert.deepEqual(first.lines, [], "first use is silent");
    rmSync(`${registry()}.bak`, { force: true });
    writeFileSync(registry(), "{ broken");
    forgetProjectFiles();
    const second = quiet(() => loadProjects(paths));
    assert.deepEqual(second.result.map((p) => [p.file, p.imported]), [["mine.json", true]]);
    assert.ok(second.lines.some((l) => /no backup/.test(l) && /paid flags are lost/.test(l)), second.lines.join("|"));
  });

  it("a corrupt registry never overwrites a good backup", () => {
    saveProjects(paths, [{ file: "a.json" }]);
    saveProjects(paths, [{ file: "a.json" }, { file: "b.json" }]);
    const goodBackup = readFileSync(`${registry()}.bak`, "utf8");
    writeFileSync(registry(), "{ broken");
    forgetProjectFiles();
    saveProjects(paths, [{ file: "x.json" }]); // saving over a corrupt file
    assert.equal(readFileSync(`${registry()}.bak`, "utf8"), goodBackup);
  });
});
