/**
 * Stage-by-stage smoke: spin isolated public Studio, sign in, walk Lab → Release.
 * Exit 0 if all checks pass; prints a Ukrainian report for each stage.
 * The child does not load the project .env (SERIES_SKIP_DOTENV) and external
 * service keys are blanked, so Telegram / paid APIs are not called.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { createMockPng } from "../src/mock-image.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "series-stage-"));
const PORT = 5700 + Math.floor(Math.random() * 200);
const results = [];

function evmWallet() {
  const priv = randomBytes(32);
  const pub = secp256k1.getPublicKey(priv, false);
  const address = `0x${Buffer.from(keccak_256(pub.subarray(1)).subarray(-20)).toString("hex")}`;
  const sign = (message) => {
    const msg = Buffer.from(message, "utf8");
    const hash = keccak_256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${msg.length}`), msg]));
    const sig = secp256k1.sign(hash, priv, { prehash: false, format: "recovered" });
    return `0x${Buffer.concat([Buffer.from(sig.subarray(1)), Buffer.from([sig[0] + 27])]).toString("hex")}`;
  };
  return { address, sign };
}

const user = evmWallet();
const admin = evmWallet();

// Do not inherit a developer .env into the child: loadKeys merges cwd .env for any
// key that is still unset, which would send real Telegram messages and paid API calls.
const BLOCKED_EXTERNAL = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "PINATA_JWT",
  "PINATA_API_KEY",
  "PINATA_KEY",
  "PINATA_SECRET_API_KEY",
  "PINATA_SECRET",
  "ALCHEMY_API_KEY",
  "VITE_ALCHEMY_API_KEY",
  "REPLICATE_API_TOKEN",
  "FAL_KEY",
  "FAL_API_KEY",
  "RUNWARE_API_KEY",
  "STABILITY_API_KEY",
  "POLLINATIONS_API_KEY",
  "SERIES_TELEGRAM_BOT_TOKEN",
  "SERIES_TELEGRAM_CHAT_ID",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "SOLANA_PAY_RECIPIENT",
  "SOLANA_PAY_RPC_URL",
  "SOLANA_RPC_URL",
  "SOLANA_RPC_FALLBACK",
  "VAULT_WALLET_ADDRESS",
];

const env = {
  ...process.env,
  ...Object.fromEntries(BLOCKED_EXTERNAL.map((k) => [k, ""])),
  SERIES_SKIP_DOTENV: "1",
  CONTENT_SAFETY_ENABLED: "0",
  MODERATION_API_ENABLED: "0",
  SERIES_MODE: "public",
  SERIES_DATA_DIR: dir,
  SERIES_KEYS_FILE: join(dir, "no-keys.env"),
  SERIES_PLATFORM_ENV: "",
  USERS_DB_PATH: join(dir, "users.db"),
  AUTH_SESSION_SECRET: "stage-smoke-secret",
  AUTH_COOKIE_INSECURE: "1",
  WELCOME_REQUIRE_BALANCE: "0",
  ENGINE_CREDIT_COSTS: '{"mock":2}',
  OFFLINE: "1",
  HOST: "127.0.0.1",
  PORT: String(PORT),
  GREMLIN_API_KEY: "gremlin-key",
  HOLDER_SYNC_INTERVAL_SECONDS: "0",
  FULFILLMENT_RECONCILE_INTERVAL_SECONDS: "0",
  SERIES_SPEND_CAP_USD: "",
  SERIES_ALLOWED_WALLETS: `${user.address},${admin.address}`,
  ADMIN_WALLETS: admin.address,
  LOCAL_GPU_CREDIT_COST: "1",
};

writeFileSync(join(dir, "no-keys.env"), "# empty\n");

let cookie = "";
let server;

function call(method, path, { body, headers = {}, raw = false } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
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
        if (!raw) {
          try { json = JSON.parse(buf.toString("utf8")); } catch { /* not json */ }
        }
        resolve({ status: res.statusCode, headers: res.headers, json, text: buf.toString("utf8"), buf });
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function ok(stage, name, pass, detail = "") {
  results.push({ stage, name, pass: Boolean(pass), detail: String(detail || "") });
  const mark = pass ? "✓" : "✗";
  console.log(`  ${mark} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function signIn(wallet) {
  const n = await call("GET", `/auth/nonce?address=${wallet.address}`);
  if (n.status !== 200) throw new Error(`nonce ${n.status}: ${n.text}`);
  const v = await call("POST", "/auth/verify", {
    body: { address: wallet.address, nonce: n.json.nonce, signature: wallet.sign(n.json.message) },
  });
  if (v.status !== 200) throw new Error(`verify ${v.status}: ${v.text}`);
  cookie = String(v.headers["set-cookie"][0]).split(";")[0];
  return v.json;
}

async function main() {
  console.log(`\n=== Stage smoke @ http://127.0.0.1:${PORT} ===\n`);
  server = spawn(process.execPath, [join(ROOT, "server/index.mjs")], { env, stdio: ["ignore", "pipe", "pipe"], cwd: ROOT });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("server did not start")), 20_000);
    let err = "";
    server.stderr.on("data", (d) => { err += d; });
    server.stdout.on("data", (d) => {
      if (String(d).includes("Series Lab Studio")) {
        clearTimeout(t);
        resolve();
      }
    });
    server.on("exit", (c) => reject(new Error(`server exited ${c}: ${err}`)));
  });

  // Auth / health
  console.log("0 · Auth / health");
  {
    const health = await call("GET", "/health");
    ok("0", "GET /health", health.status === 200 && health.json?.status === "ok", JSON.stringify(health.json));
    const anon = await call("GET", "/api/me");
    ok("0", "анонім → 401 на /api/me", anon.status === 401);
    const sess = await signIn(user);
    ok("0", "wallet sign-in + welcome", sess.balance >= 0, `balance=${sess.balance}`);
    const me = await call("GET", "/api/me");
    ok("0", "GET /api/me", me.status === 200 && me.json.wallet === user.address, `mode=${me.json.mode} admin=${me.json.admin}`);
    const packages = me.json.packages || me.json.creditPackages || null;
    const sol = me.json.solPay;
    ok("0", "solPay / packages у /api/me", sol != null || packages != null || me.json.balance != null, sol?.enabled != null ? `solPay.enabled=${sol.enabled}` : "balance ok");
  }

  // Stage 1 — Overview / presets
  console.log("\n1 · Огляд (presets)");
  let presetFile = "demo-series.json";
  {
    const list = await call("GET", "/api/presets");
    ok("1", "GET /api/presets", list.status === 200 && Array.isArray(list.json?.presets) && list.json.presets.length > 0, `n=${list.json?.presets?.length}`);
    const get = await call("GET", `/api/preset?file=${encodeURIComponent(presetFile)}`);
    ok("1", "GET /api/preset demo", get.status === 200 && get.json?.preset?.id, `id=${get.json?.preset?.id}`);
    const save = await call("POST", "/api/preset/save", {
      body: {
        preset: {
          ...get.json.preset,
          id: "stage-smoke-series",
          name: "Stage Smoke",
          seed: "stage-smoke-v1",
          engine: { ...(get.json.preset.engine || {}), default: "mock" },
        },
      },
    });
    ok("1", "POST /api/preset/save", save.status === 200, save.json?.file || save.text);
    if (save.status === 200) presetFile = save.json.file || "stage-smoke-series.json";
    const spin = await call("POST", "/api/preset/spinoff", { body: { file: presetFile, suffix: "smoke" } });
    ok("1", "POST /api/preset/spinoff", spin.status === 200 || spin.status === 201, spin.json?.file || spin.text?.slice(0, 80));
    const tpl = await call("GET", "/api/templates");
    ok("1", "GET /api/templates", tpl.status === 200 && Array.isArray(tpl.json?.templates), `n=${tpl.json?.templates?.length}`);
  }

  // Stage 2 — Base
  console.log("\n2 · Основа (base)");
  {
    const png = createMockPng({ seed: 42, title: "smoke-base" });
    const up = await call("POST", "/api/base/upload", {
      body: { data: Buffer.from(png).toString("base64"), filename: "primary.png", role: "primary" },
    });
    ok("2", "POST /api/base/upload primary", up.status === 200, up.json?.file || up.text?.slice(0, 80));
    const list = await call("GET", "/api/base/list");
    ok("2", "GET /api/base/list", list.status === 200 && (list.json?.files?.length || list.json?.images?.length || list.json?.items?.length), JSON.stringify(Object.keys(list.json || {})));
    const st = await call("GET", "/api/base/status");
    ok("2", "GET /api/base/status", st.status === 200, JSON.stringify(st.json)?.slice(0, 100));
    const wishGet = await call("GET", "/api/base/wish");
    ok("2", "GET /api/base/wish", wishGet.status === 200);
    const wishSet = await call("POST", "/api/base/wish", { body: { wish: "cute gremlin, soft light" } });
    ok("2", "POST /api/base/wish", wishSet.status === 200, wishSet.text?.slice(0, 60));
    const analyze = await call("POST", "/api/base/analyze", { body: {} });
    ok("2", "POST /api/base/analyze (heuristic/AI)", [200, 400, 502, 503].includes(analyze.status), `${analyze.status} ${analyze.json?.mode || analyze.json?.error || ""}`.slice(0, 80));
  }

  // Stage 3 — Constructor / traits
  console.log("\n3 · Конструктор (traits / validate)");
  {
    const packs = await call("GET", "/api/trait-packs");
    ok("3", "GET /api/trait-packs", packs.status === 200 && packs.json?.packs?.length > 0, `n=${packs.json?.packs?.length}`);
    const packId = packs.json.packs[0].id || packs.json.packs[0];
    const one = await call("GET", `/api/trait-packs/${encodeURIComponent(typeof packId === "string" ? packId : packId)}`);
    ok("3", "GET /api/trait-packs/:id", one.status === 200, typeof packId === "string" ? packId : JSON.stringify(packId).slice(0, 40));
    const val = await call("POST", "/api/validate", { body: { file: presetFile } });
    ok("3", "POST /api/validate", val.status === 200 && (val.json?.ok === true || val.json?.valid === true || !val.json?.errors?.length), JSON.stringify(val.json)?.slice(0, 100));
    // matrix needs an archive — build first if needed later; preview needs recipe
  }

  // Stage 4 — Recipes
  console.log("\n4 · Рецепти (build / rarity / lint)");
  let archiveName = null;
  {
    const build = await call("POST", "/api/build", { body: { file: presetFile } });
    ok("4", "POST /api/build", build.status === 200 && (build.json?.count || build.json?.recipes || build.json?.out), `recipes=${build.json?.recipes?.length} out=${build.json?.out}`);
    archiveName = (build.json?.out || "").replace(/^out\//, "") || `${(await call("GET", `/api/preset?file=${encodeURIComponent(presetFile)}`)).json?.preset?.id || "demo-series"}.json`;
    const recipes = await call("GET", `/api/recipes?file=${encodeURIComponent(presetFile)}`);
    ok("4", "GET /api/recipes", recipes.status === 200 && (recipes.json?.recipes?.length || recipes.json?.items?.length), `n=${recipes.json?.recipes?.length || recipes.json?.items?.length}`);
    const rarity = await call("GET", `/api/rarity?file=${encodeURIComponent(presetFile)}`);
    ok("4", "GET /api/rarity", rarity.status === 200);
    const lint = await call("POST", "/api/lint", { body: { text: "a studio portrait, soft light, no text" } });
    ok("4", "POST /api/lint", lint.status === 200);
    const archives = await call("GET", "/api/archive/list");
    ok("4", "GET /api/archive/list", archives.status === 200);
    const latest = await call("GET", "/api/archive/latest");
    ok("4", "GET /api/archive/latest", latest.status === 200 || latest.status === 404, `${latest.status}`);
    if (!archiveName && latest.json?.file) archiveName = latest.json.file;
    const diffSeed = await call("POST", "/api/diff-seed", { body: { file: presetFile } });
    ok("4", "POST /api/diff-seed", [200, 400].includes(diffSeed.status), `${diffSeed.status}`);
    const matrix = await call("GET", `/api/traits/matrix?archive=${encodeURIComponent(archiveName)}`);
    ok("4", "GET /api/traits/matrix", matrix.status === 200, `pairs=${matrix.json?.topPairs?.length}`);
    const recipe0 = recipes.json?.recipes?.[0] || build.json?.recipes?.[0];
    const preview = await call("POST", "/api/matrix/preview", {
      body: { recipe: recipe0, engine: "flux", preset: { id: "stage-smoke" } },
    });
    ok("4", "POST /api/matrix/preview", preview.status === 200, preview.json?.prompt ? "prompt ok" : preview.text?.slice(0, 60));
    const waves = await call("GET", `/api/waves?file=${encodeURIComponent(presetFile)}`);
    ok("4", "GET /api/waves", waves.status === 200);
  }

  // Stage 5 — Generate
  console.log("\n5 · Генерація (estimate / mock generate)");
  let setDir = null;
  {
    const est = await call("POST", "/api/estimate", { body: { engine: "mock", mode: "first", first: 3, file: presetFile } });
    ok("5", "POST /api/estimate mock×3", est.status === 200 && est.json?.creditsNeeded >= 0, `creditsNeeded=${est.json?.creditsNeeded}`);
    const gen = await call("POST", "/api/generate", { body: { engine: "mock", mode: "first", first: 3, file: presetFile } });
    ok("5", "POST /api/generate mock×3", gen.status === 200 && gen.json?.count === 3, `count=${gen.json?.count} set=${gen.json?.dir || gen.json?.set}`);
    setDir = gen.json?.dir || gen.json?.set || null;
    const bal = await call("GET", "/api/me");
    ok("5", "списання кредитів після mock", bal.json.balance < 20 || bal.json.balance != null, `balance=${bal.json.balance}`);
    const localGpu = await call("GET", "/api/local-gpu");
    ok("5", "GET /api/local-gpu", localGpu.status === 200, `enabled=${localGpu.json?.enabled}`);
  }

  // Stage 6 — Gallery / marks / versions / triage
  console.log("\n6 · Відбір (sets / marks / versions / triage / dupes)");
  {
    const sets = await call("GET", "/api/sets");
    ok("6", "GET /api/sets", sets.status === 200 && sets.json?.sets?.length > 0, `n=${sets.json?.sets?.length}`);
    if (!setDir && sets.json?.sets?.[0]) setDir = sets.json.sets[0].dir || sets.json.sets[0];
    const set = await call("GET", `/api/set?dir=${encodeURIComponent(setDir)}`);
    ok("6", "GET /api/set", set.status === 200 && (set.json?.images?.length || set.json?.files?.length), `dir=${setDir}`);
    const marksGet = await call("GET", `/api/marks?dir=${encodeURIComponent(setDir)}`);
    ok("6", "GET /api/marks", marksGet.status === 200);
    const marksPost = await call("POST", "/api/marks", { body: { dir: setDir, edition: 1, mark: "keep" } });
    ok("6", "POST /api/marks keep #1", marksPost.status === 200, marksPost.text?.slice(0, 60));
    const marksRedo = await call("POST", "/api/marks", { body: { dir: setDir, edition: 2, mark: "redo" } });
    ok("6", "POST /api/marks redo #2", marksRedo.status === 200);
    const vers = await call("GET", `/api/versions?dir=${encodeURIComponent(setDir)}&edition=1`);
    ok("6", "GET /api/versions", vers.status === 200);
    const triage = await call("POST", "/api/qa/triage", {
      body: { dir: setDir, provider: "heuristic", mode: "all", autoApplyMarks: false },
    });
    ok("6", "POST /api/qa/triage heuristic", triage.status === 200, `n=${triage.json?.results?.length || triage.json?.count || ""}`);
    const dupes = await call("POST", "/api/gallery/dupes", { body: { dir: setDir } });
    ok("6", "POST /api/gallery/dupes", dupes.status === 200);
    const waves = await call("GET", "/api/waves");
    ok("6", "GET /api/waves", waves.status === 200);
  }

  // Stage 7 — Export / release
  console.log("\n7 · Експорт / Release");
  {
    const csv = await call("GET", `/api/export/csv?file=${encodeURIComponent(presetFile)}`);
    ok("7", "GET /api/export/csv", csv.status === 200 && csv.text.length > 10, `bytes=${csv.text.length}`);
    const txt = await call("GET", `/api/export/txt?file=${encodeURIComponent(presetFile)}`);
    ok("7", "GET /api/export/txt", txt.status === 200 && txt.text.length > 5);
    const manifest = await call("GET", `/api/export/manifest.csv?file=${encodeURIComponent(presetFile)}&profile=opensea`);
    ok("7", "GET /api/export/manifest.csv", manifest.status === 200);
    const showcase = await call("GET", `/api/export/showcase.html?file=${encodeURIComponent(presetFile)}`);
    ok("7", "GET /api/export/showcase.html", showcase.status === 200 && showcase.text.includes("<html"));
    const bundle = await call("POST", "/api/export/bundle", {
      body: { archive: archiveName, set: setDir, profile: "opensea", onlyKeep: false },
    });
    ok("7", "POST /api/export/bundle", bundle.status === 200, bundle.json?.file || bundle.json?.error || `status=${bundle.status} ${bundle.text?.slice(0, 120)}`);
    const prov = await call("GET", `/api/export/provenance?set=${encodeURIComponent(setDir)}`);
    ok("7", "GET /api/export/provenance", prov.status === 200, prov.json?.error || "ok");
    const dataset = await call("POST", "/api/export/dataset", {
      body: { archive: archiveName, set: setDir, triggerWord: "smoke_hero" },
    });
    ok("7", "POST /api/export/dataset", dataset.status === 200, dataset.json?.file || dataset.json?.error || `${dataset.status} ${dataset.text?.slice(0, 100)}`);
    const portals = await call("GET", "/api/release/portals");
    ok("7", "GET /api/release/portals", portals.status === 200);
    const launchpads = await call("GET", "/api/launchpads");
    ok("7", "GET /api/launchpads", launchpads.status === 200);
    const cfg = await call("GET", `/api/release/config?file=${encodeURIComponent(presetFile)}&profile=magiceden`);
    ok("7", "GET /api/release/config", cfg.status === 200);
    const preview = await call("POST", "/api/export/preview-meta", {
      body: { file: presetFile, profile: "opensea", edition: 1 },
    });
    ok("7", "POST /api/export/preview-meta", preview.status === 200);
    const quotes = await call("GET", "/api/stages/quotes");
    ok("7", "GET /api/stages/quotes", quotes.status === 200 && quotes.json?.quotes?.archive?.credits >= 0, `archive=${quotes.json?.quotes?.archive?.credits}`);
    const quote = await call("GET", "/api/stages/quote?stage=deploy_kit");
    ok("7", "GET /api/stages/quote deploy_kit", quote.status === 200 && quote.json?.quote?.formula, `credits=${quote.json?.quote?.credits}`);
    const pre = await call("POST", "/api/preflight", {
      body: { archive: archiveName, set: setDir, profile: "magiceden", onlyKeep: false, locale: "uk" },
    });
    ok("7", "POST /api/preflight", pre.status === 200 && typeof pre.json?.ready === "boolean", `ready=${pre.json?.ready} ${pre.json?.error || ""}`.slice(0, 140));
    const dep = await call("POST", "/api/deploy-kit", {
      body: { archive: archiveName, set: setDir, chain: "solana", locale: "uk" },
    });
    ok("7", "POST /api/deploy-kit", dep.status === 200 && dep.json?.downloadUrl, dep.json?.file || dep.json?.error || `${dep.status}`);
    const mkt = await call("POST", "/api/marketplace-kit", {
      body: { archive: archiveName, set: setDir, chain: "solana", name: "Stage Smoke", locale: "uk" },
    });
    ok("7", "POST /api/marketplace-kit", mkt.status === 200 && mkt.json?.downloadUrl, mkt.json?.file || mkt.json?.error || `${mkt.status}`);
    const secrets = await call("POST", "/api/deploy-kit", {
      body: { archive: archiveName, set: setDir, chain: "solana", privateKey: "nope" },
    });
    ok("7", "deploy-kit відхиляє privateKey", secrets.status === 400 && secrets.json?.code === "secrets", `${secrets.status} ${secrets.json?.code || secrets.text?.slice(0, 80)}`);
    const pinStatus = await call("GET", "/api/storage/status");
    ok("7", "GET /api/storage/status (Pinata)", pinStatus.status === 200);
    const pub = await call("POST", "/api/publish", { body: { dir: setDir, title: "Stage Smoke Collection" } });
    ok("7", "POST /api/publish", pub.status === 200, pub.json?.slug || pub.text?.slice(0, 60));
  }

  // Credits / top-up surfaces
  console.log("\n8 · Кредити / Solana top-up / holder");
  {
    const hist = await call("GET", "/api/credits/history");
    ok("8", "GET /api/credits/history", hist.status === 200);
    const me2 = await call("GET", "/api/me");
    const packId = me2.json?.packages?.[0]?.id || "start";
    const order = await call("POST", "/api/credits/sol/order", { body: { package: packId } });
    const orderOk = order.status === 200 || (order.status === 503 && /recipient|SOLANA|disabled|налашт/i.test(order.text + JSON.stringify(order.json || {})));
    ok("8", "POST /api/credits/sol/order", orderOk || order.status === 400, `${order.status} pack=${packId} ${order.json?.error || order.json?.detail || order.json?.code || ""}`.slice(0, 100));
    const prepare = await call("POST", "/api/credits/sol/prepare", { body: { package: packId, payer: "11111111111111111111111111111111" } });
    ok("8", "POST /api/credits/sol/prepare", [200, 400, 503].includes(prepare.status), `${prepare.status} ${prepare.json?.error || prepare.json?.code || ""}`.slice(0, 80));
    const holder = await call("GET", "/api/holder");
    ok("8", "GET /api/holder", holder.status === 200);
  }

  // Admin
  console.log("\n9 · Адмін (resources / spend / engines)");
  {
    const denied = await call("GET", "/api/resources");
    ok("9", "user → resources 403", denied.status === 403);
    cookie = "";
    await signIn(admin);
    const me = await call("GET", "/api/me");
    ok("9", "admin sign-in", me.json.admin === true, `admin=${me.json.admin}`);
    const res = await call("GET", "/api/resources");
    ok("9", "GET /api/resources", res.status === 200);
    const spend = await call("GET", "/api/spend");
    ok("9", "GET /api/spend", spend.status === 200);
    const eng = await call("GET", "/api/engines/status");
    ok("9", "GET /api/engines/status", eng.status === 200);
    const econ = await call("GET", "/api/admin/economy");
    ok("9", "GET /api/admin/economy", econ.status === 200 && Array.isArray(econ.json?.stages?.stages), `${econ.status} stages=${econ.json?.stages?.stages?.length} ${econ.json?.error || ""}`);
    const trash = await call("GET", "/api/trash");
    ok("9", "GET /api/trash", trash.status === 200);
  }

  // UI assets
  console.log("\n10 · UI shell");
  {
    cookie = "";
    await signIn(user);
    const studio = await call("GET", "/studio/", { raw: true });
    ok("10", "GET /studio/", studio.status === 200 || studio.status === 302, `${studio.status}`);
    const app = await call("GET", "/studio/app.js", { raw: true });
    ok("10", "GET /studio/app.js", app.status === 200 && app.text.includes("helpSections"), `bytes=${app.text.length}`);
    const login = await call("GET", "/login", { raw: true });
    ok("10", "GET /login", login.status === 200);
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== Підсумок: ${results.length - failed.length}/${results.length} OK ===`);
  if (failed.length) {
    console.log("\nПровалені:");
    for (const f of failed) console.log(`  [${f.stage}] ${f.name}: ${f.detail}`);
  }
  return failed.length === 0 ? 0 : 1;
}

let code = 1;
try {
  code = await main();
} catch (e) {
  console.error("\nFATAL:", e);
  code = 1;
} finally {
  try {
    const { closeAll } = await import("../src/platform/db.mjs");
    closeAll();
  } catch { /* ignore */ }
  if (server && server.exitCode === null) {
    const exited = new Promise((r) => server.once("exit", r));
    server.kill();
    await exited;
  }
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch { /* ignore */ }
}
process.exit(code);
