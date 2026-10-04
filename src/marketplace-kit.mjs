/**
 * Marketplace kit: checklists, listing copy, and banner / avatar / cover
 * at documented sizes. The creator publishes from their own marketplace account.
 */
import { resizePng, pngDimensions } from "./png-fit.mjs";
import { loadSharp } from "./upscale.mjs";
import { normalizeChain } from "./deploy-kit.mjs";

/**
 * Pixel sizes the kit exports. Override with MARKETPLACE_IMAGE_SIZES (JSON).
 * Sources are the usual creator-page slots, written down so the owner can change them
 * without hunting a design doc:
 *   Magic Eden / Tensor banner 1400×400, avatar 500×500, cover 1000×1000
 *   OpenSea banner 1400×400, avatar 350×350, featured cover 600×400
 *   Ordinals storefronts vary; 1200×400 / 400×400 / 600×600 is the Lab default
 */
export const DEFAULT_MARKETPLACE_SIZES = {
  magicEden: {
    id: "magicEden",
    chain: "solana",
    name: "Magic Eden",
    banner: { width: 1400, height: 400 },
    avatar: { width: 500, height: 500 },
    cover: { width: 1000, height: 1000 },
  },
  tensor: {
    id: "tensor",
    chain: "solana",
    name: "Tensor",
    banner: { width: 1400, height: 400 },
    avatar: { width: 500, height: 500 },
    cover: { width: 1000, height: 1000 },
  },
  openSea: {
    id: "openSea",
    chain: "evm",
    name: "OpenSea",
    banner: { width: 1400, height: 400 },
    avatar: { width: 350, height: 350 },
    cover: { width: 600, height: 400 },
  },
  ordinals: {
    id: "ordinals",
    chain: "bitcoin",
    name: "Ordinals marketplaces",
    banner: { width: 1200, height: 400 },
    avatar: { width: 400, height: 400 },
    cover: { width: 600, height: 600 },
  },
};

const SLOT_FILES = {
  magicEden: { banner: "magic-eden-banner.png", avatar: "magic-eden-avatar.png", cover: "magic-eden-cover.png" },
  tensor: { banner: "tensor-banner.png", avatar: "tensor-avatar.png", cover: "tensor-cover.png" },
  openSea: { banner: "opensea-banner.png", avatar: "opensea-avatar.png", cover: "opensea-cover.png" },
  ordinals: { banner: "ordinals-banner.png", avatar: "ordinals-avatar.png", cover: "ordinals-cover.png" },
};

export function marketplaceSizes(env = process.env) {
  let over = {};
  try {
    over = JSON.parse(env?.MARKETPLACE_IMAGE_SIZES || "{}");
  } catch {
    over = {};
  }
  const out = {};
  for (const [id, base] of Object.entries(DEFAULT_MARKETPLACE_SIZES)) {
    const patch = over[id] || {};
    out[id] = {
      ...base,
      banner: { ...base.banner, ...(patch.banner || {}) },
      avatar: { ...base.avatar, ...(patch.avatar || {}) },
      cover: { ...base.cover, ...(patch.cover || {}) },
    };
  }
  return out;
}

export function marketplacesForChain(chain) {
  const c = normalizeChain(chain);
  if (c === "solana") return ["magicEden", "tensor"];
  if (c === "bitcoin") return ["ordinals"];
  return ["openSea"];
}

export function buildListingCopy({ name, description, locale = "en", symbol = "" } = {}) {
  const title = String(name || "Collection").trim();
  const about = String(description || "").trim();
  const uk = String(locale || "").toLowerCase().startsWith("uk");
  const socials = {
    twitter: "{{twitter}}",
    discord: "{{discord}}",
    website: "{{website}}",
    telegram: "{{telegram}}",
  };
  const body = about || (uk
    ? `${title} — колекція, зібрана в Series Lab. Замініть цей абзац на свій текст.`
    : `${title} — a collection prepared in Series Lab. Replace this paragraph with your own text.`);
  return {
    name: title,
    symbol: symbol || "",
    description: body,
    socials,
    note: uk
      ? "Плейсхолдери {{…}} замініть на свої посилання перед публікацією. Публікуєте ви зі свого акаунта."
      : "Replace {{…}} placeholders with your links before you publish. You publish from your own account.",
  };
}

function checklistBlocks(chain, locale) {
  const uk = String(locale || "").toLowerCase().startsWith("uk");
  const common = uk
    ? [
      "Спільне для будь-якого майданчика",
      "  [ ] Лістинг робите ви, зі свого акаунта. Series Lab нічого не виставляє і не продає за вас.",
      "  [ ] Гаманець лістингу той самий, що деплоїв колекцію (або той, якому контракт це дозволяє).",
      "  [ ] Назва, опис і посилання скопійовані з LISTING.txt, плейсхолдери замінені.",
      "  [ ] Банер, аватар і обкладинка — з теки images/ цього набору (розміри в SIZES.json).",
      "  [ ] Роялті на майданчику збігаються з royalties.json архіву.",
      "  [ ] Кілька токенів відкриваються, картинка й риси на місці.",
    ]
    : [
      "Every marketplace",
      "  [ ] You create the listing from your own account. Series Lab does not list or sell for you.",
      "  [ ] The listing wallet is the one that deployed the collection (or one the contract allows).",
      "  [ ] Name, description, and links are copied from LISTING.txt, with placeholders replaced.",
      "  [ ] Banner, avatar, and cover come from images/ in this kit (sizes are in SIZES.json).",
      "  [ ] The royalty on the site matches royalties.json from the archive.",
      "  [ ] A few tokens open and show the right image and traits.",
    ];
  const specific = {
    solana: uk
      ? [
        "Magic Eden",
        "  [ ] Creator Hub → колекція, яку ви задеплоїли (спочатку devnet, якщо ще не впевнені).",
        "  [ ] Вставте банер magic-eden-banner.png і аватар magic-eden-avatar.png.",
        "  [ ] Увімкніть роялті, що збігаються з sellerFeeBasisPoints.",
        "  [ ] Перевірка колекції Magic Eden — їхня форма верифікації, не кнопка в Lab.",
        "Tensor",
        "  [ ] Імпортуйте ту саму колекцію (mint address з виводу mplx cm).",
        "  [ ] Банер tensor-banner.png, аватар tensor-avatar.png.",
        "  [ ] Звірте роялті з Magic Eden, щоб майданчики не розходились.",
      ]
      : [
        "Magic Eden",
        "  [ ] Creator Hub → the collection you deployed (devnet first if you are not sure yet).",
        "  [ ] Upload magic-eden-banner.png and magic-eden-avatar.png.",
        "  [ ] Turn on the royalty that matches sellerFeeBasisPoints.",
        "  [ ] Magic Eden collection verification is their form, not a button in Lab.",
        "Tensor",
        "  [ ] Import the same collection (the mint address from the mplx cm output).",
        "  [ ] Banner tensor-banner.png, avatar tensor-avatar.png.",
        "  [ ] Match the royalty with Magic Eden so the two sites do not disagree.",
      ],
    evm: uk
      ? [
        "OpenSea",
        "  [ ] Спочатку testnets.opensea.io, потім opensea.io.",
        "  [ ] Edit collection: банер opensea-banner.png, аватар opensea-avatar.png, featured — opensea-cover.png.",
        "  [ ] Посилання з LISTING.txt (twitter / discord / website).",
        "  [ ] Верифікація колекції — через OpenSea (гаманець власника контракту).",
        "  [ ] Переконайтесь, що base URI вказує на ваші metadata, не на локальні імена файлів.",
      ]
      : [
        "OpenSea",
        "  [ ] testnets.opensea.io first, then opensea.io.",
        "  [ ] Edit collection: banner opensea-banner.png, avatar opensea-avatar.png, featured image opensea-cover.png.",
        "  [ ] Links from LISTING.txt (twitter / discord / website).",
        "  [ ] Collection verification is OpenSea's flow (the contract owner wallet).",
        "  [ ] Confirm the base URI points at your metadata, not at local filenames.",
      ],
    bitcoin: uk
      ? [
        "Майданчики Ordinals (Satflow, Gamma, OKX, UniSat, Ordzaar)",
        "  [ ] Список міг застаріти. Перед друком банерів відкрийте https://www.xverse.app/blog/where-to-buy-bitcoin-ordinals-marketplaces",
        "  [ ] Колекція вже заінскрибована з вашого гаманця (див. набір деплою і ORDINALS.txt).",
        "  [ ] На кожному майданчику, де ви хочете сторінку: банер ordinals-banner.png, аватар ordinals-avatar.png.",
        "  [ ] Опис і соцмережі — з LISTING.txt.",
        "  [ ] Верифікація — форма майданчика. Lab її не надсилає.",
        "  [ ] Перевірте, що parent/child інскрипції збігаються з тим, що показує майданчик.",
      ]
      : [
        "Ordinals marketplaces (Satflow, Gamma, OKX, UniSat, Ordzaar)",
        "  [ ] This list can go stale. Before you print banners, open https://www.xverse.app/blog/where-to-buy-bitcoin-ordinals-marketplaces",
        "  [ ] The collection is already inscribed from your wallet (see the deploy kit and ORDINALS.txt).",
        "  [ ] On each site where you want a page: banner ordinals-banner.png, avatar ordinals-avatar.png.",
        "  [ ] Description and socials come from LISTING.txt.",
        "  [ ] Verification is that site's form. Lab does not submit it.",
        "  [ ] Check that parent/child inscriptions match what the site shows.",
      ],
  };
  return [...common, "", ...(specific[chain] || specific.evm)];
}

export function verificationTips(chain, locale = "en") {
  const uk = String(locale || "").toLowerCase().startsWith("uk");
  const lines = uk
    ? [
      "Поради з перевірки",
      "==================",
      "  - Порівняйте 3 випадкові токени: ім'я, картинка, риси, роялті.",
      "  - Обкладинка колекції на сайті та чий гаманець отримує роялті.",
      "  - Якщо щось не збігається — виправте метадані й оновіть URI до того, як кликати людей.",
      "  - Не вводьте seed-фразу на сторінці маркетплейсу, якої ви не відкривали самі.",
    ]
    : [
      "Verification tips",
      "=================",
      "  - Compare 3 random tokens: name, image, traits, royalty.",
      "  - Collection cover on the site, and which wallet receives royalties.",
      "  - If something does not match, fix metadata and refresh the URI before you tell people.",
      "  - Do not type a seed phrase into a marketplace page you did not open yourself.",
    ];
  if (chain === "solana") {
    lines.push(uk
      ? "  - На Solana звірте mint address колекції з виводом `mplx cm validate`."
      : "  - On Solana, match the collection mint address with the `mplx cm validate` output.");
  } else if (chain === "bitcoin") {
    lines.push(uk
      ? "  - На Bitcoin звірте id інскрипції в гаманці й на майданчику."
      : "  - On Bitcoin, match the inscription id in your wallet and on the marketplace.");
  } else {
    lines.push(uk
      ? "  - На EVM звірте адресу контракту в гаманці й у URL колекції OpenSea."
      : "  - On EVM, match the contract address in your wallet and in the OpenSea collection URL.");
  }
  return lines.join("\n");
}

async function fitCover(coverBuffer, width, height) {
  const png = resizePng(coverBuffer, width, height);
  if (png.ok) return { ok: true, buffer: png.buffer, via: "png" };
  const sharp = await loadSharp();
  if (!sharp) return { ok: false, reason: png.reason || "not_png" };
  try {
    const buffer = await sharp(coverBuffer)
      .resize(width, height, { fit: "cover", position: "centre" })
      .png()
      .toBuffer();
    const dim = pngDimensions(buffer);
    if (!dim || dim.width !== width || dim.height !== height) {
      return { ok: false, reason: "sharp_size_mismatch" };
    }
    return { ok: true, buffer, via: "sharp" };
  } catch (e) {
    return { ok: false, reason: String(e.message || e) };
  }
}

/**
 * @param {object} input
 * @param {Buffer} input.coverBuffer first edition image (the collection cover)
 * @returns {Promise<{ chain: string, files: Record<string, string|Buffer>, listing: object, warnings: string[] }>}
 */
export async function buildMarketplaceKit({
  coverBuffer,
  opts = {},
  locale = "en",
  env = process.env,
  preset = {},
  archive = {},
} = {}) {
  const chain = normalizeChain(opts.chain, opts.profile, opts.format);
  const uk = String(locale || "").toLowerCase().startsWith("uk");
  const sizes = marketplaceSizes(env);
  const ids = marketplacesForChain(chain);
  const name = opts.name || preset?.name || archive?.presetId || "Collection";
  const listing = buildListingCopy({
    name,
    description: opts.description || preset?.description || "",
    locale,
    symbol: opts.symbol || preset?.symbol || "",
  });
  const warnings = [];
  const files = {};
  const sizeDoc = {
    source: "Collection cover: the first image in the archive (edition order). Slots are cropped/scaled from that single image.",
    config: "Defaults live in DEFAULT_MARKETPLACE_SIZES (src/marketplace-kit.mjs). Override with MARKETPLACE_IMAGE_SIZES JSON.",
    marketplaces: {},
  };

  for (const id of ids) {
    const spec = sizes[id];
    const names = SLOT_FILES[id];
    sizeDoc.marketplaces[id] = { name: spec.name, slots: {} };
    for (const slot of ["banner", "avatar", "cover"]) {
      const { width, height } = spec[slot];
      const filename = `images/${names[slot]}`;
      sizeDoc.marketplaces[id].slots[slot] = { width, height, file: filename };
      if (!coverBuffer) {
        warnings.push(uk ? `Немає обкладинки для ${filename}` : `No cover image for ${filename}`);
        continue;
      }
      const fitted = await fitCover(coverBuffer, width, height);
      if (!fitted.ok) {
        warnings.push(uk
          ? `${filename}: не вдалося змінити розмір (${fitted.reason}). Потрібен PNG або встановлений sharp.`
          : `${filename}: could not resize (${fitted.reason}). Need a PNG, or sharp installed.`);
        continue;
      }
      files[filename] = fitted.buffer;
    }
  }

  files["SIZES.json"] = `${JSON.stringify(sizeDoc, null, 2)}\n`;
  files["LISTING.txt"] = formatListing(listing, locale);
  files["CHECKLIST.txt"] = `${checklistBlocks(chain, locale).join("\n")}\n`;
  files["VERIFY.txt"] = `${verificationTips(chain, locale)}\n`;
  if (chain === "bitcoin") {
    files["ORDINALS.txt"] = ordinalsNote(uk, name);
    files["inscriptions.json"] = `${JSON.stringify(inscriptionsTemplate(name), null, 2)}\n`;
  }
  if (warnings.length) files["WARNINGS.txt"] = `${warnings.join("\n")}\n`;
  return { chain, files, listing, warnings, sizes: sizeDoc };
}

function ordinalsNote(uk, name) {
  return uk
    ? [
      "Ordinals · parent і child",
      "========================",
      "Документація: https://docs.ordinals.com/inscriptions/provenance.html",
      "",
      `Батьківська інскрипція — колекція «${name}». Кожен предмет — дочірня інскрипція цього батька.`,
      "Спалення батька закриває колекцію: нових дітей додати не можна.",
      "",
      "Lab не збирає транзакцію і не тримає ключ. Інскрипцію робите ви зі свого гаманця, спочатку на signet.",
      "inscriptions.json — шаблон. Порожні id заповніть після інскрипції. Не вигадуйте id.",
      "",
    ].join("\n")
    : [
      "Ordinals · parent and child",
      "===========================",
      "Docs: https://docs.ordinals.com/inscriptions/provenance.html",
      "",
      `The parent inscription is the «${name}» collection. Each item is a child of that parent.`,
      "Burning the parent closes the collection: no new children can be added.",
      "",
      "Lab does not build the transaction and does not hold a key. You inscribe from your own wallet, on signet first.",
      "inscriptions.json is a template. Fill the empty ids after you inscribe. Do not invent ids.",
      "",
    ].join("\n");
}

function inscriptionsTemplate(name) {
  return {
    parent: { inscriptionId: "", name: String(name || "Collection") },
    children: [{ inscriptionId: "", name: "", attributes: [] }],
  };
}

function formatListing(listing, locale) {
  const uk = String(locale || "").toLowerCase().startsWith("uk");
  return [
    uk ? "Текст лістингу" : "Listing copy",
    "============",
    "",
    uk ? `Назва: ${listing.name}` : `Name: ${listing.name}`,
    listing.symbol ? (uk ? `Символ: ${listing.symbol}` : `Symbol: ${listing.symbol}`) : "",
    "",
    uk ? "Опис:" : "Description:",
    listing.description,
    "",
    uk ? "Соцмережі (замініть плейсхолдери):" : "Socials (replace the placeholders):",
    `  twitter: ${listing.socials.twitter}`,
    `  discord: ${listing.socials.discord}`,
    `  website: ${listing.socials.website}`,
    `  telegram: ${listing.socials.telegram}`,
    "",
    listing.note,
    "",
  ].filter((line) => line !== "").join("\n");
}
