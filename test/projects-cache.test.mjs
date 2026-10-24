// The registry and the active-project file are read on every request: they are parsed once and reused while the file
// is unchanged, and a changed file is never served stale.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
