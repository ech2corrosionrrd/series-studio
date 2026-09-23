/**
 * Storage Dispatcher & IPFS / Arweave / Local CID Mock integration for Series Lab.
 * Manages image URI prefix generation, Pinata pinning, and decentralized metadata pointers.
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
 * Check Pinata / IPFS credentials availability.
 * @param {object} [env=process.env]
 * @returns {{ pinata: { present: boolean, type: 'jwt'|'keys'|null } }}
 */
export function checkStorageStatus(env = process.env) {
  if (env.PINATA_JWT && String(env.PINATA_JWT).trim()) {
    return { pinata: { present: true, type: "jwt" } };
  }
  if (
    (env.PINATA_API_KEY || env.PINATA_KEY) &&
    (env.PINATA_SECRET_API_KEY || env.PINATA_SECRET)
  ) {
    return { pinata: { present: true, type: "keys" } };
  }
  return { pinata: { present: false, type: null } };
}

/**
 * Upload a local image set directory to Pinata IPFS.
 * @param {object} params
 * @param {string} params.dir - Absolute path to folder containing image files
 * @param {string} [params.name] - Collection name for Pinata pin metadata
 * @param {string} [params.pinataJwt]
 * @param {string} [params.pinataApiKey]
 * @param {string} [params.pinataSecretKey]
 * @param {typeof fetch} [params.fetchFn]
 * @returns {Promise<{ ok: boolean, ipfsHash: string, ipfsUri: string, gatewayUrl: string, count: number }>}
 */
export async function uploadToPinata({
  dir,
  name = "series-lab-set",
  pinataJwt,
  pinataApiKey,
  pinataSecretKey,
  fetchFn = globalThis.fetch,
}) {
  if (!dir || !existsSync(dir)) {
    throw new Error(`Directory not found: ${dir}`);
  }

  const files = readdirSync(dir)
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .sort((a, b) => {
      const na = Number(a.match(/^(\d+)/)?.[1] || 0);
      const nb = Number(b.match(/^(\d+)/)?.[1] || 0);
      return na - nb || a.localeCompare(b);
    });

  if (!files.length) {
    throw new Error(`No image files found to pin in: ${dir}`);
  }

  // Check auth
  const jwt = pinataJwt || process.env.PINATA_JWT;
  const apiKey = pinataApiKey || process.env.PINATA_API_KEY || process.env.PINATA_KEY;
  const secretKey = pinataSecretKey || process.env.PINATA_SECRET_API_KEY || process.env.PINATA_SECRET;

  if (!jwt && (!apiKey || !secretKey)) {
    throw new Error("Pinata credentials missing (PINATA_JWT or PINATA_API_KEY/PINATA_SECRET_API_KEY required in .env)");
  }

  const formData = new FormData();

  // In Pinata directory uploads, files are added with path `${folderName}/${filename}`
  const folderName = name.replace(/[^a-zA-Z0-9_-]/g, "-") || "series-collection";
  for (const f of files) {
    const filePath = join(dir, f);
    const buf = readFileSync(filePath);
    const mime = f.endsWith(".png") ? "image/png" : f.endsWith(".webp") ? "image/webp" : "image/jpeg";
    const blob = new Blob([buf], { type: mime });
    formData.append("file", blob, `${folderName}/${f}`);
  }

  const pinataMetadata = JSON.stringify({
    name: folderName,
    keyvalues: {
      source: "series-lab",
      count: String(files.length),
      createdAt: new Date().toISOString(),
    },
  });
  formData.append("pinataMetadata", pinataMetadata);

  const pinataOptions = JSON.stringify({
    cidVersion: 0,
    wrapWithDirectory: false,
  });
  formData.append("pinataOptions", pinataOptions);

  const headers = {};
  if (jwt) {
    headers.Authorization = `Bearer ${jwt}`;
  } else {
    headers.pinata_api_key = apiKey;
    headers.pinata_secret_api_key = secretKey;
  }

  const res = await fetchFn("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers,
    body: formData,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Pinata upload failed (HTTP ${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const ipfsHash = data.IpfsHash;
  if (!ipfsHash) {
    throw new Error("Pinata response missing IpfsHash");
  }

  return {
    ok: true,
    ipfsHash,
    ipfsUri: `ipfs://${ipfsHash}/`,
    gatewayUrl: `https://gateway.pinata.cloud/ipfs/${ipfsHash}/`,
    count: files.length,
  };
}
