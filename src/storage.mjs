/**
 * Storage Dispatcher & IPFS / Arweave / Local CID Mock integration for Series Lab.
 * Manages image URI prefix generation, Arweave (Irys) upload, and decentralized metadata pointers.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";

/**
 * Base58 alphabet (Bitcoin standard).
 */
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function encodeBase58(buffer) {
  const digits = [0];
  for (let i = 0; i < buffer.length; i++) {
    for (let j = 0; j < digits.length; j++) digits[j] <<= 8;
    digits[0] += buffer[i];
    let carry = 0;
    for (let j = 0; j < digits.length; ++j) {
      digits[j] += carry;
      carry = (digits[j] / 58) | 0;
      digits[j] %= 58;
    }
    while (carry) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  for (let i = 0; i < buffer.length && buffer[i] === 0; i++) digits.push(0);
  return digits.reverse().map((digit) => BASE58_ALPHABET[digit]).join("");
}

/**
 * Deterministic calculation of simulated IPFS CIDv0 (Qm...) using SHA-256 multihash.
 * @param {Buffer|string} input
 * @returns {string}
 */
export function calculateDeterministicCid(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input || ""), "utf8");
  const sha256 = createHash("sha256").update(buf).digest();
  // IPFS Multihash header: 0x12 (sha2-256) + 0x20 (32 bytes length)
  const multihash = Buffer.concat([Buffer.from([0x12, 0x20]), sha256]);
  return encodeBase58(multihash);
}

/**
 * Format image URI given an edition, an optional prefix, and an extension.
 * @param {number|string} edition
 * @param {string} [prefix] - e.g. "ipfs://QmX...", "ar://tx...", "https://..."
 * @param {string} [ext='.png']
 * @returns {string}
 */
export function buildImageUri(edition, prefix = "", ext = ".png") {
  const ed = String(edition);
  const extension = ext.startsWith(".") ? ext : `.${ext}`;
  const filename = `${ed}${extension}`;

  if (!prefix || !String(prefix).trim()) {
    return filename;
  }

  const rawPrefix = String(prefix).trim();

  // If prefix contains explicit {edition} or {filename} placeholder
  if (rawPrefix.includes("{filename}")) {
    return rawPrefix.replace(/\{filename\}/g, filename);
  }
  if (rawPrefix.includes("{edition}")) {
    return rawPrefix.replace(/\{edition\}/g, ed);
  }

  // Ensure trailing slash if it doesn't end with one or a query/param separator
  const cleanPrefix = rawPrefix.endsWith("/") || rawPrefix.endsWith("=") || rawPrefix.endsWith("?")
    ? rawPrefix
    : `${rawPrefix}/`;

  return `${cleanPrefix}${filename}`;
}

/**
 * Check Arweave / Irys credentials availability.
 * @param {object} [env=process.env]
 * @returns {{ irys: { present: boolean } }}
 */
export function checkStorageStatus(env = process.env) {
  return { irys: { present: Boolean(env.IRYS_PRIVATE_KEY && String(env.IRYS_PRIVATE_KEY).trim()) } };
}

/** Image files of a set directory in numeric edition order. */
export function listSetImages(dir) {
  return readdirSync(dir)
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .sort((a, b) => {
      const na = Number(a.match(/^(\d+)/)?.[1] || 0);
      const nb = Number(b.match(/^(\d+)/)?.[1] || 0);
      return na - nb || a.localeCompare(b);
    });
}

export async function createIrysUploader(privateKey, rpcUrl) {
  let Uploader;
  let Solana;
  try {
    ({ Uploader } = await import("@irys/upload"));
    ({ Solana } = await import("@irys/upload-solana"));
  } catch {
    throw new Error("Arweave upload needs optional packages: npm i @irys/upload @irys/upload-solana");
  }
  return Uploader(Solana).withWallet(privateKey).withRpc(rpcUrl).mainnet();
}

/**
 * Upload a local image set directory to Arweave using Irys.
 * Result is a folder manifest: `ar://<id>/<file>`.
 * @param {object} params
 * @param {string} params.dir - Absolute path to folder containing image files
 * @param {string} [params.irysPrivateKey]
 * @param {string} [params.rpcUrl]
 * @param {Function} [params.createUploader] - injectable `(key, rpcUrl) => Promise<uploader>` (tests)
 * @returns {Promise<{ ok: boolean, arweaveId: string, arweaveUri: string, gatewayUrl: string, count: number }>}
 */
export async function uploadToIrys({
  dir,
  irysPrivateKey,
  rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
  createUploader = createIrysUploader,
}) {
  if (!dir || !existsSync(dir)) {
    throw new Error(`Directory not found: ${dir}`);
  }

  const files = listSetImages(dir);
  if (!files.length) {
    throw new Error(`No image files found to upload in: ${dir}`);
  }

  const privateKey = irysPrivateKey || process.env.IRYS_PRIVATE_KEY;
  if (!privateKey || !String(privateKey).trim()) {
    throw new Error("Irys credentials missing (IRYS_PRIVATE_KEY required in .env)");
  }

  const irys = await createUploader(String(privateKey).trim(), rpcUrl);
  const receipt = await irys.uploadFolder(dir, { keepDeleted: false });
  const id = receipt?.id;
  if (!id) {
    throw new Error("Irys upload failed: no manifest ID returned");
  }

  return {
    ok: true,
    arweaveId: id,
    arweaveUri: `ar://${id}/`,
    gatewayUrl: `https://gateway.irys.xyz/${id}/`,
    count: files.length,
  };
}
