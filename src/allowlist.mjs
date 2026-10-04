/**
 * Merkle allowlist for the Core Candy Guard `allowList` guard.
 *
 * Leaf = keccak256 of the wallet's base58 text (the program hashes `minter.to_string()`).
 * Internal nodes = keccak256 of the pair sorted with unsigned byte order.
 * An odd node with no sibling is promoted, not duplicated.
 * That is `getMerkleRoot` / `getMerkleProof` from `@metaplex-foundation/mpl-candy-machine`
 * on merkletreejs 0.3 (`sortPairs: true`, `hashLeaves` left off because leaves are pre-hashed).
 *
 * MPLX `jsonGuardParser` reads `allowList.merkleRoot` as hex.
 * Sugar's guard JSON historically stores the same 32 bytes as base58.
 */
import { keccak_256 } from "@noble/hashes/sha3.js";
import { isSolanaWallet } from "./platform/wallet.mjs";

export const ALLOWLIST_LABEL = "wl";
export const ALLOWLIST_ALGORITHM =
  "keccak256(utf8 base58 address), sorted-pair merkle, odd nodes promoted (Metaplex getMerkleRoot)";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function keccak(buf) {
  return Buffer.from(keccak_256(buf));
}

function hashPair(a, b) {
  const [left, right] = Buffer.compare(a, b) <= 0 ? [a, b] : [b, a];
  return keccak(Buffer.concat([left, right]));
}

/** @param {Buffer[]} leaves already-hashed leaves, in list order */
export function merkleLayers(leaves) {
  if (!leaves.length) throw new Error("allowlist: empty");
  const layers = [leaves];
  let nodes = leaves;
  while (nodes.length > 1) {
    const next = [];
    for (let i = 0; i < nodes.length; i += 2) {
      if (i + 1 >= nodes.length) next.push(nodes[i]);
      else next.push(hashPair(nodes[i], nodes[i + 1]));
    }
    layers.push(next);
    nodes = next;
  }
  return layers;
}

/** Sibling hashes from the leaf up to (not including) the root. */
export function merkleProof(layers, index) {
  const proof = [];
  let idx = index;
  for (let level = 0; level < layers.length - 1; level++) {
    const layer = layers[level];
    const pair = idx % 2 === 1 ? idx - 1 : idx + 1;
    if (pair < layer.length) proof.push(layer[pair]);
    idx = Math.floor(idx / 2);
  }
  return proof;
}

/** Recompute the root the way the AllowList guard does (`computed <= sibling`). */
export function verifyMerkleProof(leaf, proof, root) {
  let computed = Buffer.from(leaf);
  for (const sibling of proof) computed = hashPair(computed, Buffer.from(sibling));
  return computed.equals(Buffer.from(root));
}

export function encodeBase58(buf) {
  const bytes = Buffer.from(buf);
  let n = BigInt(`0x${bytes.toString("hex") || "0"}`);
  let s = "";
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const byte of bytes) {
    if (byte === 0) s = `1${s}`;
    else break;
  }
  return s || "1";
}

/** One address per line. Blank lines and `#` comments are ignored. */
export function parseAllowlistText(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter(Boolean);
}

function leafOf(address) {
  return keccak(Buffer.from(address, "utf8"));
}

/**
 * @param {string[]} addresses base58 wallets, order preserved (order changes the root)
 * @returns {{ wallets: string[], merkleRoot: string, merkleRootBase58: string, proofs: { address: string, proof: string[] }[], algorithm: string }}
 */
export function buildAllowlist(addresses) {
  const wallets = (addresses || []).map((a) => String(a || "").trim()).filter(Boolean);
  if (!wallets.length) throw new Error("allowlist: at least one wallet is required");
  const seen = new Set();
  for (const w of wallets) {
    if (!isSolanaWallet(w)) throw new Error(`allowlist: not a Solana address: "${w}"`);
    if (seen.has(w)) throw new Error(`allowlist: duplicate wallet ${w}`);
    seen.add(w);
  }
  const leaves = wallets.map(leafOf);
  const layers = merkleLayers(leaves);
  const root = layers[layers.length - 1][0];
  const proofs = wallets.map((address, i) => ({
    address,
    proof: merkleProof(layers, i).map((p) => p.toString("hex")),
  }));
  for (let i = 0; i < wallets.length; i++) {
    const proof = proofs[i].proof.map((hex) => Buffer.from(hex, "hex"));
    if (!verifyMerkleProof(leaves[i], proof, root)) {
      throw new Error(`allowlist: proof does not match the root for ${wallets[i]}`);
    }
  }
  return {
    wallets,
    merkleRoot: root.toString("hex"),
    merkleRootBase58: encodeBase58(root),
    proofs,
    algorithm: ALLOWLIST_ALGORITHM,
  };
}

/**
 * `null` when the release has no allowlist.
 * A string is a line-separated list. An array is wallets. An object is `{ label, wallets, priceSol }`.
 */
export function normalizeAllowlist(input) {
  if (input == null || input === false || input === "") return null;
  let label = ALLOWLIST_LABEL;
  let wallets = input;
  let priceSol = null;
  if (typeof input === "string") wallets = parseAllowlistText(input);
  else if (!Array.isArray(input)) {
    if (typeof input !== "object") throw new Error("allowlist: expected a list of wallets");
    label = String(input.label || ALLOWLIST_LABEL).trim() || ALLOWLIST_LABEL;
    if (typeof input.wallets === "string" || typeof input.addresses === "string") {
      wallets = parseAllowlistText(input.wallets || input.addresses);
    } else {
      wallets = input.wallets || input.addresses || [];
    }
    if (input.priceSol != null && input.priceSol !== "") priceSol = Number(input.priceSol);
  }
  if (!/^[A-Za-z0-9_-]{1,6}$/.test(label)) {
    throw new Error(`allowlist label must be 1..6 letters, digits, "_" or "-" (Candy Guard group label), got "${label}"`);
  }
  if (priceSol != null && !(Number.isFinite(priceSol) && priceSol >= 0)) {
    throw new Error(`allowlist.priceSol must be a number >= 0, got "${input.priceSol}"`);
  }
  const built = buildAllowlist(wallets);
  return { label, priceSol, ...built };
}
