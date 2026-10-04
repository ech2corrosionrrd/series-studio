/**
 * Deploy kit: configs and CLI steps the creator runs locally.
 * Series Lab never receives a private key and never sends the deploy transaction.
 *
 * Cost figures are formulas over owner-set constants. They are not live gas quotes.
 */
import { buildSugarConfig, buildThirdwebConfig } from "./deploy.mjs";
import { assertNoSecrets } from "./secrets.mjs";
import { formatForLaunchpad, exportManifestCsv } from "./launchpads.mjs";
import { buildLaunchAdvisor } from "./launch-advisor.mjs";
import { normalizeAllowlist } from "./allowlist.mjs";
import { placeholderMetadata, placeholderPng } from "./reveal.mjs";
import { extname } from "node:path";
import { hasGenesis } from "./genesis.mjs";

export const DEPLOY_COST_DEFAULTS = {
  solana: {
    baseLamports: 20_000_000,
    perItemLamports: 15_000,
  },
  evm: {
    gasUnits: 2_500_000,
  },
  bitcoin: {
    overheadBytes: 400,
  },
};

export function chainForProfile(profile, format) {
  const p = String(profile || "");
  const f = String(format || "");
  if (p === "ordinalsbot" || p === "ordinals" || f === "ordinals") return "bitcoin";
  if (p === "magiceden" || p === "launchmynft" || f === "metaplex") return "solana";
  return "evm";
}

export function normalizeChain(chain, profile, format) {
  const c = String(chain || "").toLowerCase();
  if (c === "solana" || c === "sol" || c === "solana-legacy" || c === "sugar") return "solana";
  if (c === "bitcoin" || c === "btc" || c === "ordinals") return "bitcoin";
  if (c === "evm" || c === "ethereum" || c === "eth") return "evm";
  return chainForProfile(profile, format);
}

/** Missing chain is Solana Core. Sugar is only the explicit legacy choice. */
export function deployChainChoice(chain, legacyFlag = false) {
  const raw = String(chain || "solana").trim().toLowerCase();
  const sugar = raw === "solana-legacy" || raw === "sugar";
  const normalized = normalizeChain(sugar ? "solana" : raw);
  return { chain: normalized, legacy: normalized === "solana" && (sugar || legacyFlag === true) };
}

function envInt(env, name) {
  if (env?.[name] == null || String(env[name]).trim() === "") return null;
  const n = Number.parseInt(env[name], 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function envNum(env, name) {
  if (env?.[name] == null || String(env[name]).trim() === "") return null;
  const n = Number(env[name]);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Approximate network cost. USD is filled only when the owner set a rate.
 * @param {{ chain: string, count?: number, totalBytes?: number }} input
 * @param {object} [env]
 */
export function estimateDeployCost(input = {}, env = process.env) {
  const chain = normalizeChain(input.chain, input.profile, input.format);
  const count = Math.max(0, Number(input.count) || 0);
  const totalBytes = Math.max(0, Number(input.totalBytes) || 0);
  const assumptions = [];

  if (chain === "solana") {
    const base = envInt(env, "DEPLOY_SOL_BASE_LAMPORTS") ?? DEPLOY_COST_DEFAULTS.solana.baseLamports;
    const per = envInt(env, "DEPLOY_SOL_PER_ITEM_LAMPORTS") ?? DEPLOY_COST_DEFAULTS.solana.perItemLamports;
    const lamports = base + count * per;
    const sol = lamports / 1e9;
    const solUsd = envNum(env, "DEPLOY_SOL_USD");
    assumptions.push(
      "ESTIMATE, not an RPC quote.",
      "lamports = DEPLOY_SOL_BASE_LAMPORTS + count × DEPLOY_SOL_PER_ITEM_LAMPORTS",
      `DEPLOY_SOL_BASE_LAMPORTS=${base} (default ${DEPLOY_COST_DEFAULTS.solana.baseLamports} = 0.02 SOL: collection asset + Core Candy Machine account, a rent-shaped assumption)`,
      `DEPLOY_SOL_PER_ITEM_LAMPORTS=${per} (default ${DEPLOY_COST_DEFAULTS.solana.perItemLamports}: config-line storage per item)`,
      solUsd == null
        ? "DEPLOY_SOL_USD is unset, so USD is omitted on purpose (no fabricated SOL price)."
        : `DEPLOY_SOL_USD=${solUsd} (owner-set rate)`,
      "Upload bandwidth and priority fees are not included.",
      "You pay this from your wallet when you run the commands in DEPLOY.txt. Series Lab does not hold the key or send the transaction.",
    );
    return {
      chain,
      label: "estimate",
      count,
      formula: "lamports = base + count × perItem; SOL = lamports / 1e9; USD = SOL × DEPLOY_SOL_USD if set",
      lamports,
      sol: Math.round(sol * 1e6) / 1e6,
      usd: solUsd == null ? null : Math.round(sol * solUsd * 100) / 100,
      assumptions,
    };
  }

  if (chain === "bitcoin") {
    const overhead = envInt(env, "DEPLOY_ORDINALS_OVERHEAD_BYTES") ?? DEPLOY_COST_DEFAULTS.bitcoin.overheadBytes;
    const satsPerVByte = envInt(env, "DEPLOY_ORDINALS_SATS_PER_VBYTE");
    const bytes = totalBytes + count * overhead;
    const sats = satsPerVByte == null ? null : bytes * satsPerVByte;
    const btc = sats == null ? null : sats / 1e8;
    const btcUsd = envNum(env, "DEPLOY_BTC_USD");
    assumptions.push(
      "ESTIMATE, not a mempool quote.",
      "bytes = imageBytes + count × DEPLOY_ORDINALS_OVERHEAD_BYTES",
      "feeSats = bytes × DEPLOY_ORDINALS_SATS_PER_VBYTE",
      `DEPLOY_ORDINALS_OVERHEAD_BYTES=${overhead} (default ${DEPLOY_COST_DEFAULTS.bitcoin.overheadBytes}: envelope + metadata, an assumption)`,
      `imageBytes=${totalBytes}`,
      satsPerVByte == null
        ? "DEPLOY_ORDINALS_SATS_PER_VBYTE is unset, so the fee in sats is omitted (no fabricated fee rate)."
        : `DEPLOY_ORDINALS_SATS_PER_VBYTE=${satsPerVByte} (owner-set)`,
      btcUsd == null
        ? "DEPLOY_BTC_USD is unset, so USD is omitted."
        : `DEPLOY_BTC_USD=${btcUsd} (owner-set rate)`,
      "You pay miner fees from your Bitcoin wallet.",
    );
    return {
      chain,
      label: "estimate",
      count,
      formula: "feeSats = (imageBytes + count × overheadBytes) × satsPerVByte; BTC = sats / 1e8",
      bytes,
      satsPerVByte,
      sats,
      btc,
      usd: btc != null && btcUsd != null ? Math.round(btc * btcUsd * 100) / 100 : null,
      assumptions,
    };
  }

  const gasUnits = envInt(env, "DEPLOY_EVM_GAS_UNITS") ?? DEPLOY_COST_DEFAULTS.evm.gasUnits;
  const gwei = envNum(env, "DEPLOY_EVM_GAS_GWEI");
  const eth = gwei == null ? null : (gasUnits * gwei) / 1e9;
  const ethUsd = envNum(env, "DEPLOY_ETH_USD");
  assumptions.push(
    "ESTIMATE, not an eth_gasPrice call.",
    "ETH = DEPLOY_EVM_GAS_UNITS × DEPLOY_EVM_GAS_GWEI × 1e-9",
    `DEPLOY_EVM_GAS_UNITS=${gasUnits} (default ${DEPLOY_COST_DEFAULTS.evm.gasUnits}: one drop-contract deploy, an assumption, not a measured trace)`,
    gwei == null
      ? "DEPLOY_EVM_GAS_GWEI is unset, so ETH and USD are omitted (no fabricated gas price)."
      : `DEPLOY_EVM_GAS_GWEI=${gwei} (owner-set)`,
    ethUsd == null
      ? "DEPLOY_ETH_USD is unset, so USD is omitted."
      : `DEPLOY_ETH_USD=${ethUsd} (owner-set rate)`,
    "Item count does not change this deploy figure; mint gas later is separate and also yours to pay.",
    "You sign the deploy in your wallet (Thirdweb / your CLI). Series Lab does not.",
  );
  return {
    chain: "evm",
    label: "estimate",
    count,
    formula: "ETH = gasUnits × gwei × 1e-9; USD = ETH × DEPLOY_ETH_USD if both are set",
    gasUnits,
    gwei,
    eth,
    usd: eth != null && ethUsd != null ? Math.round(eth * ethUsd * 100) / 100 : null,
    assumptions,
  };
}

export function formatCostEstimate(estimate, locale = "en") {
  const uk = String(locale || "").toLowerCase().startsWith("uk");
  const lines = [
    uk ? "ОЦІНКА вартості деплою (не жива ціна мережі)" : "DEPLOY COST ESTIMATE (not a live network price)",
    "============================================================",
    uk ? `Мережа: ${estimate.chain}` : `Chain: ${estimate.chain}`,
    uk ? `Формула: ${estimate.formula}` : `Formula: ${estimate.formula}`,
    "",
  ];
  if (estimate.chain === "solana") {
    lines.push(`lamports = ${estimate.lamports}`);
    lines.push(`SOL ≈ ${estimate.sol}`);
  } else if (estimate.chain === "bitcoin") {
    lines.push(`bytes ≈ ${estimate.bytes}`);
    lines.push(estimate.sats == null ? (uk ? "sats: не пораховано (немає ставки)" : "sats: not computed (rate unset)") : `sats ≈ ${estimate.sats}`);
  } else {
    lines.push(`gas units = ${estimate.gasUnits}`);
    lines.push(estimate.eth == null ? (uk ? "ETH: не пораховано (немає gwei)" : "ETH: not computed (gwei unset)") : `ETH ≈ ${estimate.eth}`);
  }
  lines.push(estimate.usd == null
    ? (uk ? "USD: не показано — курс не задано в конфігурації" : "USD: omitted — no rate in config")
    : `USD ≈ ${estimate.usd}`);
  lines.push("");
  lines.push(uk ? "Припущення (їх змінює власник у .env):" : "Assumptions (the owner changes these in .env):");
  for (const a of estimate.assumptions || []) lines.push(`  - ${a}`);
  return lines.join("\n");
}

function traitItemsOf(preset) {
  if (Array.isArray(preset?.traits?.items)) return preset.traits.items;
  if (Array.isArray(preset?.traits)) return preset.traits;
  return [];
}

function profileForChain(chain) {
  if (chain === "solana") return "magiceden";
  if (chain === "bitcoin") return "ordinalsbot";
  return "opensea";
}

/**
 * Build the deploy package in memory.
 * @returns {{ chain: string, files: Record<string, string|Buffer>, estimate: object, guide: string }}
 */
export function buildDeployKit({
  archive = {},
  preset = {},
  items = [],
  opts = {},
  locale = "en",
  env = process.env,
} = {}) {
  assertNoSecrets(opts);
  const chain = normalizeChain(opts.chain, opts.profile, opts.format);
  const profile = profileForChain(chain);
  const uk = String(locale || "").toLowerCase().startsWith("uk");
  const traitItems = traitItemsOf(preset);
  const sorted = [...items].sort((a, b) => Number(a.edition) - Number(b.edition));
  const count = sorted.length;
  const totalBytes = sorted.reduce((s, it) => s + (it.buffer?.length || 0), 0);
  const name = String(opts.name || preset?.name || archive?.presetId || "Series").replace(/\s+#$/, "");
  const description = opts.description || preset?.description || "";
  const symbol = String(opts.symbol || preset?.symbol || "LAB");
  const fee = Number(opts.sellerFeeBasisPoints ?? 500);
  const creator = String(opts.creatorAddress || "").trim();
  const kitOpts = {
    ...opts,
    profile,
    symbol,
    sellerFeeBasisPoints: fee,
    description,
    creatorAddress: creator,
    namePrefix: opts.namePrefix || `${name} #`,
    locale,
  };

  const files = {};
  const zeroBased = chain === "solana";
  // Genesis series: edition numbers are final (base = 0, edition k = k), so the usual
  // "edition-1" shift of 0-based exports must not be applied on top of the file index.
  const genesis = hasGenesis(sorted);
  sorted.forEach((item, index) => {
    const display = zeroBased ? index : Number(item.edition);
    const ext = (item.ext || "png").replace(/^\./, "");
    const recipe = item.recipe || { edition: item.edition, traits: item.traits || {} };
    const meta = formatForLaunchpad(recipe, profile, { ...kitOpts, zeroIndexed: zeroBased, genesis }, traitItems);
    if (chain === "solana") {
      files[`assets/${display}.${ext}`] = item.buffer;
      files[`assets/${display}.json`] = `${JSON.stringify(meta, null, 2)}\n`;
    } else {
      files[`images/${display}.${ext}`] = item.buffer;
      files[`metadata/${display}.json`] = `${JSON.stringify(meta, null, 2)}\n`;
    }
  });

  if (chain === "solana") {
    const cover = sorted[0];
    const coverExt = (cover?.ext || "png").replace(/^\./, "");
    if (cover?.buffer) files[`assets/collection.${coverExt}`] = cover.buffer;
    const collectionMeta = {
      name,
      symbol,
      description,
      image: `collection.${coverExt}`,
      seller_fee_basis_points: fee,
      attributes: [],
      properties: {
        files: [{ uri: `collection.${coverExt}`, type: coverExt === "png" ? "image/png" : `image/${coverExt}` }],
        category: "image",
        creators: creator ? [{ address: creator, share: 100 }] : [],
      },
    };
    files["assets/collection.json"] = `${JSON.stringify(collectionMeta, null, 2)}\n`;
    const hiddenName = "Hidden #";
    files["hidden.json"] = `${JSON.stringify(placeholderMetadata({ name: hiddenName, symbol, description }), null, 2)}\n`;
    files["hidden.png"] = placeholderPng();
    files["hidden-settings.json"] = `${JSON.stringify(hiddenSettingsDraft(hiddenName), null, 2)}\n`;
    files["HIDDEN.txt"] = hiddenSettingsNote(uk);
    const sugar = buildSugarConfig(
      { ...archive, size: count, recipes: sorted.map((s) => s.recipe).filter(Boolean) },
      preset,
      { ...kitOpts, zeroIndexed: false, price: opts.price ?? 0 },
    );
    sugar.number = count;
    sugar.isSequential = true;
    const sugarJson = `${JSON.stringify(sugar, null, 2)}\n`;
    const legacy = Boolean(opts.legacy);
    if (legacy) {
      files["config.json"] = sugarJson;
      files["assets/README.txt"] = sugarLayoutReadme(uk, true);
    } else {
      files["cm-config.json"] = `${JSON.stringify(coreCandyConfig({ name, symbol, description, fee, count, creator }), null, 2)}\n`;
      files["ROYALTIES.txt"] = royaltiesNote(uk);
      files["assets/README.txt"] = coreLayoutReadme(uk);
      files["sugar/config.json"] = sugarJson;
      files["sugar/LEGACY.txt"] = sugarLegacyNote(uk);
    }
  } else if (chain === "evm") {
    const tw = buildThirdwebConfig(
      { ...archive, size: count },
      preset,
      { ...kitOpts, namePrefix: name },
    );
    files["thirdweb.json"] = `${JSON.stringify(tw, null, 2)}\n`;
  } else {
    const recipes = sorted.map((s) => s.recipe || { edition: s.edition, traits: {} });
    files["manifest.csv"] = exportManifestCsv(recipes, traitItems, { ...kitOpts, genesis });
  }

  let allowlist = null;
  if (chain === "solana" && String(opts.allowlist || "").trim()) {
    try {
      allowlist = normalizeAllowlist(opts.allowlist);
    } catch (e) {
      e.status = e.status || 400;
      throw e;
    }
  }
  if (allowlist) {
    files["allowlist.json"] = `${JSON.stringify({
      label: allowlist.label,
      algorithm: allowlist.algorithm,
      merkleRoot: allowlist.merkleRoot,
      merkleRootBase58: allowlist.merkleRootBase58,
      wallets: allowlist.proofs,
    }, null, 2)}\n`;
  }

  const estimate = estimateDeployCost({ chain, count, totalBytes, profile }, env);
  files["ESTIMATE.txt"] = `${formatCostEstimate(estimate, locale)}\n`;
  let guide = buildDeployGuide({ chain, locale, count, name, symbol, creator, estimate, legacy: Boolean(opts.legacy) });
  if (allowlist) {
    guide += uk
      ? `\nAllowlist: група "${allowlist.label}", merkle root (hex, поле allowList.merkleRoot для mplx):\n${allowlist.merkleRoot}\nГаманці і докази: allowlist.json. Повний guard з оплатою: series guards release.json (ті самі гаманці в release.json → allowlist).\n`
      : `\nAllowlist: group "${allowlist.label}", merkle root (hex, the mplx allowList.merkleRoot field):\n${allowlist.merkleRoot}\nWallets and proofs: allowlist.json. The full guard, including payment: series guards release.json (the same wallets in release.json → allowlist).\n`;
  }
  files["DEPLOY.txt"] = guide;
  const advisor = buildLaunchAdvisor({ chain, locale });
  files["ADVISOR.txt"] = `${advisor.text}\n`;
  if (opts.includeHolderLicence !== false) {
    const custom = typeof opts.holderLicence === "string" ? opts.holderLicence.trim() : "";
    files["HOLDER-LICENCE.txt"] = `${custom || advisor.holderTemplate}\n`;
  }
  return { chain, files, estimate, guide, count, advisor };
}

function hiddenSettingsDraft(name = "Hidden #") {
  return {
    name,
    uri: "",
    hash: null,
  };
}

function hiddenSettingsNote(uk) {
  return uk
    ? [
      "Приховане розкриття Core Candy Machine",
      "======================================",
      "hidden.json і hidden.png — метадані, які бачить покупець до розкриття.",
      "hash у hidden-settings.json ще порожній: посилання на метадані з'являються після завантаження.",
      "",
      "1. series upload <ця тека> --keypair <ваш.json>",
      "2. Завантажте hidden.json (і hidden.png) тим самим шляхом і візьміть посилання на JSON.",
      "3. series hidden <ця тека> --uri <посилання на hidden.json>",
      "   Команда читає cache.json і пише SHA-256 від JSON.stringify([{name,uri}, ...]) —",
      "   той самий хеш, що в гайді Core Candy Machine hidden settings.",
      "4. series mint release.json --keypair <гаманець-мінтера.json>",
      "   Підписує мінт Core на цьому ПК. Для групи wl спочатку йде route з доказом allowlist, потім mintV1.",
      "   Адреса асета і індекс (itemsRedeemed) пишуться в mints.json. Ключ на сервер не йде.",
      "5. series reveal <ця тека> --keypair <ключ оновлення колекції.json>",
      "   Підписує ім'я й URI кожного асета з mints.json (UpdateV1). Індекс — порядок мінту 0, 1, 2, …",
      "   Без --keypair команда лише пише reveal-updates.json і не підписує.",
      "",
      "EVM: пароль delayed reveal вводите в кабінеті thirdweb. У цей файл його не кладуть.",
      "https://www.metaplex.com/docs/smart-contracts/core-candy-machine/guides/create-a-core-candy-machine-with-hidden-settings",
      "",
    ].join("\n")
    : [
      "Core Candy Machine hidden reveal",
      "================================",
      "hidden.json and hidden.png are what a buyer sees before the reveal.",
      "hash in hidden-settings.json is still empty: metadata links exist only after upload.",
      "",
      "1. series upload <this folder> --keypair <yours.json>",
      "2. Upload hidden.json (and hidden.png) the same way and copy the JSON link.",
      "3. series hidden <this folder> --uri <link of hidden.json>",
      "   The command reads cache.json and writes the SHA-256 of JSON.stringify([{name,uri}, ...]) —",
      "   the hash from the Core Candy Machine hidden-settings guide.",
      "4. series mint release.json --keypair <minter.json>",
      "   Signs the Core mint on this PC. An allowlist group sends route (the proof) and then mintV1.",
      "   The asset address and index (itemsRedeemed) are written to mints.json. The key is not sent to a server.",
      "5. series reveal <this folder> --keypair <collection-update-authority.json>",
      "   Signs the name and URI of each asset in mints.json (UpdateV1). The index is the mint order 0, 1, 2, …",
      "   Without --keypair the command only writes reveal-updates.json and does not sign.",
      "",
      "EVM: enter the delayed-reveal password in the thirdweb dashboard. It does not go in this file.",
      "https://www.metaplex.com/docs/smart-contracts/core-candy-machine/guides/create-a-core-candy-machine-with-hidden-settings",
      "",
    ].join("\n");
}

function coreCandyConfig({ name, symbol, description, fee, count, creator }) {
  return {
    name,
    symbol,
    description,
    sellerFeeBasisPoints: fee,
    itemsAvailable: count,
    isMutable: true,
    creators: creator ? [{ address: creator, percentage: 100 }] : [],
  };
}

function coreLayoutReadme(uk) {
  return uk
    ? [
      "Розклад Core Candy Machine",
      "===========================",
      "assets/0.png + assets/0.json … — предмети з нуля, у порядку видань.",
      "assets/collection.png + assets/collection.json — обкладинка колекції.",
      "cm-config.json — поля для майстра `mplx cm create --wizard` (назва, символ, роялті, творець).",
      "Гварди: series guards пише allowList (група wl) разом з оплатою. Див. DEPLOY.txt.",
      "Роялті Core — у ROYALTIES.txt. Список програм заповнюєте ви.",
      "Не кладіть сюди ключ гаманця.",
      "",
    ].join("\n")
    : [
      "Core Candy Machine layout",
      "=========================",
      "assets/0.png + assets/0.json … — items from zero, in edition order.",
      "assets/collection.png + assets/collection.json — collection cover.",
      "cm-config.json — fields for the `mplx cm create --wizard` (name, symbol, royalty, creator).",
      "Guards: series guards writes allowList (group wl) next to the payment rule. See DEPLOY.txt.",
      "Core royalties are explained in ROYALTIES.txt. You fill the program list.",
      "Do not put a wallet key in this folder.",
      "",
    ].join("\n");
}

function sugarLayoutReadme(uk, legacy) {
  const banner = legacy
    ? (uk
      ? "ЗАСТАРІЛИЙ: legacy Candy Machine, не для нової колекції.\n"
      : "LEGACY: legacy Candy Machine, not for a new collection.\n")
    : "";
  const body = uk
    ? [
      "Розклад Sugar",
      "=============",
      "assets/0.png + assets/0.json … — предмети з нуля, у порядку видань.",
      "assets/collection.png + assets/collection.json — обкладинка колекції.",
      "config.json у корені — конфіг Sugar CLI.",
      "Не кладіть сюди ключ гаманця.",
      "",
    ].join("\n")
    : [
      "Sugar layout",
      "============",
      "assets/0.png + assets/0.json … — items from zero, in edition order.",
      "assets/collection.png + assets/collection.json — collection cover.",
      "config.json at the root is the Sugar CLI config.",
      "Do not put a wallet key in this folder.",
      "",
    ].join("\n");
  return banner + body;
}

function sugarLegacyNote(uk) {
  const commands = uk
    ? [
      "Команди Sugar (лише якщо ви свідомо лишаєтесь на застарілому варіанті).",
      "Запускайте їх з кореня набору — теки, де лежить assets/, не з теки sugar/:",
      "   sugar validate",
      "   sugar upload --config sugar/config.json",
      "   sugar deploy --config sugar/config.json",
      "   sugar verify",
      "Конфіг — sugar/config.json. Асети лишаються в assets/ у корені набору.",
      "sugar validate і sugar verify не приймають --config: вони читають assets/ і cache.json з поточної теки.",
      "Гаманець і ключ — у вас. Lab транзакцію не підписує.",
    ]
    : [
      "Sugar commands (only if you deliberately stay on the legacy program).",
      "Run them from the kit root — the folder that contains assets/, not from sugar/:",
      "   sugar validate",
      "   sugar upload --config sugar/config.json",
      "   sugar deploy --config sugar/config.json",
      "   sugar verify",
      "The config is sugar/config.json. Assets stay in assets/ at the kit root.",
      "sugar validate and sugar verify do not take --config: they read assets/ and cache.json from the current folder.",
      "The wallet and the key stay with you. Lab does not sign the transaction.",
    ];
  return [
    uk
      ? "ЗАСТАРІЛИЙ: legacy Candy Machine, не для нової колекції."
      : "LEGACY: legacy Candy Machine, not for a new collection.",
    uk
      ? "Metaplex позначає Sugar і legacy Candy Machine як застарілі. Нова колекція — Core Candy Machine і MPLX, див. DEPLOY.txt у корені."
      : "Metaplex marks Sugar and the legacy Candy Machine as deprecated. A new collection uses Core Candy Machine and MPLX; see DEPLOY.txt at the kit root.",
    "",
    ...commands,
    "",
  ].join("\n");
}

function royaltiesNote(uk) {
  return uk
    ? [
      "Роялті Core",
      "============",
      "ProgramAllowList — роялті примусові лише для програм, які ви самі вписали в список.",
      "None (без правила) — дорадчі: майданчик може їх проігнорувати.",
      "",
      "Список програм порожній навмисно. Впишіть адреси програм самі.",
      "Не підставляйте чужий гаманець отримувача.",
      "",
      "programs: []",
      "",
    ].join("\n")
    : [
      "Core royalties",
      "===============",
      "ProgramAllowList — royalties are enforced only for the programs you put on the list.",
      "None (no rule) — advisory: a marketplace may ignore them.",
      "",
      "The program list is empty on purpose. Fill in program addresses yourself.",
      "Do not paste someone else's treasury wallet.",
      "",
      "programs: []",
      "",
    ].join("\n");
}

function coreGuideSteps(uk) {
  return uk
    ? [
      "Solana · Core Candy Machine (MPLX CLI)",
      "--------------------------------------",
      "Встановіть Solana CLI і MPLX собі на машину. Lab їх за вас не запускає.",
      "Гаманець лишається у вас. Lab не підписує транзакцію і не тримає ключ.",
      "",
      "1. Devnet (сухий прогін)",
      "   solana config set --url https://api.devnet.solana.com",
      "   solana config set --keypair <шлях-до-вашого-keypair.json>   # файл лишається у вас",
      "   solana airdrop 2",
      "   cd <ця тека>",
      "   mplx cm create --wizard",
      "   Відповідайте майстру з cm-config.json: назва, символ, sellerFeeBasisPoints, адреса творця.",
      "   Асети: assets/0.png, assets/0.json, … і assets/collection.json.",
      "   Приховане розкриття: hidden.json + hidden.png. Хеш — series hidden після series upload. Розкриття — series reveal --keypair. EVM лишається в кабінеті Thirdweb. Пароль у файл не кладіть.",
      "   Команди Lab на цьому ПК (ключ у файлі, не в майстерні):",
      "   series release-init <архів.json> -o release.json",
      "   series upload <ця тека> --keypair <файл>",
      "   series hidden <ця тека> --uri <посилання hidden.json>",
      "   series guards release.json",
      "   mplx cm create --wizard",
      "   series verify release.json",
      "   series mint release.json --keypair <файл>",
      "   series reveal <ця тека> --keypair <ключ оновлення колекції>",
      "   Список дозволених: група wl, allowList (merkle root з series guards або allowlist.json) і mintLimit. Доказ у транзакцію кладе series mint.",
      "   series mint збирає оплату, allowList і mintLimit. Інше правило зупиняє команду.",
      "   Перевірте колекцію на devnet-експлорері.",
      "",
      "2. Mainnet — лише якщо devnet виглядає правильно",
      "   solana config set --url https://api.mainnet-beta.solana.com",
      "   Переконайтесь, що адреса творця — ваш гаманець.",
      "   Повторіть mplx cm create --wizard (або upload / insert / validate) уже на mainnet.",
      "",
      "Роялті: ROYALTIES.txt. ProgramAllowList примусовий для програм зі списку, який заповнюєте ви. None — дорадчо.",
      "Комісію мережі (SOL) платите ви. Оцінка — у ESTIMATE.txt, це не рахунок від Lab.",
      "Застарілий Candy Machine — файл sugar/LEGACY.txt. Не для нової колекції.",
    ]
    : [
      "Solana · Core Candy Machine (MPLX CLI)",
      "--------------------------------------",
      "Install the Solana CLI and MPLX on your machine. Lab does not run them for you.",
      "The wallet stays with you. Lab does not sign the transaction and does not hold the key.",
      "",
      "1. Devnet (dry run)",
      "   solana config set --url https://api.devnet.solana.com",
      "   solana config set --keypair <path-to-your-keypair.json>   # the file stays with you",
      "   solana airdrop 2",
      "   cd <this folder>",
      "   mplx cm create --wizard",
      "   Answer the wizard from cm-config.json: name, symbol, sellerFeeBasisPoints, creator address.",
      "   Assets: assets/0.png, assets/0.json, … and assets/collection.json.",
      "   Hidden reveal: hidden.json + hidden.png. The hash is series hidden after series upload. Reveal is series reveal --keypair. EVM stays in the Thirdweb dashboard. Do not put a password in the file.",
      "   Lab commands on this PC (the key stays in a file, never in the studio):",
      "   series release-init <archive.json> -o release.json",
      "   series upload <this folder> --keypair <file>",
      "   series hidden <this folder> --uri <hidden.json link>",
      "   series guards release.json",
      "   mplx cm create --wizard",
      "   series verify release.json",
      "   series mint release.json --keypair <file>",
      "   series reveal <this folder> --keypair <collection update key>",
      "   Allowlist: group wl, allowList (merkle root from series guards or allowlist.json) and mintLimit. series mint puts the proof in the transaction.",
      "   series mint builds payment, allowList, and mintLimit. Any other rule stops the command.",
      "   Check the collection on a devnet explorer.",
      "",
      "2. Mainnet — only after devnet looks right",
      "   solana config set --url https://api.mainnet-beta.solana.com",
      "   Confirm the creator address is your wallet.",
      "   Repeat mplx cm create --wizard (or upload / insert / validate) on mainnet.",
      "",
      "Royalties: ROYALTIES.txt. ProgramAllowList is enforced for programs you list. None is advisory.",
      "You pay the network fee (SOL). The figure in ESTIMATE.txt is an estimate, not a Lab invoice.",
      "The legacy Candy Machine note is sugar/LEGACY.txt. It is not the path for a new collection.",
    ];
}

function sugarGuideSteps(uk) {
  const banner = uk
    ? "ЗАСТАРІЛИЙ: legacy Candy Machine, не для нової колекції."
    : "LEGACY: legacy Candy Machine, not for a new collection.";
  const rest = uk
    ? [
      "Solana · Sugar CLI",
      "------------------",
      "Встановіть Solana CLI і Sugar (Metaplex) собі на машину. Lab їх за вас не запускає.",
      "",
      "1. Devnet (сухий прогін)",
      "   solana config set --url https://api.devnet.solana.com",
      "   solana config set --keypair <шлях-до-вашого-keypair.json>   # файл лишається у вас",
      "   solana airdrop 2",
      "   cd <ця тека>",
      "   sugar validate",
      "   sugar upload",
      "   sugar deploy --config config.json",
      "   sugar verify",
      "   Перевірте колекцію на devnet-експлорері. Ціна в config.json зараз для прогону.",
      "",
      "2. Mainnet — лише якщо devnet виглядає правильно",
      "   solana config set --url https://api.mainnet-beta.solana.com",
      "   Переконайтесь, що creators у config.json — це ваш гаманець, не заглушка.",
      "   sugar upload",
      "   sugar deploy --config config.json",
      "   sugar verify",
      "",
      "Комісію мережі (SOL) платите ви. Оцінка — у ESTIMATE.txt, це не рахунок від Lab.",
    ]
    : [
      "Solana · Sugar CLI",
      "------------------",
      "Install the Solana CLI and Metaplex Sugar on your machine. Lab does not run them for you.",
      "",
      "1. Devnet (dry run)",
      "   solana config set --url https://api.devnet.solana.com",
      "   solana config set --keypair <path-to-your-keypair.json>   # the file stays with you",
      "   solana airdrop 2",
      "   cd <this folder>",
      "   sugar validate",
      "   sugar upload",
      "   sugar deploy --config config.json",
      "   sugar verify",
      "   Check the collection on a devnet explorer. The price in config.json is for this run.",
      "",
      "2. Mainnet — only after devnet looks right",
      "   solana config set --url https://api.mainnet-beta.solana.com",
      "   Confirm creators in config.json is your wallet, not a placeholder.",
      "   sugar upload",
      "   sugar deploy --config config.json",
      "   sugar verify",
      "",
      "You pay the network fee (SOL). The figure in ESTIMATE.txt is an estimate, not a Lab invoice.",
    ];
  return [banner, "", ...rest];
}

export function buildDeployGuide({ chain, locale = "en", count = 0, name = "Series", symbol = "LAB", creator = "", estimate, legacy = false } = {}) {
  const uk = String(locale || "").toLowerCase().startsWith("uk");
  const who = creator || (uk ? "<ВАША_ПУБЛІЧНА_АДРЕСА>" : "<YOUR_PUBLIC_ADDRESS>");
  const head = uk
    ? [
      "Набір деплою Series Lab",
      "=======================",
      `Колекція: ${name} (${symbol}), предметів: ${count}`,
      `Адреса творця (публічна): ${who}`,
      "",
      "Спочатку тест, потім основна мережа. Це рекомендація, не опція «для когось іншого».",
      "Ви підписуєте транзакції на своєму комп'ютері. Не надсилайте seed-фразу чи приватний ключ у Series Lab, у чат чи в цей файл.",
      "",
    ]
    : [
      "Series Lab deploy kit",
      "=====================",
      `Collection: ${name} (${symbol}), items: ${count}`,
      `Creator address (public): ${who}`,
      "",
      "Test first, then mainnet. That is the recommended path.",
      "You sign on your own computer. Do not send a seed phrase or private key to Series Lab, to a chat, or into this file.",
      "",
    ];
  let steps;
  if (chain === "solana") {
    steps = legacy ? sugarGuideSteps(uk) : coreGuideSteps(uk);
  } else if (chain === "bitcoin") {
    steps = uk
      ? [
        "Bitcoin Ordinals",
        "----------------",
        "Lab не робить інскрипцію. Файл manifest.csv і теки images/ та metadata/ — те, що ви завантажуєте самі.",
        "",
        "1. Signet (сухий прогін)",
        "   Зберіть гаманець ord / Sparrow на signet.",
        "   Зробіть одну тестову інскрипцію з images/0 (або першого файлу) і metadata поруч.",
        "   Переконайтесь, що батьківська інскрипція колекції і дочірні збігаються з назвами.",
        "",
        "2. Mainnet",
        "   Повторіть той самий порядок зі свого гаманця.",
        "   Або завантажте manifest.csv у сервіс на кшталт OrdinalsBot і сплатіть комісію там — зі свого рахунку.",
        "   Адреса отримувача — ваша Taproot (bc1p…), не адреса Lab.",
        "",
        "Комісія майнерів — у ESTIMATE.txt, якщо ви задали DEPLOY_ORDINALS_SATS_PER_VBYTE.",
      ]
      : [
        "Bitcoin Ordinals",
        "----------------",
        "Lab does not inscribe. manifest.csv plus images/ and metadata/ are what you upload yourself.",
        "",
        "1. Signet (dry run)",
        "   Use an ord / Sparrow wallet on signet.",
        "   Inscribe one test item from the first image and its metadata.",
        "   Check that a collection parent and the children match the names.",
        "",
        "2. Mainnet",
        "   Repeat the same order from your wallet.",
        "   Or upload manifest.csv to a service such as OrdinalsBot and pay there, from your account.",
        "   The receive address is your Taproot (bc1p…), not a Lab address.",
        "",
        "Miner fees are in ESTIMATE.txt when DEPLOY_ORDINALS_SATS_PER_VBYTE is set.",
      ];
  } else {
    steps = uk
      ? [
        "EVM · Thirdweb",
        "---------------",
        "thirdweb.json — параметри дропу (назва, символ, роялті, отримувач). Картинки й метадані — у images/ і metadata/.",
        "",
        "1. Тестнет (сухий прогін) — Sepolia або Base Sepolia",
        "   Відкрийте https://thirdweb.com/dashboard зі свого гаманця.",
        "   Створіть Drop ERC-721 у тестнеті.",
        "   Перенесіть поля з thirdweb.json (назва, символ, seller_fee_basis_points, fee_recipient).",
        "   Пароль delayed reveal вводьте в кабінеті thirdweb. У thirdweb.json його немає — Lab його не зберігає.",
        "   Завантажте images/ і metadata/ у сховище Thirdweb (або свій IPFS) і вкажіть base URI.",
        "   Задеплойте контракт. Підпис — у вашому гаманці (MetaMask / Coinbase / інший).",
        "   Змінтіть 1 тестовий токен і відкрийте його на тестовому OpenSea.",
        "",
        "2. Mainnet — лише після тестнету",
        "   Той самий порядок на обраній мережі (Ethereum, Base, Polygon, Arbitrum…).",
        "   fee_recipient має бути ваш гаманець, не нульова адреса.",
        "",
        "Газ платите ви. Оцінка деплою контракту — у ESTIMATE.txt.",
      ]
      : [
        "EVM · Thirdweb",
        "--------------",
        "thirdweb.json holds drop parameters (name, symbol, royalty, recipient). Artwork and metadata are in images/ and metadata/.",
        "",
        "1. Testnet (dry run) — Sepolia or Base Sepolia",
        "   Open https://thirdweb.com/dashboard with your wallet.",
        "   Create an ERC-721 Drop on the testnet.",
        "   Copy fields from thirdweb.json (name, symbol, seller_fee_basis_points, fee_recipient).",
        "   Enter the delayed-reveal password in the thirdweb dashboard. It is not in thirdweb.json — Lab does not store it.",
        "   Upload images/ and metadata/ to Thirdweb storage (or your IPFS) and set the base URI.",
        "   Deploy the contract. The signature happens in your wallet (MetaMask / Coinbase / another).",
        "   Mint 1 test token and open it on testnet OpenSea.",
        "",
        "2. Mainnet — only after the testnet",
        "   Same order on the chain you picked (Ethereum, Base, Polygon, Arbitrum…).",
        "   fee_recipient must be your wallet, not the zero address.",
        "",
        "You pay gas. The contract-deploy estimate is in ESTIMATE.txt.",
      ];
  }
  const tail = estimate ? ["", uk ? "Див. також ESTIMATE.txt." : "See also ESTIMATE.txt."] : [];
  return [...head, ...steps, ...tail, ""].join("\n");
}

export function itemExt(filename) {
  const ext = extname(String(filename || "")).replace(/^\./, "").toLowerCase();
  return ext || "png";
}
