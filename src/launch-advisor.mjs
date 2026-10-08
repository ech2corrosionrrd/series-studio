/**
 * Offline launch advisor. No network, no exchange prices, no deploy button.
 * Figures from articles are cited and marked as not measured by Series Lab.
 * Historical mint prices named in the recommendations stay out of the text.
 */

import { buildHolderLicence, HOLDER_MODELS } from "./holder-licence.mjs";

const SOURCES = {
  drops2024: "https://nftevening.com/state-of-2024-nft-drops/",
  sales2025: "https://chainreport.co/more-nfts-less-money-supply-rose-to-134b-as-sales-fell-37-in-2025/",
  creatorHub: "https://help.magiceden.us/en/articles/8115241-why-was-my-listing-rejected-on-magic-eden-common-creator-hub-reasons",
  coreRoyalties: "https://www.metaplex.com/docs/smart-contracts/core/plugins/royalties",
  eip2981: "https://eips.ethereum.org/EIPS/eip-2981",
  irys: "https://docs.irys.xyz/",
  arweave: "https://docs.arweave.org/developers",
  nftStorage: "https://classic.nft.storage/",
};

function chainId(chain) {
  const c = String(chain || "solana").toLowerCase();
  if (c === "evm" || c === "bitcoin") return c;
  return "solana";
}

function link(href, label) {
  return { href, label };
}

function sectionText(section) {
  const lines = [section.lead, ...(section.paragraphs || [])];
  if (section.checks?.length) {
    lines.push(...section.checks.map((item, i) => `${i + 1}. ${item.text}`));
  }
  if (section.links?.length) {
    lines.push(...section.links.map((item) => `${item.label}: ${item.href}`));
  }
  return lines.filter(Boolean).join("\n");
}

function supplySection(uk) {
  const section = uk
    ? {
      id: "supply",
      title: "Тираж і ціна — діапазон, не формула",
      lead: "Діапазон тиражу й ціни обираєте ви: десятки, сотні або тисячі.",
      paragraphs: [
        "Порадник не блокує малий тираж і не називає ціну мінта. Статті нижче описують ринок, а не вашу ціну. Курс SOL, ETH чи BTC з біржі сюди не підставляється.",
        "Цифра зі статті, не вимір Series Lab: 64% дропів 2024 мали менше ніж 10 мінтів.",
        "Цифра зі статті, не вимір Series Lab: продажі NFT у 2025 впали на 37% до 5,63 млрд USD. Це обсяг ринку, не ціна вашого мінта.",
        "НЕПЕРЕВІРЕНО, у ціну не входить: історичні ціни мінта колекцій (Pudgy Penguins, BAYC, Doodles, Mad Lads) і «круглі» тиражі 3333 / 5555 / 6666. Ці числа порадник не підставляє.",
      ],
      links: [
        link(SOURCES.drops2024, "Стаття про дропи 2024 (NFT Evening)"),
        link(SOURCES.sales2025, "Звіт про продажі 2025 (Chain Report)"),
      ],
    }
    : {
      id: "supply",
      title: "Supply and price — a range, not a formula",
      lead: "You choose the supply and the price range: tens, hundreds, or thousands.",
      paragraphs: [
        "The advisor does not block a small supply and does not name a mint price. The articles below describe the market, not your price. No SOL, ETH, or BTC exchange rate is filled in.",
        "Figure from an article, not a Series Lab measurement: 64% of 2024 drops had fewer than 10 mints.",
        "Figure from an article, not a Series Lab measurement: NFT sales in 2025 fell 37% to 5.63 billion USD. That is market volume, not your mint price.",
        "UNVERIFIED, not used as a price: historical mint prices of collections (Pudgy Penguins, BAYC, Doodles, Mad Lads) and round supplies 3333 / 5555 / 6666. The advisor does not insert those numbers.",
      ],
      links: [
        link(SOURCES.drops2024, "2024 drops article (NFT Evening)"),
        link(SOURCES.sales2025, "2025 sales report (Chain Report)"),
      ],
    };
  section.body = sectionText(section);
  return section;
}

function readinessSection(uk) {
  const checks = uk
    ? [
      { id: "readiness.scam", text: "Чи немає ознак шахрайства з утечею коштів (rug pull): обіцянок, яких ви не зможете виконати?" },
      { id: "readiness.community", text: "Чи спільнота справжня, а не боти, порожній або щойно створений акаунт?" },
      { id: "readiness.discord", text: "Чи в Discord не ви один?" },
      { id: "readiness.rights", text: "Чи контент не порушує авторські права і правила майданчика (образливе, чужі роботи)?" },
      { id: "readiness.spam", text: "Чи немає історії спаму або повторного шахрайства?" },
      { id: "readiness.files", text: "Чи картинки, опис і метадані цілі, без битих файлів?" },
    ]
    : [
      { id: "readiness.scam", text: "Is there no sign of fraud where the funds are taken and the team leaves (a rug pull): promises you cannot keep?" },
      { id: "readiness.community", text: "Is the community real, not botted followers, an empty account, or a brand-new account?" },
      { id: "readiness.discord", text: "Are you the only person in the Discord?" },
      { id: "readiness.rights", text: "Does the content respect copyright and the marketplace rules (no offensive or copied work)?" },
      { id: "readiness.spam", text: "Is there no history of spam or repeat fraud?" },
      { id: "readiness.files", text: "Are the images, description, and metadata intact, with no broken files?" },
    ];
  const section = {
    id: "readiness",
    title: uk ? "Готовність до Creator Hub" : "Creator Hub readiness",
    lead: uk
      ? "Це питання з публічної статті, не подача заявки і не гарантія приймання."
      : "These are questions from a public article, not a submission and not a promise of acceptance.",
    paragraphs: [
      uk
        ? "Питання для Solana за причинами відмови Magic Eden Creator Hub (стаття від 29.07.2025)."
        : "Questions for Solana, from the Magic Eden Creator Hub rejection reasons (article of 29 July 2025).",
    ],
    checks,
    links: [
      link(
        SOURCES.creatorHub,
        uk ? "Причини відмови Creator Hub (Magic Eden)" : "Creator Hub rejection reasons (Magic Eden)",
      ),
    ],
  };
  section.body = sectionText(section);
  return section;
}

function royaltySection(chain, uk) {
  const copy = uk
    ? {
      solana: {
        lead: "На Solana роялті примусові лише для програм, які ви самі вказали.",
        paragraphs: [
          "Правило списку програм (ProgramAllowList) у Core змушує роялті лише для цього списку. Без правила роялті дорадчі — майданчик може їх не сплатити. Чужий гаманець порадник не підставляє.",
        ],
        links: [link(SOURCES.coreRoyalties, "Документація роялті Core")],
      },
      evm: {
        lead: "На EVM стандарт лише повідомляє розмір роялті.",
        paragraphs: ["ERC-2981 не змушує OpenSea його сплатити."],
        links: [link(SOURCES.eip2981, "Текст стандарту ERC-2981")],
      },
      bitcoin: {
        lead: "Протокол Ordinals не змушує майданчик сплатити роялті.",
        paragraphs: ["Перевірте правила конкретного майданчика перед друком умов."],
        links: [],
      },
    }
    : {
      solana: {
        lead: "On Solana, royalties are enforced only for programs you list yourself.",
        paragraphs: [
          "A program list rule (ProgramAllowList) in Core enforces royalties only for that list. With no rule, royalties are advisory and a marketplace may skip them. The advisor does not insert someone else's wallet.",
        ],
        links: [link(SOURCES.coreRoyalties, "Core royalties documentation")],
      },
      evm: {
        lead: "On EVM the standard only announces a royalty amount.",
        paragraphs: ["ERC-2981 does not force OpenSea to pay it."],
        links: [link(SOURCES.eip2981, "ERC-2981 standard text")],
      },
      bitcoin: {
        lead: "The Ordinals protocol does not force a marketplace to pay a royalty.",
        paragraphs: ["Check that marketplace's rules before you print terms."],
        links: [],
      },
    };
  const picked = copy[chain];
  const section = {
    id: "royalties",
    title: uk ? "Роялті — що реально виконується" : "Royalties — what is actually enforced",
    ...picked,
  };
  section.body = sectionText(section);
  return section;
}

function storageSection(chain, uk) {
  const copy = {
    solana: uk
      ? {
        title: "Сховище — типово Arweave через Irys",
        lead: "Типове сховище набору для Solana — Arweave через Irys, не IPFS.",
        paragraphs: [
          "Рекомендований префікс посилання — ar://. Завантаження: `series upload <тека> --keypair <файл>` (ключ лишається на вашому ПК, перервану загрузку можна продовжити) або кнопка в Експорті.",
          "Попередження про постійність: Arweave задуманий так, щоб дані лишались після однієї оплати. Це властивість мережі, не обіцянка Lab. Шлюз може бути повільним, а Irys — лише шлях завантаження, не окреме сховище.",
          "Якщо лишаєте IPFS, пін має тривати постійно: без піна файл зникає з мережі. NFT.Storage (Classic) з 30.06.2024 нові завантаження не приймає.",
        ],
        links: [
          link(SOURCES.irys, "Документація Irys"),
          link(SOURCES.arweave, "Документація Arweave"),
          link(SOURCES.nftStorage, "Архів NFT.Storage (Classic)"),
        ],
      }
      : {
        title: "Storage — Arweave via Irys by default",
        lead: "The default store for a Solana kit is Arweave via Irys, not IPFS.",
        paragraphs: [
          "The recommended link prefix is ar://. Upload with `series upload <folder> --keypair <file>` (the key stays on your computer, an interrupted upload resumes) or with the Export button.",
          "Permanence warning: Arweave is designed so data remains after a single payment. That is a property of the network, not a promise from Lab. A gateway can be slow, and Irys is only an upload path, not a separate store.",
          "If you keep IPFS, the pin has to stay up: without a pin the file leaves the network. NFT.Storage (Classic) has not accepted new uploads since 30 June 2024.",
        ],
        links: [
          link(SOURCES.irys, "Irys documentation"),
          link(SOURCES.arweave, "Arweave documentation"),
          link(SOURCES.nftStorage, "NFT.Storage archive (Classic)"),
        ],
      },
    evm: uk
      ? {
        title: "Сховище — IPFS або https",
        lead: "Для EVM картинки й метадані зазвичай лежать в IPFS (ipfs://) або на вашому https-хості.",
        paragraphs: [
          "Пін має тривати постійно: без піна файл зникає з мережі. Оберіть сервіс піна самі; Series Lab на IPFS нічого не завантажує.",
          "Префікс вкажіть у полі «Префікс URI зображень» в Експорті; порожньо = локальні імена 1.png.",
        ],
        links: [link(SOURCES.nftStorage, "Архів NFT.Storage (Classic)")],
      }
      : {
        title: "Storage — IPFS or https",
        lead: "On EVM the images and metadata usually live on IPFS (ipfs://) or on your own https host.",
        paragraphs: [
          "The pin has to stay up: without a pin the file leaves the network. Pick the pinning service yourself; Series Lab does not upload to IPFS.",
          "Put the prefix into the image URI prefix field in Export; empty = local names 1.png.",
        ],
        links: [link(SOURCES.nftStorage, "NFT.Storage archive (Classic)")],
      },
    bitcoin: uk
      ? {
        title: "Сховище — файли в самій інскрипції",
        lead: "Для Ordinals файли записуються в Bitcoin під час інскрипції, зовнішнє сховище не потрібне.",
        paragraphs: ["Префікс посилань на файли тут не потрібен. Розмір файлів визначає вартість інскрипції: стискайте картинки."],
        links: [],
      }
      : {
        title: "Storage — files inside the inscription",
        lead: "For Ordinals the files are written to Bitcoin at inscription, so no external storage is needed.",
        paragraphs: ["No file-link prefix is needed here. File size sets the inscription cost: keep images small."],
        links: [],
      },
  }[chain];
  const section = { id: "storage", ...copy };
  section.body = sectionText(section);
  return section;
}

function holderTemplate(uk) {
  if (uk) {
    return [
      "Заява для власників (чернетка, не юридичний висновок)",
      "Заповніть пропуски. Вимкніть цей файл у наборі, якщо не хочете його публікувати.",
      "Series Lab цей текст не підписує і не вирішує, чи є майстерня провайдером.",
      "",
      "Колекція: __________",
      "Що власник предмета може робити: __________",
      "Комерційне використання предмета: так / ні / __________",
      "Позначка синтетичного виводу (де її вимагає закон): __________",
      "Людський відбір і правки записані в маніфесті: так / ні",
      "Обмеження: __________",
    ].join("\n");
  }
  return [
    "Holder statement (draft, not a legal opinion)",
    "Fill in the blanks. Leave this file out of the kit if you do not want to publish it.",
    "Series Lab does not sign this text and does not decide whether the studio is a provider.",
    "",
    "Collection: __________",
    "What the holder of an item may do: __________",
    "Commercial use of the item: yes / no / __________",
    "Synthetic-output mark (where the law requires one): __________",
    "Human review and edits are recorded in the manifest: yes / no",
    "Limits: __________",
  ].join("\n");
}

export function buildLaunchAdvisor({ chain = "solana", locale = "uk", licence = "statement", name = "", creator = "", cap = "" } = {}) {
  const uk = String(locale || "").toLowerCase().startsWith("uk");
  const id = chainId(chain);
  const sections = [
    supplySection(uk),
    ...(id === "solana" ? [readinessSection(uk)] : []),
    royaltySection(id, uk),
    storageSection(id, uk),
  ];
  const template = buildHolderLicence({ model: licence, locale, name, creator, cap }) || holderTemplate(uk);
  const text = [
    uk ? "Порадник запуску (офлайн)" : "Launch advisor (offline)",
    uk
      ? "Мережі не викликає. Біржових цін немає. Кнопки деплою немає: транзакцію підписуєте ви зі свого гаманця."
      : "Does not call the network. No exchange prices. No deploy button: you sign the transaction from your own wallet.",
    "",
    ...sections.flatMap((s) => [s.title, s.body, ""]),
  ].join("\n");
  return {
    chain: id,
    locale: uk ? "uk" : "en",
    offline: true,
    exchangePrices: false,
    sections,
    holderTemplate: template,
    licenceModels: HOLDER_MODELS,
    text,
    sources: SOURCES,
  };
}
