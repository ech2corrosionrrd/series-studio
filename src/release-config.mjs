/**
 * Release config (`release.json`) — one file per series with everything the
 * release steps share: royalty, creators, price, mint rules, reserve, and the
 * addresses written after deploy. Adapted from gremlin-nft collection.config.mjs
 * + src/guards.mjs + src/mint.mjs. No network, no keys.
 */

/** Id of the per-wallet limit inside one Candy Machine. Changing it resets wallet counters. */
export const MINT_LIMIT_ID = 1;

const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PLACEHOLDER = "11111111111111111111111111111111";

/** Sugar date form: `2026-10-15 18:00:00 +00:00`. Throws on anything that is not a date. */
export function sugarDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`mint.startDate: not a date — "${value}". Use "2026-10-15T18:00:00Z".`);
  }
  return `${d.toISOString().slice(0, 19).replace("T", " ")} +00:00`;
}

/** @returns {{ id: number, limit: number } | null} */
export function mintLimitGuard(limit) {
  if (limit === null || limit === undefined) return null;
  if (!Number.isInteger(limit) || limit < 1 || limit > 65535) {
    throw new Error(`mint.limitPerWallet: integer 1..65535 or null, got "${limit}"`);
  }
  return { id: MINT_LIMIT_ID, limit };
}

/** Skeleton release config from an archive + preset. Placeholders must be replaced before deploy. */
export function releaseFromArchive(archive = {}, preset = {}, opts = {}) {
  const size = Number(archive.size ?? archive.recipes?.length ?? 0);
  return {
    name: String(opts.name || preset.name || archive.presetId || "Series"),
    symbol: String(opts.symbol || preset.symbol || "LAB").trim(),
    description: String(opts.description || preset.description || ""),
    size,
    sellerFeeBasisPoints: Number(opts.fee ?? 500),
    creators: [{ address: String(opts.creator || PLACEHOLDER), share: 100 }],
    priceSol: Number(opts.price ?? 0.1),
    standard: "core",
    reserve: { count: 0, note: "" },
    mint: { startDate: null, limitPerWallet: null },
    deployed: { candyMachine: null, candyGuard: null, collection: null },
  };
}

/** @returns {{ errors: string[], warnings: string[] }} */
export function validateRelease(cfg = {}) {
  const errors = [];
  const warnings = [];
  if (!String(cfg.name || "").trim()) errors.push("name is required");
  if (!String(cfg.symbol || "").trim()) errors.push("symbol is required");
  else if (String(cfg.symbol).length > 10) errors.push("symbol is longer than 10 characters");
  if (!Number.isInteger(cfg.size) || cfg.size < 1) errors.push("size must be a positive integer");
  const fee = cfg.sellerFeeBasisPoints;
  if (!Number.isInteger(fee) || fee < 0 || fee > 10000) errors.push("sellerFeeBasisPoints must be an integer 0..10000");
  if (!(Number(cfg.priceSol) >= 0)) errors.push("priceSol must be a number >= 0");
  else if (Number(cfg.priceSol) === 0) warnings.push("priceSol is 0: the mint would be free");

  const creators = Array.isArray(cfg.creators) ? cfg.creators : [];
  if (!creators.length) errors.push("at least one creator is required");
  else {
    const total = creators.reduce((s, c) => s + Number(c.share || 0), 0);
    if (total !== 100) errors.push(`creator shares must sum to 100, got ${total}`);
    for (const c of creators) {
      if (!B58.test(String(c.address || ""))) errors.push(`creator address is not a Solana address: "${c.address}"`);
      else if (c.address === PLACEHOLDER) errors.push("creator address is still the placeholder");
    }
  }

  const reserve = Number(cfg.reserve?.count ?? 0);
  if (!Number.isInteger(reserve) || reserve < 0 || reserve >= (cfg.size || 0)) {
    errors.push("reserve.count must be an integer 0..size-1");
  }
  try {
    mintLimitGuard(cfg.mint?.limitPerWallet);
  } catch (e) {
    errors.push(e.message);
  }
  if (cfg.mint?.startDate) {
    try {
      sugarDate(cfg.mint.startDate);
    } catch (e) {
      errors.push(e.message);
    }
  } else warnings.push("mint.startDate is empty: the mint opens the moment the guard is set");
  if (!cfg.mint?.limitPerWallet) warnings.push("no per-wallet limit: one wallet can buy everything");
  if (!["core", "v3"].includes(cfg.standard)) errors.push('standard must be "core" or "v3"');
  return { errors, warnings };
}

/** Items on sale = size minus the team reserve. */
export function publicSize(cfg) {
  return cfg.size - Number(cfg.reserve?.count || 0);
}

/**
 * Guards we want on chain. Payment is always included: `guard update` REPLACES
 * the whole set, so omitting it would make the mint free.
 */
export function buildReleaseGuards(cfg) {
  const { errors } = validateRelease(cfg);
  if (errors.length) throw new Error(`release config invalid: ${errors.join("; ")}`);
  const guards = { solPayment: { value: Number(cfg.priceSol), destination: cfg.creators[0].address } };
  if (cfg.mint?.startDate) guards.startDate = { date: sugarDate(cfg.mint.startDate) };
  const ml = mintLimitGuard(cfg.mint?.limitPerWallet);
  if (ml) guards.mintLimit = ml;
  return guards;
}

/** Sugar-format guard config (`sugar guard update --config …`). */
export function guardUpdateConfig(cfg) {
  return {
    number: publicSize(cfg),
    symbol: cfg.symbol,
    sellerFeeBasisPoints: cfg.sellerFeeBasisPoints,
    creators: cfg.creators,
    guards: { default: buildReleaseGuards(cfg), groups: null },
  };
}
