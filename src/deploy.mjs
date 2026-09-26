/**
 * Release & Deployment Hub for Series Lab.
 * Non-custodial launchpad integrations, Metaplex Sugar CLI configs,
 * Thirdweb Drop configs, and platform release guides.
 */

import { LAUNCHPAD_PROFILES } from "./launchpads.mjs";

/**
 * Generate Solana Metaplex Sugar CLI config (`sugar.json` / `config.json`).
 * @param {object} archive
 * @param {object} [preset={}]
 * @param {object} [opts={}]
 * @returns {object}
 */
/**
 * Core Candy Machine draft for the release hub (not a Sugar config).
 * Fields match the deploy kit's cm-config.json. No wallet key.
 */
export function buildCoreCandyConfig(archive = {}, preset = {}, opts = {}) {
  const count = Number(archive.size ?? archive.recipes?.length ?? 0);
  const name = String(opts.name || opts.namePrefix || preset.name || archive.presetId || "Series").replace(/\s+#$/, "");
  const symbol = String(opts.symbol || preset.symbol || "LAB").trim();
  const description = opts.description || preset.description || "";
  const fee = Number(opts.sellerFeeBasisPoints ?? opts.fee ?? 500);
  const creator = String(opts.creatorAddress || "").trim();
  return {
    name,
    symbol,
    description,
    sellerFeeBasisPoints: Number.isFinite(fee) ? fee : 500,
    itemsAvailable: count,
    isMutable: true,
    creators: creator ? [{ address: creator, percentage: 100 }] : [],
  };
}

export function buildSugarConfig(archive = {}, preset = {}, opts = {}) {
  const count = Number(archive.size ?? archive.recipes?.length ?? 10);
  const symbol = String(opts.symbol || preset.symbol || "LAB").trim();
  const fee = Number(opts.sellerFeeBasisPoints ?? opts.fee ?? 500);
  const creatorAddress = String(opts.creatorAddress || "").trim() || "11111111111111111111111111111111";
  const price = Number(opts.price ?? 0.1);
  const isZeroIndex = Boolean(opts.zeroIndexed || opts.zeroIndex);

  const uploadMethod = opts.uploadMethod ||
    (opts.imageUriPrefix?.includes("ipfs") || opts.imagePrefix?.includes("ipfs") ? "pinata" : "bundlr");

  return {
    price,
    number: count,
    symbol,
    sellerFeeBasisPoints: fee,
    isMutable: true,
    isSequential: !isZeroIndex,
    creators: [
      {
        address: creatorAddress,
        share: 100,
      },
    ],
    uploadMethod,
    awsConfig: null,
    nftStorageAuthToken: null,
    pinataConfig: null,
    shdwStorageConfigFile: null,
    hiddenSettings: null,
    guards: null,
    solTreasuryAccount: creatorAddress,
    splToken: null,
    splTokenAccount: null,
    goLiveDate: opts.goLiveDate || new Date().toISOString(),
    endSettings: null,
    whitelistMintSettings: null,
  };
}

/**
 * Generate Thirdweb / EVM Drop contract deploy config (`thirdweb.json`).
 * @param {object} archive
 * @param {object} [preset={}]
 * @param {object} [opts={}]
 * @returns {object}
 */
export function buildThirdwebConfig(archive = {}, preset = {}, opts = {}) {
  const count = Number(archive.size ?? archive.recipes?.length ?? 10);
  const name = opts.namePrefix?.replace(/\s*#$/, "") || preset.name || archive.presetId || "Series Collection";
  const symbol = String(opts.symbol || preset.symbol || "LAB").trim();
  const description = opts.description || preset.description || "Series Lab Generated NFT Collection";
  const fee = Number(opts.sellerFeeBasisPoints ?? opts.fee ?? 500);
  const creator = String(opts.creatorAddress || "").trim() || "0x0000000000000000000000000000000000000000";
  const image = opts.imageUriPrefix || opts.coverImage || "";

  const uk = String(opts.locale || "en").toLowerCase().startsWith("uk");
  return {
    name,
    symbol,
    description,
    image,
    seller_fee_basis_points: fee,
    fee_recipient: creator,
    primary_sale_recipient: creator,
    platform_fee_basis_points: 0,
    platform_fee_recipient: creator,
    defaultAdmin: creator,
    total_supply: count,
    ...(opts.provenanceHash ? { provenance_hash: opts.provenanceHash } : {}),
    delayedReveal: {
      passwordStored: false,
      hint: uk
        ? "Пароль delayed reveal вводьте у своєму кабінеті thirdweb. Series Lab його не приймає і не зберігає."
        : "Enter the delayed-reveal password in your own thirdweb dashboard. Series Lab does not accept or store it.",
    },
  };
}

/**
 * Returns direct launchpad portal URLs and step-by-step guidance.
 * @param {string} [profileKey='opensea']
 * @param {object} [archive={}]
 * @param {object} [opts={}]
 * @returns {object}
 */
export function getLaunchpadPortalUrls(profileKey = "opensea", archive = {}, opts = {}) {
  const profile = LAUNCHPAD_PROFILES[profileKey] || LAUNCHPAD_PROFILES.opensea;
  const id = profile.id;

  if (id === "magiceden") {
    return {
      id: "magiceden",
      name: "Magic Eden Creator Hub",
      portalUrl: "https://magiceden.io/creator-hub",
      testnetPortalUrl: "https://devnet.magiceden.io/creator-hub",
      recommendedFile: "cm-config.json",
      standard: "Metaplex / Solana",
      tips: [
        "1. Open Magic Eden Creator Hub and connect your creator wallet.",
        "2. Select 'Create New Drop' on Solana.",
        "3. Upload the ZIP. Solana drops use the Core Candy Machine layout (cm-config.json and assets/). sugar/config.json is labelled legacy only.",
        "4. Set your drop phases (Allowlist / Public) and launch date.",
      ],
    };
  }

  if (id === "launchmynft") {
    return {
      id: "launchmynft",
      name: "LaunchMyNFT Portal",
      portalUrl: "https://launchmynft.io/create",
      testnetPortalUrl: "https://launchmynft.io/create",
      recommendedFile: "bundle.zip",
      standard: "Metaplex / Multi-chain",
      tips: [
        "1. Visit LaunchMyNFT Create page.",
        "2. Connect Phantom, Solflare, or EVM wallet.",
        "3. Drag-and-drop the extracted images/ and metadata/ folders.",
        "4. Set mint price and launch your collection.",
      ],
    };
  }

  if (id === "ordinalsbot") {
    return {
      id: "ordinalsbot",
      name: "OrdinalsBot Inscription Portal",
      portalUrl: "https://ordinalsbot.com/",
      testnetPortalUrl: "https://testnet.ordinalsbot.com/",
      recommendedFile: "manifest.csv",
      standard: "Bitcoin Ordinals",
      tips: [
        "1. Go to OrdinalsBot Bulk Inscription tool.",
        "2. Upload manifest.csv from the root of your Series Lab bundle.",
        "3. Provide receiving Bitcoin Taproot (bc1p...) address.",
        "4. Pay sat/vB network fees to broadcast batch inscriptions.",
      ],
    };
  }

  // Default: OpenSea Studio
  return {
    id: "opensea",
    name: "OpenSea Studio Drop Creator",
    portalUrl: "https://opensea.io/studio/create",
    testnetPortalUrl: "https://testnets.opensea.io/studio/create",
    recommendedFile: "manifest.csv",
    standard: "ERC-721 / EVM",
    tips: [
      "1. Navigate to OpenSea Studio Create Drop.",
      "2. Connect MetaMask, Coinbase Wallet, or Rainbow.",
      "3. Choose blockchain (Ethereum, Base, Polygon, Arbitrum, Optimism).",
      "4. Import manifest.csv or upload IPFS metadata folder from the ZIP bundle.",
      "5. Deploy the audited Drop contract with 0 upfront platform fees.",
    ],
  };
}

/**
 * Generate tailored step-by-step Release Guide text for ZIP bundles.
 * @param {string} [locale='en']
 * @param {object} [archive={}]
 * @param {object} [opts={}]
 * @returns {string}
 */
export function buildReleaseGuide(locale = "en", archive = {}, opts = {}) {
  const uk = String(locale || "").toLowerCase().startsWith("uk");
  const profileKey = opts.profile || "opensea";
  const portal = getLaunchpadPortalUrls(profileKey, archive, opts);
  const count = archive.size ?? archive.recipes?.length ?? "all";

  if (uk) {
    return [
      "============================================================",
      `Series Lab — Інструкція з релізу (${portal.name})`,
      "============================================================",
      "",
      `Профіль: ${portal.name} (${portal.standard})`,
      `Кількість NFT: ${count}`,
      `Рекомендований конфіг: ${portal.recommendedFile}`,
      `Портал для запуску: ${portal.portalUrl}`,
      `Тестнет: ${portal.testnetPortalUrl}`,
      "",
      "Кроки для запуску колекції:",
      ...portal.tips.map((t) => `  ${t}`),
      "",
      "Вміст бандлу:",
      "  - images/       : оптимізовані зображення з правильною нумерацією",
      "  - metadata/     : JSON метадані кожного токена зі структурою атрибутів",
      "  - manifest.csv  : зведений CSV-маніфест для гуртового імпорту",
      "  - cm-config.json: чернетка Core Candy Machine (Solana, типово)",
      "  - sugar/config.json : застарілий Sugar, не для нової колекції",
      "  - thirdweb.json : параметри для контракту Thirdweb Drop (якщо EVM)",
      "  - collection.json: звіт параметрів серії",
      "",
      "Безпека:",
      "  Series Lab є non-custodial інструментом. Деплой відбувається через ваш",
      "  власний браузерний гаманець або CLI без передачі ключів третім особам.",
      "============================================================",
    ].join("\n");
  }

  return [
    "============================================================",
    `Series Lab — Release & Deployment Guide (${portal.name})`,
    "============================================================",
    "",
    `Profile: ${portal.name} (${portal.standard})`,
    `Total Items: ${count}`,
    `Recommended Config: ${portal.recommendedFile}`,
    `Mainnet Portal: ${portal.portalUrl}`,
    `Testnet Portal: ${portal.testnetPortalUrl}`,
    "",
    "Deployment Steps:",
    ...portal.tips.map((t) => `  ${t}`),
    "",
    "Bundle Layout:",
    "  - images/        : artwork files with exact indexing",
    "  - metadata/      : per-token JSON metadata formatted for the standard",
    "  - manifest.csv   : bulk upload manifest CSV",
    "  - cm-config.json : Core Candy Machine draft (Solana default)",
    "  - sugar/config.json : legacy Sugar config, not for a new collection",
    "  - thirdweb.json  : Thirdweb Drop contract parameters (for EVM)",
    "  - collection.json: series summary & reproducibility metadata",
    "",
    "Security:",
    "  Series Lab is strictly non-custodial. All deployments are signed through",
    "  your own browser extension wallet or CLI with zero key exposure.",
    "============================================================",
  ].join("\n");
}
