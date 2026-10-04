/**
 * Read-only on-chain check of a deployed Candy Machine v3 / Candy Guard
 * (Sugar layout). Adapted from gremlin-nft src/guards.mjs + scripts/guard-status.mjs.
 * Core Candy Machine uses a different account layout: this verifier does not decode it.
 */
import { buildReleaseGuards } from "./release-config.mjs";

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
  ["tokenGate", (b, o) => [{ amount: Number(b.readBigUInt64LE(o + 32)) }, 40]],
  ["gatekeeper", () => [{}, 33]],
  ["endDate", (b, o) => [{ date: new Date(Number(b.readBigInt64LE(o)) * 1000).toISOString() }, 8]],
  ["allowList", (b, o) => [{ merkleRoot: b.subarray(o, o + 32).toString("hex") }, 32]],
  ["mintLimit", (b, o) => [{ id: b[o], limit: b.readUInt16LE(o + 1) }, 3]],
];

/** Decode a Candy Guard account. Guards past bit 9 are not decoded: `unknown` is then true. */
export function decodeGuardAccount(buf) {
  const authority = toBase58(buf.subarray(41, 73));
  const features = buf.readBigUInt64LE(73);
  const guards = {};
  let offset = 81;
  let unknown = false;
  for (let bit = 0; bit < 64; bit++) {
    if (((features >> BigInt(bit)) & 1n) === 0n) continue;
    if (bit >= GUARDS.length) {
      unknown = true;
      break;
    }
    const [name, parse] = GUARDS[bit];
    const [value, size] = parse(buf, offset);
    guards[name] = value;
    offset += size;
  }
  const groups = unknown ? null : buf.readUInt32LE(offset);
  return { authority, features, guards, groups, unknown };
}

const dateMs = (g) => (g ? Date.parse((g.date ?? "").replace(" +00:00", "Z").replace(" ", "T")) || Date.parse(g.date) : null);
const NORM = {
  solPayment: (g) => (g ? { sol: g.sol ?? g.value, destination: g.destination } : null),
  mintLimit: (g) => (g ? { id: g.id, limit: g.limit } : null),
  startDate: dateMs,
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
  const res = await fetchFn(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [address, { encoding: "base64" }] }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const r = await res.json();
  if (r.error) throw new Error(`RPC error: ${JSON.stringify(r.error).slice(0, 200)}`);
  if (!r.result?.value) throw new Error(`account not found: ${address}`);
  return Buffer.from(r.result.value.data[0], "base64");
}

/**
 * Compare the release config with chain state.
 * @returns {Promise<{ ok: boolean, minted: number, total: number, authority: string, guards: object, problems: string[], diff: object }>}
 */
export async function verifyRelease(cfg, { rpcUrl, fetchFn } = {}) {
  const { candyMachine, candyGuard } = cfg.deployed || {};
  if (cfg.standard !== "v3") throw new Error('verify decodes Candy Machine v3 only (standard "v3"); for Core use `mplx cm validate`');
  if (!candyMachine || !candyGuard) throw new Error("release.json: deployed.candyMachine and deployed.candyGuard are required");
  const url = rpcUrl || process.env.SOLANA_RPC_URL || "https://solana-rpc.publicnode.com";
  const g = decodeGuardAccount(await fetchAccount(url, candyGuard, fetchFn));
  const cm = await fetchAccount(url, candyMachine, fetchFn);
  const minted = Number(cm.readBigUInt64LE(112));
  const total = Number(cm.readBigUInt64LE(120));
  const diff = guardDiff(buildReleaseGuards(cfg), g.guards);
  const problems = [];
  if (!g.guards.solPayment) problems.push("no solPayment on chain: the mint is free");
  if (g.unknown) problems.push("chain has guards this tool does not decode: check manually");
  for (const [label, list] of [["missing on chain", diff.added], ["different on chain", diff.changed], ["extra on chain", diff.removed]]) {
    if (list.length) problems.push(`${label}: ${list.join(", ")}`);
  }
  return { ok: problems.length === 0, minted, total, authority: g.authority, guards: g.guards, problems, diff };
}
