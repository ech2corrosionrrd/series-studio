import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  uploadBundle,
  planUpload,
  scanBundle,
  loadKeypairFile,
  releaseFromArchive,
  validateRelease,
  buildReleaseGuards,
  guardUpdateConfig,
  sugarDate,
  decodeGuardAccount,
  guardDiff,
  verifyRelease,
} from "../src/index.mjs";

const CREATOR = "So11111111111111111111111111111111111111112";
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function fromB58(s) {
  let n = 0n;
  for (const c of s) n = n * 58n + BigInt(B58.indexOf(c));
  const hex = n.toString(16).padStart(64, "0");
  return Buffer.from(hex, "hex");
}

function tmp() {
  return mkdtempSync(join(tmpdir(), "series-release-"));
}

function makeBundle(count = 3) {
  const root = tmp();
  const assets = join(root, "assets");
  mkdirSync(assets);
  for (let i = 0; i < count; i++) {
    writeFileSync(join(assets, `${i}.png`), Buffer.from(`png-${i}`));
    writeFileSync(join(assets, `${i}.json`), JSON.stringify({ name: `Item #${i + 1}`, image: `${i}.png` }));
  }
  writeFileSync(join(assets, "collection.png"), Buffer.from("cover"));
  writeFileSync(join(assets, "collection.json"), JSON.stringify({ name: "Coll", image: "collection.png" }));
  return root;
}

function mockUploader({ balance = 1, price = 0.01, failAfter = Infinity } = {}) {
  const calls = { upload: [], fund: [] };
  let ids = 0;
  const irys = {
    utils: { fromAtomic: (x) => Number(x), toAtomic: (x) => x },
    getPrice: async () => price,
    getLoadedBalance: async () => balance,
    fund: async (x) => calls.fund.push(x),
    upload: async (data, opts) => {
      if (calls.upload.length >= failAfter) throw new Error("network down");
      calls.upload.push({ type: opts.tags[0].value, data });
      return { id: `tx${++ids}` };
    },
  };
  return { calls, create: async () => irys };
}

describe("release config", () => {
  const good = () => ({
    ...releaseFromArchive({ size: 100 }, { name: "Demo", symbol: "DMO" }, { creator: CREATOR, fee: 500, price: 0.2 }),
    reserve: { count: 10 },
    mint: { startDate: "2026-10-15T18:00:00Z", limitPerWallet: 5 },
  });

  it("validates, flags placeholders and bad values", () => {
    assert.deepEqual(validateRelease(good()).errors, []);
    const skeleton = releaseFromArchive({ size: 10 }, {});
    assert.match(validateRelease(skeleton).errors.join(), /placeholder/);
    const bad = { ...good(), sellerFeeBasisPoints: 20000, mint: { startDate: "nope", limitPerWallet: 0 } };
    const e = validateRelease(bad).errors.join("|");
    assert.match(e, /sellerFeeBasisPoints/);
    assert.match(e, /not a date/);
    assert.match(e, /limitPerWallet/);
    assert.match(validateRelease({ ...good(), reserve: { count: 100 } }).errors.join(), /reserve/);
  });

  it("builds guards that always include payment and a Sugar date", () => {
    const g = buildReleaseGuards(good());
    assert.deepEqual(g.solPayment, { value: 0.2, destination: CREATOR });
    assert.equal(g.startDate.date, "2026-10-15 18:00:00 +00:00");
    assert.deepEqual(g.mintLimit, { id: 1, limit: 5 });
    const conf = guardUpdateConfig(good());
    assert.equal(conf.number, 90);
    assert.throws(() => buildReleaseGuards({ ...good(), creators: [] }), /invalid/);
    assert.throws(() => sugarDate("x"), /not a date/);
  });
});

describe("bundle upload", () => {
  it("scans the kit layout and rejects an image without metadata", () => {
    const root = makeBundle(3);
    const s = scanBundle(root);
    assert.equal(s.items.length, 3);
    assert.ok(s.collection);
    assert.deepEqual(s.gaps, []);
    rmSync(join(root, "assets", "1.json"));
    assert.throws(() => scanBundle(root), /metadata missing/);
  });

  it("uploads image then metadata, writes cache.json, and resumes after a failure", async () => {
    const root = makeBundle(3);
    const logs = [];
    const first = mockUploader({ failAfter: 5 });
    await assert.rejects(
      uploadBundle({ bundleDir: root, key: new Uint8Array(64), createUploader: first.create, log: (m) => logs.push(m) }),
      /network down/,
    );
    const cache1 = JSON.parse(readFileSync(join(root, "cache.json"), "utf8"));
    assert.deepEqual(Object.keys(cache1.items).sort(), ["-1", "0"]);

    const second = mockUploader();
    const res = await uploadBundle({ bundleDir: root, key: new Uint8Array(64), createUploader: second.create });
    assert.equal(res.alreadyUploaded, 2);
    assert.equal(res.uploadedNow, 2);
    assert.equal(second.calls.upload.length, 4);
    const cache = JSON.parse(readFileSync(join(root, "cache.json"), "utf8"));
    assert.deepEqual(Object.keys(cache.items).sort(), ["-1", "0", "1", "2"]);
    assert.match(cache.items["1"].image_link, /^https:\/\/gateway\.irys\.xyz\/tx\d+\?ext=png$/);
    assert.match(cache.items["1"].metadata_link, /^https:\/\/gateway\.irys\.xyz\/tx\d+$/);
    assert.equal(cache.items["1"].image_hash.length, 64);
    // metadata uploaded to Arweave carries the image link
    const metaUpload = second.calls.upload.find((c) => c.type === "application/json");
    assert.match(JSON.parse(metaUpload.data.toString()).image, /gateway\.irys\.xyz/);

    const third = mockUploader();
    const again = await uploadBundle({ bundleDir: root, key: new Uint8Array(64), createUploader: third.create });
    assert.equal(again.uploadedNow, 0);
    assert.equal(third.calls.upload.length, 0);
  });

  it("estimates, funds with a 5% buffer, and honours the price limit", async () => {
    const root = makeBundle(2);
    const poor = mockUploader({ balance: 0.004, price: 0.01 });
    await uploadBundle({ bundleDir: root, key: new Uint8Array(64), createUploader: poor.create });
    assert.equal(poor.calls.fund.length, 1);
    assert.ok(Math.abs(poor.calls.fund[0] - 0.006 * 1.05) < 1e-9);

    const root2 = makeBundle(2);
    const dear = mockUploader({ price: 5 });
    await assert.rejects(
      uploadBundle({ bundleDir: root2, key: new Uint8Array(64), createUploader: dear.create, maxPriceSol: 1 }),
      /above the limit/,
    );
    assert.equal(dear.calls.upload.length, 0);
    assert.equal(existsSync(join(root2, "cache.json")), false);

    const root3 = makeBundle(2);
    const broke = mockUploader({ balance: 0, price: 1 });
    await assert.rejects(
      uploadBundle({ bundleDir: root3, key: new Uint8Array(64), createUploader: broke.create, fund: false }),
      /below the estimate/,
    );
  });

  it("dry run needs no key and uploads nothing", async () => {
    const root = makeBundle(2);
    const res = await uploadBundle({ bundleDir: root, dryRun: true });
    assert.equal(res.uploadedNow, 0);
    assert.ok(res.bytes > 0);
    assert.equal(planUpload(root).todo.length, 3);
  });

  it("rejects a malformed keypair file", () => {
    const f = join(tmp(), "k.json");
    writeFileSync(f, "[1,2,3]");
    assert.throws(() => loadKeypairFile(f), /64 bytes/);
    writeFileSync(f, JSON.stringify(Array.from({ length: 64 }, (_, i) => i)));
    assert.equal(loadKeypairFile(f).length, 64);
  });
});

describe("candy verify", () => {
  function guardAccount({ price = 0.2, date = "2026-10-15T18:00:00Z", limit = 5 } = {}) {
    const buf = Buffer.alloc(81 + 40 + 8 + 3 + 4);
    fromB58(CREATOR).copy(buf, 41);
    buf.writeBigUInt64LE((1n << 1n) | (1n << 3n) | (1n << 9n), 73);
    let o = 81;
    buf.writeBigUInt64LE(BigInt(Math.round(price * 1e9)), o);
    fromB58(CREATOR).copy(buf, o + 8);
    o += 40;
    buf.writeBigInt64LE(BigInt(Date.parse(date) / 1000), o);
    o += 8;
    buf[o] = 1;
    buf.writeUInt16LE(limit, o + 1);
    return buf;
  }
  function cmAccount(minted, total) {
    const buf = Buffer.alloc(128);
    buf.writeBigUInt64LE(BigInt(minted), 112);
    buf.writeBigUInt64LE(BigInt(total), 120);
    return buf;
  }
  const cfg = () => ({
    ...releaseFromArchive({ size: 100 }, { name: "Demo", symbol: "DMO" }, { creator: CREATOR, price: 0.2 }),
    standard: "v3",
    reserve: { count: 10 },
    mint: { startDate: "2026-10-15T18:00:00Z", limitPerWallet: 5 },
    deployed: { candyMachine: "CM1", candyGuard: "CG1" },
  });
  const rpc = (guard) => async (_url, init) => {
    const addr = JSON.parse(init.body).params[0];
    const data = addr === "CG1" ? guard : cmAccount(4, 90);
    return { ok: true, json: async () => ({ result: { value: { data: [data.toString("base64"), "base64"] } } }) };
  };

  it("decodes guards and matches the config", async () => {
    const g = decodeGuardAccount(guardAccount());
    assert.equal(g.authority, CREATOR);
    assert.equal(g.guards.solPayment.sol, 0.2);
    assert.equal(g.guards.mintLimit.limit, 5);
    assert.equal(g.groups, 0);
    const r = await verifyRelease(cfg(), { rpcUrl: "http://rpc", fetchFn: rpc(guardAccount()) });
    assert.equal(r.ok, true, r.problems.join());
    assert.equal(r.minted, 4);
    assert.equal(r.total, 90);
  });

  it("reports price and limit drift", async () => {
    const r = await verifyRelease(cfg(), { rpcUrl: "http://rpc", fetchFn: rpc(guardAccount({ price: 0.1, limit: 9 })) });
    assert.equal(r.ok, false);
    assert.match(r.problems.join(), /different on chain: .*solPayment/);
    assert.match(r.problems.join(), /mintLimit/);
  });

  it("guardDiff and refusal paths", async () => {
    const d = guardDiff({ solPayment: { value: 1, destination: "a" }, mintLimit: { id: 1, limit: 3 } }, { solPayment: { sol: 1, destination: "a" }, startDate: { date: "x" } });
    assert.deepEqual([d.added, d.removed, d.unchanged], [["mintLimit"], ["startDate"], ["solPayment"]]);
    await assert.rejects(verifyRelease({ ...cfg(), standard: "core" }), /v3 only/);
    await assert.rejects(verifyRelease({ ...cfg(), deployed: {} }), /required/);
  });
});

describe("CLI release flow", () => {
  it("release-init → guards, and refuses to overwrite", () => {
    const dir = tmp();
    const archive = join(dir, "archive.json");
    writeFileSync(archive, JSON.stringify({ presetId: "x", size: 20, recipes: [] }));
    const cli = resolve("bin/series.mjs");
    const rel = join(dir, "release.json");
    execFileSync(process.execPath, [cli, "release-init", archive, "-o", rel, "--creator", CREATOR, "--price", "0.3"]);
    const cfg = JSON.parse(readFileSync(rel, "utf8"));
    assert.equal(cfg.size, 20);
    assert.equal(cfg.priceSol, 0.3);
    assert.throws(() => execFileSync(process.execPath, [cli, "release-init", archive, "-o", rel], { stdio: "pipe" }));
    const out = join(dir, "g.json");
    execFileSync(process.execPath, [cli, "guards", rel, "-o", out]);
    assert.equal(JSON.parse(readFileSync(out, "utf8")).guards.default.solPayment.value, 0.3);
    cfg.creators[0].address = "11111111111111111111111111111111";
    writeFileSync(rel, JSON.stringify(cfg));
    assert.throws(() => execFileSync(process.execPath, [cli, "guards", rel, "-o", out], { stdio: "pipe" }));
  });

  it("upload --dry-run reports the plan without a key", () => {
    const root = makeBundle(2);
    const out = execFileSync(process.execPath, [resolve("bin/series.mjs"), "upload", root, "--dry-run"], { encoding: "utf8" });
    assert.match(out, /3 entries, 0 already uploaded, 3 to upload/);
  });
});
