/**
 * Atomic file writes: content goes to a temp file next to the target, then
 * renameSync replaces the target in one step. An interrupted process
 * (Ctrl+C, crash, power loss) never leaves a half-written JSON behind.
 * Ported from gremlin-nft src/fs-safe.mjs.
 */
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

// Windows: antivirus / indexer may briefly lock the target → EPERM/EBUSY on rename.
const RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

export function atomicWriteFileSync(filePath, content, encoding) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  writeFileSync(tmp, content, encoding);
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, filePath);
      return;
    } catch (e) {
      if (!RETRY_CODES.has(e.code) || attempt >= 4) {
        rmSync(tmp, { force: true });
        throw e;
      }
      const until = Date.now() + 25 * (attempt + 1);
      while (Date.now() < until) { /* short sync backoff */ }
    }
  }
}

export function writeJsonAtomic(filePath, data, space = 2) {
  atomicWriteFileSync(filePath, JSON.stringify(data, null, space) + "\n", "utf8");
}

/**
 * True when `target` is `root` or lies inside it. Works with both path separators
 * (a plain `startsWith(root + "/")` never matches on Windows) and rejects `..` escapes.
 */
export function isInsideDir(root, target) {
  const rel = relative(resolve(root), resolve(target));
  return rel === "" || (!/^\.\.(?:[\\/]|$)/.test(rel) && !isAbsolute(rel));
}
