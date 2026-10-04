/**
 * Solana Core Candy Machine hidden settings and the later reveal step.
 *
 * The hash is SHA-256 of `JSON.stringify([{ name, uri }, ...])` — the array the
 * Core hidden-settings guide commits on the machine. There is no reveal password
 * on Solana; EVM delayed reveal stays a Thirdweb dashboard step and is not stored here.
 *
 * `series hidden` fills the hash from uploaded metadata URIs.
 * `series reveal` writes the index-ordered update list and checks that hash.
 * Lab does not sign the Core asset updates.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { encodeRgbaPng } from "./png-fit.mjs";

export const REVEAL_ALGORITHM = "sha256(JSON.stringify([{name,uri}]))";

export function canonicalRevealJson(items) {
  const list = (items || []).map((it, i) => {
    const name = String(it?.name ?? "").trim();
    const uri = String(it?.uri ?? "").trim();
    if (!name) throw new Error(`reveal item ${i}: name is required`);
    if (!uri) throw new Error(`reveal item ${i}: uri is required`);
    return { name, uri };
  });
  if (!list.length) throw new Error("reveal data is empty");
  return JSON.stringify(list);
}

/** 64-char hex SHA-256 of the canonical reveal JSON. */
export function revealDataHash(items) {
  const json = typeof items === "string" ? items : canonicalRevealJson(items);
  return createHash("sha256").update(json).digest("hex");
}

/**
 * Hidden settings object for the Core Candy Machine (`name`, `uri`, `hash` only).
 * Extra keys would not match the MPLX field set, so the algorithm name stays outside.
 */
export function hiddenSettings({ name, uri, revealData }) {
  const hiddenName = String(name || "").trim();
  const hiddenUri = String(uri || "").trim();
  if (!hiddenName) throw new Error("hidden settings: name is required");
  if (hiddenName.length > 32) throw new Error("hidden settings: name is longer than 32 characters");
  if (!hiddenUri) throw new Error("hidden settings: uri is required (the uploaded hidden.json link)");
  if (hiddenUri.length > 200) throw new Error("hidden settings: uri is longer than 200 characters");
  return { name: hiddenName, uri: hiddenUri, hash: revealDataHash(revealData) };
}

/** Placeholder metadata every mint shows until `series reveal`. */
export function placeholderMetadata({ name, image = "hidden.png", description, symbol = "" } = {}) {
  const title = String(name || "Hidden").trim() || "Hidden";
  const desc = String(description || "Hidden until reveal.").trim();
  return {
    name: title,
    symbol: String(symbol || ""),
    description: desc,
    image,
    attributes: [],
    properties: {
      files: [{ uri: image, type: "image/png" }],
      category: "image",
    },
  };
}

/** Solid PNG so the kit contains a real placeholder image, not a note. */
export function placeholderPng(width = 32, height = 32) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 28;
    rgba[i + 1] = 28;
    rgba[i + 2] = 36;
    rgba[i + 3] = 255;
  }
  return encodeRgbaPng(width, height, rgba);
}

/**
 * Reveal rows from a Sugar-style `cache.json` written by `series upload`.
 * Item `-1` is the collection and is not part of the hash. Indexes must be 0..n-1.
 */
export function revealItemsFromCache(cache) {
  const items = cache?.items || {};
  const nums = Object.keys(items)
    .filter((k) => k !== "-1")
    .map((k) => Number(k));
  if (!nums.length) throw new Error("cache.json has no uploaded items");
  if (nums.some((n) => !Number.isInteger(n) || n < 0)) throw new Error("cache.json item keys must be indexes");
  nums.sort((a, b) => a - b);
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] !== i) throw new Error(`cache.json is missing item ${i}`);
  }
  return nums.map((n) => {
    const row = items[String(n)] || {};
    const name = String(row.name || "").trim();
    const uri = String(row.metadata_link || "").trim();
    if (!name) throw new Error(`cache item ${n} has no name`);
    if (!uri) throw new Error(`cache item ${n} has no metadata_link — run series upload first`);
    return { name, uri };
  });
}

/** Names from local `assets/N.json`, URIs from a prefix the creator already controls. */
export function revealItemsFromAssets(dir, uriPrefix) {
  const prefix = String(uriPrefix || "");
  if (!prefix) throw new Error("uri prefix is required when cache.json is not used");
  const assets = join(dir, "assets");
  const items = [];
  for (let i = 0; ; i++) {
    const file = join(assets, `${i}.json`);
    if (!existsSync(file)) break;
    const meta = JSON.parse(readFileSync(file, "utf8"));
    const name = String(meta.name || "").trim();
    if (!name) throw new Error(`assets/${i}.json has no name`);
    items.push({ name, uri: `${prefix}${i}.json` });
  }
  if (!items.length) throw new Error(`no assets/0.json in ${dir}`);
  return items;
}

export function loadRevealItems(dir, { uriPrefix } = {}) {
  const cacheFile = join(dir, "cache.json");
  if (!uriPrefix && existsSync(cacheFile)) {
    return revealItemsFromCache(JSON.parse(readFileSync(cacheFile, "utf8")));
  }
  if (uriPrefix) return revealItemsFromAssets(dir, uriPrefix);
  throw new Error("cache.json not found. Run series upload first, or pass --uri-prefix.");
}

/**
 * Compare a revealed name/uri list with the committed reveal data.
 * @returns {{ ok: boolean, hash: string, problems: string[] }}
 */
export function checkReveal(expected, actual) {
  const problems = [];
  let expectedJson;
  let actualJson;
  try {
    expectedJson = canonicalRevealJson(expected);
  } catch (e) {
    return { ok: false, hash: "", problems: [e.message] };
  }
  try {
    actualJson = canonicalRevealJson(actual);
  } catch (e) {
    return { ok: false, hash: revealDataHash(expectedJson), problems: [e.message] };
  }
  const hash = revealDataHash(expectedJson);
  if (expectedJson !== actualJson) {
    const exp = JSON.parse(expectedJson);
    const got = JSON.parse(actualJson);
    const n = Math.max(exp.length, got.length);
    if (exp.length !== got.length) problems.push(`reveal length ${got.length}, committed ${exp.length}`);
    for (let i = 0; i < n && problems.length < 8; i++) {
      if (!got[i] || !exp[i] || got[i].name !== exp[i].name || got[i].uri !== exp[i].uri) {
        problems.push(`index ${i} differs`);
      }
    }
  }
  return { ok: problems.length === 0, hash, problems };
}

/** Index-ordered Core update list. Mint order under hidden settings is 0, 1, 2, … */
export function revealUpdates(items, hidden) {
  const json = canonicalRevealJson(items);
  const hash = revealDataHash(json);
  if (hidden?.hash && String(hidden.hash).toLowerCase() !== hash) {
    throw new Error("hidden-settings.json hash does not match this reveal data");
  }
  return {
    standard: "core",
    algorithm: REVEAL_ALGORITHM,
    hash,
    hidden: hidden ? { name: hidden.name, uri: hidden.uri } : null,
    items: JSON.parse(json).map((row, index) => ({ index, name: row.name, uri: row.uri })),
  };
}
