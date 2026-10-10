/**
 * Trash: deleting files becomes reversible.
 *
 *   out/trash/<id>/item.json   — { id, at, reason, files: [{ from, name }] }
 *   out/trash/<id>/<name>      — the moved file(s)
 *
 * `from` is relative to the project root, so restore puts files back exactly
 * where they were. Simplified port of gremlin-nft src/trash.mjs.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { writeJsonAtomic } from "./fs-safe.mjs";

const ID_RE = /^\d{8}T\d{6}-[a-z0-9]{4,}$/;

export function isTrashId(id) {
  return typeof id === "string" && ID_RE.test(id);
}

function newId(now = new Date()) {
  const s = now.toISOString().replace(/[-:]/g, "").slice(0, 15); // YYYYMMDDTHHMMSS
  return `${s}-${Math.random().toString(36).slice(2, 8)}`;
}

function moveFile(src, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  try {
    renameSync(src, dest);
  } catch (e) {
    if (e.code !== "EXDEV") throw e;
    copyFileSync(src, dest);
    unlinkSync(src);
  }
}

function inside(root, p) {
  const rel = relative(root, p);
  return rel !== "" && rel.split(sep)[0] !== ".." && !isAbsolute(rel);
}

/**
 * Move files into a new trash item.
 * @param {{ root: string, trashDir: string }} dirs
 * @param {string[]} absPaths existing files under `root`
 * @param {string} [reason]
 * @returns {object|null} the item (null when nothing existed)
 */
export function trashFiles({ root, trashDir }, absPaths, reason = "", now = new Date()) {
  const paths = absPaths.map((p) => resolve(p)).filter((p) => existsSync(p) && statSync(p).isFile());
  if (!paths.length) return null;
  for (const p of paths) {
    if (!inside(resolve(root), p)) throw new Error(`refusing to trash outside project: ${p}`);
  }
  const id = newId(now);
  const dir = join(trashDir, id);
  const used = new Set();
  const files = [];
  for (const p of paths) {
    let name = basename(p);
    for (let i = 2; used.has(name); i++) name = `${i}-${basename(p)}`;
    used.add(name);
    moveFile(p, join(dir, name));
    files.push({ from: relative(resolve(root), p).split(sep).join("/"), name });
  }
  const item = { id, at: now.toISOString(), reason: String(reason || ""), files };
  writeJsonAtomic(join(dir, "item.json"), item);
  return item;
}

function readItem(trashDir, id) {
  if (!isTrashId(id)) throw Object.assign(new Error(`bad trash id: ${id}`), { status: 400 });
  const p = join(trashDir, id, "item.json");
  if (!existsSync(p)) throw new Error(`trash item not found: ${id}`);
  return JSON.parse(readFileSync(p, "utf8"));
}

function dirBytes(dir) {
  let n = 0;
  for (const f of readdirSync(dir)) {
    try { n += statSync(join(dir, f)).size; } catch { /* ignore */ }
  }
  return n;
}

/** Newest first. */
export function listTrash(trashDir) {
  if (!existsSync(trashDir)) return [];
  const items = [];
  for (const id of readdirSync(trashDir)) {
    if (!isTrashId(id)) continue;
    try {
      items.push({ ...readItem(trashDir, id), bytes: dirBytes(join(trashDir, id)) });
    } catch { /* skip broken item */ }
  }
  return items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/**
 * Put files back. Refuses (without moving anything) when a target already
 * exists — the user decides what to do with the newer file first.
 */
export function restoreTrash({ root, trashDir }, id) {
  const item = readItem(trashDir, id);
  const targets = item.files.map((f) => ({ ...f, dest: resolve(root, f.from) }));
  for (const t of targets) {
    if (!inside(resolve(root), t.dest)) throw new Error(`bad path in trash item: ${t.from}`);
    if (existsSync(t.dest)) throw new Error(`already exists: ${t.from} — move or delete it first`);
  }
  for (const t of targets) moveFile(join(trashDir, id, t.name), t.dest);
  rmSync(join(trashDir, id), { recursive: true, force: true });
  return item;
}

export function purgeTrash(trashDir, id) {
  readItem(trashDir, id);
  rmSync(join(trashDir, id), { recursive: true, force: true });
}

/** Remove items older than `days`. Returns purged ids. */
export function pruneTrash(trashDir, days, now = new Date()) {
  const cutoff = now.getTime() - days * 86400_000;
  const purged = [];
  for (const item of listTrash(trashDir)) {
    if (Date.parse(item.at) < cutoff) {
      rmSync(join(trashDir, item.id), { recursive: true, force: true });
      purged.push(item.id);
    }
  }
  return purged;
}
