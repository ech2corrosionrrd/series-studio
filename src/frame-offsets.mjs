/**
 * Per-frame offset of the hand layers, kept with the SET of frames, not with the preset.
 *
 * A trait's `layerOffset` moves its layer by the same amount on every frame. A model rarely moves every frame the same way, and two sets
 * (two runs) move them differently, so the correction for one frame lives next to the frames it was measured on:
 * `<set>/layer-offsets.json` = `{ "<edition>": { "x": 7, "y": -3 } }`. It is added to the trait offsets on top of the alignment, and the
 * hybrid preview and the hybrid compose both read it. Whole pixels of the frame, +x right, +y down.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeJsonAtomic } from "./fs-safe.mjs";

export const FRAME_OFFSETS_FILE = "layer-offsets.json";
/** Far beyond any real correction; a typo like 100000 must not push a layer out of the frame silently. */
export const MAX_FRAME_OFFSET = 2000;

function whole(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : 0;
}

/** `{ x, y }` as whole pixels inside the limit, or null when it moves nothing. Throws on a value past the limit. */
export function normalizeFrameOffset(o) {
  if (!o || typeof o !== "object") return null;
  const x = whole(o.x);
  const y = whole(o.y);
  if (Math.abs(x) > MAX_FRAME_OFFSET || Math.abs(y) > MAX_FRAME_OFFSET) {
    throw new Error(`frame offset must stay within ±${MAX_FRAME_OFFSET} px`);
  }
  return x === 0 && y === 0 ? null : { x, y };
}

/** All stored offsets of a set: `{ "<edition>": { x, y } }`. A broken or missing file is an empty map. */
export function readFrameOffsets(setDir) {
  const file = join(setDir || "", FRAME_OFFSETS_FILE);
  if (!setDir || !existsSync(file)) return {};
  try {
    const doc = JSON.parse(readFileSync(file, "utf8"));
    const out = {};
    for (const [edition, value] of Object.entries(doc && typeof doc === "object" ? doc : {})) {
      if (!/^[1-9]\d{0,8}$/.test(edition)) continue;
      let o = null;
      try {
        o = normalizeFrameOffset(value);
      } catch {
        o = null;
      }
      if (o) out[edition] = o;
    }
    return out;
  } catch {
    return {};
  }
}

/** The offset of one frame, or null. */
export function frameOffsetFor(offsets, edition) {
  return offsets?.[String(edition)] || null;
}

/**
 * Sets (or, with 0/0, clears) the offset of one frame and writes the file. Nothing is deleted: a cleared frame just leaves the map.
 * @returns {{ offset: {x:number,y:number}|null, offsets: Record<string,{x:number,y:number}> }}
 */
export function writeFrameOffset(setDir, edition, x, y) {
  const n = Number(edition);
  if (!Number.isInteger(n) || n < 1) throw new Error("edition must be a whole number from 1");
  const offset = normalizeFrameOffset({ x, y });
  const offsets = readFrameOffsets(setDir);
  if (offset) offsets[String(n)] = offset;
  else delete offsets[String(n)];
  writeJsonAtomic(join(setDir, FRAME_OFFSETS_FILE), offsets);
  return { offset, offsets };
}
