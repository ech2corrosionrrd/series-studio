/**
 * Light image QA without heavy deps: exists, size, magic bytes.
 * Optional width/height left for sharp later — not required.
 */

import { existsSync, readFileSync, statSync } from "node:fs";

const MIN_BYTES = 1024;

/**
 * Detect png / jpeg / webp from magic bytes.
 * @param {Buffer} buf
 * @returns {"png"|"jpeg"|"webp"|null}
 */
export function detectImageMagic(buf) {
  if (!buf || buf.length < 12) return null;
  // PNG
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "png";
  }
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  // WEBP: RIFF....WEBP
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

/**
 * @param {string} absPath
 * @returns {{ ok: boolean, issues: string[], bytes?: number, format?: string|null }}
 */
export function checkImageFile(absPath) {
  const issues = [];
  if (!absPath || !existsSync(absPath)) {
    return { ok: false, issues: ["missing"] };
  }
  let st;
  try {
    st = statSync(absPath);
  } catch {
    return { ok: false, issues: ["unreadable"] };
  }
  if (!st.isFile()) return { ok: false, issues: ["not-file"] };
  const bytes = st.size;
  if (bytes < MIN_BYTES) issues.push("too-small");

  let buf;
  try {
    // only need header
    buf = readFileSync(absPath).subarray(0, 32);
  } catch {
    return { ok: false, issues: ["unreadable"], bytes };
  }
  const format = detectImageMagic(buf);
  if (!format) issues.push("bad-magic");

  return {
    ok: issues.length === 0,
    issues,
    bytes,
    format,
  };
}
