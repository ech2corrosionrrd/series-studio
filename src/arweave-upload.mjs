/**
 * Resumable bundle upload to Arweave via Irys. Adapted from gremlin-nft
 * scripts/upload-arweave.mjs.
 *
 * For every item: image first, its link is written into the metadata JSON
 * (`image`, `properties.files`), then the JSON is uploaded. Progress goes into
 * a Sugar-shaped `cache.json` after each item, so an interrupted run continues
 * where it stopped. Before paying, the price is estimated against the balance.
 *
 * The signing key stays with the caller (local CLI). Nothing here reads env keys.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { writeJsonAtomic } from "./fs-safe.mjs";
import { IRYS_NETWORKS, assertRpcMatchesNetwork, createIrysUploader, ensureIrysFunds, irysNetwork } from "./storage.mjs";

const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
const FUND_BUFFER = 1.05;

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const linkFor = (network) => (id, ext) => `${IRYS_NETWORKS[network].gateway}/${id}${ext ? `?ext=${ext}` : ""}`;

/** Solana keypair file (`[1,2,…]` JSON array) → secret key bytes. */
export function loadKeypairFile(path) {
  const arr = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(arr) || arr.length !== 64 || arr.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    throw new Error(`not a Solana keypair file (expected 64 bytes): ${path}`);
  }
  return Uint8Array.from(arr);
}

/** Where the files live: `<bundle>/assets` (deploy kit) or the folder itself. */
export function resolveAssetsDir(bundleDir) {
  const nested = join(bundleDir, "assets");
  return existsSync(nested) && statSync(nested).isDirectory() ? nested : bundleDir;
}

/** Items in numeric order + optional collection cover. Throws when an image has no JSON. */
export function scanBundle(bundleDir) {
  if (!existsSync(bundleDir)) throw new Error(`bundle not found: ${bundleDir}`);
  const dir = resolveAssetsDir(bundleDir);
  const files = readdirSync(dir);
  const items = [];
  let collection = null;
  for (const f of files) {
    const m = f.match(/^(\d+|collection)\.(png|jpe?g|webp|gif)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase() === "collection" ? "-1" : String(Number(m[1]));
    const json = `${m[1]}.json`;
    if (!files.includes(json)) throw new Error(`metadata missing for ${f}: expected ${json}`);
    const entry = { key, image: join(dir, f), json: join(dir, json), ext: m[2].toLowerCase() };
    if (key === "-1") collection = entry;
    else items.push(entry);
  }
  if (!items.length) throw new Error(`no numbered images (0.png, 1.png …) in ${dir}`);
  items.sort((a, b) => Number(a.key) - Number(b.key));
  const keys = items.map((i) => Number(i.key));
  const gaps = [];
  for (let n = keys[0]; n <= keys[keys.length - 1]; n++) if (!keys.includes(n)) gaps.push(n);
  return { dir, items, collection, gaps };
}

function emptyCache() {
  return { program: { candyMachine: "", candyGuard: "", candyMachineCreator: "", collectionMint: "" }, items: {} };
}

function loadCache(path) {
  if (!existsSync(path)) return emptyCache();
  try {
    const c = JSON.parse(readFileSync(path, "utf8"));
    return { ...c, program: c.program || emptyCache().program, items: c.items || {} };
  } catch {
    throw new Error(`cache.json is not valid JSON: ${path} (fix or delete it; uploaded items are listed there)`);
  }
}

const done = (c) => Boolean(c?.image_link && c.metadata_link);

/** Offline plan: what still needs uploading and how many bytes that is. */
export function planUpload(bundleDir) {
  const scan = scanBundle(bundleDir);
  const cache = loadCache(join(bundleDir, "cache.json"));
  const all = scan.collection ? [scan.collection, ...scan.items] : scan.items;
  const todo = all.filter((e) => !done(cache.items[e.key]));
  const bytes = todo.reduce((s, e) => s + statSync(e.image).size + statSync(e.json).size, 0);
  return { scan, cache, todo, bytes, total: all.length, uploaded: all.length - todo.length };
}

/**
 * @param {object} p
 * @param {string} p.bundleDir
 * @param {Uint8Array|string} [p.key] secret key; omit with dryRun
 * @param {string} [p.rpcUrl]
 * @param {"mainnet"|"devnet"} [p.network="mainnet"] devnet = rehearsal with test SOL, temporary storage, devnet links
 * @param {boolean} [p.dryRun] estimate only
 * @param {boolean} [p.fund=true] top the Irys balance up from the wallet when short
 * @param {number} [p.maxPriceSol] refuse when the estimate is above this
 * @param {(msg: string) => void} [p.log]
 * @param {Function} [p.createUploader] injectable `(key, rpcUrl, network) => Promise<uploader>`
 */
export async function uploadBundle({
  bundleDir,
  key,
  rpcUrl,
  network: networkName,
  dryRun = false,
  fund = true,
  maxPriceSol,
  log = () => {},
  createUploader = createIrysUploader,
}) {
  const network = irysNetwork(networkName);
  rpcUrl = rpcUrl || IRYS_NETWORKS[network].rpc;
  assertRpcMatchesNetwork(rpcUrl, network);
  const link = linkFor(network);
  const plan = planUpload(bundleDir);
  const { scan, cache, todo, bytes } = plan;
  if (scan.gaps.length) log(`warning: numbering has gaps: ${scan.gaps.slice(0, 10).join(", ")}${scan.gaps.length > 10 ? " …" : ""}`);
  log(`${plan.total} entries, ${plan.uploaded} already uploaded, ${todo.length} to upload (${(bytes / 1024 / 1024).toFixed(2)} MB)`);
  const result = { ok: true, dryRun, total: plan.total, alreadyUploaded: plan.uploaded, uploadedNow: 0, bytes, priceSol: null, cacheFile: join(bundleDir, "cache.json") };
  if (!todo.length) return result;
  if (dryRun) return result;
  if (!key) throw new Error("signing key required (keypair file); use dryRun to estimate without it");

  if (network === "devnet") log("devnet rehearsal: paid in devnet SOL, links point to devnet.irys.xyz and are not permanent");
  const irys = await createUploader(key, rpcUrl, network);
  result.priceSol = await ensureIrysFunds(irys, bytes, { fund, maxPriceSol, log });

  const save = () => writeJsonAtomic(result.cacheFile, cache);
  for (const e of [...(scan.collection ? [scan.collection] : []), ...scan.items].filter((x) => todo.includes(x))) {
    const png = readFileSync(e.image);
    const imgTx = await irys.upload(png, { tags: [{ name: "Content-Type", value: MIME[e.ext] || "application/octet-stream" }] });
    const imageLink = link(imgTx.id, e.ext);

    const meta = JSON.parse(readFileSync(e.json, "utf8"));
    meta.image = imageLink;
    meta.properties = meta.properties || {};
    meta.properties.files = [{ uri: imageLink, type: MIME[e.ext] || "application/octet-stream" }];
    const metaBuf = Buffer.from(JSON.stringify(meta, null, 2), "utf8");
    const metaTx = await irys.upload(metaBuf, { tags: [{ name: "Content-Type", value: "application/json" }] });

    cache.items[e.key] = {
      name: meta.name || (e.key === "-1" ? "Collection" : `#${e.key}`),
      image_hash: sha256(png),
      image_link: imageLink,
      metadata_hash: sha256(metaBuf),
      metadata_link: link(metaTx.id),
      onChain: false,
    };
    save();
    result.uploadedNow++;
    log(`[${result.uploadedNow}/${todo.length}] ${cache.items[e.key].name} -> ${imageLink}`);
  }
  return result;
}
