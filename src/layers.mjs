/**
 * PNG layer compositor. Sits next to the prompt path: recipes still carry prompts
 * and DNA from `buildRecipes`. This stacks a base PNG and one PNG per trait value.
 *
 * Files: `<layers>/<trait key>/<value>.png`, or `option.layer` relative to that directory.
 * `None` paints nothing. `skipDna` still paints; it only stays out of the DNA string.
 * Paint order: by the optional trait field `z` (low = bottom), else by position in the preset.
 *
 * Optional trait field `layerAlign: true` (hybrid with the base given): the layer was drawn on the base image, so it is
 * moved and zoomed by the global shift found between the base and the model's frame (`layer-align.mjs`) before it is painted.
 *
 * Two modes: `composeArchive` stacks every trait from layers on the base image (all layers must
 * exist); `overlaySet` is the hybrid: frames the model already drew are the bottom, and only the
 * traits that have a layer file are painted over them (the rest stay as the model drew them).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve, relative } from "node:path";
import { parseBackdropColor, tintBackdrop } from "./backdrop-tint.mjs";
import { decodePngRgba } from "./dupes.mjs";
import { frameOffsetFor, readFrameOffsets } from "./frame-offsets.mjs";
import { estimateAlignment, warpRgba } from "./layer-align.mjs";
import { encodeRgbaPng, resizePng } from "./png-fit.mjs";
import { dna, dnaKeysFromItems } from "./recipes.mjs";
import { NONE, option } from "./traits.mjs";

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/** Straight-alpha src-over, integer arithmetic so the PNG bytes stay stable. */
export function compositeOver(bottom, top) {
  if (bottom.length !== top.length || bottom.length % 4 !== 0) throw new Error("layer size mismatch");
  const out = Buffer.alloc(bottom.length);
  for (let i = 0; i < bottom.length; i += 4) {
    const sr = top[i];
    const sg = top[i + 1];
    const sb = top[i + 2];
    const sa = top[i + 3];
    const dr = bottom[i];
    const dg = bottom[i + 1];
    const db = bottom[i + 2];
    const da = bottom[i + 3];
    const inv = 255 - sa;
    const outA = sa + Math.floor((da * inv + 127) / 255);
    if (outA === 0) continue;
    const den = outA * 255;
    const half = Math.floor(den / 2);
    const ch = (s, d) => Math.floor((s * sa * 255 + d * da * inv + half) / den);
    out[i] = ch(sr, dr);
    out[i + 1] = ch(sg, dg);
    out[i + 2] = ch(sb, db);
    out[i + 3] = outA;
  }
  return out;
}

function decodeLayer(buf, width, height, label) {
  let png = buf;
  const decoded = (() => {
    try {
      return decodePngRgba(png);
    } catch (e) {
      throw new Error(`${label}: ${e.message}`);
    }
  })();
  if (decoded.width === width && decoded.height === height) return decoded.rgba;
  const resized = resizePng(png, width, height);
  if (!resized.ok) throw new Error(`${label}: ${resized.reason}`);
  return decodePngRgba(resized.buffer).rgba;
}

/**
 * Optional `layerOffset: { x, y }` of a trait: whole pixels of the frame, +x right, +y down. A model that redraws
 * the face (Kontext at 0.45) can shift it against the base the layer was drawn on; the offset moves the layer back.
 * Returns null when there is nothing to move (unset, zero or not numbers).
 */
export function traitLayerOffset(trait) {
  const o = trait?.layerOffset;
  if (!o || typeof o !== "object") return null;
  const x = Math.round(Number(o.x));
  const y = Math.round(Number(o.y));
  const fx = Number.isFinite(x) ? x : 0;
  const fy = Number.isFinite(y) ? y : 0;
  return fx === 0 && fy === 0 ? null : { x: fx, y: fy };
}

/** Moves an RGBA buffer by (dx, dy); what leaves the frame is dropped, what enters is transparent. */
export function shiftRgba(rgba, width, height, dx, dy) {
  if (!dx && !dy) return rgba;
  const out = Buffer.alloc(rgba.length);
  for (let y = 0; y < height; y += 1) {
    const sy = y - dy;
    if (sy < 0 || sy >= height) continue;
    const x0 = Math.max(0, dx);
    const x1 = Math.min(width, width + dx);
    if (x1 <= x0) continue;
    rgba.copy(out, (y * width + x0) * 4, (sy * width + (x0 - dx)) * 4, (sy * width + (x1 - dx)) * 4);
  }
  return out;
}

/**
 * Path of a trait PNG inside the layers directory.
 * `option.layer` is a relative path. Otherwise `<key>/<value>.png`.
 */
export function layerFileFor(layerDir, trait, value, opt) {
  if (opt?.layer) {
    const rel = String(opt.layer).replaceAll("\\", "/");
    if (rel.startsWith("/") || rel.split("/").includes("..")) {
      throw new Error(`bad layer path for ${trait.key}: "${opt.layer}"`);
    }
    return join(layerDir, rel);
  }
  const name = String(value);
  if (!name || name.includes("..") || /[\\/]/.test(name)) throw new Error(`bad trait value for a layer file: "${value}"`);
  return join(layerDir, trait.key, `${name}.png`);
}

function assertInside(root, file) {
  const base = resolve(root);
  const target = resolve(file);
  const rel = relative(base, target);
  if (rel.startsWith("..") || rel.split(/[/\\]/).includes("..")) {
    throw new Error(`layer file escapes the layers directory: ${file}`);
  }
  return target;
}

/** Numeric `z` of a trait, or null when it is not set / not a finite number. */
export function traitZ(trait) {
  const raw = trait?.z;
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Paint order of the traits: ascending `z`, bottom first. A trait without `z` takes its position in
 * the preset, so a preset with no `z` anywhere paints in the old order. Ties keep the preset order.
 * Only the painting order changes: DNA keys and trait order in the preset are untouched.
 */
export function paintOrder(items) {
  return (items || [])
    .map((trait, index) => ({ trait, index, z: traitZ(trait) ?? index }))
    .sort((a, b) => a.z - b.z || a.index - b.index)
    .map((x) => x.trait);
}

/**
 * Stack base + trait PNGs for one recipe.
 * @returns {{ png: Buffer, dna: string, prompt: string, edition: number, sha256: string, layers: string[] }}
 */
export function composeEdition({ recipe, items, basePng, layerDir, readFile = readFileSync, only = null, skipMissing = false, alignRef = null, frameOffset = null }) {
  if (!items?.length) throw new Error("compose: preset has no traits");
  const base = decodePngRgba(basePng);
  let canvas = Buffer.from(base.rgba);
  const used = ["base"];
  const skipped = [];
  let align = null;
  let alignFailed = null;
  const onlySet = Array.isArray(only) && only.length ? new Set(only.map(String)) : null;
  // An option with `backdrop: "#rrggbb"` re-colours the frame's own backdrop first (a layer cannot: it would cover the subject).
  // Where no smooth backdrop is found the frame is left alone and the skip is listed.
  for (const trait of paintOrder(items)) {
    if (onlySet && !onlySet.has(trait.key)) continue;
    const value = recipe?.traits?.[trait.key] ?? NONE;
    if (!value || value === NONE) continue;
    const color = option(items, trait.key, value).backdrop;
    if (!parseBackdropColor(color)) continue;
    const tinted = tintBackdrop(canvas, base.width, base.height, color);
    if (tinted.applied) {
      canvas = tinted.rgba;
      used.push(`tint:${trait.key}/${value}`);
    } else {
      skipped.push(`tint:${trait.key}/${value} (${tinted.reason})`);
    }
  }
  for (const trait of paintOrder(items)) {
    if (onlySet && !onlySet.has(trait.key)) continue;
    const value = recipe?.traits?.[trait.key] ?? NONE;
    if (!value || value === NONE) continue;
    const opt = option(items, trait.key, value);
    const file = assertInside(layerDir, layerFileFor(layerDir, trait, value, opt));
    let buf = null;
    try {
      buf = readFile(file);
    } catch {
      buf = null;
    }
    if (!buf) {
      if (skipMissing) {
        skipped.push(`${trait.key}/${value}`);
        continue;
      }
      throw new Error(`missing layer ${trait.key}=${value}: the layers folder has no ${relative(layerDir, file).replaceAll("\\", "/")}. A trait with no layers cannot be composed: remove it, or upload its layers`);
    }
    let rgba = decodeLayer(buf, base.width, base.height, `${trait.key}=${value}`);
    if (trait.layerAlign === true) {
      // The move is found once per frame and shared by every aligned trait; a weak match leaves the layer where it was drawn.
      if (alignRef && !align) align = estimateAlignment(alignRef, basePng);
      if (align?.ok) {
        const flat = align.scale === 1;
        if (flat) rgba = shiftRgba(rgba, base.width, base.height, align.dx, align.dy);
        else rgba = warpRgba(rgba, base.width, base.height, align);
      } else if (!alignFailed) {
        alignFailed = alignRef ? align.reason : "no_base";
      }
    }
    // The trait's own offset and this frame's offset (from the set) add up; both come after the alignment.
    const move = traitLayerOffset(trait);
    const dx = (move?.x || 0) + (frameOffset?.x || 0);
    const dy = (move?.y || 0) + (frameOffset?.y || 0);
    if (dx || dy) rgba = shiftRgba(rgba, base.width, base.height, dx, dy);
    canvas = compositeOver(canvas, rgba);
    used.push(`${trait.key}/${value}`);
  }
  const keys = dnaKeysFromItems(items);
  const fingerprint = dna(recipe?.line || "", recipe?.traits || {}, keys);
  if (recipe?.dna && recipe.dna !== fingerprint) {
    throw new Error(`edition ${recipe.edition}: dna does not match traits (${recipe.dna} vs ${fingerprint})`);
  }
  const png = encodeRgbaPng(base.width, base.height, canvas);
  return {
    edition: recipe?.edition,
    png,
    dna: fingerprint,
    prompt: recipe?.prompt || "",
    sha256: sha256(png),
    layers: used,
    skipped,
    // null: no trait asked for alignment; { skipped }: it asked and the match was missing or weak, the layer stayed where drawn.
    align: align?.ok ? { dx: align.dx, dy: align.dy, scale: align.scale, score: align.score } : alignFailed ? { skipped: alignFailed } : null,
  };
}

/**
 * Compose ONE edition in memory (nothing is written) to look at it before running the whole series.
 * Same code path as `composeArchive` / `overlaySet`, so the preview is byte-identical to the real frame.
 * `basePng` is either the base image (full stack) or the model-drawn frame (hybrid, pass `skipMissing`).
 * Throws an error with `status` 404 when the edition is not in the archive.
 */
export function previewEdition({ archive, items, edition, basePng, layerDir, readFile = readFileSync, only = null, skipMissing = false, alignRef = null, frameOffset = null }) {
  const n = Number(edition);
  const recipe = Number.isInteger(n) ? (archive?.recipes || []).find((r) => Number(r.edition) === n) : null;
  if (!recipe) throw Object.assign(new Error(`preview: edition ${edition} is not in the archive`), { status: 404 });
  return composeEdition({ recipe, items, basePng, layerDir, readFile, only, skipMissing, alignRef, frameOffset });
}

/**
 * Write `<edition>.png` plus `dna.json`. Prompts from the archive are copied, not regenerated.
 */
export function composeArchive({
  archive,
  items,
  basePng,
  layerDir,
  outDir,
  limit,
  readFile,
  writeFile = writeFileSync,
  onFrame = null,
  shouldStop = null,
} = {}) {
  const recipes = archive?.recipes || [];
  if (!recipes.length) throw new Error("compose: archive has no recipes");
  const take = limit ? recipes.slice(0, Number(limit)) : recipes;
  mkdirSync(outDir, { recursive: true });
  const editions = [];
  let stopped = false;
  for (const recipe of take) {
    // `shouldStop` / `onFrame` let a worker report progress and be stopped between frames; without them this is the plain loop.
    if (shouldStop?.()) {
      stopped = true;
      break;
    }
    const frame = composeEdition({ recipe, items, basePng, layerDir, readFile });
    const file = join(outDir, `${recipe.edition}.png`);
    writeFile(file, frame.png);
    editions.push({
      edition: recipe.edition,
      line: recipe.line || "",
      dna: frame.dna,
      prompt: frame.prompt,
      sha256: frame.sha256,
      layers: frame.layers,
      file: `${recipe.edition}.png`,
    });
    onFrame?.({ done: editions.length, total: take.length });
  }
  const report = {
    source: "layers",
    note: "PNG layers stacked on the base image. Prompt generation is unchanged; each row still carries its prompt.",
    count: editions.length,
    ...(stopped ? { stopped: true, total: take.length } : {}),
    editions,
  };
  writeFile(join(outDir, "dna.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

/**
 * Hybrid mode: paint hand layers over frames the model already drew (`<setDir>/<edition>.png`).
 * Only traits that have a layer file are painted (or only the keys in `only`); a trait without a file
 * stays as the model drew it. Writes `<outDir>/<edition>.png` and `dna.json`; never touches `setDir`.
 */
export function overlaySet({
  archive,
  items,
  setDir,
  layerDir,
  outDir,
  only = null,
  limit,
  alignRef = null,
  readFile = readFileSync,
  writeFile = writeFileSync,
  onFrame = null,
  shouldStop = null,
} = {}) {
  const recipes = archive?.recipes || [];
  if (!recipes.length) throw new Error("overlay: archive has no recipes");
  if (resolve(setDir) === resolve(outDir)) throw new Error("overlay: the output folder must differ from the set folder");
  const take = limit ? recipes.slice(0, Number(limit)) : recipes;
  mkdirSync(outDir, { recursive: true });
  const editions = [];
  const missingFrames = [];
  let stopped = false;
  // `<set>/layer-offsets.json`: a correction measured on one frame of this set (see frame-offsets.mjs)
  const frameOffsets = readFrameOffsets(setDir);
  for (const recipe of take) {
    if (shouldStop?.()) {
      stopped = true;
      break;
    }
    const frameFile = join(setDir, `${recipe.edition}.png`);
    if (!existsSync(frameFile)) {
      missingFrames.push(recipe.edition);
      continue;
    }
    const frame = composeEdition({ recipe, items, basePng: readFile(frameFile), layerDir, readFile, only, skipMissing: true, alignRef, frameOffset: frameOffsetFor(frameOffsets, recipe.edition) });
    writeFile(join(outDir, `${recipe.edition}.png`), frame.png);
    editions.push({
      edition: recipe.edition,
      line: recipe.line || "",
      dna: frame.dna,
      prompt: frame.prompt,
      sha256: frame.sha256,
      layers: frame.layers.filter((l) => l !== "base"),
      skipped: frame.skipped,
      ...(frame.align ? { align: frame.align } : {}),
      ...(frameOffsetFor(frameOffsets, recipe.edition) ? { frameOffset: frameOffsetFor(frameOffsets, recipe.edition) } : {}),
      file: `${recipe.edition}.png`,
    });
    onFrame?.({ done: editions.length + missingFrames.length, total: take.length });
  }
  if (!editions.length && !stopped) throw new Error(`overlay: no frames ${basename(setDir)}/<edition>.png found for this archive`);
  const painted = editions.filter((e) => e.layers.length).length;
  const report = {
    source: "layers-over-set",
    over: basename(setDir),
    note: "Hand PNG layers painted over model-drawn frames. Traits without a layer file stay as the model drew them. The source set is untouched.",
    only: Array.isArray(only) && only.length ? only : null,
    count: editions.length,
    ...(stopped ? { stopped: true, total: take.length } : {}),
    painted,
    unpainted: editions.length - painted,
    frameOffsetFrames: editions.filter((e) => e.frameOffset).length,
    aligned: editions.filter((e) => e.align && !e.align.skipped).length,
    alignSkipped: editions.filter((e) => e.align?.skipped).length,
    missingFrames,
    editions,
  };
  writeFile(join(outDir, "dna.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function readBasePng(file) {
  if (!file || !existsSync(file)) throw new Error(`base image not found: ${file || "(none)"}`);
  return readFileSync(file);
}
