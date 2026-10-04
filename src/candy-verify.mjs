/**
 * Read-only on-chain check of a deployed Candy Machine (v3 / Sugar, or Metaplex Core)
 * and its Candy Guard. Adapted from gremlin-nft src/guards.mjs + scripts/guard-status.mjs.
 * Core layouts follow metaplex-foundation/mpl-core-candy-machine (state/candy_machine.rs,
 * candy_machine_data.rs, candy_guard.rs, guards/*.rs) and were checked against live mainnet accounts.
 */
import { createHash } from "node:crypto";
import { allowlistOf, buildReleaseGuards, publicSize } from "./release-config.mjs";

export const CORE_CANDY_MACHINE_PROGRAM = "CMACYFENjoBMHzapRXyo1JZkVS6EtaDDzkjMrmQLvr4J";
export const CORE_CANDY_GUARD_PROGRAM = "CMAGAKJ67e9hRZgfC5SFTbZH8MgEmtqazKXjmkaJjWTJ";

const anchorDiscriminator = (name) => createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function toBase58(buf) {
  let n = BigInt("0x" + (buf.toString("hex") || "0"));
  let s = "";
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const byte of buf) {
    if (byte === 0) s = "1" + s;
    else break;
  }
  return s;
}

/** Guards by feature-bit order and how to read their data. */
const GUARDS = [
  ["botTax", (b, o) => [{ lamports: Number(b.readBigUInt64LE(o)) / 1e9, lastInstruction: b[o + 8] === 1 }, 9]],
  ["solPayment", (b, o) => [{ sol: Number(b.readBigUInt64LE(o)) / 1e9, destination: toBase58(b.subarray(o + 8, o + 40)) }, 40]],
  ["tokenPayment", (b, o) => [{ amount: Number(b.readBigUInt64LE(o)) }, 72]],
  ["startDate", (b, o) => [{ date: new Date(Number(b.readBigInt64LE(o)) * 1000).toISOString() }, 8]],
  ["thirdPartySigner", (b, o) => [{ signerKey: toBase58(b.subarray(o, o + 32)) }, 32]],
  ["tokenGate", (b, o, std) => [{ amount: Number(b.readBigUInt64LE(std === "core" ? o : o + 32)) }, 40]],
  ["gatekeeper", () => [{}, 33]],
  ["endDate", (b, o) => [{ date: new Date(Number(b.readBigInt64LE(o)) * 1000).toISOString() }, 8]],
  ["allowList", (b, o) => [{ merkleRoot: b.subarray(o, o + 32).toString("hex") }, 32]],
  ["mintLimit", (b, o) => [{ id: b[o], limit: b.readUInt16LE(o + 1) }, 3]],
];

const pk = (b, o) => toBase58(b.subarray(o, o + 32));
const u64 = (b, o) => Number(b.readBigUInt64LE(o));

/** Core-only guards, feature bits 10..30 (mpl-core-candy-guard GuardType order). */
const CORE_GUARDS = [
  ["nftPayment", (b, o) => [{ requiredCollection: pk(b, o), destination: pk(b, o + 32) }, 64]],
  ["redeemedAmount", (b, o) => [{ maximum: u64(b, o) }, 8]],
  ["addressGate", (b, o) => [{ address: pk(b, o) }, 32]],
  ["nftGate", (b, o) => [{ requiredCollection: pk(b, o) }, 32]],
  ["nftBurn", (b, o) => [{ requiredCollection: pk(b, o) }, 32]],
  ["tokenBurn", (b, o) => [{ amount: u64(b, o), mint: pk(b, o + 8) }, 40]],
  ["freezeSolPayment", (b, o) => [{ sol: u64(b, o) / 1e9, destination: pk(b, o + 8) }, 40]],
  ["freezeTokenPayment", (b, o) => [{ amount: u64(b, o), mint: pk(b, o + 8), destinationAta: pk(b, o + 40) }, 72]],
  ["programGate", (b, o) => {
    const n = b.readUInt32LE(o);
    return [{ additional: Array.from({ length: n }, (_, i) => pk(b, o + 4 + i * 32)) }, 4 + n * 32];
  }],
  ["allocation", (b, o) => [{ id: b[o], limit: b.readUInt32LE(o + 1) }, 5]],
  ["token2022Payment", (b, o) => [{ amount: u64(b, o), mint: pk(b, o + 8), destinationAta: pk(b, o + 40) }, 72]],
  ["solFixedFee", (b, o) => [{ sol: u64(b, o) / 1e9, destination: pk(b, o + 8) }, 40]],
  ["nftMintLimit", (b, o) => [{ id: b[o], limit: b.readUInt16LE(o + 1), requiredCollection: pk(b, o + 3) }, 35]],
  ["edition", (b, o) => [{ editionStartOffset: b.readUInt32LE(o) }, 4]],
  ["assetPayment", (b, o) => [{ requiredCollection: pk(b, o), destination: pk(b, o + 32) }, 64]],
  ["assetBurn", (b, o) => [{ requiredCollection: pk(b, o) }, 32]],
  ["assetMintLimit", (b, o) => [{ id: b[o], limit: b.readUInt16LE(o + 1), requiredCollection: pk(b, o + 3) }, 35]],
  ["assetBurnMulti", (b, o) => [{ requiredCollection: pk(b, o), num: b[o + 32] }, 33]],
  ["assetPaymentMulti", (b, o) => [{ requiredCollection: pk(b, o), destination: pk(b, o + 32), num: b[o + 64] }, 65]],
  ["assetGate", (b, o) => [{ requiredCollection: pk(b, o) }, 32]],
  ["vanityMint", (b, o) => {
    const [regex, end] = readString(b, o);
    return [{ regex }, end - o];
  }],
];

/**
 * One guard set: 8-byte feature mask, then the enabled guards in bit order.
 * @returns {{ features: bigint, guards: object, offset: number, unknown: boolean }}
 */
function decodeGuardSet(buf, offset, standard) {
  const features = buf.readBigUInt64LE(offset);
  let o = offset + 8;
  const guards = {};
  let unknown = false;
  const table = standard === "core" ? [...GUARDS, ...CORE_GUARDS] : GUARDS;
  for (let bit = 0; bit < 64; bit++) {
    if (((features >> BigInt(bit)) & 1n) === 0n) continue;
    if (bit >= table.length) {
      unknown = true;
      break;
    }
    const [name, parse] = table[bit];
    const [value, size] = parse(buf, o, standard);
    guards[name] = value;
    o += size;
  }
  return { features, guards, offset: o, unknown };
}

/**
 * Decode a Candy Guard account (same header for v3 and Core; only tokenGate field order differs).
 * v3: guards past bit 9 are not decoded (`unknown` = true). Core: all 31 guards are decoded.
 * `bytesRead` is where the default guard set ends plus the 4-byte group count: for a guard with no groups it
 * equals the account size, which is how the decoder is cross-checked against live accounts.
 * Core group bodies are decoded into `groupList` (label + that group's guards).
 * @param {Buffer} buf
 * @param {{ standard?: "v3" | "core" }} [opts]
 */
export function decodeGuardAccount(buf, { standard = "v3" } = {}) {
  if (standard === "core" && !buf.subarray(0, 8).equals(anchorDiscriminator("CandyGuard"))) {
    throw new Error("not a Candy Guard account (discriminator mismatch)");
  }
  const authority = toBase58(buf.subarray(41, 73));
  const set = decodeGuardSet(buf, 73, standard);
  if (set.unknown) {
    return { authority, features: set.features, guards: set.guards, groups: null, groupList: [], unknown: true, bytesRead: null };
  }
  let o = set.offset;
  const groups = buf.readUInt32LE(o);
  o += 4;
  const groupList = [];
  if (standard === "core") {
    for (let i = 0; i < groups; i++) {
      const [label, next] = readString(buf, o);
      const body = decodeGuardSet(buf, next, standard);
      groupList.push({ label, guards: body.guards });
      o = body.offset;
    }
  }
  return { authority, features: set.features, guards: set.guards, groups, groupList, unknown: false, bytesRead: standard === "core" ? o : set.offset + 4 };
}

/** Anchor string: u32 length + utf8 bytes. */
function readString(buf, o) {
  const len = buf.readUInt32LE(o);
  return [buf.toString("utf8", o + 4, o + 4 + len), o + 4 + len];
}

/**
 * Decode a Metaplex Core Candy Machine account header (the item lines after it are not read).
 * Layout: 8 discriminator, authority, mint_authority, collection_mint (3 × 32), items_redeemed u64,
 * then CandyMachineData: items_available u64, max_supply u64, is_mutable u8,
 * Option<ConfigLineSettings>, Option<HiddenSettings>.
 */
export function decodeCoreCandyMachine(buf) {
  if (buf.length < 8 + 96 + 8 + 18 || !buf.subarray(0, 8).equals(anchorDiscriminator("CandyMachine"))) {
    throw new Error("not a Core Candy Machine account (discriminator mismatch)");
  }
  const out = {
    authority: toBase58(buf.subarray(8, 40)),
    mintAuthority: toBase58(buf.subarray(40, 72)),
    collectionMint: toBase58(buf.subarray(72, 104)),
    itemsRedeemed: Number(buf.readBigUInt64LE(104)),
    itemsAvailable: Number(buf.readBigUInt64LE(112)),
    maxSupply: Number(buf.readBigUInt64LE(120)),
    isMutable: buf[128] === 1,
    configLineSettings: null,
    hiddenSettings: false,
    hidden: null,
  };
  let o = 129;
  if (buf[o++] === 1) {
    const [prefixName, o1] = readString(buf, o);
    const nameLength = buf.readUInt32LE(o1);
    const [prefixUri, o2] = readString(buf, o1 + 4);
    const uriLength = buf.readUInt32LE(o2);
    out.configLineSettings = { prefixName, nameLength, prefixUri, uriLength, isSequential: buf[o2 + 4] === 1 };
    o = o2 + 5;
  }
  out.hiddenSettings = buf[o] === 1;
  if (out.hiddenSettings && o + 1 < buf.length) {
    try {
      const [name, n1] = readString(buf, o + 1);
      const [uri, n2] = readString(buf, n1);
      if (n2 + 32 <= buf.length) out.hidden = { name, uri, hash: buf.subarray(n2, n2 + 32).toString("hex") };
    } catch {
      out.hidden = null;
    }
  }
  return out;
}

const dateMs = (g) => (g ? Date.parse((g.date ?? "").replace(" +00:00", "Z").replace(" ", "T")) || Date.parse(g.date) : null);
const NORM = {
  solPayment: (g) => (g ? { sol: g.sol ?? g.value, destination: g.destination } : null),
  mintLimit: (g) => (g ? { id: g.id, limit: g.limit } : null),
  startDate: dateMs,
  allowList: (g) => (g ? { merkleRoot: String(g.merkleRoot || "").toLowerCase().replace(/^0x/, "") } : null),
};

/** What `guard update` would change. */
export function guardDiff(desired, onChain) {
  const same = (n) => JSON.stringify(NORM[n]?.(desired[n]) ?? desired[n]) === JSON.stringify(NORM[n]?.(onChain[n]) ?? onChain[n]);
  const out = { added: [], removed: [], changed: [], unchanged: [] };
  for (const n of new Set([...Object.keys(desired), ...Object.keys(onChain)])) {
    if (desired[n] && !onChain[n]) out.added.push(n);
    else if (!desired[n] && onChain[n]) out.removed.push(n);
    else if (same(n)) out.unchanged.push(n);
    else out.changed.push(n);
  }
  return out;
}

export async function fetchAccount(rpcUrl, address, fetchFn = globalThis.fetch) {
  return (await fetchAccountInfo(rpcUrl, address, fetchFn)).data;
}

/** @returns {Promise<{ data: Buffer, owner: string }>} */
export async function fetchAccountInfo(rpcUrl, address, fetchFn = globalThis.fetch) {
  const res = await fetchFn(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [address, { encoding: "base64" }] }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const r = await res.json();
  if (r.error) throw new Error(`RPC error: ${JSON.stringify(r.error).slice(0, 200)}`);
  if (!r.result?.value) throw new Error(`account not found: ${address}`);
  return { data: Buffer.from(r.result.value.data[0], "base64"), owner: r.result.value.owner };
}

/**
 * Compare the release config with chain state.
 * @returns {Promise<{ ok: boolean, standard: string, minted: number, total: number, authority: string, guards: object, problems: string[], diff: object }>}
 */
export async function verifyRelease(cfg, { rpcUrl, fetchFn } = {}) {
  const { candyMachine, candyGuard, collection } = cfg.deployed || {};
  const standard = cfg.standard === "core" ? "core" : "v3";
  if (!candyMachine) throw new Error("release.json: deployed.candyMachine is required");
  if (!candyGuard) throw new Error("release.json: deployed.candyGuard is required");
  const url = rpcUrl || process.env.SOLANA_RPC_URL || "https://solana-rpc.publicnode.com";
  const problems = [];

  const guardInfo = await fetchAccountInfo(url, candyGuard, fetchFn);
  const g = decodeGuardAccount(guardInfo.data, { standard });
  const cmInfo = await fetchAccountInfo(url, candyMachine, fetchFn);

  let minted;
  let total;
  if (standard === "core") {
    if (cmInfo.owner !== CORE_CANDY_MACHINE_PROGRAM) problems.push(`candyMachine is owned by ${cmInfo.owner}, not the Core Candy Machine program`);
    if (guardInfo.owner !== CORE_CANDY_GUARD_PROGRAM) problems.push(`candyGuard is owned by ${guardInfo.owner}, not the Core Candy Guard program`);
    const cm = decodeCoreCandyMachine(cmInfo.data);
    minted = cm.itemsRedeemed;
    total = cm.itemsAvailable;
    if (cm.mintAuthority !== candyGuard) problems.push(`machine's mint authority is ${cm.mintAuthority}, not the candy guard: the guard rules are bypassed or belong to another machine`);
    if (collection && cm.collectionMint !== collection) problems.push(`collection on chain is ${cm.collectionMint}, release.json has ${collection}`);
    const revealOn = Boolean(cfg.reveal && typeof cfg.reveal === "object" && cfg.reveal.enabled);
    if (revealOn && !cm.hiddenSettings) problems.push("release.json sets reveal, but the machine has no hidden settings");
    if (!revealOn && cm.hiddenSettings) problems.push("machine uses hidden settings (reveal later): items are not individually listed");
    if (revealOn && cfg.reveal.hash && cm.hidden?.hash && cm.hidden.hash !== String(cfg.reveal.hash).toLowerCase()) {
      problems.push(`hidden settings hash differs: chain ${cm.hidden.hash}, release.json ${String(cfg.reveal.hash).toLowerCase()}`);
    }
  } else {
    minted = Number(cmInfo.data.readBigUInt64LE(112));
    total = Number(cmInfo.data.readBigUInt64LE(120));
  }
  if (total !== publicSize(cfg)) problems.push(`items on chain: ${total}, release.json expects ${publicSize(cfg)} (size minus reserve)`);

  const diff = guardDiff(buildReleaseGuards(cfg), g.guards);
  try {
    const al = allowlistOf(cfg);
    if (al) {
      const group = (g.groupList || []).find((row) => row.label === al.label);
      const onRoot = group?.guards?.allowList?.merkleRoot || "";
      if (!group) problems.push(`allowList group "${al.label}" is missing on chain`);
      else if (onRoot !== al.merkleRoot) problems.push(`allowList merkle root differs: chain ${onRoot}, release.json ${al.merkleRoot}`);
    }
  } catch (e) {
    problems.push(e.message);
  }
  if (!g.guards.solPayment) problems.push("no solPayment on chain: the mint is free");
  if (g.unknown) problems.push("chain has guards this tool does not decode: check manually");
  for (const [label, list] of [["missing on chain", diff.added], ["different on chain", diff.changed], ["extra on chain", diff.removed]]) {
    if (list.length) problems.push(`${label}: ${list.join(", ")}`);
  }
  return { ok: problems.length === 0, standard, minted, total, authority: g.authority, guards: g.guards, problems, diff };
}
