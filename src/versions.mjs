/**
 * Render version history: re-generation never overwrites a paid image.
 *
 *   out/<set>/<edition>.png                — CURRENT version (what gallery/export use)
 *   out/<set>/versions/<edition>/v<k>.png  — every other (older / non-selected) version
 *   out/<set>/versions/<edition>/meta.json — { current: k, versions: [{ v, at, engine, seed, ... }] }
 *
 * Each version's bytes live in exactly one place, so history costs no extra
 * disk for the current image. Pre-existing <edition>.png without meta becomes v1.
 * Adapted from gremlin-nft src/versions.mjs.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFileSync, writeJsonAtomic } from "./fs-safe.mjs";

const edKey = (edition) => {
  const s = String(edition);
  if (!/^\d+$/.test(s)) throw new Error(`bad edition: ${edition}`);
  return s;
};
const vdir = (setDir, ed) => join(setDir, "versions", edKey(ed));
const metaPath = (setDir, ed) => join(vdir(setDir, ed), "meta.json");
export const currentPath = (setDir, ed) => join(setDir, `${edKey(ed)}.png`);
const storedPath = (setDir, ed, v) => join(vdir(setDir, ed), `v${v}.png`);

/** Where version `v` lives on disk right now. */
export function versionPath(setDir, edition, v, meta = readMeta(setDir, edition)) {
  return meta.current === v ? currentPath(setDir, edition) : storedPath(setDir, edition, v);
}

export function readMeta(setDir, edition) {
  const p = metaPath(setDir, edition);
  if (existsSync(p)) {
    const meta = JSON.parse(readFileSync(p, "utf8"));
    // Files restored from trash come back without a meta entry — re-adopt them.
    const known = new Set(meta.versions.map((x) => x.v));
    const found = readdirSync(vdir(setDir, edition))
      .map((f) => /^v(\d+)\.png$/.exec(f)?.[1])
      .filter(Boolean)
      .map(Number)
      .filter((v) => !known.has(v));
    if (found.length) {
      meta.versions = [...meta.versions, ...found.map((v) => ({ v, at: null, restored: true }))].sort((a, b) => a.v - b.v);
    }
    return meta;
  }
  if (existsSync(currentPath(setDir, edition))) {
    return { current: 1, versions: [{ v: 1, at: null, legacy: true }] };
  }
  return { current: null, versions: [] };
}

function writeMeta(setDir, edition, meta) {
  writeJsonAtomic(metaPath(setDir, edition), meta);
}

/**
 * Store a new render and make it current; the previous current image moves
 * into versions/. Returns the new version number.
 */
export function addVersion(setDir, edition, buf, info = {}, now = new Date()) {
  const meta = readMeta(setDir, edition);
  const v = meta.versions.reduce((m, x) => Math.max(m, x.v), 0) + 1;
  const cur = currentPath(setDir, edition);
  if (meta.current != null && existsSync(cur)) {
    mkdirSync(vdir(setDir, edition), { recursive: true });
    renameSync(cur, storedPath(setDir, edition, meta.current));
  }
  atomicWriteFileSync(cur, buf);
  meta.versions.push({ v, at: now.toISOString(), ...info });
  meta.current = v;
  writeMeta(setDir, edition, meta);
  return v;
}

/** Make an older version current (swap files). */
export function setCurrent(setDir, edition, v) {
  const meta = readMeta(setDir, edition);
  v = Number(v);
  if (!meta.versions.some((x) => x.v === v)) throw new Error(`no version v${v} for #${edition}`);
  if (meta.current === v) return meta;
  const src = storedPath(setDir, edition, v);
  if (!existsSync(src)) throw new Error(`file for v${v} of #${edition} is missing`);
  const cur = currentPath(setDir, edition);
  mkdirSync(vdir(setDir, edition), { recursive: true });
  if (meta.current != null && existsSync(cur)) renameSync(cur, storedPath(setDir, edition, meta.current));
  renameSync(src, cur);
  meta.current = v;
  writeMeta(setDir, edition, meta);
  return meta;
}

/**
 * Forget a non-current version in meta and return its file path so the
 * caller can move it to trash. The current version cannot be dropped —
 * select another one first.
 */
export function dropVersion(setDir, edition, v) {
  const meta = readMeta(setDir, edition);
  v = Number(v);
  if (!meta.versions.some((x) => x.v === v)) throw new Error(`no version v${v} for #${edition}`);
  if (meta.current === v) throw new Error("cannot drop the current version — select another first");
  const file = storedPath(setDir, edition, v);
  meta.versions = meta.versions.filter((x) => x.v !== v);
  writeMeta(setDir, edition, meta);
  return file;
}

/** Versions with URLs relative to out/, for API responses. */
export function listVersions(setDir, setName, edition) {
  const meta = readMeta(setDir, edition);
  const ed = edKey(edition);
  return {
    edition: Number(ed),
    current: meta.current,
    versions: meta.versions.map((x) => ({
      ...x,
      current: x.v === meta.current,
      exists: existsSync(versionPath(setDir, edition, x.v, meta)),
      url: x.v === meta.current
        ? `/out/${setName}/${ed}.png`
        : `/out/${setName}/versions/${ed}/v${x.v}.png`,
    })),
  };
}

/** Number of versions per edition in a set (editions with >1 only). */
export function versionCounts(setDir) {
  const root = join(setDir, "versions");
  const out = {};
  if (!existsSync(root)) return out;
  for (const ed of readdirSync(root)) {
    if (!/^\d+$/.test(ed)) continue;
    try {
      const n = readMeta(setDir, ed).versions.length;
      if (n > 1) out[ed] = n;
    } catch { /* ignore broken meta */ }
  }
  return out;
}
