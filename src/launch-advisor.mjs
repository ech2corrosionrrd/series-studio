/**
 * Offline launch advisor. No network, no exchange prices, no deploy button.
 * Figures from articles are cited and marked as not measured by Series Lab.
 * Historical mint prices named in the recommendations stay out of the text.
 */

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

function supplySection(uk) {
  if (uk) {
    return {
      id: "supply",
      title: "Тираж і ціна — діапазон, не формула",
      body: [
        "Порадник не блокує малий тираж і не називає ціну мінта. Діапазон тиражу — ваш: десятки, сотні або тисячі. Статті нижче описують ринок, а не вашу ціну. Курс SOL, ETH чи BTC з біржі сюди не підставляється.",
        "Цифра зі статті, не вимір Series Lab: 64% дропів 2024 мали менше ніж 10 мінтів. Джерело: NFT Evening, State of 2024 NFT Drops.",
        SOURCES.drops2024,
        "Цифра зі статті, не вимір Series Lab: продажі NFT у 2025 впали на 37% до 5,63 млрд USD. Це обсяг ринку, не ціна вашого мінта. Джерело: Chain Report.",
        SOURCES.sales2025,
        "UNVERIFIED, у ціну не входить: історичні ціни мінта Pudgy Penguins, BAYC, Doodles і Mad Lads, а також «круглі» тиражі 3333 / 5555 / 6666. Ці числа порадник не підставляє.",
      ].join("\n"),
    };
  }
  return {
    id: "supply",
    title: "Supply and price — a range, not a formula",
    body: [
      "The advisor does not block a small supply and does not name a mint price. The supply range is yours: tens, hundreds, or thousands. The articles below describe the market, not your price. No SOL, ETH, or BTC exchange rate is filled in.",
      "Figure from an article, not a Series Lab measurement: 64% of 2024 drops had fewer than 10 mints. Source: NFT Evening, State of 2024 NFT Drops.",
      SOURCES.drops2024,
      "Figure from an article, not a Series Lab measurement: NFT sales in 2025 fell 37% to 5.63 billion USD. That is market volume, not your mint price. Source: Chain Report.",
      SOURCES.sales2025,
      "UNVERIFIED, not used as a price: historical mint prices of Pudgy Penguins, BAYC, Doodles, and Mad Lads, and round supplies 3333 / 5555 / 6666. The advisor does not insert those numbers.",
    ].join("\n"),
  };
}

function readinessSection(uk) {
  const questions = uk
    ? [
      "1. Чи немає ознак шахрайства або rug: обіцянок, яких ви не зможете виконати?",
      "2. Чи спільнота справжня, а не боти, порожній або щойно створений акаунт?",
      "3. Чи в Discord не ви один?",
      "4. Чи контент не порушує авторські права і правила майданчика (образливе, чужі роботи)?",
      "5. Чи немає історії спаму або повторного шахрайства?",
      "6. Чи картинки, опис і метадані цілі, без битих файлів?",
    ]
    : [
      "1. Is there no sign of a scam or rug: promises you cannot keep?",
      "2. Is the community real, not botted followers, an empty account, or a brand-new account?",
      "3. Are you the only person in the Discord?",
      "4. Does the content respect copyright and the marketplace rules (no offensive or copied work)?",
      "5. Is there no history of spam or repeat fraud?",
      "6. Are the images, description, and metadata intact, with no broken files?",
    ];
  const intro = uk
    ? "Питання для Solana за публічними причинами відмови Magic Eden Creator Hub (стаття від 29.07.2025). Це не подача заявки з Lab і не гарантія приймання."
    : "Questions for Solana, from the public Magic Eden Creator Hub rejection reasons (article of 29 July 2025). Lab does not submit the application and does not promise acceptance.";
  return {
    id: "readiness",
    title: uk ? "Готовність до Creator Hub" : "Creator Hub readiness",
    body: [intro, ...questions, SOURCES.creatorHub].join("\n"),
  };
}

function royaltySection(chain, uk) {
  const common = uk
    ? {
      solana: [
        "Solana, Core: правило ProgramAllowList змушує роялті лише для програм, які ви самі вписали. Без правила роялті дорадчі — майданчик може їх не сплатити. Список програм заповнюєте ви; чужий гаманець порадник не підставляє.",
        SOURCES.coreRoyalties,
      ],
      evm: [
        "EVM: ERC-2981 повідомляє розмір роялті. Стандарт не змушує OpenSea його сплатити.",
        SOURCES.eip2981,
      ],
      bitcoin: [
        "Bitcoin Ordinals: протокол не змушує майданчик сплатити роялті творцю. Перевірте правила конкретного майданчика перед друком умов.",
      ],
    }
    : {
      solana: [
        "Solana, Core: a ProgramAllowList rule enforces royalties only for programs you list yourself. With no rule, royalties are advisory and a marketplace may skip them. You fill in the program list; the advisor does not insert someone else's wallet.",
        SOURCES.coreRoyalties,
      ],
      evm: [
        "EVM: ERC-2981 announces a royalty amount. The standard does not force OpenSea to pay it.",
        SOURCES.eip2981,
      ],
      bitcoin: [
        "Bitcoin Ordinals: the protocol does not force a marketplace to pay the creator a royalty. Check that marketplace's rules before you print terms.",
      ],
    };
  return {
    id: "royalties",
    title: uk ? "Роялті — що реально виконується" : "Royalties — what is actually enforced",
    body: common[chain].join("\n"),
  };
}

function storageSection(uk) {
  const body = uk
    ? [
      "Типове сховище для набору — Arweave через Irys, не IPFS. Для Solana це рекомендований префікс посилання (ar://). Series Lab файл туди не відправляє і не оплачує.",
      "Попередження про постійність: Arweave задуманий так, щоб дані лишались після однієї оплати. Це властивість мережі, не обіцянка Lab. Шлюз може відповідати повільно, а Irys — лише шлях завантаження, не сховище Lab.",
      "Якщо лишаєте IPFS, пін має тривати постійно: без піна файл зникає з мережі. NFT.Storage Classic з 30.06.2024 нові завантаження не приймає.",
      SOURCES.irys,
      SOURCES.arweave,
      SOURCES.nftStorage,
    ]
    : [
      "The default store for the kit is Arweave via Irys, not IPFS. For Solana that is the recommended link prefix (ar://). Series Lab does not upload the file and does not pay for it.",
      "Permanence warning: Arweave is designed so data remains after a single payment. That is a property of the network, not a promise from Lab. A gateway can be slow, and Irys is only an upload path, not storage run by Lab.",
      "If you keep IPFS, the pin has to stay up: without a pin the file leaves the network. NFT.Storage Classic has not accepted new uploads since 30 June 2024.",
      SOURCES.irys,
      SOURCES.arweave,
      SOURCES.nftStorage,
    ];
  return {
    id: "storage",
    title: uk ? "Сховище — типово Arweave через Irys" : "Storage — Arweave via Irys by default",
    body: body.join("\n"),
  };
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

export function buildLaunchAdvisor({ chain = "solana", locale = "uk" } = {}) {
  const uk = String(locale || "").toLowerCase().startsWith("uk");
  const id = chainId(chain);
  const sections = [
    supplySection(uk),
    readinessSection(uk),
    royaltySection(id, uk),
    storageSection(uk),
  ];
  const template = holderTemplate(uk);
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
    text,
    sources: SOURCES,
  };
}
