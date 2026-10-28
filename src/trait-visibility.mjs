/**
 * Are the traits in the metadata really on the pictures? Offline, no network, pure except the three small file helpers.
 *
 * Metadata attributes come from the recipes (what was asked for), while the image is what a model drew. The only check that looks
 * at the picture is the vision critic (`triage.json`, rows with `mode: "vision"`, paid). The offline heuristic only checks the file, so its rows
 * say nothing about traits and are not counted here. The author can also confirm, once per set, that the traits are not checked by image.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeJsonAtomic } from "./fs-safe.mjs";

const SAMPLE = 8;

function rowMissesTrait(row) {
  const missing = Array.isArray(row?.missingTraits) ? row.missingTraits : [];
  const issues = Array.isArray(row?.issues) ? row.issues : [];
  return missing.length > 0 || issues.includes("missing_trait");
}

/**
 * @param {{ triage?: any, editions: number[], ack?: { at?: string }|null }} input
 *   `triage`: parsed `triage.json` (or its rows); `editions`: the frames that go into the release; `ack`: the author's confirmation.
 * @returns {{ status: "none"|"verified"|"partial"|"unchecked"|"issues", total: number, checked: number, missingFrames: number,
 *   missingEditions: number[], acknowledged: boolean, ackAt: string|null }}
 *   `issues`: some checked frame lacks a listed trait. `partial`: some frames were checked by vision, not all. `unchecked`: none.
 *   `acknowledged` is true only when the status is `partial` or `unchecked` and the author confirmed it.
 */
export function traitVisibility({ triage, editions, ack = null }) {
  const wanted = new Set((Array.isArray(editions) ? editions : []).map(Number).filter((n) => Number.isFinite(n)));
  const rows = Array.isArray(triage) ? triage : Array.isArray(triage?.results) ? triage.results : [];
  const checked = new Map();
  for (const row of rows) {
    const ed = Number(row?.edition);
    if (!wanted.has(ed) || row?.mode !== "vision") continue;
    checked.set(ed, Boolean(checked.get(ed)) || rowMissesTrait(row));
  }
  const missingEditions = [...checked.entries()].filter(([, miss]) => miss).map(([ed]) => ed).sort((a, b) => a - b);
  const total = wanted.size;
  let status = "unchecked";
  if (total === 0) status = "none";
  else if (missingEditions.length) status = "issues";
  else if (checked.size === total) status = "verified";
  else if (checked.size > 0) status = "partial";
  const confirmed = Boolean(ack) && (ack.ack === true || ack.ack === undefined);
  return {
    status,
    total,
    checked: checked.size,
    missingFrames: missingEditions.length,
    missingEditions: missingEditions.slice(0, SAMPLE),
    acknowledged: confirmed && (status === "partial" || status === "unchecked"),
    ackAt: confirmed && typeof ack.at === "string" ? ack.at : null,
  };
}

/** One line for the checklist and the ZIP. */
export function describeVisibility(v) {
  if (v.status === "verified") return `all ${v.total} frames checked by vision, every listed trait is visible`;
  if (v.status === "issues") return `${v.missingFrames} of ${v.checked} checked frames lack a listed trait (editions ${v.missingEditions.join(", ")}${v.missingFrames > v.missingEditions.length ? ", …" : ""})`;
  if (v.acknowledged) return `traits are not checked by image (${v.checked} of ${v.total} frames); the author confirmed this${v.ackAt ? ` on ${v.ackAt.slice(0, 10)}` : ""}. The metadata lists the traits from the recipes`;
  if (v.status === "partial") return `only ${v.checked} of ${v.total} frames checked by vision; the rest are not. The metadata lists the traits from the recipes`;
  return `no frame checked by vision (0 of ${v.total}). The metadata lists the traits from the recipes, not from the pictures. Run the AI check on the Review tab or confirm this`;
}

export function readTriageDoc(setDir) {
  const file = join(setDir, "triage.json");
  if (!setDir || !existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

const ACK_FILE = "visibility-ack.json";

export function readVisibilityAck(setDir) {
  const file = join(setDir, ACK_FILE);
  if (!setDir || !existsSync(file)) return null;
  try {
    const doc = JSON.parse(readFileSync(file, "utf8"));
    return doc && typeof doc === "object" ? doc : null;
  } catch {
    return null;
  }
}

/** Records (or withdraws) the author's confirmation. The file stays, with `ack: false`, so nothing is deleted. */
export function writeVisibilityAck(setDir, ack, now = new Date()) {
  const doc = { ack: Boolean(ack), at: now.toISOString() };
  writeJsonAtomic(join(setDir, ACK_FILE), doc);
  return doc;
}
