/**
 * Launchpad Presets & Multi-Standard Export Profiles for Series Lab.
 * Supports OpenSea Studio, Magic Eden Drops, LaunchMyNFT, and Bitcoin Ordinals Bots.
 */

import { traitsToAttributes } from "./checklist.mjs";
import { buildImageUri } from "./storage.mjs";

export const LAUNCHPAD_PROFILES = {
  opensea: {
    id: "opensea",
    name: "OpenSea Studio (ERC-721)",
    standard: "erc721",
    format: "erc721",
    description: "Standard Ethereum / Polygon ERC-721 metadata with OpenSea display types and CSV manifest.",
    defaultNamePrefix: "Series #",
    defaultSymbol: "LAB",
    defaultFee: 500,
    supportsCreators: false,
    supportsZeroIndex: false,
    supportsCsvManifest: true,
  },
  magiceden: {
    id: "magiceden",
    name: "Magic Eden Drop (Solana / EVM)",
    standard: "metaplex",
    format: "metaplex",
    description: "Metaplex / EVM Drop metadata with creator royalties array and seller fee basis points.",
    defaultNamePrefix: "Series #",
    defaultSymbol: "LAB",
    defaultFee: 500,
    supportsCreators: true,
    supportsZeroIndex: false,
    supportsCsvManifest: true,
  },
  launchmynft: {
    id: "launchmynft",
    name: "LaunchMyNFT (Solana / Multi-chain)",
    standard: "metaplex",
    format: "metaplex",
    description: "LaunchMyNFT format supporting creator royalty shares and optional 0-based indexing.",
    defaultNamePrefix: "Series #",
    defaultSymbol: "LMNFT",
    defaultFee: 500,
    supportsCreators: true,
    supportsZeroIndex: true,
    supportsCsvManifest: true,
  },
  ordinalsbot: {
    id: "ordinalsbot",
    name: "Bitcoin Ordinals / Inscriptions",
    standard: "ordinals",
    format: "ordinals",
    description: "Bitcoin Ordinals inscription manifest format with individual JSON metadata.",
    defaultNamePrefix: "Series #",
    defaultSymbol: "ORD",
    defaultFee: 0,
    supportsCreators: false,
    supportsZeroIndex: false,
    supportsCsvManifest: true,
  },
};

/**
 * Returns list of supported launchpad profile descriptors.
 */
export function getLaunchpadProfiles() {
  return Object.values(LAUNCHPAD_PROFILES);
}

/**
 * Returns MIME type for media files based on extension.
 * @param {string} uri
 * @returns {string}
 */
export function getMimeType(uri = "") {
  const clean = String(uri || "").split("?")[0].toLowerCase();
  if (clean.endsWith(".mp4")) return "video/mp4";
  if (clean.endsWith(".webm")) return "video/webm";
  if (clean.endsWith(".mov")) return "video/quicktime";
  if (clean.endsWith(".gif")) return "image/gif";
  if (clean.endsWith(".glb")) return "model/gltf-binary";
  if (clean.endsWith(".gltf")) return "model/gltf+json";
  if (clean.endsWith(".html") || clean.endsWith(".htm")) return "text/html";
  if (clean.endsWith(".png")) return "image/png";
  if (clean.endsWith(".jpg") || clean.endsWith(".jpeg")) return "image/jpeg";
  if (clean.endsWith(".webp")) return "image/webp";
  if (clean.endsWith(".svg")) return "image/svg+xml";
  return "image/png";
}

/**
 * Returns Metaplex category based on media extension/MIME.
 * @param {string} animUri
 * @returns {string}
 */
export function getMediaCategory(animUri = "") {
  const clean = String(animUri || "").split("?")[0].toLowerCase();
  if (clean.endsWith(".glb") || clean.endsWith(".gltf")) return "vr";
  if (clean.endsWith(".html") || clean.endsWith(".htm")) return "html";
  if (clean.endsWith(".mp4") || clean.endsWith(".webm") || clean.endsWith(".mov")) return "video";
  if (clean.endsWith(".gif")) return "image";
  return "image";
}

/**
 * Build tailored metadata JSON object for a specific launchpad profile.
 * @param {object} recipe
 * @param {string} [profileKey='opensea']
 * @param {object} [opts={}]
 * @param {Array} [traitItems=[]]
 * @returns {object}
 */
export function formatForLaunchpad(recipe, profileKey = "opensea", opts = {}, traitItems = []) {
  let profile = LAUNCHPAD_PROFILES[profileKey];
  if (!profile) {
    if (profileKey === "metaplex") profile = LAUNCHPAD_PROFILES.magiceden;
    else if (profileKey === "ordinals") profile = LAUNCHPAD_PROFILES.ordinalsbot;
    else profile = LAUNCHPAD_PROFILES.opensea;
  }
  const isZeroIndex = Boolean(opts.zeroIndexed || opts.zeroIndex);
  const edNum = Number(recipe.edition ?? 1);
  const displayEd = isZeroIndex ? Math.max(0, edNum - 1) : edNum;

  const image = buildImageUri(displayEd, opts.imageUriPrefix || opts.imagePrefix || "");
  const namePrefix = opts.namePrefix || profile.defaultNamePrefix;
  const symbol = opts.symbol || profile.defaultSymbol;
  const description = opts.description || "";
  const fee = Number(opts.sellerFeeBasisPoints ?? profile.defaultFee ?? 500);

  // Dynamic animation / video / 3D URL
  let animationUrl = null;
  if (opts.animationUrl || recipe.animation_url) {
    animationUrl = opts.animationUrl || recipe.animation_url;
  } else if (opts.animationUriPrefix || opts.animPrefix) {
    const ext = opts.animationExtension || opts.animExt || "mp4";
    const prefix = opts.animationUriPrefix || opts.animPrefix;
    animationUrl = prefix.includes("{edition}") || prefix.includes("{filename}")
      ? prefix.replace(/\{edition\}/g, String(displayEd)).replace(/\{filename\}/g, `${displayEd}.${ext}`)
      : prefix.endsWith("/")
        ? `${prefix}${displayEd}.${ext}`
        : `${prefix}/${displayEd}.${ext}`;
  }

  if (profile.format === "metaplex") {
    const creators = [];
    if (opts.creatorAddress && String(opts.creatorAddress).trim()) {
      creators.push({
        address: String(opts.creatorAddress).trim(),
        share: 100,
      });
    }

    const files = [{ uri: image, type: getMimeType(image) }];
    let category = "image";

    if (animationUrl) {
      files.push({ uri: animationUrl, type: getMimeType(animationUrl) });
      category = getMediaCategory(animationUrl);
    }

    const meta = {
      name: `${namePrefix}${displayEd}`,
      symbol,
      description,
      seller_fee_basis_points: fee,
      image,
      attributes: traitsToAttributes(recipe.traits, traitItems),
      properties: {
        files,
        category,
        creators,
      },
    };

    if (animationUrl) {
      meta.animation_url = animationUrl;
    }

    return meta;
  }

  if (profile.format === "ordinals") {
    const collectionName = namePrefix.trim().replace(/\s*#$/, "") || "Series";
    const files = [{ uri: image, type: getMimeType(image) }];
    if (animationUrl) {
      files.push({ uri: animationUrl, type: getMimeType(animationUrl) });
    }

    const meta = {
      id: `${symbol}-${displayEd}`,
      name: `${namePrefix}${displayEd}`,
      description,
      image,
      attributes: traitsToAttributes(recipe.traits, traitItems),
      properties: {
        edition: displayEd,
        collection: collectionName,
        files,
      },
    };

    if (animationUrl) {
      meta.animation_url = animationUrl;
    }

    return meta;
  }

  // Default: ERC-721 / OpenSea
  const meta = {
    name: `${namePrefix}${displayEd}`,
    description,
    image,
    attributes: traitsToAttributes(recipe.traits, traitItems),
  };

  if (animationUrl) {
    meta.animation_url = animationUrl;
  }

  return meta;
}

function escapeCsvCell(value) {
  if (value == null) return "";
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generate a bulk upload CSV manifest for OpenSea / Launchpads.
 * @param {Array<object>} recipes
 * @param {Array<object>} [traitItems=[]]
 * @param {object} [opts={}]
 * @returns {string}
 */
export function exportManifestCsv(recipes = [], traitItems = [], opts = {}) {
  const isZeroIndex = Boolean(opts.zeroIndexed || opts.zeroIndex);
  const namePrefix = opts.namePrefix || "Series #";
  const description = opts.description || "";
  const uriPrefix = opts.imageUriPrefix || opts.imagePrefix || "";
  const animUriPrefix = opts.animationUriPrefix || opts.animPrefix || "";
  const hasAnimation = Boolean(animUriPrefix || recipes.some((r) => r.animation_url || r.animationUrl));

  // Collect all unique trait keys across items and definitions
  const traitKeySet = new Set();
  for (const t of traitItems) {
    if (t?.key) traitKeySet.add(t.key);
  }
  for (const r of recipes) {
    if (r?.traits && typeof r.traits === "object") {
      for (const k of Object.keys(r.traits)) {
        traitKeySet.add(k);
      }
    }
  }
  const traitKeys = [...traitKeySet];

  // Header row
  const headers = ["id", "edition", "name", "description", "image"];
  if (hasAnimation) headers.push("animation_url");
  headers.push(...traitKeys);

  const rows = [headers.map(escapeCsvCell).join(",")];

  for (const r of recipes) {
    const edNum = Number(r.edition ?? 1);
    const displayEd = isZeroIndex ? Math.max(0, edNum - 1) : edNum;
    const name = `${namePrefix}${displayEd}`;
    const image = buildImageUri(displayEd, uriPrefix);

    let animationUrl = "";
    if (r.animation_url || r.animationUrl) {
      animationUrl = r.animation_url || r.animationUrl;
    } else if (animUriPrefix) {
      const ext = opts.animationExtension || opts.animExt || "mp4";
      animationUrl = animUriPrefix.includes("{edition}") || animUriPrefix.includes("{filename}")
        ? animUriPrefix.replace(/\{edition\}/g, String(displayEd)).replace(/\{filename\}/g, `${displayEd}.${ext}`)
        : animUriPrefix.endsWith("/")
          ? `${animUriPrefix}${displayEd}.${ext}`
          : `${animUriPrefix}/${displayEd}.${ext}`;
    }

    const row = [
      String(displayEd),
      String(displayEd),
      name,
      description,
      image,
    ];

    if (hasAnimation) {
      row.push(animationUrl);
    }

    for (const key of traitKeys) {
      const val = r?.traits?.[key] ?? "";
      row.push(val === "__NONE__" || val === "None" ? "" : String(val));
    }

    rows.push(row.map(escapeCsvCell).join(","));
  }

  return rows.join("\r\n") + "\r\n";
}

