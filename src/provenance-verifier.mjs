#!/usr/bin/env node
/**
 * Independent check of a Series Lab provenance record. Only node:crypto, node:fs
 * and node:path are used, so this single file runs on any Node 18+ without
 * installing Series Lab. It ships inside every export ZIP as verify-provenance.mjs.
 *
 *   node verify-provenance.mjs [images-dir] [provenance.json]
 *
 * Defaults: ./images (or the current folder when there is none) and ./provenance.json.
 *
 * The rule, written out so anyone can re-implement it:
 *   1. sha256 every image file as raw bytes, lowercase hex;
 *   2. order the files by edition number, ascending;
 *   3. concatenate the 64-character hex strings, no separators;
 *   4. provenanceHash = sha256 of that string (as UTF-8).
 *
 * Exit code 0 only when every error check passes. Warnings never fail the run.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/**
 * @param {{ provenanceHash: string, count?: number, records: Array<{ edition: number, file: string, sha256: string }> }} prov
 * @param {{ read: (file: string) => Buffer | null, list?: () => string[] }} source
 * @returns {{ valid: boolean, errors: string[], warnings: string[], recomputed: string | null }}
 */
export function checkProvenance(prov, source) {
  const errors = [];
  const warnings = [];
  if (!prov || typeof prov.provenanceHash !== "string" || !Array.isArray(prov.records) || !prov.records.length) {
    return { valid: false, errors: ["Invalid provenance data structure"], warnings, recomputed: null };
  }
  const records = [...prov.records].sort((a, b) => Number(a.edition) - Number(b.edition));

  if (prov.count != null && Number(prov.count) !== records.length) {
    errors.push(`count says ${prov.count}, the record lists ${records.length} files`);
  }

  // The record must agree with itself before the files are even opened.
  const own = sha256(records.map((r) => r.sha256).join(""));
  if (own !== prov.provenanceHash) {
    errors.push(`The record is inconsistent: its own hashes give ${own}, not ${prov.provenanceHash}`);
  }

  const seenEdition = new Set();
  const seenHash = new Map();
  let concatenated = "";
  for (const r of records) {
    const ed = Number(r.edition);
    if (seenEdition.has(ed)) errors.push(`Edition #${ed} is listed twice`);
    seenEdition.add(ed);

    if (typeof r.file !== "string" || !r.file || /[\\/]/.test(r.file) || r.file.includes("..")) {
      errors.push(`Unsafe or empty file name for edition #${ed}: ${JSON.stringify(r.file)}`);
      continue;
    }
    const buf = source.read(r.file);
    if (!buf) {
      errors.push(`File missing: ${r.file}`);
      continue;
    }
    const actual = sha256(buf);
    concatenated += actual;
    if (actual !== r.sha256) {
      errors.push(`Hash mismatch for edition #${ed} (${r.file}): recorded ${r.sha256}, file gives ${actual}`);
    }
    if (seenHash.has(actual)) {
      errors.push(`Editions #${seenHash.get(actual)} and #${ed} are the same image (${actual.slice(0, 12)}...)`);
    } else {
      seenHash.set(actual, ed);
    }
    if (/\.png$/i.test(r.file) && !PNG_SIG.every((b, i) => buf[i] === b)) {
      warnings.push(`${r.file} is named .png but the bytes are not a PNG`);
    }
  }

  const recomputed = sha256(concatenated);
  if (recomputed !== prov.provenanceHash) {
    errors.push(`Provenance hash mismatch: recorded ${prov.provenanceHash}, the files give ${recomputed}`);
  }

  const eds = [...seenEdition].sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < eds.length; i++) for (let e = eds[i - 1] + 1; e < eds[i]; e++) gaps.push(e);
  if (gaps.length) {
    warnings.push(`Edition numbers skip ${gaps.length} value(s): ${gaps.slice(0, 10).join(", ")}${gaps.length > 10 ? "..." : ""}`);
  }
  if (typeof source.list === "function") {
    const listed = new Set(records.map((r) => r.file));
    const extra = source.list().filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f) && !listed.has(f));
    if (extra.length) {
      warnings.push(`${extra.length} image file(s) in the folder are not in the record: ${extra.slice(0, 5).join(", ")}${extra.length > 5 ? "..." : ""}`);
    }
  }

  return { valid: errors.length === 0, errors, warnings, recomputed };
}

/** Duplicate images among hashed records: [[editionA, editionB, ...], ...]. */
export function duplicateImages(records) {
  const byHash = new Map();
  for (const r of records) {
    const list = byHash.get(r.sha256) || [];
    list.push(Number(r.edition));
    byHash.set(r.sha256, list);
  }
  return [...byHash.values()].filter((l) => l.length > 1);
}

/** Read images from a folder. Only plain file names are served. */
export function folderSource(dir) {
  return {
    read(file) {
      if (/[\\/]/.test(file)) return null;
      const p = join(dir, file);
      return existsSync(p) && statSync(p).isFile() ? readFileSync(p) : null;
    },
    list: () => readdirSync(dir),
  };
}

function main(argv) {
  const args = argv.slice(2);
  const provPath = resolve(args[1] || "provenance.json");
  const dir = resolve(args[0] || (existsSync("images") ? "images" : "."));
  if (!existsSync(provPath)) {
    console.error(`Provenance file not found: ${provPath}`);
    return 2;
  }
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(`Images folder not found: ${dir}`);
    return 2;
  }
  let prov;
  try {
    prov = JSON.parse(readFileSync(provPath, "utf8"));
  } catch (e) {
    console.error(`Cannot read ${provPath}: ${e.message}`);
    return 2;
  }
  const r = checkProvenance(prov, folderSource(dir));
  for (const w of r.warnings) console.warn(`warning: ${w}`);
  if (r.valid) {
    console.log(`OK  ${prov.records.length} files, provenance hash ${prov.provenanceHash}`);
    return 0;
  }
  console.error("FAILED");
  for (const e of r.errors) console.error(`  - ${e}`);
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv));
}
