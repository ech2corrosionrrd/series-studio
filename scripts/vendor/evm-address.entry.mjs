// Перевірка адреси EVM (EIP-55) для сторінки входу; замінює імпорт isAddress/getAddress з viem.
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex } from "@noble/hashes/utils.js";

const SHAPE = /^0x[0-9a-fA-F]{40}$/;

export function checksumAddress(address) {
  const lower = String(address).toLowerCase().slice(2);
  const hash = bytesToHex(keccak_256(new TextEncoder().encode(lower)));
  let out = "0x";
  for (let i = 0; i < 40; i++) out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  return out;
}

/** Як viem: 0x + 40 hex; суто малі літери приймаємо, змішаний регістр має збігатись із контрольною сумою. */
export function isAddress(address, { strict = true } = {}) {
  if (typeof address !== "string" || !SHAPE.test(address)) return false;
  if (address.toLowerCase() === address) return true;
  return strict ? checksumAddress(address) === address : true;
}

export function getAddress(address) {
  if (typeof address !== "string" || !SHAPE.test(address)) throw new Error(`Address "${address}" is invalid.`);
  return checksumAddress(address);
}
