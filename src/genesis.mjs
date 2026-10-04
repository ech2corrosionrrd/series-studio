/**
 * Genesis lot: the series' base image as a collection item, edition #0.
 *
 * Owner decision 2026-10-05: the base image is part of the collection as an extra 1-of-1
 * (supply N+1). It is NOT a recipe: it is never generated, has no DNA/trait roll and does not
 * enter rarity. It is injected only where the collection is assembled (Review, bundle, deploy
 * kit, release size). The stored archive.recipes stay exactly N entries, so recipes, DNA,
 * rarity and the LoRA dataset are unaffected.
 *
 * Numbering: edition 0 is the base, editions 1..N keep their own number. In 0-based exports
 * (Solana) file index == edition number (the base is 0.png). Without a genesis lot the
 * historical shift edition-1 stays as it was.
 */
import { copyFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

export const GENESIS_EDITION = 0;
export const GENESIS_TRAIT = { Edition: "Genesis" };

const BASE_RE = /^(primary|mother)\.(png|jpe?g|webp)$/i;

/** `preset.genesis` is true, or `{ enabled: true }`. Off unless the series asks for it. */
export function genesisEnabled(preset) {
  const g = preset?.genesis;
  return g === true || g?.enabled === true;
}

export function isGenesisRecipe(recipe) {
  return Number(recipe?.edition) === GENESIS_EDITION && recipe?.genesis === true;
}

export function genesisRecipe() {
  return { edition: GENESIS_EDITION, genesis: true, dna: "genesis", prompt: "", traits: { ...GENESIS_TRAIT } };
}

/** Recipes without the genesis lot (what rarity / DNA / dataset must see). */
export function withoutGenesis(recipes) {
  return (Array.isArray(recipes) ? recipes : []).filter((r) => !isGenesisRecipe(r));
}

/** True when this set of recipes/items contains the genesis lot (drives the numbering rule). */
export function hasGenesis(list) {
  return (Array.isArray(list) ? list : []).some((r) => Number(r?.edition) === GENESIS_EDITION && (r.genesis === true || r.recipe?.genesis === true));
}

/**
 * Archive copy with the genesis recipe first and size N+1, or the archive itself when the
 * series has no genesis lot (or it is already injected).
 */
export function withGenesis(archive, preset) {
  if (!archive || !genesisEnabled(preset)) return archive;
  const recipes = Array.isArray(archive.recipes) ? archive.recipes : [];
  if (recipes.some(isGenesisRecipe)) return archive;
  const n = Number(archive.size ?? recipes.length);
  return { ...archive, genesis: true, size: n + 1, recipes: [genesisRecipe(), ...recipes] };
}

/** Supply of the collection as released: recipes + the genesis lot when enabled. */
export function supplyOf(archive, preset) {
  const n = Number(archive?.size ?? archive?.recipes?.length ?? 0);
  const injected = Array.isArray(archive?.recipes) && archive.recipes.some(isGenesisRecipe);
  return injected ? n : n + (genesisEnabled(preset) ? 1 : 0);
}

/** Display number of an edition in an export. Genesis series keep edition numbers; legacy 0-based shifts by one. */
export function displayEdition(edition, { zeroIndexed = false, genesis = false } = {}) {
  const n = Number(edition);
  return zeroIndexed && !genesis ? Math.max(0, n - 1) : n;
}

/** The base image file in `inputDir` (primary.* / legacy mother.*), or null. */
export function findBaseFile(inputDir) {
  if (!inputDir || !existsSync(inputDir)) return null;
  const f = readdirSync(inputDir).filter((n) => BASE_RE.test(n)).sort((a, b) => Number(/^primary/i.test(b)) - Number(/^primary/i.test(a)))[0];
  return f ? join(inputDir, f) : null;
}

/**
 * Put the base image into the set folder as `0.<ext>` (copy, input/ stays untouched) so Review,
 * bundle and deploy kit find it like any edition. Idempotent. Returns the file name or null.
 */
export function syncGenesisImage({ inputDir, setDir }) {
  const src = findBaseFile(inputDir);
  if (!src || !setDir || !existsSync(setDir)) return null;
  const ext = src.slice(src.lastIndexOf(".") + 1).toLowerCase();
  for (const e of ["png", "jpg", "jpeg", "webp"]) {
    if (e !== ext) rmSync(join(setDir, `0.${e}`), { force: true });
  }
  copyFileSync(src, join(setDir, `0.${ext}`));
  return `0.${ext}`;
}
