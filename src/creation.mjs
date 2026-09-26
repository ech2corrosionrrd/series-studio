/**
 * Per-edition creation manifest. Sits beside the set, not inside chain metadata.
 */
import { createHash } from "node:crypto";
import { ENGINES, TXT2IMG } from "./engines.mjs";

export function modelTitle(engine, mode = "edit") {
  const id = String(engine || "");
  if (mode === "txt") return TXT2IMG[id]?.title || ENGINES[id]?.title || id;
  return ENGINES[id]?.title || TXT2IMG[id]?.title || id;
}

export function sha256Hex(input) {
  const hash = createHash("sha256");
  hash.update(typeof input === "string" ? input : Buffer.from(input || ""));
  return hash.digest("hex");
}

export function promptHash(prompt) {
  return sha256Hex(String(prompt ?? ""));
}

/** One version row for creation/<edition>.json. Omits absent triage fields. */
export function creationVersion(info = {}) {
  const row = {
    versionId: info.versionId ?? info.v ?? null,
    engine: info.engine ?? null,
    model: info.model ?? (info.engine ? modelTitle(info.engine, info.mode) : null),
    strength: info.strength ?? null,
    seed: info.seed ?? null,
    promptHash: info.promptHash ?? null,
    baseSha256: info.baseSha256 ?? null,
  };
  if (info.score != null) row.score = info.score;
  if (info.verdict) row.verdict = info.verdict;
  return row;
}
