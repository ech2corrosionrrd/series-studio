/**
 * Projects: every collection is its own project that can be saved and reopened for editing.
 *
 * A project is a preset the user created (its archive and sets follow it). The first PROJECTS_FREE projects of a
 * wallet are free; each further one costs PROJECT_EXTRA_CREDITS once, and the project then stays for good. Only
 * CREATING a project beyond the limit is charged or blocked: existing projects always open and edit.
 *
 * The registry lives next to the workspace (`workspace/projects.json`). Template presets seeded into every user's
 * folder (abstract-series, demo-series, pfp-portrait …) are NOT projects until the user saves one under their own id.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeJsonAtomic } from "./fs-safe.mjs";

export const PROJECTS_FREE_DEFAULT = 3;
export const PROJECT_EXTRA_CREDITS_DEFAULT = 30;

const intEnv = (v, def) => {
  const n = Number.parseInt(String(v ?? "").trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : def;
};

export function projectsConfig(env = process.env) {
  return {
    free: intEnv(env.PROJECTS_FREE, PROJECTS_FREE_DEFAULT),
    extraCredits: intEnv(env.PROJECT_EXTRA_CREDITS, PROJECT_EXTRA_CREDITS_DEFAULT),
  };
}

const registryPath = (paths) => join(paths.workspace, "projects.json");

function readRegistry(paths) {
  try {
    const data = JSON.parse(readFileSync(registryPath(paths), "utf8"));
    return Array.isArray(data?.projects) ? data.projects : [];
  } catch {
    return null;
  }
}

/**
 * The wallet's projects. On first use the registry is built from the presets already in the folder, except the
 * template files shipped with Series Lab (`templateFiles`), so existing users keep what they made and templates never count.
 * @param {{ presets: string, workspace: string }} paths
 * @param {Set<string>} templateFiles file names of the shipped templates
 */
export function loadProjects(paths, templateFiles = new Set()) {
  let list = readRegistry(paths);
  if (list) return list;
  list = [];
  if (existsSync(paths.presets)) {
    for (const f of readdirSync(paths.presets).sort()) {
      if (!f.endsWith(".json") || templateFiles.has(f)) continue;
      let createdAt = null;
      try {
        createdAt = statSync(join(paths.presets, f)).mtime.toISOString();
      } catch {
        /* keep null */
      }
      list.push({ file: f, createdAt, paid: false, credits: 0, imported: true });
    }
  }
  saveProjects(paths, list);
  return list;
}

export function saveProjects(paths, list) {
  mkdirSync(paths.workspace, { recursive: true });
  writeJsonAtomic(registryPath(paths), { projects: list });
}

export function isProject(list, file) {
  return list.some((p) => p.file === file);
}

/** Quota for the UI and for the gate: `needsCharge` is true when creating one more project costs credits. */
export function projectQuota(list, cfg = projectsConfig()) {
  const used = list.length;
  return {
    free: cfg.free,
    used,
    freeLeft: Math.max(0, cfg.free - used),
    extraCredits: cfg.extraCredits,
    needsCharge: used >= cfg.free && cfg.extraCredits > 0,
  };
}

/**
 * Decides what saving `file` means. Editing a known project is free; a new one is free within the limit and costs
 * `extraCredits` beyond it.
 * @returns {{ isNew: boolean, charge: number }}
 */
export function admitProject(list, file, cfg = projectsConfig()) {
  if (isProject(list, file)) return { isNew: false, charge: 0 };
  const q = projectQuota(list, cfg);
  return { isNew: true, charge: q.needsCharge ? q.extraCredits : 0 };
}

export function registerProject(paths, list, file, { charge = 0, now = new Date() } = {}) {
  if (isProject(list, file)) return list;
  const next = [...list, { file, createdAt: now.toISOString(), paid: charge > 0, credits: charge }];
  saveProjects(paths, next);
  return next;
}

/** Display rows: file, id, name, size, created, paid. Missing preset files are still listed (the project exists). */
export function describeProjects(paths, list) {
  return list.map((p) => {
    let name = p.file.replace(/\.json$/, "");
    let size = null;
    try {
      const preset = JSON.parse(readFileSync(join(paths.presets, p.file), "utf8"));
      name = preset.name || name;
      size = preset.size ?? null;
    } catch {
      /* the registry entry outlives a missing file */
    }
    return { file: p.file, id: p.file.replace(/\.json$/, ""), name, size, createdAt: p.createdAt, paid: Boolean(p.paid), credits: p.credits || 0 };
  });
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Assets per project (public mode)
 *
 *   <user>/presets/<id>.json            the project definition (user level, listed together)
 *   <user>/workspace/…                  workspace, registry, active project (user level)
 *   <user>/projects/<id>/input          the base image of THIS project
 *   <user>/projects/<id>/layers         PNG layers of THIS project
 *   <user>/projects/<id>/out            recipe archive, frame sets, bundles, the project's own trash
 *   <user>/trash-projects/<ts>-<id>/…   deleted projects (reversible): preset.json, project/ (assets), meta.json
 *
 * The server puts the active project's folders behind `P()`, so every route works on one project without knowing it.
 * ───────────────────────────────────────────────────────────────────────── */

export const projectIdOf = (file) => String(file || "").replace(/\.json$/, "");
const projectsDir = (user) => join(user.root, "projects");
const assetsMarker = (user) => join(projectsDir(user), ".assets-v1");
const deletedRoot = (user) => join(user.root, "trash-projects");
const activeFile = (user) => join(user.workspace, "active-project.json");

/** Folders of one project; everything not listed here stays at user level. */
export function projectPaths(user, file) {
  const dir = join(projectsDir(user), projectIdOf(file));
  return { ...user, input: join(dir, "input"), out: join(dir, "out"), layers: join(dir, "layers") };
}

export function ensureProjectDirs(paths) {
  for (const d of [paths.input, paths.out, paths.layers]) mkdirSync(d, { recursive: true });
}

export function readActiveProject(user) {
  try {
    const f = JSON.parse(readFileSync(activeFile(user), "utf8"))?.file;
    return typeof f === "string" ? f : null;
  } catch {
    return null;
  }
}

/**
 * Which project is active when none was ever opened explicitly: the series the workspace was last on, else the first.
 * (This decides which project adopts the assets the wallet had before projects owned them.)
 */
export function initialActiveProject(user, list) {
  try {
    const id = JSON.parse(readFileSync(join(user.workspace, "current.json"), "utf8"))?.presetId;
    const file = id ? `${id}.json` : "";
    if (file && isProject(list, file)) return file;
  } catch {
    /* no workspace yet */
  }
  return list[0]?.file || null;
}

export function writeActiveProject(user, file) {
  mkdirSync(user.workspace, { recursive: true });
  writeJsonAtomic(activeFile(user), { file, at: new Date().toISOString() });
}

function moveEntry(src, dst) {
  mkdirSync(join(dst, ".."), { recursive: true });
  try {
    renameSync(src, dst);
  } catch (e) {
    if (e.code !== "EXDEV") throw e;
    cpSync(src, dst, { recursive: true });
    rmSync(src, { recursive: true, force: true });
  }
}

/**
 * One-time move of the assets that were shared by the whole wallet into the projects:
 * recipe archives go to the project of the same name, everything else (base image, layers, frame sets, bundles,
 * trash) to the project that is active now. Safe to repeat: a marker is written last and moves skip what is gone.
 * @returns {{ moved: string[] } | null} null when it had already run
 */
export function adoptLegacyAssets(user, activeFileName, projectFileNames) {
  if (existsSync(assetsMarker(user))) return null;
  const moved = [];
  const active = projectPaths(user, activeFileName);
  ensureProjectDirs(active);
  const projectSet = new Set(projectFileNames);

  const take = (from, to) => {
    if (!existsSync(from)) return;
    if (existsSync(to)) return; // never overwrite
    moveEntry(from, to);
    moved.push(from.slice(user.root.length + 1));
  };

  // input/ and layers/ go to the active project
  for (const [legacy, target] of [[user.input, active.input], [user.layers, active.layers]]) {
    if (!existsSync(legacy)) continue;
    for (const name of readdirSync(legacy)) take(join(legacy, name), join(target, name));
  }
  // out/: archives by name, the rest to the active project
  if (existsSync(user.out)) {
    for (const name of readdirSync(user.out)) {
      const from = join(user.out, name);
      if (name.endsWith(".json") && projectSet.has(name)) {
        const owner = projectPaths(user, name);
        ensureProjectDirs(owner);
        take(from, join(owner.out, name));
      } else {
        take(from, join(active.out, name));
      }
    }
  }
  // trash items remember where files came from (relative to the user folder): point them at the project
  const trash = join(active.out, "trash");
  if (existsSync(trash)) {
    for (const id of readdirSync(trash)) {
      const meta = join(trash, id, "item.json");
      try {
        const item = JSON.parse(readFileSync(meta, "utf8"));
        const prefix = `projects/${projectIdOf(activeFileName)}/`;
        for (const f of item.files || []) {
          if (/^(out|input|layers)\//.test(f.from) && !f.from.startsWith(prefix)) f.from = `${prefix}${f.from}`;
        }
        writeJsonAtomic(meta, item);
      } catch {
        /* a broken trash item stays as it is */
      }
    }
  }
  mkdirSync(projectsDir(user), { recursive: true });
  writeFileSync(assetsMarker(user), JSON.stringify({ at: new Date().toISOString(), active: activeFileName, moved: moved.length }));
  return { moved };
}

/** Frames, sets and bytes of a project: shown in the "My projects" card. */
export function projectAssetStats(user, file) {
  const paths = projectPaths(user, file);
  const stats = { sets: 0, frames: 0, bytes: 0, hasBase: false };
  try {
    stats.hasBase = readdirSync(paths.input).some((f) => /^primary\.(png|jpe?g|webp)$/i.test(f));
  } catch {
    /* no base yet */
  }
  if (!existsSync(paths.out)) return stats;
  for (const name of readdirSync(paths.out)) {
    const dir = join(paths.out, name);
    let st;
    try {
      st = statSync(dir);
    } catch {
      continue;
    }
    if (!st.isDirectory() || name === "trash" || name === "bundles") continue;
    const frames = readdirSync(dir).filter((f) => /^\d+\.(png|jpe?g|webp)$/i.test(f));
    if (!frames.length) continue;
    stats.sets += 1;
    stats.frames += frames.length;
    for (const f of frames) {
      try {
        stats.bytes += statSync(join(dir, f)).size;
      } catch {
        /* ignore */
      }
    }
  }
  return stats;
}

/* deleted projects (reversible) */
const DELETED_ID = /^\d{8}T\d{6}-[a-z0-9-]+$/;

/**
 * Move a project to the trash: its preset, its recipe archive when it still lives in the shared `out/`, and its asset folder.
 * @returns {string} trash id
 */
export function trashProject(user, file, { now = new Date(), legacyArchive = null } = {}) {
  const slug = projectIdOf(file).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24) || "p";
  const id = `${now.toISOString().replace(/[-:]/g, "").slice(0, 15)}-${slug}-${Math.random().toString(36).slice(2, 6)}`;
  const dir = join(deletedRoot(user), id);
  mkdirSync(dir, { recursive: true });
  const presetPath = join(user.presets, file);
  if (existsSync(presetPath)) moveEntry(presetPath, join(dir, "preset.json"));
  const assets = join(projectsDir(user), projectIdOf(file));
  if (existsSync(assets)) moveEntry(assets, join(dir, "project"));
  if (legacyArchive && existsSync(legacyArchive)) moveEntry(legacyArchive, join(dir, "archive.json"));
  writeJsonAtomic(join(dir, "meta.json"), { id, file, at: now.toISOString() });
  return id;
}

/**
 * Projects deleted before assets belonged to projects (file-level trash items with the reason `project:<file>`, written
 * into the then-shared or the active project's `out/trash`) become entries of the deleted-projects list, so they can be
 * restored from the card. Runs once per wallet (marker) and keeps the files; only the old trash item is removed.
 * @returns {string[]} converted project files
 */
export function convertLegacyProjectTrash(user) {
  const marker = join(projectsDir(user), ".project-trash-v1");
  if (existsSync(marker)) return [];
  const converted = [];
  const trashDirs = [join(user.out, "trash")];
  const root = projectsDir(user);
  if (existsSync(root)) {
    for (const id of readdirSync(root)) trashDirs.push(join(root, id, "out", "trash"));
  }
  for (const dir of trashDirs) {
    if (!existsSync(dir)) continue;
    for (const itemId of readdirSync(dir)) {
      const itemDir = join(dir, itemId);
      let item;
      try {
        item = JSON.parse(readFileSync(join(itemDir, "item.json"), "utf8"));
      } catch {
        continue;
      }
      const reason = String(item.reason || "");
      if (!reason.startsWith("project:")) continue;
      const file = reason.slice("project:".length);
      if (!/^[a-zA-Z0-9._-]+\.json$/.test(file) || file.includes("..")) continue;
      const target = join(deletedRoot(user), itemId);
      if (existsSync(target)) continue;
      mkdirSync(target, { recursive: true });
      for (const f of item.files || []) {
        const stored = join(itemDir, f.name);
        if (!existsSync(stored)) continue;
        if (f.from.endsWith(`presets/${file}`)) moveEntry(stored, join(target, "preset.json"));
        else if (f.from.endsWith(`out/${file}`)) moveEntry(stored, join(target, "archive.json"));
      }
      writeJsonAtomic(join(target, "meta.json"), { id: itemId, file, at: item.at || new Date().toISOString() });
      rmSync(itemDir, { recursive: true, force: true });
      converted.push(file);
    }
  }
  mkdirSync(root, { recursive: true });
  writeFileSync(marker, JSON.stringify({ at: new Date().toISOString(), converted }));
  return converted;
}

export function listDeletedProjects(user) {
  const root = deletedRoot(user);
  if (!existsSync(root)) return [];
  const out = [];
  for (const id of readdirSync(root)) {
    if (!DELETED_ID.test(id)) continue;
    try {
      const meta = JSON.parse(readFileSync(join(root, id, "meta.json"), "utf8"));
      out.push({ trashId: id, file: meta.file, at: meta.at });
    } catch {
      /* skip broken entries */
    }
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/** Which project a deleted entry is (for the gate): its preset file name, or null when the id is unknown. */
export function deletedProjectFile(user, trashId) {
  return listDeletedProjects(user).find((d) => d.trashId === trashId)?.file || null;
}

/**
 * Put a deleted project back. Refuses (409) when a preset or an asset folder with that name exists now.
 * @returns {string} the preset file name
 */
export function restoreDeletedProject(user, trashId, { legacyArchiveTarget = null } = {}) {
  if (!DELETED_ID.test(String(trashId || ""))) throw Object.assign(new Error("bad trash id"), { status: 400 });
  const dir = join(deletedRoot(user), trashId);
  let meta;
  try {
    meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
  } catch {
    throw Object.assign(new Error("trash item is not a project"), { status: 404 });
  }
  const target = join(user.presets, meta.file);
  const assets = join(projectsDir(user), projectIdOf(meta.file));
  if (existsSync(target) || existsSync(assets)) {
    throw Object.assign(new Error("A project file with this name already exists: delete or rename it first."), { status: 409 });
  }
  if (existsSync(join(dir, "preset.json"))) moveEntry(join(dir, "preset.json"), target);
  if (existsSync(join(dir, "project"))) moveEntry(join(dir, "project"), assets);
  if (existsSync(join(dir, "archive.json"))) {
    moveEntry(join(dir, "archive.json"), legacyArchiveTarget || join(assets, "out", meta.file));
  }
  rmSync(dir, { recursive: true, force: true });
  return meta.file;
}
