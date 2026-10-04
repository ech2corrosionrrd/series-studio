/**
 * Local Core Candy Guard mint and Core asset reveal.
 *
 * Signing matches `series upload`: the keypair stays in this process.
 * The studio never receives it.
 *
 * Mint is Candy Guard `mintV1` (not the candy-machine instruction alone).
 * An allowlist group needs `route` first: that creates the proof PDA, then
 * `mintV1` reads it. Account order and discriminators follow the generated
 * client in metaplex-foundation/mpl-core-candy-machine (mintV1, route).
 * Remaining accounts follow feature-bit order of the active guard set.
 * This builder only fills solPayment, startDate (no accounts), allowList
 * and mintLimit — the guards `series guards` emits. Anything else throws.
 *
 * A Core asset minted into a collection stores update authority as
 * `Collection(collection)`. `UpdateV1` is therefore signed by the collection's
 * update authority (the creator wallet), not by the candy-machine PDA.
 * The PDA is only the collection's update delegate, used so the machine can mint.
 * EVM delayed reveal is not handled here.
 */
import { existsSync, readFileSync } from "node:fs";
import { keccak_256 } from "@noble/hashes/sha3.js";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_SLOT_HASHES_PUBKEY,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { verifyMerkleProof } from "./allowlist.mjs";
import { allowlistOf, coreGuardConfig } from "./release-config.mjs";
import {
  CORE_CANDY_GUARD_PROGRAM,
  CORE_CANDY_MACHINE_PROGRAM,
  decodeCoreCandyMachine,
  decodeGuardAccount,
  fetchAccountInfo,
} from "./candy-verify.mjs";
import { writeJsonAtomic } from "./fs-safe.mjs";

export const MPL_CORE_PROGRAM = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
export const COLLECTION_KEY = 5;

const MINT_V1_DISC = Buffer.from([145, 98, 192, 118, 184, 147, 118, 104]);
const ROUTE_DISC = Buffer.from([229, 23, 203, 151, 122, 227, 173, 42]);
const UPDATE_V1_DISC = 15;
const ALLOW_LIST_GUARD = 8;

const SUPPORTED_GUARDS = new Set(["solPayment", "startDate", "allowList", "mintLimit"]);

const guardProgram = new PublicKey(CORE_CANDY_GUARD_PROGRAM);
const machineProgram = new PublicKey(CORE_CANDY_MACHINE_PROGRAM);
const coreProgram = new PublicKey(MPL_CORE_PROGRAM);

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}

function encodeString(value) {
  const body = Buffer.from(String(value), "utf8");
  return Buffer.concat([u32(body.length), body]);
}

function encodeOptionString(value) {
  if (value == null) return Buffer.from([0]);
  return Buffer.concat([Buffer.from([1]), encodeString(value)]);
}

function encodeBytes(buf) {
  const body = Buffer.from(buf);
  return Buffer.concat([u32(body.length), body]);
}

function pubkeyOf(value) {
  if (!value) throw new Error("missing public key");
  if (typeof value === "string") return value;
  if (typeof value.toBase58 === "function") return value.toBase58();
  if (value.publicKey) return pubkeyOf(value.publicKey);
  throw new Error("missing public key");
}

function meta(pubkey, { signer = false, writable = false } = {}) {
  return { pubkey: pubkeyOf(pubkey), isSigner: signer, isWritable: writable };
}

export function candyMachineAuthorityPda(candyMachine) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("candy_machine"), new PublicKey(candyMachine).toBuffer()],
    machineProgram,
  )[0].toBase58();
}

export function allowListProofPda({ merkleRoot, minter, candyGuard, candyMachine }) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("allow_list"),
      rootBytes(merkleRoot),
      new PublicKey(minter).toBuffer(),
      new PublicKey(candyGuard).toBuffer(),
      new PublicKey(candyMachine).toBuffer(),
    ],
    guardProgram,
  )[0].toBase58();
}

export function mintLimitPda({ id, minter, candyGuard, candyMachine }) {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 0 || n > 255) throw new Error(`mintLimit id must be 0..255, got "${id}"`);
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("mint_limit"),
      Buffer.from([n]),
      new PublicKey(minter).toBuffer(),
      new PublicKey(candyGuard).toBuffer(),
      new PublicKey(candyMachine).toBuffer(),
    ],
    guardProgram,
  )[0].toBase58();
}

function rootBytes(hex) {
  const clean = String(hex || "").toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(clean)) throw new Error(`merkle root must be 32 bytes of hex, got "${hex}"`);
  return Buffer.from(clean, "hex");
}

function deployedOf(release) {
  const d = release?.deployed || {};
  for (const key of ["candyMachine", "candyGuard", "collection"]) {
    if (!d[key]) throw new Error(`release.json: deployed.${key} is required`);
  }
  return d;
}

/**
 * Which Candy Guard group this minter uses.
 * A wallet on the allowlist uses that group unless `publicPhase` is set.
 * `null` is the default (public) guard set.
 */
export function selectMintGroup({ release, minter, group = null, publicPhase = false } = {}) {
  if (publicPhase && group) throw new Error("pass either --public or --group, not both");
  const al = allowlistOf(release);
  if (publicPhase) return null;
  if (group) {
    if (!al || al.label !== group) {
      throw new Error(`release.json allowlist group is ${al ? al.label : "absent"}, not "${group}"`);
    }
    if (!al.wallets.includes(minter)) throw new Error(`${minter} is not on the allowlist group ${group}`);
    return group;
  }
  if (al && al.wallets.includes(minter)) return al.label;
  return null;
}

function guardsFor({ release, label, chain }) {
  if (chain) {
    if (!label) return chain.guards || {};
    const group = (chain.groupList || []).find((g) => g.label === label);
    if (!group) throw new Error(`candy guard has no group "${label}"`);
    return group.guards || {};
  }
  const core = coreGuardConfig(release);
  if (!label) return core.guardConfig;
  const group = (core.groups || []).find((g) => g.label === label);
  if (!group) throw new Error(`release.json has no allowlist group "${label}"`);
  return group.guards;
}

function proofFor(release, minter, rootHex) {
  const al = allowlistOf(release);
  if (!al) throw new Error("this guard set has allowList, but release.json has no allowlist to build the proof");
  const want = rootBytes(rootHex).toString("hex");
  if (al.merkleRoot !== want) {
    throw new Error(`allowList root on the guard is ${want}, release.json has ${al.merkleRoot}`);
  }
  const row = al.proofs.find((p) => p.address === minter);
  if (!row) throw new Error(`${minter} is not on the allowlist`);
  const proof = row.proof.map((hex) => {
    const buf = Buffer.from(hex, "hex");
    if (buf.length !== 32) throw new Error("allowlist proof entry is not 32 bytes");
    return buf;
  });
  const leaf = Buffer.from(keccak_256(Buffer.from(minter, "utf8")));
  if (!verifyMerkleProof(leaf, proof, rootBytes(want))) {
    throw new Error("allowlist proof does not match this merkle root");
  }
  return proof;
}

function destinationOf(solPayment) {
  const destination = solPayment?.destination;
  if (!destination) throw new Error("solPayment destination is missing");
  return destination;
}

/**
 * Remaining accounts in feature-bit order.
 * solPayment (bit 1), startDate (bit 3, no accounts), allowList (bit 8), mintLimit (bit 9).
 */
export function mintRemainingAccounts(guards, { minter, candyGuard, candyMachine }) {
  const extra = Object.keys(guards).filter((name) => !SUPPORTED_GUARDS.has(name));
  if (extra.length) {
    throw new Error(`series mint does not build remaining accounts for: ${extra.join(", ")}. It covers solPayment, startDate, allowList and mintLimit.`);
  }
  const accounts = [];
  if (guards.solPayment) {
    accounts.push(meta(destinationOf(guards.solPayment), { writable: true }));
  }
  let proof = null;
  if (guards.allowList) {
    const pda = allowListProofPda({
      merkleRoot: guards.allowList.merkleRoot,
      minter,
      candyGuard,
      candyMachine,
    });
    accounts.push(meta(pda, { writable: false }));
    proof = pda;
  }
  let mintCounter = null;
  if (guards.mintLimit) {
    mintCounter = mintLimitPda({
      id: guards.mintLimit.id,
      minter,
      candyGuard,
      candyMachine,
    });
    accounts.push(meta(mintCounter, { writable: true }));
  }
  return { accounts, proof, mintCounter };
}

function routeData(proof, label) {
  const body = Buffer.concat(proof);
  const inner = Buffer.concat([u32(proof.length), body]);
  return Buffer.concat([
    ROUTE_DISC,
    Buffer.from([ALLOW_LIST_GUARD]),
    encodeBytes(inner),
    encodeOptionString(label),
  ]);
}

function mintData(label) {
  return Buffer.concat([
    MINT_V1_DISC,
    u32(0),
    encodeOptionString(label),
  ]);
}

/**
 * Offline mint plan. `chain` is a decoded Candy Guard account; without it the
 * guard set comes from `release.json` (dry-run).
 */
export function planCoreMint({
  release,
  minter,
  asset,
  index = 0,
  label = null,
  chain = null,
  hidden = true,
} = {}) {
  if (release?.standard && release.standard !== "core") {
    throw new Error('series mint signs a Core Candy Guard mint. standard "v3" (Sugar) is not built here');
  }
  if (!Number.isInteger(index) || index < 0) throw new Error(`mint index must be an integer >= 0, got "${index}"`);
  const deployed = deployedOf(release);
  const minterKey = pubkeyOf(minter);
  const assetKey = pubkeyOf(asset);
  const guards = guardsFor({ release, label, chain });
  const { accounts: remaining, proof, mintCounter } = mintRemainingAccounts(guards, {
    minter: minterKey,
    candyGuard: deployed.candyGuard,
    candyMachine: deployed.candyMachine,
  });
  const proofBytes = guards.allowList ? proofFor(release, minterKey, guards.allowList.merkleRoot) : null;
  const authority = candyMachineAuthorityPda(deployed.candyMachine);
  const instructions = [];

  if (proofBytes) {
    instructions.push({
      name: "route",
      programId: CORE_CANDY_GUARD_PROGRAM,
      keys: [
        meta(deployed.candyGuard),
        meta(deployed.candyMachine, { writable: true }),
        meta(minterKey, { signer: true, writable: true }),
        meta(proof, { writable: true }),
        meta(SystemProgram.programId),
      ],
      data: routeData(proofBytes, label),
    });
  }

  instructions.push({
    name: "mintV1",
    programId: CORE_CANDY_GUARD_PROGRAM,
    keys: [
      meta(deployed.candyGuard),
      meta(machineProgram),
      meta(deployed.candyMachine, { writable: true }),
      meta(authority, { writable: true }),
      meta(minterKey, { signer: true, writable: true }),
      meta(minterKey, { signer: true, writable: true }),
      meta(guardProgram),
      meta(assetKey, { signer: true, writable: true }),
      meta(deployed.collection, { writable: true }),
      meta(coreProgram),
      meta(SystemProgram.programId),
      meta(SYSVAR_INSTRUCTIONS_PUBKEY),
      meta(SYSVAR_SLOT_HASHES_PUBKEY),
      ...remaining,
    ],
    data: mintData(label),
  });

  return {
    standard: "core",
    label,
    index,
    hidden: Boolean(hidden),
    asset: assetKey,
    minter: minterKey,
    candyMachine: deployed.candyMachine,
    candyGuard: deployed.candyGuard,
    collection: deployed.collection,
    authority,
    proofPda: proof,
    mintCounter,
    instructions,
  };
}

/** First byte of a collection account is the mpl-core Key; update authority follows it. */
export function readCollectionUpdateAuthority(data) {
  const buf = Buffer.from(data);
  if (buf.length < 33 || buf[0] !== COLLECTION_KEY) {
    throw new Error("account is not a Core collection");
  }
  return new PublicKey(buf.subarray(1, 33)).toBase58();
}

export function buildUpdateV1({ asset, collection, payer, name, uri }) {
  const title = String(name ?? "");
  const link = String(uri ?? "");
  if (!title) throw new Error("reveal name is required");
  if (!link) throw new Error("reveal uri is required");
  const payerKey = pubkeyOf(payer);
  return {
    name: "updateV1",
    programId: MPL_CORE_PROGRAM,
    keys: [
      meta(asset, { writable: true }),
      meta(collection),
      meta(payerKey, { signer: true, writable: true }),
      meta(payerKey, { signer: true }),
      meta(SystemProgram.programId),
      meta(coreProgram),
    ],
    data: Buffer.concat([
      Buffer.from([UPDATE_V1_DISC]),
      encodeOptionString(title),
      encodeOptionString(link),
      Buffer.from([0]),
    ]),
  };
}

/**
 * One UpdateV1 per minted asset that does not yet have a reveal signature.
 * Index is the hidden-settings mint order recorded by `series mint`.
 */
export function planCoreReveal({ updates, mints, payer }) {
  if (!mints?.collection) throw new Error("mints.json: collection is required");
  const items = Array.isArray(mints.items) ? mints.items : [];
  if (!items.length) throw new Error("mints.json has no minted assets");
  const rows = updates?.items || [];
  const pending = [];
  const skipped = [];
  for (const row of items) {
    if (row.hidden === false) {
      skipped.push({ index: row.index, reason: "not a hidden-settings mint" });
      continue;
    }
    if (row.revealSignature) {
      skipped.push({ index: row.index, reason: "already revealed" });
      continue;
    }
    const item = rows.find((r) => r.index === row.index);
    if (!item) throw new Error(`reveal data has no row for minted index ${row.index}`);
    pending.push({
      index: row.index,
      asset: row.asset,
      name: item.name,
      uri: item.uri,
      instruction: buildUpdateV1({
        asset: row.asset,
        collection: mints.collection,
        payer,
        name: item.name,
        uri: item.uri,
      }),
    });
  }
  return { pending, skipped, collection: mints.collection };
}

export function loadMints(file) {
  if (!existsSync(file)) {
    return { standard: "core", candyMachine: null, candyGuard: null, collection: null, items: [] };
  }
  const data = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(data.items)) throw new Error(`mints.json has no items array: ${file}`);
  return data;
}

export function appendMintRecord(file, record) {
  const data = loadMints(file);
  if (data.candyMachine && data.candyMachine !== record.candyMachine) {
    throw new Error("mints.json belongs to another candy machine");
  }
  if (data.items.some((row) => row.index === record.index || row.asset === record.asset)) {
    throw new Error(`mints.json already has index ${record.index}`);
  }
  data.standard = "core";
  data.candyMachine = record.candyMachine;
  data.candyGuard = record.candyGuard;
  data.collection = record.collection;
  data.items.push({
    index: record.index,
    asset: record.asset,
    mintSignature: record.mintSignature,
    revealSignature: null,
    hidden: record.hidden !== false,
  });
  data.items.sort((a, b) => a.index - b.index);
  writeJsonAtomic(file, data);
  return data;
}

export function markRevealed(file, index, signature) {
  const data = loadMints(file);
  const row = data.items.find((item) => item.index === index);
  if (!row) throw new Error(`mints.json has no index ${index}`);
  row.revealSignature = signature;
  writeJsonAtomic(file, data);
  return data;
}

export function compileInstruction(ix) {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.keys.map((key) => ({
      pubkey: new PublicKey(key.pubkey),
      isSigner: key.isSigner,
      isWritable: key.isWritable,
    })),
    data: Buffer.from(ix.data),
  });
}

export async function sendInstructions({ instructions, signers, rpcUrl, feePayer, sendImpl }) {
  const tx = new Transaction();
  for (const ix of instructions) tx.add(compileInstruction(ix));
  const payer = feePayer || signers[0].publicKey;
  tx.feePayer = payer instanceof PublicKey ? payer : new PublicKey(pubkeyOf(payer));
  if (sendImpl) return sendImpl({ transaction: tx, signers, rpcUrl });
  const connection = new Connection(rpcUrl, "confirmed");
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  return sendAndConfirmTransaction(connection, tx, signers, { commitment: "confirmed" });
}

export async function readMintState(release, { rpcUrl, fetchFn } = {}) {
  const deployed = deployedOf(release);
  const url = rpcUrl || process.env.SOLANA_RPC_URL || "https://solana-rpc.publicnode.com";
  const cmInfo = await fetchAccountInfo(url, deployed.candyMachine, fetchFn);
  const guardInfo = await fetchAccountInfo(url, deployed.candyGuard, fetchFn);
  if (cmInfo.owner !== CORE_CANDY_MACHINE_PROGRAM) {
    throw new Error(`candyMachine is owned by ${cmInfo.owner}, not the Core Candy Machine program`);
  }
  if (guardInfo.owner !== CORE_CANDY_GUARD_PROGRAM) {
    throw new Error(`candyGuard is owned by ${guardInfo.owner}, not the Core Candy Guard program`);
  }
  const cm = decodeCoreCandyMachine(cmInfo.data);
  const guard = decodeGuardAccount(guardInfo.data, { standard: "core" });
  return {
    rpcUrl: url,
    itemsRedeemed: cm.itemsRedeemed,
    itemsAvailable: cm.itemsAvailable,
    hiddenSettings: Boolean(cm.hiddenSettings),
    collection: deployed.collection,
    guard,
  };
}

export async function readCollectionAuthority(collection, { rpcUrl, fetchFn } = {}) {
  const url = rpcUrl || process.env.SOLANA_RPC_URL || "https://solana-rpc.publicnode.com";
  const info = await fetchAccountInfo(url, collection, fetchFn);
  if (info.owner !== MPL_CORE_PROGRAM) throw new Error(`collection is owned by ${info.owner}, not Core`);
  return readCollectionUpdateAuthority(info.data);
}

export function keypairFromFile(bytes) {
  return Keypair.fromSecretKey(bytes);
}

export function generateAssetKeypair() {
  return Keypair.generate();
}

export const MINT_V1_DISCRIMINATOR = MINT_V1_DISC;
export const ROUTE_DISCRIMINATOR = ROUTE_DISC;
export const UPDATE_V1_DISCRIMINATOR = UPDATE_V1_DISC;
export const ALLOW_LIST_GUARD_ID = ALLOW_LIST_GUARD;
