/**
 * Extra files that make an export a verified, ready-to-upload package:
 * cover, royalties, rarity, and a chain-specific README / next steps.
 */
import { computeRarity, openRarityByEdition } from "./rarity.mjs";
import { chainForProfile } from "./deploy-kit.mjs";
import { authorshipText } from "./authorship.mjs";

export function buildRoyalties(opts = {}) {
  const fee = Number(opts.sellerFeeBasisPoints ?? 500);
  const address = String(opts.creatorAddress || "").trim();
  const creators = address ? [{ address, share: 100 }] : [];
  return {
    sellerFeeBasisPoints: Number.isFinite(fee) ? Math.trunc(fee) : 500,
    percent: Number.isFinite(fee) ? Math.trunc(fee) / 100 : 5,
    creators,
    feeRecipient: address || null,
    note: "Set by the creator in Series Lab. The private key is never included.",
  };
}

export function buildRarityReport(preset, recipes) {
  const list = Array.isArray(recipes) ? recipes : [];
  try {
    if (preset && (preset.traits || preset.id)) {
      const report = computeRarity(preset, list);
      if (report?.traits?.length) {
        report.openRarity = openRarityByEdition(preset, list);
        return report;
      }
    }
  } catch {
    /* preset has no trait pack — count what the recipes actually used */
  }
  const counts = new Map();
  for (const r of list) {
    for (const [key, value] of Object.entries(r?.traits || {})) {
      if (value == null || value === "") continue;
      if (!counts.has(key)) counts.set(key, new Map());
      const m = counts.get(key);
      m.set(value, (m.get(value) || 0) + 1);
    }
  }
  const n = list.length || 1;
  const traits = [...counts.entries()].map(([key, m]) => ({
    key,
    type: key,
    options: [...m.entries()]
      .map(([value, count]) => ({
        value,
        count,
        actualPct: Math.round((count / n) * 1000) / 10,
        expectedPct: null,
      }))
      .sort((a, b) => b.count - a.count),
  }));
  return {
    traits,
    sampleSize: list.length,
    source: "recipes",
    openRarity: openRarityByEdition(preset, list),
  };
}

export function formatRarityText(report, locale = "en") {
  const uk = String(locale || "").toLowerCase().startsWith("uk");
  const lines = [
    uk ? "Звіт рідкості рис" : "Trait rarity report",
    "====================",
    uk ? `Вибірка: ${report.sampleSize ?? 0}` : `Sample: ${report.sampleSize ?? 0}`,
    "",
  ];
  for (const trait of report.traits || []) {
    lines.push(trait.type && trait.type !== trait.key ? `${trait.key} (${trait.type})` : trait.key);
    for (const opt of trait.options || []) {
      const expected = opt.expectedPct == null ? "" : uk ? `, очікувано ${opt.expectedPct}%` : `, expected ${opt.expectedPct}%`;
      lines.push(`  ${opt.value}: ${opt.count} (${opt.actualPct}%${expected})`);
    }
    lines.push("");
  }
  if (!report.traits?.length) {
    lines.push(uk ? "Рис у вибраних рецептах немає." : "No traits on the selected recipes.");
  }
  lines.push(uk
    ? "Метод вище: частота (кількість / вибірка). Це попередній звіт, його не замінює OpenRarity."
    : "Method above: frequency (count / sample). This is the existing report. OpenRarity does not replace it.");
  const open = report.openRarity;
  if (open?.editions?.length) {
    lines.push("");
    lines.push(uk
      ? "OpenRarity = сума −log2(P). Відсутня риса шару, який є в пресеті, рахується як значення «null»."
      : "OpenRarity = sum of -log2(P). A missing trait on a layer that exists in the preset counts as the value \"null\".");
    for (const row of open.editions) {
      const score = Number(row.openRarity);
      const shown = Number.isFinite(score) ? score.toFixed(6) : "—";
      lines.push(`  #${row.edition}: ${shown}`);
    }
  }
  return lines.join("\n");
}

/**
 * README that is also the next-steps sheet for the chosen chain.
 * Deploy commands live in the deploy kit; this file says what is in the zip and what to do next.
 */
export function buildChainReadme(locale, collection = {}) {
  const uk = String(locale || "").toLowerCase().startsWith("uk");
  const chain = collection.chain || chainForProfile(collection.profile, collection.format);
  const count = collection.count ?? "—";
  const fee = collection.sellerFeeBasisPoints ?? "—";
  const commonUk = [
    "Series Lab — архів, готовий до публікації",
    "==========================================",
    "",
    `Мережа: ${chainLabel(chain, "uk")}`,
    `Профіль: ${collection.profile || "—"}`,
    `Кількість: ${count}`,
    `Опис колекції: ${collection.description || "—"}`,
    `Роялті: ${fee} bps (див. royalties.json)`,
    collection.ready === false
      ? "Статус перевірки: НЕ готовий — див. preflight.txt"
      : "Статус перевірки: готовий, якщо preflight.txt не містить ERROR",
    `Кадрів із missing_trait після triage: ${Number(collection.missingTraitFrames) || 0}. ZIP через це не блокується.`,
    "",
    "Що в архіві:",
    "  images/          — картинки видань",
    "  metadata/        — метадані обраного стандарту",
    "  cover.*          — обкладинка колекції (перше зображення набору)",
    "  royalties.json   — роялті й адреса творця (без приватного ключа)",
    "  rarity.json      — частота рис і окремий звіт OpenRarity",
    "  rarity.txt       — той самий звіт текстом",
    "  creation/        — маніфест створення кожного видання (не всередині metadata/)",
    "  collection.json  — підсумок",
    ...((collection.aiMarked?.images || collection.aiMarked?.signed) ? ["  ai-disclosure.json — позначка «створено ШІ» в метаданих PNG (XMP) і кадри з підписом C2PA; XMP не є підписом, його можна стерти"] : []),
    "  preflight.txt    — результат перевірки",
    "  README.txt       — цей файл, наступні кроки для вашої мережі",
    "",
    aiDisclosure("uk"),
    ...(collection.authorship ? ["", authorshipText("uk", collection.authorship)] : []),
    "",
    "Наступні кроки:",
    "  1. Прочитайте preflight.txt. ERROR блокує позначку «готовий».",
    "  2. Завантажте набір деплою і спочатку пройдіть тестнет / devnet.",
    "  3. Деплой і лістинг підписуєте ви зі свого гаманця й акаунта.",
    "     Series Lab не просить seed-фразу чи приватний ключ і не тримає кошти.",
    "",
  ];
  const commonEn = [
    "Series Lab — archive ready to publish",
    "======================================",
    "",
    `Chain: ${chainLabel(chain, "en")}`,
    `Profile: ${collection.profile || "—"}`,
    `Count: ${count}`,
    `Collection description: ${collection.description || "—"}`,
    `Royalty: ${fee} bps (see royalties.json)`,
    collection.ready === false
      ? "Preflight: NOT ready — see preflight.txt"
      : "Preflight: ready when preflight.txt has no ERROR lines",
    `Frames with missing_trait after triage: ${Number(collection.missingTraitFrames) || 0}. The ZIP is not blocked for this.`,
    "",
    "What is in the archive:",
    "  images/          — edition artwork",
    "  metadata/        — metadata for the chosen standard",
    "  cover.*          — collection cover (first image in the set)",
    "  royalties.json   — royalty and creator address (no private key)",
    "  rarity.json      — trait frequency plus a separate OpenRarity report",
    "  rarity.txt       — the same report as text",
    "  creation/        — per-edition creation manifest (not inside metadata/)",
    "  collection.json  — summary",
    ...((collection.aiMarked?.images || collection.aiMarked?.signed) ? ["  ai-disclosure.json — \"AI-generated\" mark in PNG metadata (XMP) and frames with a C2PA signature; XMP is not a signature, it can be stripped"] : []),
    "  preflight.txt    — validation result",
    "  README.txt       — this file, next steps for your chain",
    "",
    aiDisclosure("en"),
    ...(collection.authorship ? ["", authorshipText("en", collection.authorship)] : []),
    "",
    "Next steps:",
    "  1. Read preflight.txt. An ERROR keeps the archive from being marked ready.",
    "  2. Download the deploy kit and do a testnet / devnet dry run first.",
    "  3. You deploy and list from your own wallet and account.",
    "     Series Lab never asks for a seed phrase or private key and never holds funds.",
    "",
  ];
  const tail = uk ? chainNextUk(chain) : chainNextEn(chain);
  return [...(uk ? commonUk : commonEn), ...tail, ""].join("\n");
}

function aiDisclosure(locale) {
  if (locale === "uk") {
    return [
      "----- РОЗКРИТТЯ ШІ (цей абзац можна стерти) -----",
      "Ці зображення згенеровано моделлю в Series Lab. Людина задала пресет, зерно порядку і те, які кадри лишити. Це робочий текст розкриття, не юридичний висновок, і його можна видалити.",
      "----- КІНЕЦЬ РОЗКРИТТЯ ШІ -----",
    ].join("\n");
  }
  return [
    "----- AI DISCLOSURE (delete this paragraph if you do not want it in the archive) -----",
    "These images were generated with a model in Series Lab. A person set the preset, the seed, and which frames to keep. This paragraph is a working disclosure, not a legal opinion, and you may delete it.",
    "----- END AI DISCLOSURE -----",
  ].join("\n");
}

function chainLabel(chain, locale) {
  const uk = locale === "uk";
  if (chain === "solana") return uk ? "Solana (пріоритетна мережа; інші теж підтримані)" : "Solana (first-class; other chains stay supported)";
  if (chain === "bitcoin") return "Bitcoin Ordinals";
  return uk ? "EVM (Ethereum / Base / Polygon / Arbitrum та інші)" : "EVM (Ethereum / Base / Polygon / Arbitrum and others)";
}

function chainNextUk(chain) {
  if (chain === "solana") {
    return [
      "Solana:",
      "  - Метадані в metadata/ — Metaplex.",
      "  - cm-config.json у цьому архіві — чернетка Core Candy Machine.",
      "  - sugar/config.json і sugar/LEGACY.txt — застарілі, не для нової колекції.",
      "  - Робочий набір CLI — «Набір деплою» (mplx, спочатку devnet).",
      "  - Далі маркетплейс: Magic Eden і Tensor, зі свого акаунта.",
    ];
  }
  if (chain === "bitcoin") {
    return [
      "Bitcoin Ordinals:",
      "  - metadata/ і manifest.csv — список інскрипцій, не ончейн-мінт з Lab.",
      "  - Набір деплою містить кроки для signet, потім mainnet.",
      "  - Комісію мережі платите ви зі свого Bitcoin-гаманця.",
    ];
  }
  return [
    "EVM:",
    "  - metadata/ — ERC-721 / OpenSea.",
    "  - thirdweb.json — параметри дропу. Повний набір і тестнет (Sepolia / Base Sepolia) — у «Наборі деплою».",
    "  - Лістинг на OpenSea робите ви зі свого акаунта.",
  ];
}

function chainNextEn(chain) {
  if (chain === "solana") {
    return [
      "Solana:",
      "  - metadata/ is Metaplex.",
      "  - cm-config.json in this archive is a Core Candy Machine draft.",
      "  - sugar/config.json and sugar/LEGACY.txt are legacy, not for a new collection.",
      "  - The CLI package is the Deploy kit (mplx, devnet first).",
      "  - Then the marketplace kit: Magic Eden and Tensor, from your own account.",
    ];
  }
  if (chain === "bitcoin") {
    return [
      "Bitcoin Ordinals:",
      "  - metadata/ and manifest.csv are the inscription list. Lab does not inscribe for you.",
      "  - The deploy kit has signet steps, then mainnet.",
      "  - You pay miner fees from your own Bitcoin wallet.",
    ];
  }
  return [
    "EVM:",
    "  - metadata/ is ERC-721 / OpenSea.",
    "  - thirdweb.json holds drop parameters. The full package and a testnet (Sepolia / Base Sepolia) are in the Deploy kit.",
    "  - You list on OpenSea from your own account.",
  ];
}
