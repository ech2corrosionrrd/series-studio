import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { NONE } from "./traits.mjs";
import { traitsToAttributes } from "./checklist.mjs";
import { upscale2x } from "./upscale.mjs";
import { buildImageUri } from "./storage.mjs";
import { extname } from "node:path";
import {
  LAUNCHPAD_PROFILES,
  formatForLaunchpad,
  exportManifestCsv,
  getMimeType,
  getMediaCategory,
} from "./launchpads.mjs";
import {
  buildSugarConfig,
  buildCoreCandyConfig,
  buildThirdwebConfig,
  buildReleaseGuide,
} from "./deploy.mjs";
import { calculateCollectionProvenance } from "./provenance.mjs";
import { readMeta } from "./versions.mjs";
import { creationVersion, promptHash } from "./creation.mjs";
import { runPreflight, formatPreflightReport } from "./preflight.mjs";
import { countMissingTraitFrames } from "./critic.mjs";
import {
  buildRoyalties,
  buildRarityReport,
  formatRarityText,
  buildChainReadme,
} from "./archive-package.mjs";
import { chainForProfile } from "./deploy-kit.mjs";

export {
  calculateCollectionProvenance,
  traitsToAttributes,
  buildImageUri,
  LAUNCHPAD_PROFILES,
  formatForLaunchpad,
  exportManifestCsv,
  buildSugarConfig,
  buildCoreCandyConfig,
  buildThirdwebConfig,
  buildReleaseGuide,
  getMimeType,
  getMediaCategory,
};

function readTriageCount(setDir) {
  const file = join(setDir, "triage.json");
  if (!setDir || !existsSync(file)) return { frames: 0, editions: [] };
  try {
    const doc = JSON.parse(readFileSync(file, "utf8"));
    return countMissingTraitFrames(doc?.results || doc);
  } catch {
    return { frames: 0, editions: [] };
  }
}

/** OpenSea / ERC-721 metadata. */
export function buildErc721Meta(recipe, opts = {}, traitItems = []) {
  return formatForLaunchpad(recipe, "opensea", opts, traitItems);
}

/** Metaplex metadata. */
export function buildMetaplexMeta(recipe, opts = {}, traitItems = []) {
  return formatForLaunchpad(recipe, "magiceden", opts, traitItems);
}

/** Bitcoin Ordinals / Inscription metadata manifest. */
export function buildOrdinalsMeta(recipe, opts = {}, traitItems = []) {
  return formatForLaunchpad(recipe, "ordinalsbot", opts, traitItems);
}

/** Generate formatted metadata preview for a given recipe & settings. */
export function generateMetadataPreview(recipe, formatOrProfile = "erc721", opts = {}, traitItems = []) {
  const profileKey = opts.profile || formatOrProfile || "opensea";
  return formatForLaunchpad(recipe, profileKey, opts, traitItems);
}

export function buildCollectionJson({
  format,
  profile,
  archive,
  set,
  count,
  editions,
  opts = {},
  missing,
  upscaled,
}) {
  const isZeroIndex = Boolean(opts.zeroIndexed || opts.zeroIndex);
  return {
    schema: "series-lab-bundle/v0",
    format,
    profile: profile || null,
    presetId: archive?.presetId || null,
    set: set || null,
    count,
    editions,
    imageUriPrefix: opts.imageUriPrefix || opts.imagePrefix || null,
    animationUriPrefix: opts.animationUriPrefix || opts.animPrefix || null,
    namePrefix: opts.namePrefix || "Series #",
    symbol: opts.symbol || "LAB",
    sellerFeeBasisPoints: Number(opts.sellerFeeBasisPoints ?? 500),
    creatorAddress: opts.creatorAddress || null,
    zeroIndexed: isZeroIndex,
    description: opts.description || "",
    missing: missing || [],
    upscaled: Boolean(upscaled),
    imageNaming: isZeroIndex
      ? "edition.png (0-based edition number, no zero-padding)"
      : "edition.png (1-based edition number, no zero-padding)",
    createdAt: new Date().toISOString(),
  };
}

export function buildReadme(locale, collection) {
  const uk = String(locale || "").toLowerCase().startsWith("uk");
  const isZero = Boolean(collection.zeroIndexed);
  const nameGuide = isZero
    ? "0.png, 1.png, ... (0-based edition number, no zero-padding)"
    : "1.png, 2.png, ... (1-based edition number, no zero-padding)";

  if (uk) {
    return [
      "Series Lab — mint-ready ZIP",
      "============================",
      "",
      `Формат: ${collection.format}`,
      collection.profile ? `Профіль лаунчпаду: ${collection.profile}` : "",
      `Кількість: ${collection.count}`,
      `Набір зображень: ${collection.set || "—"}`,
      `Імена файлів: ${nameGuide}`,
      "",
      "Структура:",
      "  images/N.png     — картинки / обкладинки",
      "  images/N.mp4     — відео / анімації (якщо є)",
      "  metadata/N.json  — метадані",
      "  manifest.csv     — зведений CSV маніфест для гуртового імпорту",
      "  collection.json  — підсумок",
      "  README.txt       — цей файл",
      "",
      collection.upscaled
        ? "Upscale 2×: застосовано (sharp)."
        : "Upscale 2×: не застосовано (sharp відсутній або вимкнено).",
      "",
      "ERC-721 / OpenSea: завантажте images/ і metadata/ на IPFS або на свій https і вкажіть base URI, або імпортуйте manifest.csv у Studio.",
      "Magic Eden / LaunchMyNFT (Solana): метадані Metaplex лежать у metadata/. Рекомендоване сховище — Arweave (ar://). Чернетка Core — cm-config.json. Тека sugar/ — застарілий Candy Machine, не для нової колекції.",
      "LaunchMyNFT: імена з нуля (0.png, 0.json), коли цю опцію увімкнено.",
      "Bitcoin Ordinals / Inscriptions: metadata/ + images/ — маніфести для інскрипшенів.",
      "",
      "Мінт з Lab за замовчуванням не виконується — це бандл для Release.",
      "",
    ].filter(Boolean).join("\n");
  }
  return [
    "Series Lab — mint-ready ZIP",
    "============================",
    "",
    `Format: ${collection.format}`,
    collection.profile ? `Launchpad profile: ${collection.profile}` : "",
    `Count: ${collection.count}`,
    `Image set: ${collection.set || "—"}`,
    `Filenames: ${nameGuide}`,
    "",
    "Layout:",
    "  images/N.png     — artwork / posters",
    "  images/N.mp4     — animations / videos (if present)",
    "  metadata/N.json  — per-token metadata",
    "  manifest.csv     — bulk upload CSV manifest",
    "  collection.json  — summary",
    "  README.txt       — this file",
    "",
    collection.upscaled
      ? "Upscale 2×: applied (sharp)."
      : "Upscale 2×: skipped (sharp not installed or disabled).",
    "",
    "ERC-721 / OpenSea: host images/ and metadata/ on IPFS or your own https and set the base URI, or import manifest.csv into Studio.",
    "Magic Eden / LaunchMyNFT (Solana): Metaplex metadata is in metadata/. Recommended storage is Arweave (ar://). The Core draft is cm-config.json. sugar/ is the legacy Candy Machine, not for a new collection.",
    "LaunchMyNFT: 0-based names (0.png, 0.json) when that option is on.",
    "Bitcoin Ordinals / Inscriptions: metadata/ + images/ — manifests formatted for inscription batches.",
    "",
    "Lab does not mint by default — this ZIP is for the Release step.",
    "",
  ].filter(Boolean).join("\n");
}

/**
 * @returns {{ recipes: object[], fallback: string|null, error: string|null }}
 */
export function selectBundleRecipes(archiveRecipes, marks, onlyKeep, imageEditionSet) {
  const recipes = Array.isArray(archiveRecipes) ? archiveRecipes : [];
  const keepKeys = Object.entries(marks || {})
    .filter(([, v]) => v === "keep")
    .map(([k]) => Number(k))
    .filter((n) => Number.isInteger(n) && n > 0);
  const keepSet = new Set(keepKeys);

  if (onlyKeep) {
    if (keepSet.size > 0) {
      const selected = recipes.filter((r) => keepSet.has(r.edition));
      if (!selected.length) {
        return {
          recipes: [],
          fallback: null,
          error:
            "onlyKeep is set but no keep-marked editions match the archive — mark keep in Review",
        };
      }
      return { recipes: selected, fallback: null, error: null };
    }
    const withImg = recipes.filter((r) => imageEditionSet.has(r.edition));
    if (withImg.length) {
      return { recipes: withImg, fallback: "all_with_images", error: null };
    }
    return {
      recipes: [],
      fallback: null,
      error:
        "onlyKeep is set but marks have no keep entries and no images found — mark keep in Review or generate images",
    };
  }

  const withImg = recipes.filter((r) => imageEditionSet.has(r.edition));
  if (withImg.length) return { recipes: withImg, fallback: null, error: null };
  return { recipes, fallback: "all_recipes_no_images", error: null };
}

/**
 * Find image and animation/video/3D files for an edition.
 * @param {string} setDir
 * @param {number|string} edition
 * @returns {{ imagePath: string|null, animationPath: string|null }}
 */
export function findEditionMedia(setDir, edition) {
  const ed = String(edition);
  let imagePath = null;
  let animationPath = null;

  // Search static image (png, jpg, webp)
  for (const ext of [".png", ".jpg", ".jpeg", ".webp"]) {
    const p = join(setDir, ed + ext);
    if (existsSync(p)) { imagePath = p; break; }
  }
  if (!imagePath) {
    for (const width of [2, 3, 4]) {
      const padded = ed.padStart(width, "0");
      for (const ext of [".png", ".jpg", ".jpeg", ".webp"]) {
        const p = join(setDir, padded + ext);
        if (existsSync(p)) { imagePath = p; break; }
      }
      if (imagePath) break;
    }
  }

  // Search animation/video/3D (mp4, webm, mov, gif, glb, gltf, html)
  for (const ext of [".mp4", ".webm", ".mov", ".gif", ".glb", ".gltf", ".html"]) {
    const p = join(setDir, ed + ext);
    if (existsSync(p)) { animationPath = p; break; }
  }
  if (!animationPath) {
    for (const width of [2, 3, 4]) {
      const padded = ed.padStart(width, "0");
      for (const ext of [".mp4", ".webm", ".mov", ".gif", ".glb", ".gltf", ".html"]) {
        const p = join(setDir, padded + ext);
        if (existsSync(p)) { animationPath = p; break; }
      }
      if (animationPath) break;
    }
  }

  return { imagePath, animationPath };
}

export function findEditionImage(setDir, edition) {
  const media = findEditionMedia(setDir, edition);
  return media.imagePath || media.animationPath || null;
}

export function listImageEditions(setDir) {
  const set = new Set();
  if (!setDir || !existsSync(setDir)) return set;
  for (const f of readdirSync(setDir)) {
    const m = f.match(/^(\d+)\.(png|jpe?g|webp|mp4|webm|mov|gif|glb|gltf|html)$/i);
    if (m) set.add(Number(m[1]));
  }
  return set;
}

/**
 * Editions that would go into a bundle, with image bytes. Shared by the deploy kit.
 * @returns {{ items: object[], error: string|null }}
 */
export function readBundleItems({ archive, setDir, marks = {}, onlyKeep = false } = {}) {
  const imageEditionSet = listImageEditions(setDir);
  const sel = selectBundleRecipes(archive?.recipes || [], marks, onlyKeep, imageEditionSet);
  if (sel.error) return { items: [], error: sel.error };
  const items = [];
  for (const recipe of sel.recipes) {
    const media = findEditionMedia(setDir, recipe.edition);
    if (!media.imagePath) continue;
    const buffer = readFileSync(media.imagePath);
    items.push({
      edition: recipe.edition,
      buffer,
      ext: extname(media.imagePath).slice(1) || "png",
      filename: media.imagePath,
      recipe,
    });
  }
  return { items, error: items.length ? null : "no images for the selected editions" };
}

/**
 * Build ZIP at out/bundles/<id>-<format>.zip
 * opts: format, profile, creatorAddress, zeroIndexed, onlyKeep, namePrefix, symbol, sellerFeeBasisPoints, description, locale, upscale, animationUriPrefix
 */
function creationDocForEdition(setDir, recipe, marks) {
  const edition = Number(recipe?.edition);
  let versions = [];
  try {
    const meta = readMeta(setDir, edition);
    versions = (meta.versions || [])
      .filter((row) => row && row.v != null)
      .map((row) => creationVersion(row));
  } catch {
    versions = [];
  }
  if (!versions.length) {
    versions = [creationVersion({
      versionId: null,
      engine: null,
      seed: recipe?.seed ?? null,
      promptHash: recipe?.prompt ? promptHash(recipe.prompt) : null,
    })];
  }
  const mark = marks?.[String(edition)] ?? marks?.[edition];
  if (mark && !versions[versions.length - 1].verdict) {
    versions[versions.length - 1] = { ...versions[versions.length - 1], verdict: mark };
  }
  return { edition, versions };
}

export async function buildBundleZip(params) {
  const {
    archive,
    preset,
    setDir,
    set,
    marks = {},
    opts = {},
    bundlesDir,
    bundleId,
  } = params;

  const profileKey = opts.profile || (opts.format === "metaplex" ? "magiceden" : opts.format === "ordinals" ? "ordinalsbot" : "opensea");
  const profile = LAUNCHPAD_PROFILES[profileKey] || LAUNCHPAD_PROFILES.opensea;
  const format = profile.format || "erc721";
  const isZeroIndex = Boolean(opts.zeroIndexed || opts.zeroIndex);

  const onlyKeep = Boolean(opts.onlyKeep);
  const doUpscale = Boolean(opts.upscale);
  const locale = opts.locale || "en";
  const traitItems = Array.isArray(preset?.traits?.items)
    ? preset.traits.items
    : Array.isArray(preset?.traits)
      ? preset.traits
      : [];

  const imageEditionSet = listImageEditions(setDir);
  const sel = selectBundleRecipes(
    archive?.recipes || [],
    marks,
    onlyKeep,
    imageEditionSet,
  );
  if (sel.error) {
    const err = new Error(sel.error);
    err.code = "bundle_select";
    err.status = 400;
    throw err;
  }

  const missing = [];
  const includedEditions = [];
  const includedRecipes = [];
  let anyUpscaled = false;
  let upscaleSkippedReason = null;

  const zip = new JSZip();
  const imagesFolder = zip.folder("images");
  const metaFolder = zip.folder("metadata");

  const imageRecords = [];
  const packed = [];

  for (const recipe of sel.recipes) {
    const ed = recipe.edition;
    const media = findEditionMedia(setDir, ed);
    if (!media.imagePath && !media.animationPath) {
      missing.push(ed);
      continue;
    }

    const displayEd = isZeroIndex ? Math.max(0, ed - 1) : ed;

    // Handle primary image
    if (media.imagePath) {
      let buf = readFileSync(media.imagePath);
      if (doUpscale) {
        const up = await upscale2x(buf);
        if (up.ok) {
          buf = up.buffer;
          anyUpscaled = true;
        } else if (!upscaleSkippedReason) {
          upscaleSkippedReason = up.reason;
        }
      }
      const imgExt = extname(media.imagePath).slice(1) || "png";
      const imgFileName = `${displayEd}.${imgExt}`;
      imagesFolder.file(imgFileName, buf);
      imageRecords.push({ edition: ed, file: imgFileName, buffer: buf });
    }

    // Handle dynamic animation / video / 3D file
    let tokenOpts = { ...opts };
    if (media.animationPath) {
      const animBuf = readFileSync(media.animationPath);
      const animExt = extname(media.animationPath).slice(1) || "mp4";
      const animFileName = `${displayEd}.${animExt}`;
      imagesFolder.file(animFileName, animBuf);
      tokenOpts.animationExtension = animExt;

      if (!tokenOpts.animationUriPrefix && !tokenOpts.animationUrl && !recipe.animation_url) {
        tokenOpts.animationUrl = animFileName;
      }
      if (!media.imagePath) {
        imageRecords.push({ edition: ed, file: animFileName, buffer: animBuf });
      }
    }

    const meta = formatForLaunchpad(recipe, profileKey, tokenOpts, traitItems);
    metaFolder.file(`${displayEd}.json`, JSON.stringify(meta, null, 2) + "\n");
    includedEditions.push(ed);
    includedRecipes.push(recipe);
    const primary = media.imagePath ? imageRecords[imageRecords.length - 1] : null;
    if (primary?.buffer) {
      packed.push({
        edition: ed,
        filename: primary.file,
        buffer: primary.buffer,
        meta,
      });
    }
  }

  if (!includedEditions.length) {
    const err = new Error(
      missing.length
        ? `No images or media found for selected editions (missing: ${missing.slice(0, 20).join(", ")})`
        : "Nothing to export",
    );
    err.code = "bundle_empty";
    err.status = 400;
    throw err;
  }

  // Calculate Collection Provenance Hash
  let provenance = null;
  if (imageRecords.length > 0) {
    const presetSeed = preset?.seed || archive?.seed || null;
    provenance = calculateCollectionProvenance(imageRecords, { presetSeed });
    zip.file("provenance.json", JSON.stringify(provenance, null, 2) + "\n");
    opts.provenanceHash = provenance.provenanceHash;
  }

  // Generate CSV Manifest in ZIP root
  const manifestCsv = exportManifestCsv(includedRecipes, traitItems, opts);
  zip.file("manifest.csv", manifestCsv);

  // Generate Launchpad deployment configuration files
  if (profileKey === "magiceden" || profileKey === "launchmynft" || format === "metaplex") {
    const coreConfig = buildCoreCandyConfig(archive, preset, opts);
    zip.file("cm-config.json", JSON.stringify(coreConfig, null, 2) + "\n");
    const sugarConfig = buildSugarConfig(archive, preset, opts);
    zip.file("sugar/config.json", JSON.stringify(sugarConfig, null, 2) + "\n");
    zip.file("sugar/LEGACY.txt", String(locale).toLowerCase().startsWith("uk")
      ? "ЗАСТАРІЛИЙ: legacy Candy Machine, не для нової колекції.\n"
      : "LEGACY: legacy Candy Machine, not for a new collection.\n");
  } else if (profileKey === "opensea" || format === "erc721") {
    const twConfig = buildThirdwebConfig(archive, preset, opts);
    zip.file("thirdweb.json", JSON.stringify(twConfig, null, 2) + "\n");
  }

  // Generate localized step-by-step Release Guide
  zip.file("release-guide.txt", buildReleaseGuide(locale, archive, opts));

  const chain = chainForProfile(profileKey, format);
  const royalties = buildRoyalties(opts);
  const cover = packed[0];
  if (cover?.buffer) {
    const coverExt = extname(cover.filename).replace(/^\./, "") || "png";
    zip.file(`cover.${coverExt}`, cover.buffer);
  }
  const rarity = buildRarityReport(preset, includedRecipes);
  zip.file("rarity.json", JSON.stringify(rarity, null, 2) + "\n");
  zip.file("rarity.txt", formatRarityText(rarity, locale));
  zip.file("royalties.json", JSON.stringify(royalties, null, 2) + "\n");

  const triageCount = readTriageCount(setDir);
  const preflight = runPreflight({
    locale,
    standard: format === "metaplex" ? "metaplex" : format === "ordinals" ? "ordinals" : "erc721",
    recipes: includedRecipes,
    images: packed.map((p) => ({ edition: p.edition, filename: p.filename, buffer: p.buffer })),
    metadata: packed.map((p) => ({ edition: p.edition, meta: p.meta })),
    royalties,
    description: opts.description || "",
    coverPresent: Boolean(cover?.buffer),
  }, opts.env || process.env);
  if (triageCount.frames > 0) {
    const uk = String(locale).toLowerCase().startsWith("uk");
    const message = uk
      ? `${triageCount.frames} кадрів мають missing_trait після triage (${triageCount.editions.slice(0, 12).join(", ")}). ZIP не блокується — вирішує людина.`
      : `${triageCount.frames} frames have missing_trait after triage (${triageCount.editions.slice(0, 12).join(", ")}). The ZIP is not blocked — a person decides.`;
    preflight.warnings.push(message);
    preflight.checks.push({ level: "warning", code: "missing_trait", message });
    preflight.report = formatPreflightReport(preflight, locale);
  }
  zip.file("preflight.json", JSON.stringify({
    ready: preflight.ready,
    status: preflight.status,
    errors: preflight.errors,
    warnings: preflight.warnings,
    checks: preflight.checks,
  }, null, 2) + "\n");
  zip.file("preflight.txt", `${preflight.report}\n`);

  if (opts.gate && !preflight.ready) {
    const err = new Error(preflight.report);
    err.code = "preflight_blocked";
    err.status = 422;
    err.preflight = preflight;
    err.report = preflight.report;
    throw err;
  }

  const collection = buildCollectionJson({
    format,
    profile: profileKey,
    archive,
    set,
    count: includedEditions.length,
    editions: includedEditions,
    opts,
    missing,
    upscaled: anyUpscaled,
  });
  if (provenance) collection.provenanceHash = provenance.provenanceHash;
  if (sel.fallback) collection.selectionFallback = sel.fallback;
  if (upscaleSkippedReason) collection.upscaleSkipped = upscaleSkippedReason;
  collection.chain = chain;
  collection.description = opts.description || "";
  collection.sellerFeeBasisPoints = royalties.sellerFeeBasisPoints;
  collection.ready = preflight.ready;
  collection.missingTraitFrames = triageCount.frames;
  collection.preflight = {
    ready: preflight.ready,
    errors: preflight.errors.length,
    warnings: preflight.warnings.length,
  };

  zip.file("collection.json", JSON.stringify(collection, null, 2) + "\n");
  for (const recipe of includedRecipes) {
    const doc = creationDocForEdition(setDir, recipe, marks);
    zip.file(`creation/${recipe.edition}.json`, JSON.stringify(doc, null, 2) + "\n");
  }
  zip.file("README.txt", buildChainReadme(locale, collection));

  if (opts.dryRun) {
    return {
      ok: preflight.ready,
      ready: preflight.ready,
      dryRun: true,
      count: includedEditions.length,
      missing,
      format,
      profile: profileKey,
      chain,
      preflight,
      provenanceHash: provenance?.provenanceHash || null,
      fallback: sel.fallback,
    };
  }

  mkdirSync(bundlesDir, { recursive: true });
  const id =
    bundleId ||
    `${String(archive?.presetId || "series").replace(/[^a-zA-Z0-9_-]/g, "")}-${set || "set"}-${Date.now().toString(36)}`;
  const file = `${id}-${format}.zip`;
  const abs = join(bundlesDir, file);
  const content = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  writeFileSync(abs, content);

  return {
    ok: true,
    file,
    path: `out/bundles/${file}`,
    count: includedEditions.length,
    missing,
    format,
    profile: profileKey,
    provenanceHash: provenance?.provenanceHash || null,
    fallback: sel.fallback,
    upscaled: anyUpscaled,
    upscaleSkipped: upscaleSkippedReason,
    ready: preflight.ready,
    preflight,
    chain,
  };
}
