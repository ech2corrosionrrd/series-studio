/**
 * One look at a set before it is exported: what is wrong, where, and what to do.
 * Gathers checks (file format, tiny files, exact copies, similarity to the base
 * image) into a single per-frame list. Copies are matched by SHA-256 of the file:
 * frames of one series share a composition, so a fuzzy hash flags nearly every
 * pair (tried on a real series: 7 of 8 frames). Fuzzy matching stays a separate
 * button ("Find similar").
 * Offline, no paid calls. It does not judge whether a requested trait (a
 * "Teal" background, a scarf colour) is actually visible: that needs the AI
 * triage, which stays a separate button.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { similarityToBase, SIMILARITY_WARN_BELOW, SIMILARITY_METHOD } from "./similarity.mjs";
import { imageFormat } from "./png-normalize.mjs";
import { writeJsonAtomic } from "./fs-safe.mjs";

const MIN_BYTES = 1024;
const CACHE_FILE = "quality-cache.json";

/** Worse first when the list is cut. */
const SEVERITY = { bad_format: 4, tiny: 4, duplicate: 3, low_similarity: 2, marked_redo: 0 };

const tick = () => new Promise((resolve) => setImmediate(resolve));

function readCache(setDir) {
  try {
    return JSON.parse(readFileSync(join(setDir, CACHE_FILE), "utf8"));
  } catch {
    return {};
  }
}

/**
 * @param {{ setDir: string, baseBuf?: Buffer|null, marks?: Record<string,string>, limit?: number }} args
 */
export async function analyzeSetQuality({ setDir, baseBuf = null, marks = {}, limit = 24 }) {
  if (!existsSync(setDir) || !statSync(setDir).isDirectory()) throw new Error(`not a folder: ${setDir}`);
  const files = readdirSync(setDir)
    .filter((f) => /^\d+\.png$/i.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

  const baseKey = baseBuf ? createHash("sha1").update(baseBuf).digest("hex").slice(0, 12) : null;
  const cache = readCache(setDir);
  const nextCache = {};
  let cacheDirty = false;

  const frames = new Map();
  const byHash = new Map();
  const frame = (edition) => {
    if (!frames.has(edition)) frames.set(edition, { edition, issues: [], similarity: null });
    return frames.get(edition);
  };

  for (const file of files) {
    const edition = parseInt(file, 10);
    const f = frame(edition);
    const path = join(setDir, file);
    const st = statSync(path);
    if (st.size < MIN_BYTES) f.issues.push({ kind: "tiny", detail: `${st.size} B` });
    const buf = readFileSync(path);
    const sha = createHash("sha256").update(buf).digest("hex");
    byHash.set(sha, [...(byHash.get(sha) || []), edition]);
    const format = imageFormat(buf);
    if (format !== "png") {
      f.issues.push({ kind: "bad_format", detail: format === "unknown" ? "not an image" : format });
      await tick();
      continue;
    }
    if (baseBuf) {
      const key = `${st.mtimeMs}:${st.size}:${baseKey}`;
      let score = cache[file]?.key === key ? cache[file].similarity : undefined;
      if (score === undefined) {
        try {
          score = similarityToBase(buf, baseBuf).similarity;
        } catch {
          score = null;
        }
        cacheDirty = true;
        await tick();
      }
      nextCache[file] = { key, similarity: score };
      if (score != null) {
        f.similarity = score;
        if (score < SIMILARITY_WARN_BELOW) f.issues.push({ kind: "low_similarity", detail: String(score) });
      }
    }
  }
  if (cacheDirty || Object.keys(cache).length !== Object.keys(nextCache).length) {
    try {
      writeJsonAtomic(join(setDir, CACHE_FILE), nextCache);
    } catch {
      /* the cache is only a speed-up */
    }
  }

  for (const group of byHash.values()) {
    if (group.length < 2) continue;
    for (const ed of group) {
      frame(ed).issues.push({ kind: "duplicate", detail: group.filter((e) => e !== ed).map((e) => `#${e}`).join(", ") });
    }
  }

  for (const [key, val] of Object.entries(marks || {})) {
    if (val === "redo" && frames.has(Number(key))) frame(Number(key)).issues.push({ kind: "marked_redo", detail: "" });
  }

  const list = [...frames.values()];
  const counts = { bad_format: 0, tiny: 0, duplicate: 0, low_similarity: 0, marked_redo: 0 };
  for (const f of list) for (const k of new Set(f.issues.map((i) => i.kind))) counts[k] += 1;
  const problem = list.filter((f) => f.issues.some((i) => i.kind !== "marked_redo"));
  const score = (f) => Math.max(0, ...f.issues.map((i) => SEVERITY[i.kind] ?? 0));
  problem.sort((a, b) => score(b) - score(a) || (a.similarity ?? 1) - (b.similarity ?? 1) || a.edition - b.edition);

  const sims = list.map((f) => f.similarity).filter((v) => v != null);
  return {
    total: list.length,
    problemFrames: problem.length,
    counts,
    similarity: sims.length
      ? {
          method: SIMILARITY_METHOD,
          warnBelow: SIMILARITY_WARN_BELOW,
          mean: Math.round((sims.reduce((x, y) => x + y, 0) / sims.length) * 1000) / 1000,
          min: Math.min(...sims),
          max: Math.max(...sims),
        }
      : null,
    hasBase: Boolean(baseBuf),
    weakest: problem.slice(0, limit),
    problemEditions: problem.map((f) => f.edition),
  };
}
