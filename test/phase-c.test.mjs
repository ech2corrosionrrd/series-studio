import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import {
  buildRecipes,
  dnaKeysFromItems,
  drySimulate,
  duplicates,
  weightPercent,
  licenseWarning,
  similarityToBase,
  sanitizeCriticOutput,
  triageImageOffline,
  countMissingTraitFrames,
} from "../src/index.mjs";
import { createMockPng } from "../src/mock-image.mjs";
import { imagesDirName } from "../src/reference.mjs";

function mini(size, items, extra = {}) {
  return {
    schema: "series-preset/v0",
    id: "mini",
    seed: extra.seed || "phase-c",
    size,
    lines: { a: { who: "subject", quota: size } },
    promptTemplate: {
      keep: "Keep {who}.",
      changeKeys: items.map((t) => t.key),
      suffix: "end",
    },
    traits: { items },
    ...(extra.rules ? { rules: extra.rules } : {}),
  };
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function solidPng(w, h, paint) {
  const rgbOf = typeof paint === "function" ? paint : () => paint;
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      const rgb = rgbOf(x, y);
      row[1 + x * 3] = rgb[0];
      row[2 + x * 3] = rgb[1];
      row[3 + x * 3] = rgb[2];
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("R6 constructor", () => {
  it("shows a weight as a percent of the trait", () => {
    assert.equal(weightPercent(1, [{ weight: 1 }, { weight: 3 }]), 25);
    assert.equal(weightPercent(3, [{ weight: 1 }, { weight: 3 }]), 75);
  });

  it("skipDna keeps the other traits unique and leaves the layer out of DNA", () => {
    const items = [
      {
        key: "hat",
        options: [
          { value: "cap", weight: 1, prompt: "a cap" },
          { value: "hood", weight: 1, prompt: "a hood" },
        ],
      },
      {
        key: "bg",
        skipDna: true,
        options: [
          { value: "red", weight: 1, prompt: "red" },
          { value: "blue", weight: 1, prompt: "blue" },
          { value: "green", weight: 1, prompt: "green" },
        ],
      },
    ];
    const recipes = buildRecipes(mini(2, items));
    assert.equal(recipes.length, 2);
    const keys = dnaKeysFromItems(items);
    assert.deepEqual(keys, ["hat"]);
    assert.deepEqual(duplicates(recipes, keys), []);
    for (const row of recipes) {
      assert.equal(row.dna.split("|").length, 2);
      assert.equal(row.traits.bg == null, false);
      assert.equal(row.dna.includes(row.traits.bg), false);
    }
    assert.throws(() => buildRecipes(mini(3, items)), /not enough unique combinations/);
  });

  it("exact N is met, or the build fails with the trait name", () => {
    const ok = buildRecipes(mini(4, [
      {
        key: "hat",
        options: [
          { value: "skull", weight: 1, prompt: "skull", exact: 1 },
          { value: "cap", weight: 5, prompt: "cap" },
        ],
      },
      {
        key: "bg",
        options: [
          { value: "red", weight: 1, prompt: "red" },
          { value: "blue", weight: 1, prompt: "blue" },
          { value: "green", weight: 1, prompt: "green" },
        ],
      },
    ]));
    assert.equal(ok.filter((r) => r.traits.hat === "skull").length, 1);
    assert.throws(
      () => buildRecipes(mini(3, [{
        key: "hat",
        options: [
          { value: "skull", weight: 1, prompt: "skull", exact: 2 },
          { value: "crown", weight: 1, prompt: "crown", exact: 2 },
        ],
      }])),
      /hat=skull/,
    );
  });

  it("dry simulation uses computeRarity and counts rejected conflicts without an engine", () => {
    const sim = drySimulate(mini(4, [
      {
        key: "color",
        options: [
          { value: "red", weight: 1, prompt: "red" },
          { value: "blue", weight: 1, prompt: "blue" },
          { value: "gold", weight: 1, prompt: "gold" },
        ],
      },
      {
        key: "hat",
        options: [
          { value: "beanie", weight: 30, prompt: "beanie" },
          { value: "none", weight: 1, prompt: "none" },
          { value: "cap", weight: 1, prompt: "cap" },
        ],
      },
    ], {
      seed: "conflict-seed",
      rules: { conflicts: [{ a: "color:red", b: "hat:beanie" }] },
    }));
    assert.equal(sim.engine, null);
    assert.equal(sim.size, 4);
    assert.ok(sim.rejectedConflicts > 0);
    assert.ok(sim.rarity.traits.some((t) => t.key === "color"));
    assert.equal(typeof sim.rarity.traits[0].options[0].actualPct, "number");
  });
});

describe("R16 licence warning", () => {
  it("warns for fal flux/dev and platform kontext-dev, not Pro or Schnell", () => {
    assert.ok(licenseWarning("fal", "fal-ai/flux/dev/image-to-image"));
    assert.ok(licenseWarning("flux", "black-forest-labs/flux-kontext-dev"));
    assert.equal(licenseWarning("kontext", "black-forest-labs/flux-kontext-pro"), null);
    assert.equal(licenseWarning("fal", "fal-ai/flux/schnell"), null);
    assert.equal(licenseWarning("replicate", "black-forest-labs/flux-schnell"), null);
    assert.equal(licenseWarning("comfyui", null), null);
    assert.equal(licenseWarning("comfyui", null, { fluxDevWeights: true })?.code, "flux-dev");
    assert.equal(licenseWarning("mock", null), null);
    assert.match(licenseWarning("fal", "fal-ai/flux/dev/image-to-image").en, /does not sign a legal conclusion/);
  });
});

describe("R8 similarity", () => {
  it("is deterministic offline for two png fixtures", () => {
    const black = solidPng(16, 16, [0, 0, 0]);
    const split = solidPng(16, 16, (x) => (x < 8 ? [0, 0, 0] : [255, 255, 255]));
    const a = similarityToBase(black, black);
    const b = similarityToBase(black, black);
    const far = similarityToBase(split, black);
    assert.deepEqual(a, b);
    assert.equal(a.offline, true);
    assert.equal(a.similarity, 1);
    assert.equal(a.warn, false);
    assert.equal(far.offline, true);
    assert.ok(far.similarity < a.similarity);
    assert.equal(far.warn, true);
  });
});

describe("R13 critic keys", () => {
  it("sanitizeCriticOutput keeps only known missing trait keys", () => {
    const cleaned = sanitizeCriticOutput({
      score: 4,
      verdict: "redo",
      issues: ["blurry"],
      missingTraits: ["hat", "not-a-trait", "hat", ""],
      reason: "Hat is absent.",
    }, ["hat", "bg"]);
    assert.deepEqual(cleaned.missingTraits, ["hat"]);
    assert.ok(cleaned.issues.includes("missing_trait"));
  });

  it("offline triage does not mark a trait missing because of prompt text", () => {
    const png = solidPng(4, 4, [20, 40, 60]);
    const dir = mkdtempSync(join(tmpdir(), "critic-"));
    const file = join(dir, "1.png");
    writeFileSync(file, png);
    const row = triageImageOffline({
      imagePath: file,
      recipe: { prompt: "a portrait with a red hat and blue coat", traits: { hat: "red", coat: "blue" } },
    });
    assert.deepEqual(row.missingTraits, []);
    assert.equal(row.issues.includes("missing_trait"), false);
    assert.equal(countMissingTraitFrames([row]).frames, 0);
    assert.equal(countMissingTraitFrames([{ edition: 3, issues: ["missing_trait"], missingTraits: ["hat"] }]).frames, 1);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("R7 batch base", () => {
  const dir = mkdtempSync(join(tmpdir(), "series-phase-c-"));
  const PORT = 5900 + Math.floor(Math.random() * 200);
  const env = {
    ...process.env,
    SERIES_MODE: "public",
    SERIES_DATA_DIR: dir,
    SERIES_KEYS_FILE: join(dir, "no-keys.env"),
    SERIES_PLATFORM_ENV: "",
    USERS_DB_PATH: join(dir, "users.db"),
    AUTH_SESSION_SECRET: "phase-c-secret",
    AUTH_COOKIE_INSECURE: "1",
    WELCOME_REQUIRE_BALANCE: "0",
    ENGINE_CREDIT_COSTS: '{"mock":2}',
    OFFLINE: "1",
    HOST: "127.0.0.1",
    PORT: String(PORT),
    HOLDER_SYNC_INTERVAL_SECONDS: "0",
    FULFILLMENT_RECONCILE_INTERVAL_SECONDS: "0",
    SOLANA_PAY_RECIPIENT: "",
    SERIES_SPEND_CAP_USD: "",
  };
  let server;
  let cookie = "";
  let user;

  function call(method, path, { body, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
      const req = request({
        host: "127.0.0.1",
        port: PORT,
        method,
        path,
        headers: {
          ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...headers,
        },
      }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          let json = null;
          try { json = JSON.parse(buf.toString("utf8")); } catch { /* text */ }
          resolve({ status: res.statusCode, headers: res.headers, json, text: buf.toString("utf8") });
        });
      });
      req.on("error", reject);
      if (data) req.write(data);
      req.end();
    });
  }

  before(async () => {
    const priv = randomBytes(32);
    const pub = secp256k1.getPublicKey(priv, false);
    const address = `0x${Buffer.from(keccak_256(pub.subarray(1)).subarray(-20)).toString("hex")}`;
    user = {
      address,
      sign(message) {
        const msg = Buffer.from(message, "utf8");
        const hash = keccak_256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${msg.length}`), msg]));
        const sig = secp256k1.sign(hash, priv, { prehash: false, format: "recovered" });
        return `0x${Buffer.concat([Buffer.from(sig.subarray(1)), Buffer.from([sig[0] + 27])]).toString("hex")}`;
      },
    };
    env.SERIES_ALLOWED_WALLETS = address;
    server = spawn(process.execPath, ["server/index.mjs"], { env, stdio: ["ignore", "pipe", "pipe"] });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("server did not start")), 15_000);
      server.stdout.on("data", (d) => {
        if (String(d).includes("Series Lab Studio")) {
          clearTimeout(t);
          resolve();
        }
      });
      server.stderr.on("data", () => {});
      server.on("exit", (c) => reject(new Error(`server exited ${c}`)));
    });
  });

  after(async () => {
    (await import("../src/platform/db.mjs")).closeAll();
    if (server && server.exitCode === null) {
      const exited = new Promise((r) => server.once("exit", r));
      server.kill();
      await exited;
    }
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  it("sends primary bytes to the engine, not the previous set png, and warns before a fal charge", async () => {
    const n = await call("GET", `/auth/nonce?address=${user.address}`);
    const ok = await call("POST", "/auth/verify", {
      body: { address: user.address, nonce: n.json.nonce, signature: user.sign(n.json.message) },
    });
    assert.equal(ok.status, 200, ok.text);
    cookie = String(ok.headers["set-cookie"][0]).split(";")[0];
    const png = createMockPng({ seed: 7, title: "primary" });
    const primaryHash = createHash("sha256").update(png).digest("hex");
    const up = await call("POST", "/api/base/upload", {
      body: { data: Buffer.from(png).toString("base64"), filename: "primary.png", role: "primary" },
    });
    assert.equal(up.status, 200, up.text);
    const build = await call("POST", "/api/build", { body: { file: "demo-series.json" } });
    assert.equal(build.status, 200, build.text);
    const before = (await call("GET", "/api/me")).json.balance;
    const blocked = await call("POST", "/api/generate", { body: { engine: "fal", mode: "first", first: 1 } });
    assert.equal(blocked.status, 409, blocked.text);
    assert.equal(blocked.json.code, "license_warning");
    assert.equal(blocked.json.charged, false);
    assert.equal((await call("GET", "/api/me")).json.balance, before);
    const first = await call("POST", "/api/generate", { body: { engine: "mock", mode: "first", first: 1 } });
    assert.equal(first.status, 200, first.text);
    assert.equal(first.json.count, 1);
    const set = imagesDirName("mock", 0.45);
    const safe = user.address.replace(/[^a-zA-Z0-9]/g, "");
    const setDir = join(dir, "users", safe, "out", set);
    const other = createMockPng({ seed: 99, title: "not-the-base" });
    writeFileSync(join(setDir, "1.png"), other);
    const second = await call("POST", "/api/generate", { body: { engine: "mock", mode: "only", only: "2" } });
    assert.equal(second.status, 200, second.text);
    assert.equal(second.json.count, 1);
    const creation = JSON.parse(readFileSync(join(setDir, "creation", "2.json"), "utf8"));
    const row = creation.versions.at(-1);
    assert.equal(row.baseSha256, primaryHash);
    assert.notEqual(row.baseSha256, createHash("sha256").update(other).digest("hex"));
  });
});
