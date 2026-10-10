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
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
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
