/**
 * PNG layer compositor. Sits next to the prompt path: recipes still carry prompts
 * and DNA from `buildRecipes`. This stacks a base PNG and one PNG per trait value.
 *
 * Files: `<layers>/<trait key>/<value>.png`, or `option.layer` relative to that directory.
 * `None` paints nothing. `skipDna` still paints; it only stays out of the DNA string.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { decodePngRgba } from "./dupes.mjs";
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

/**
 * Stack base + trait PNGs for one recipe.
 * @returns {{ png: Buffer, dna: string, prompt: string, edition: number, sha256: string, layers: string[] }}
 */
export function composeEdition({ recipe, items, basePng, layerDir, readFile = readFileSync }) {
  if (!items?.length) throw new Error("compose: preset has no traits");
  const base = decodePngRgba(basePng);
  let canvas = Buffer.from(base.rgba);
  const used = ["base"];
  for (const trait of items) {
    const value = recipe?.traits?.[trait.key] ?? NONE;
    if (!value || value === NONE) continue;
    const opt = option(items, trait.key, value);
    const file = assertInside(layerDir, layerFileFor(layerDir, trait, value, opt));
    let buf;
    try {
      buf = readFile(file);
    } catch {
      throw new Error(`missing layer ${trait.key}=${value} (${file})`);
    }
    if (!buf) throw new Error(`missing layer ${trait.key}=${value} (${file})`);
    const rgba = decodeLayer(buf, base.width, base.height, `${trait.key}=${value}`);
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
  };
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
} = {}) {
  const recipes = archive?.recipes || [];
  if (!recipes.length) throw new Error("compose: archive has no recipes");
  const take = limit ? recipes.slice(0, Number(limit)) : recipes;
  mkdirSync(outDir, { recursive: true });
  const editions = [];
  for (const recipe of take) {
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
  }
  const report = {
    source: "layers",
    note: "PNG layers stacked on the base image. Prompt generation is unchanged; each row still carries its prompt.",
    count: editions.length,
    editions,
  };
  writeFile(join(outDir, "dna.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function readBasePng(file) {
  if (!file || !existsSync(file)) throw new Error(`base image not found: ${file || "(none)"}`);
  return readFileSync(file);
}
