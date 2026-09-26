#!/usr/bin/env node
/**
 * Series Lab Studio.
 * Development placement: http://127.0.0.1:5344/studio/ (HOST).
 * The product itself is always the full platform: wallet sign-in, per-wallet
 * data, credits. SERIES_MODE=local is an explicit file-folder workshop and
 * may listen only on loopback.
 */
import { createServer } from "node:http";
import { AsyncLocalStorage } from "node:async_hooks";
import { exec } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { dirname, extname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildRecipes,
  buildPrompt,
  appendSupplyWave,
  describeSupply,
  findDupes,
  dna,
  duplicates,
  duplicateGroups,
  diffArchives,
  spinoffPreset,
  loadTraitsFromPreset,
  optionsFor,
  validatePreset,
  validatePresetSemantics,
  validateArchive,
  lintPrompt,
  lintPrompts,
  computeRarity,
  collectConflicts,
  checkConflicts,
  conflictMessage,
  checkImageFile,
  runChecklist,
  buildBundleZip,
  listImageEditions,
  resolveBaseImageForRecipe,
  filterRedoEditions,
  filterRedoRecipes,
  validateTraitPack,
  exportPresetAsTraitPack,
  analyzeBaseImage,
  mapConcurrent,
  triageBatch,
  triageImageOffline,
  triageImageVision,
  checkStorageStatus,
  uploadToPinata,
  generateMetadataPreview,
  calculateDeterministicCid,
  getLaunchpadProfiles,
  LAUNCHPAD_PROFILES,
  exportManifestCsv,
  getLaunchpadPortalUrls,
  buildSugarConfig,
  buildThirdwebConfig,
  generateShowcaseHtml,
  calculateRarityScores,
  calculateCollectionProvenance,
  verifyProvenance,
  exportDatasetZip,
  dispatchBatchNotification,
  sendTelegramNotification,
  sendTelegramTest,
  getTelegramConfig,
  formatEnginePrompt,
} from "../src/index.mjs";
import { loadKeys, loadKeysExtra } from "../src/keys.mjs";
import {
  ENGINES,
  TXT2IMG,
  buildWishPrompt,
  engineCtx,
  getEngine,
  getTxt2Img,
  pickAvailableEngine,
  withRetry,
  clampStrength,
} from "../src/engines.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const UI = join(__dirname, "ui");
const PUBLIC = join(__dirname, "public");
const TEMPLATES = join(ROOT, "templates");
const KEYS_PATH = loadKeys();
const EXTRA_KEYS = loadKeysExtra([join(ROOT, ".env")]);
if (KEYS_PATH) console.log(`Keys loaded from ${KEYS_PATH} (values never sent to browser)`);
else console.log("Keys: no .env found (set SERIES_KEYS_FILE or place .env in project root)");
if (process.env.SERIES_PLATFORM_ENV) {
  console.warn("SERIES_PLATFORM_ENV is ignored — Series Lab is self-contained (keys live in this .env only)");
}
{
  console.log(
    solPayInfo().enabled
      ? "Top-up: USDC on Solana · payment check on"
      : "Top-up: off — set SOLANA_PAY_RECIPIENT (public Solana address) in Lab .env",
  );
  const tg = getTelegramConfig();
  console.log(
    tg.configured
      ? `Telegram (Series Lab): on · ${tg.source}`
      : "Telegram (Series Lab): off — set SERIES_TELEGRAM_BOT_TOKEN + SERIES_TELEGRAM_CHAT_ID in Lab .env",
  );
}
// Full product unless SERIES_MODE=local. 127.0.0.1 is where the dev server sits, not a reduced mode.
const PUBLIC_MODE = (process.env.SERIES_MODE || "public") === "public";
const PLATFORM_ON = PUBLIC_MODE || process.env.SERIES_PLATFORM === "1";
const DATA_DIR = resolve(process.env.SERIES_DATA_DIR || join(ROOT, "data"));
const LOCAL_PATHS = {
  root: ROOT,
  input: join(ROOT, "input"),
  presets: join(ROOT, "presets"),
  traits: join(ROOT, "libraries", "traits"),
  out: join(ROOT, "out"),
  workspace: join(ROOT, "workspace"),
};
const reqCtx = new AsyncLocalStorage();
const P = () => reqCtx.getStore()?.paths ?? LOCAL_PATHS;
const currentWallet = () => reqCtx.getStore()?.wallet ?? null;
const bundlesDir = () => join(P().out, "bundles");
const workspaceFile = () => join(P().workspace, "current.json");
const trashDir = () => join(P().out, "trash");
// The spend log/cap is server-wide in public mode (one operator bill), per project locally.
const renderLog = () => (PUBLIC_MODE ? join(DATA_DIR, "render-log.jsonl") : join(P().out, "render-log.jsonl"));
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 5344);
const OPEN = process.argv.includes("--open");
const ALLOWED_HOSTS = allowedHostnames(HOST, process.env.SERIES_ALLOWED_HOSTS);
if (EXTRA_KEYS.length) console.log(`Also merged: ${EXTRA_KEYS.join(", ")}`);


import { testEngineConnection } from "../src/connectors.mjs";
import { allowedHostnames, checkApiRequest, openAccessError } from "./guard.mjs";
import { handlePlatform, sessionWallet, startPlatformBackground } from "./platform.mjs";
import { PACKAGES, checkGenerationRate, creditCost, deductCredits, freemiumCheck, freemiumRecord, getBalance,
  listTransactions, recordFunnelEvent, referralCodeFor, refundCredits, localGpuCreditCost,
} from "../src/platform/billing.mjs";
import { rateLimit } from "../src/platform/ratelimit.mjs";
import { checkSolOrders, createSolOrder, listSolOrders, prepareSolPayment, solPayInfo } from "../src/platform/solpay.mjs";
import { isAdmin, notifyOperator } from "../src/platform/ops.mjs";
import { providersSnapshot, keyHealth, providerFloatStatus } from "../src/platform/providers.mjs";
import { claim as claimHolderBonus, eligibility as holderEligibility } from "../src/platform/holders.mjs";
import { checkPromptSafetySync, safetyMessage } from "../src/platform/safety.mjs";
import { publishCollection } from "../src/platform/site.mjs";
import { economyReport } from "../src/platform/margin.mjs";
import { funnel } from "../src/platform/stats.mjs";
import { writeJsonAtomic } from "../src/fs-safe.mjs";
import { addVersion, dropVersion, listVersions, setCurrent, versionCounts } from "../src/versions.mjs";
import { listTrash, pruneTrash, purgeTrash, restoreTrash, trashFiles } from "../src/trash.mjs";
import { appendRenderLog, capError, engineStatsToday, recentEngineErrors, spendByEngineToday, spendCap, spentToday } from "../src/spend.mjs";
import { failureBreaker } from "../src/pool.mjs";

const RESOURCE_KEYS = [
  { name: "OPENAI_API_KEY", env: "OPENAI_API_KEY", note: "OpenAI Images / GPT image" },
  { name: "REPLICATE_API_TOKEN", env: "REPLICATE_API_TOKEN", note: "Replicate / Flux Kontext" },
  { name: "FAL_KEY", env: "FAL_KEY", note: "Fal.ai Fast Cloud (Flux Schnell/Dev)" },
  { name: "RUNWARE_API_KEY", env: "RUNWARE_API_KEY", note: "Runware AI Fast Cloud" },
  { name: "COMFYUI_URL", env: "COMFYUI_URL", note: "Local ComfyUI on PC · Lab support fee (LOCAL_GPU_CREDIT_COST)" },
  { name: "A1111_URL", env: "A1111_URL", note: "Local A1111 on PC · Lab support fee (LOCAL_GPU_CREDIT_COST)" },
  { name: "STABILITY_API_KEY", env: "STABILITY_API_KEY", note: "Stability AI" },
  { name: "POLLINATIONS_API_KEY", env: "POLLINATIONS_API_KEY", note: "Pollinations / Pollen" },
  { name: "ANTHROPIC_API_KEY", env: "ANTHROPIC_API_KEY", note: "Claude critic (optional, Studio)" },
  { name: "PINATA_JWT", env: "PINATA_JWT", note: "Pinata IPFS Storage Dispatcher" },
  { name: "SERIES_TELEGRAM_BOT_TOKEN", env: "SERIES_TELEGRAM_BOT_TOKEN", note: "Series Lab Telegram bot" },
  { name: "SERIES_TELEGRAM_CHAT_ID", env: "SERIES_TELEGRAM_CHAT_ID", note: "Series Lab operator chat / channel" },
  { name: "TELEGRAM_BOT_TOKEN", env: "TELEGRAM_BOT_TOKEN", note: "Fallback Telegram bot (Lab .env)" },
  { name: "TELEGRAM_CHAT_ID", env: "TELEGRAM_CHAT_ID", note: "Fallback Telegram chat (Lab .env)" },
  { name: "SOLANA_PAY_RECIPIENT", env: "SOLANA_PAY_RECIPIENT", note: "Direct USDC (Solana) receiving address" },
];

function nowIsoKyiv() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "shortOffset",
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  let offset = "+03:00";
  const tz = get("timeZoneName");
  if (tz && /^GMT[+-]/.test(tz)) {
    const m2 = tz.match(/GMT([+-])(\d+)(?::?(\d+))?/);
    if (m2) offset = `${m2[1]}${pad(Number(m2[2]))}:${pad(Number(m2[3] || 0))}`;
  }
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}${offset}`;
}

function send(res, status, body, type = "application/json; charset=utf-8", extraHeaders = {}) {
  const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    const MAX = 25 * 1024 * 1024;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolveBody({});
      try {
        resolveBody(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function httpError(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, extra });
}

/** Moves files to out/trash instead of deleting them. */
function toTrash(paths, reason) {
  return trashFiles({ root: P().root, trashDir: trashDir() }, paths, reason);
}

/** Throws 400 `spend_cap` when `plannedUsd` would exceed today's cap. */
function assertSpend(plannedUsd) {
  const cap = spendCap(process.env.SERIES_SPEND_CAP_USD);
  const spent = spentToday(renderLog());
  const error = capError({ cap, spent, planned: plannedUsd });
  if (!error) return;
  if (PUBLIC_MODE) {
    // Server-wide operator cap: users get a neutral message, the operator sees the numbers in the log.
    console.warn(`[spend-cap] ${error}`);
    throw httpError(503, "The service is at its daily capacity — please try again tomorrow.", { code: "capacity" });
  }
  throw httpError(400, error, { code: "spend_cap", capUsd: cap, spentTodayUsd: spent, plannedUsd });
}

function logRender(entry) {
  try {
    appendRenderLog(renderLog(), entry);
  } catch (e) {
    console.warn(`[render-log] ${e.message}`);
  }
}

/** Runs one paid engine call, logging success/failure to render-log.jsonl. */
// ── Credits (public mode) ──────────────────────────────────────────────────
// Every paid engine call is reserved in credits BEFORE it runs and refunded if
// it fails — the same money path as Промт (debit note "image generation",
// refund "refund: generation failed", which Passport quests count).
const LOCAL_ONLY_ENGINES = new Set(["comfyui", "a1111"]);
const visionCreditCost = () => Math.max(0, Number.parseInt(process.env.VISION_CREDIT_COST || "1", 10) || 0);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function isLoopbackHost(host) {
  return LOOPBACK_HOSTS.has(String(host || "").toLowerCase());
}

function isLoopbackUrl(raw) {
  try {
    return isLoopbackHost(new URL(String(raw || "")).hostname);
  } catch {
    return false;
  }
}

/**
 * ComfyUI / A1111 on the user's PC.
 * - SERIES_MODE=local → allowed (dev; no credits ledger).
 * - SERIES_MODE=public + Studio on loopback (or SERIES_LOCAL_GPU=1) → allowed + Lab support fee in credits.
 * - Public cloud (0.0.0.0 / remote) → blocked (server has no user GPU).
 */
function localGpuPolicy() {
  const flag = String(process.env.SERIES_LOCAL_GPU || "").trim();
  const comfyUrl = String(process.env.COMFYUI_URL || "http://127.0.0.1:8188").trim();
  const a1111Url = String(process.env.A1111_URL || process.env.SD_WEBUI_URL || "http://127.0.0.1:7860").trim();
  const loopbackStudio = isLoopbackHost(HOST);
  let enabled = false;
  let reason = "public_cloud";
  if (!PUBLIC_MODE) {
    enabled = true;
    reason = "local_studio";
  } else if (flag === "0") {
    enabled = false;
    reason = "disabled";
  } else if (flag === "1" || loopbackStudio) {
    enabled = true;
    reason = "pc_with_account";
  }
  const fee = localGpuCreditCost();
  return {
    enabled,
    reason,
    monetized: Boolean(PUBLIC_MODE && enabled),
    creditPerImage: fee,
    engines: ["comfyui", "a1111"],
    urls: { comfyui: comfyUrl, a1111: a1111Url },
    urlsLoopback: { comfyui: isLoopbackUrl(comfyUrl), a1111: isLoopbackUrl(a1111Url) },
    env: {
      comfyui: Boolean(process.env.COMFYUI_URL?.trim() || process.env.COMFYUI_ENABLED === "1"),
      a1111: Boolean(process.env.A1111_URL?.trim() || process.env.SD_WEBUI_URL?.trim() || process.env.A1111_ENABLED === "1"),
    },
  };
}

function assertEngineAllowed(engine) {
  if (!LOCAL_ONLY_ENGINES.has(engine)) return;
  const gpu = localGpuPolicy();
  if (gpu.enabled) {
    const url = gpu.urls[engine];
    if (PUBLIC_MODE && url && !isLoopbackUrl(url)) {
      throw httpError(
        400,
        "Local GPU URL must point to this PC (127.0.0.1). Remote Comfy/A1111 is not supported.",
        { code: "local_gpu", engine },
      );
    }
    return;
  }
  throw httpError(
    400,
    "ComfyUI / Automatic1111 need Studio on your PC (HOST=127.0.0.1 or SERIES_LOCAL_GPU=1). On the public website use cloud engines — GPU fees fund Lab; local GPU charges a small support fee in credits.",
    { code: "local_gpu", engine },
  );
}

function insufficient(wallet, needed) {
  return httpError(402, `Not enough credits: need ${needed}, balance ${getBalance(wallet)}. Top up in the header (💳).`, {
    code: "credits", needed, balance: getBalance(wallet),
  });
}

/** Reserve credits for one paid call. → charge handle (or null in local mode / free engine). */
function chargeCredits({ engine, costUsd = 0, reference = false, credits = null, note, rateLimited = true }) {
  if (!PUBLIC_MODE) return null;
  const wallet = currentWallet();
  if (!wallet) throw httpError(401, "Sign in with your wallet first", { code: "auth" });
  assertEngineAllowed(engine);
  const amount = credits ?? creditCost(engine, { reference, costUsd });
  if (amount <= 0) return null;
  if (rateLimited && !checkGenerationRate(wallet)) {
    throw httpError(429, "Generation rate limit reached — wait a minute (top up to lift the limit).", { code: "rate" });
  }
  const fm = freemiumCheck(wallet);
  if (!fm.allowed) throw httpError(429, "Daily free generation limit reached — top up to continue.", { code: "freemium" });
  const debitNote = note
    || (LOCAL_ONLY_ENGINES.has(engine) ? "Lab support · local GPU" : undefined);
  if (!deductCredits(wallet, amount, { engine, ...(debitNote ? { note: debitNote } : {}) })) throw insufficient(wallet, amount);
  freemiumRecord(wallet, 1);
  return { wallet, amount, engine, note: debitNote };
}

function refundCharge(charge) {
  if (!charge) return;
  try {
    refundCredits(charge.wallet, charge.amount, { engine: charge.engine, ...(charge.note ? { note: `refund: ${charge.note} failed` } : {}) });
    freemiumRecord(charge.wallet, -1);
  } catch (e) {
    console.error(`[credits] refund failed for ${charge.wallet}: ${e.message}`);
  }
}

/** Waits (max ~2 min) for a free per-minute slot — batch mode, like Промт wait_for_generation_rate. */
async function waitForRateSlot(maxMs = 120_000) {
  if (!PUBLIC_MODE) return;
  const wallet = currentWallet();
  const until = Date.now() + maxMs;
  while (!checkGenerationRate(wallet) && Date.now() < until) await new Promise((r) => setTimeout(r, 2000));
}

function trackFunnel(event, payload) {
  const wallet = currentWallet();
  if (wallet) recordFunnelEvent(wallet, event, payload || null);
}

/** Brand/franchise lint + content safety. → null when OK, else an error body. */
function blockedPrompts(texts) {
  const list = texts.map((t) => String(t ?? ""));
  for (const t of list) {
    const safety = checkPromptSafetySync(t);
    if (!safety.ok) return { error: safetyMessage(safety, "en"), code: "safety", category: safety.category };
  }
  const lint = lintPrompts(list);
  if (!lint.ok) return { error: "Prompt blocked by brand/franchise lint", code: "lint", hits: lint.hits };
  return null;
}

async function paidCall(entry, fn) {
  const charge = chargeCredits({ engine: entry.engine, costUsd: entry.costUsd ?? 0, reference: Boolean(entry.reference) });
  try {
    const buf = await fn();
    logRender({ ...entry, ok: true, ...(charge ? { wallet: charge.wallet, credits: charge.amount } : {}) });
    trackFunnel("generate", { kind: entry.kind, count: 1 });
    return buf;
  } catch (e) {
    refundCharge(charge);
    logRender({ ...entry, ok: false, costUsd: 0, error: String(e.message || e).slice(0, 300) });
    throw e;
  }
}

function safeJsonName(file, fallback = "demo-series.json") {
  const base = basename(String(file || fallback)).replace(/[/\\]/g, "");
  if (!base.endsWith(".json")) throw new Error("file must be *.json");
  if (base.includes("..")) throw new Error("bad path");
  return base;
}

function listPresets() {
  if (!existsSync(P().presets)) return [];
  return readdirSync(P().presets)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const p = JSON.parse(readFileSync(join(P().presets, f), "utf8"));
        return { file: f, id: p.id || f, name: p.name || p.id || f, size: p.size, seed: p.seed };
      } catch {
        return { file: f, id: f, name: f };
      }
    });
}

function listTemplates() {
  if (!existsSync(TEMPLATES)) return [];
  return readdirSync(TEMPLATES)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const p = JSON.parse(readFileSync(join(TEMPLATES, f), "utf8"));
        // templates/ also holds non-preset files (e.g. comfyui-workflow.json)
        if (!p || typeof p !== "object" || !p.id || !p.traits) return null;
        return {
          id: p.id || f.replace(/\.json$/, ""),
          file: f,
          name: p.name || p.id,
          titleUk: p._meta?.titleUk || p.name,
          blurb: p._meta?.blurb || p.base?.note || "",
          size: p.size,
          seed: p.seed,
          engine: p.engine,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}


function summarizeTraitPack(pack, file) {
  const items = Array.isArray(pack?.items) ? pack.items : [];
  const keys = items.map((t) => t.key).filter(Boolean);
  const optionCounts = {};
  let optionsTotal = 0;
  for (const t of items) {
    const n = Array.isArray(t?.options) ? t.options.length : 0;
    if (t?.key) optionCounts[t.key] = n;
    optionsTotal += n;
  }
  return {
    id: pack.id || String(file || "").replace(/\.json$/, ""),
    file: file || `${pack.id || "pack"}.json`,
    name: pack.name || pack.id || file,
    description: pack.description || "",
    tags: Array.isArray(pack.tags) ? pack.tags : [],
    keys,
    optionCounts,
    optionsTotal,
    defaults: pack.defaults || null,
  };
}

function listTraitPacks() {
  if (!existsSync(P().traits)) return [];
  return readdirSync(P().traits)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const pack = JSON.parse(readFileSync(join(P().traits, f), "utf8"));
        return summarizeTraitPack(pack, f);
      } catch {
        return {
          id: f.replace(/\.json$/, ""),
          file: f,
          name: f,
          description: "",
          tags: [],
          keys: [],
          optionCounts: {},
          optionsTotal: 0,
          defaults: null,
        };
      }
    })
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function loadTraitPackById(id) {
  const clean = String(id || "").replace(/[/\\]/g, "");
  const candidates = [
    join(P().traits, `${clean}.json`),
    join(P().traits, clean.endsWith(".json") ? clean : `${clean}.json`),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      const pack = JSON.parse(readFileSync(path, "utf8"));
      return { path, file: basename(path), pack, summary: summarizeTraitPack(pack, basename(path)) };
    }
  }
  throw new Error(`trait pack not found: ${clean}`);
}

function loadPresetByFile(file) {
  const base = safeJsonName(file);
  const path = join(P().presets, base);
  if (!existsSync(path)) throw new Error(`preset not found: ${base}`);
  return { path, file: base, preset: JSON.parse(readFileSync(path, "utf8")) };
}

function loadTemplateById(id) {
  const clean = String(id || "").replace(/[/\\]/g, "");
  const candidates = [
    join(TEMPLATES, `${clean}.json`),
    join(TEMPLATES, clean.endsWith(".json") ? clean : `${clean}.json`),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      return { path, preset: JSON.parse(readFileSync(path, "utf8")) };
    }
  }
  throw new Error(`template not found: ${clean}`);
}

function makeArchive(preset) {
  const recipes = buildRecipes(preset, { items: preset.overrides || {} });
  const traitKeys = loadTraitsFromPreset(preset).map((t) => t.key);
  const dupes = duplicates(recipes, traitKeys);
  const archive = {
    schema: "series-archive/v0",
    presetId: preset.id,
    createdAt: nowIsoKyiv(),
    seed: preset.seed,
    size: recipes.length,
    recipes,
  };
  const schema = validateArchive(archive);
  if (!schema.ok) throw new Error(`archive invalid: ${schema.errors || "schema"}`);
  return { archive, dupes, traitKeys };
}

function checkPreset(preset) {
  const schema = validatePreset(preset);
  if (!schema.ok) {
    const err = schema.errors;
    return { ok: false, errors: Array.isArray(err) ? err : [String(err)] };
  }
  const sem = validatePresetSemantics(preset);
  if (!sem.ok) {
    const err = sem.errors;
    return { ok: false, errors: Array.isArray(err) ? err : [String(err)] };
  }
  return { ok: true };
}

function listArchives() {
  if (!existsSync(P().out)) return [];
  return readdirSync(P().out)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const path = join(P().out, f);
      let size;
      let presetId;
      try {
        const a = JSON.parse(readFileSync(path, "utf8"));
        size = a.size ?? a.recipes?.length;
        presetId = a.presetId;
      } catch {
        /* ignore */
      }
      let mtime = 0;
      try {
        mtime = statSync(path).mtimeMs;
      } catch {
        /* ignore */
      }
      return { file: f, size, presetId, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function loadArchiveFile(file) {
  const base = safeJsonName(file);
  const path = join(P().out, base);
  if (!existsSync(path)) throw new Error(`archive not found: ${base}`);
  return { path, file: base, archive: JSON.parse(readFileSync(path, "utf8")) };
}

function loadPresetForArchive(archive) {
  const id = String(archive.presetId || "").replace(/[/\\]/g, "");
  if (!id) throw new Error("archive.presetId missing");
  const candidates = [
    join(P().presets, `${id}.json`),
    join(P().presets, id.endsWith(".json") ? id : `${id}.json`),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      return { path, file: basename(path), preset: JSON.parse(readFileSync(path, "utf8")) };
    }
  }
  throw new Error(`preset not found for archive.presetId=${id}`);
}

function traitsEqual(a, b) {
  const aa = a && typeof a === "object" ? a : {};
  const bb = b && typeof b === "object" ? b : {};
  const keys = new Set([...Object.keys(aa), ...Object.keys(bb)]);
  for (const k of keys) {
    if (String(aa[k] ?? "") !== String(bb[k] ?? "")) return false;
  }
  return true;
}

function enrichRecipe(r) {
  return {
    ...r,
    note: typeof r.note === "string" ? r.note : "",
    edited: Boolean(r.edited),
  };
}

function traitMetaFromPreset(preset) {
  const items = loadTraitsFromPreset(preset);
  const traits = items.map((t) => ({
    key: t.key,
    type: t.type || t.key,
    options: (t.options || []).map((o) => ({
      value: o.value,
      weight: o.weight ?? 1,
      prompt: o.prompt || "",
      ...(Array.isArray(o.lines) ? { lines: o.lines } : {}),
    })),
  }));
  return { traits, traitKeys: items.map((t) => t.key) };
}

function recipesPayload(file, archive, preset) {
  const { traits, traitKeys } = traitMetaFromPreset(preset);
  const recipes = (archive.recipes || []).map(enrichRecipe);
  const rarity = computeRarity(preset, recipes);
  const conflicts = collectConflicts(preset);
  return {
    file,
    presetId: archive.presetId,
    size: archive.size ?? archive.recipes?.length ?? 0,
    recipes,
    traits,
    traitKeys,
    rarity,
    conflicts,
  };
}

function setDirName(engine, strength) {
  const e = String(engine || "kontext").replace(/[^a-z0-9_-]/gi, "");
  const s = Number(strength);
  const str = Number.isFinite(s) ? s.toFixed(2).replace(/0+$/, "").replace(/\.$/, "") : "0.45";
  return `${e}-s${str}`;
}

function safeSetName(name) {
  const base = basename(String(name || "")).replace(/[/\\]/g, "");
  if (!base || base.includes("..") || !/^[a-z0-9._-]+$/i.test(base)) {
    throw new Error("bad set name");
  }
  return base;
}

function listImageSets() {
  if (!existsSync(P().out)) return [];
  const sets = [];
  for (const name of readdirSync(P().out)) {
    const dir = join(P().out, name);
    let st;
    try { st = statSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;
    if (name === "pilots" || name === "trash") continue;
    const files = readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
    if (!files.length && name !== "pilots") {
      // still list dirs that look like engine sets even if empty after wipe? skip empty
      if (!files.length) continue;
    }
    let mtime = st.mtimeMs;
    sets.push({
      dir: name,
      count: files.length,
      mtime,
    });
  }
  return sets.sort((a, b) => b.mtime - a.mtime);
}

function listSetImages(setName) {
  const dirName = safeSetName(setName);
  const dir = join(P().out, dirName);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`set not found: ${dirName}`);
  const images = [];
  const vcounts = versionCounts(dir);
  for (const f of readdirSync(dir)) {
    if (!/\.(png|jpe?g|webp)$/i.test(f)) continue;
    const m = f.match(/^(\d+)/);
    const edition = m ? Number(m[1]) : null;
    const abs = join(dir, f);
    const qa = checkImageFile(abs);
    images.push({
      file: f,
      edition,
      versions: edition != null ? vcounts[String(edition)] || 1 : 1,
      url: `/out/${dirName}/${f}`,
      path: `out/${dirName}/${f}`,
      qa: {
        ok: qa.ok,
        issues: qa.issues,
        bytes: qa.bytes ?? 0,
        format: qa.format || null,
      },
    });
  }
  images.sort((a, b) => (a.edition ?? 0) - (b.edition ?? 0) || a.file.localeCompare(b.file));
  return { dir: dirName, images };
}

function readMarks(setName) {
  const dirName = safeSetName(setName);
  const p = join(P().out, dirName, "marks.json");
  if (!existsSync(p)) return {};
  try {
    const data = JSON.parse(readFileSync(p, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function writeMarks(setName, marks) {
  const dirName = safeSetName(setName);
  const dir = join(P().out, dirName);
  mkdirSync(dir, { recursive: true });
  writeJsonAtomic(join(dir, "marks.json"), marks);
}


function readWorkspace() {
  if (!existsSync(workspaceFile())) return null;
  try {
    return JSON.parse(readFileSync(workspaceFile(), "utf8"));
  } catch {
    return null;
  }
}

function writeWorkspace(data) {
  mkdirSync(P().workspace, { recursive: true });
  const payload = {
    savedAt: nowIsoKyiv(),
    ...(data && typeof data === "object" ? data : {}),
  };
  writeJsonAtomic(workspaceFile(), payload);
  return payload;
}

function resolveLocale(req, body) {
  if (body?.locale) return String(body.locale).slice(0, 8);
  const al = String(req.headers["accept-language"] || "");
  if (/^uk/i.test(al) || /\buk\b/i.test(al)) return "uk";
  return "en";
}

function loadPresetFileSafe(file) {
  try {
    const base = safeJsonName(file);
    const p = join(P().presets, base);
    if (!existsSync(p)) return null;
    return { file: base, preset: JSON.parse(readFileSync(p, "utf8")) };
  } catch {
    return null;
  }
}

function existingEditions(setName) {
  const set = new Set();
  try {
    for (const img of listSetImages(setName).images) {
      if (img.edition != null) set.add(img.edition);
    }
  } catch {
    /* set missing */
  }
  return set;
}

function parseEditionList(raw) {
  return String(raw || "")
    .split(/[,\s]+/)
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

function resolveGenerateSelection(archive, body, setName) {
  const recipes = archive.recipes || [];
  const byEdition = new Map(recipes.map((r) => [r.edition, r]));
  const mode = String(body.mode || body.selection || "pilot");
  const force = mode === "redo" ? (body.force !== false) : Boolean(body.force);
  const have = existingEditions(setName);
  let editions = [];
  if (mode === "pilot") {
    const n = Math.max(1, Math.min(Number(body.pilot) || 10, recipes.length || 1));
    editions = recipes.slice(0, n).map((r) => r.edition);
  } else if (mode === "only") {
    editions = parseEditionList(body.only || body.editions || "");
  } else if (mode === "first") {
    const n = Math.max(1, Math.min(Number(body.first) || 50, recipes.length || 1));
    editions = recipes.slice(0, n).map((r) => r.edition);
  } else if (mode === "missing") {
    editions = recipes.map((r) => r.edition).filter((e) => !have.has(e));
  } else if (mode === "redo") {
    const marks = readMarks(setName);
    editions = filterRedoEditions(marks);
  } else {
    throw new Error(`unknown mode: ${mode}`);
  }
  // keep only editions that exist in archive
  editions = editions.filter((e) => byEdition.has(e));
  const skippedExisting = force ? [] : editions.filter((e) => have.has(e));
  if (!force) editions = editions.filter((e) => !have.has(e));
  return { mode, force, editions, skippedExisting, recipes: editions.map((e) => byEdition.get(e)) };
}

function serveOut(res, urlPath) {
  if (!urlPath.startsWith("/out/")) return false;
  const rel = urlPath.slice("/out/".length);
  if (!rel || rel.includes("..")) {
    send(res, 400, { error: "bad path" });
    return true;
  }
  const file = join(P().out, rel);
  if (!file.startsWith(P().out)) {
    send(res, 400, { error: "bad path" });
    return true;
  }
  if (sendFile(res, file)) return true;
  send(res, 404, { error: "not found" });
  return true;
}

function csvEscape(s) {
  const t = String(s ?? "");
  if (/[",\n\r]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

function archiveToCsv(archive) {
  const lines = ["edition,line,dna,prompt"];
  for (const r of archive.recipes || []) {
    lines.push([r.edition, r.line, r.dna, r.prompt].map(csvEscape).join(","));
  }
  return lines.join("\n") + "\n";
}

function archiveToTxt(archive) {
  const parts = [];
  for (const r of archive.recipes || []) {
    parts.push(`#${r.edition} [${r.line}] ${r.dna}\n${r.prompt}\n`);
  }
  return parts.join("\n---\n\n");
}

function inferRole(name) {
  const n = String(name).toLowerCase();
  if (/^(primary|mother)\.(png|jpe?g|webp)$/.test(n)) return "primary";
  if (/^base-([a-z0-9_-]+)\./.test(n)) return "line";
  if (/^style[-_]/.test(n) || /^style\./.test(n)) return "style";
  return "extra";
}

function inferLine(name) {
  const m = String(name).match(/^base-([a-zA-Z0-9_-]+)\./);
  return m ? m[1] : null;
}

function listBases() {
  mkdirSync(P().input, { recursive: true });
  const allowed = new Set([".png", ".jpg", ".jpeg", ".webp"]);
  const files = [];
  for (const name of readdirSync(P().input)) {
    const ext = extname(name).toLowerCase();
    if (!allowed.has(ext)) continue;
    const path = join(P().input, name);
    if (!statSync(path).isFile()) continue;
    files.push({
      file: name,
      path: `input/${name}`,
      bytes: statSync(path).size,
      role: inferRole(name),
      line: inferLine(name),
      primary: /^(primary|mother)\./i.test(name),
    });
  }
  files.sort((a, b) => Number(b.primary) - Number(a.primary) || a.file.localeCompare(b.file));
  return files;
}

function baseStatus() {
  mkdirSync(P().input, { recursive: true });
  const list = listBases();
  const primary = list.find((f) => f.primary) || list[0];
  if (primary) return { exists: true, file: primary.file, path: primary.path, count: list.length, files: list };
  return { exists: false, file: "primary.png", path: "input/primary.png", count: 0, files: [] };
}

function readWish() {
  const path = join(P().input, "wish.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
};

function sendFile(res, filePath) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return false;
  const ext = extname(filePath).toLowerCase();
  send(res, 200, readFileSync(filePath), MIME[ext] || "application/octet-stream");
  return true;
}

function serveUi(res, urlPath) {
  let rel = urlPath;
  if (rel === "/studio") {
    send(res, 302, "", "text/plain", { Location: "/studio/" });
    return true;
  }
  if (rel === "/" || rel === "/studio/") rel = "index.html";
  else if (rel.startsWith("/studio/")) rel = rel.slice("/studio/".length);
  else if (rel.startsWith("/")) rel = rel.slice(1);
  if (!rel || rel.endsWith("/")) rel = `${rel || ""}index.html`;
  if (rel.includes("..")) {
    send(res, 400, { error: "bad path" });
    return true;
  }
  const root = resolve(UI);
  const file = resolve(root, rel);
  const ok =
    process.platform === "win32"
      ? file.toLowerCase().startsWith(root.toLowerCase() + "\\") || file.toLowerCase() === root.toLowerCase()
      : file.startsWith(root + "/") || file === root;
  // also allow exact files directly under root
  const ok2 =
    process.platform === "win32"
      ? file.toLowerCase().startsWith(root.toLowerCase())
      : file.startsWith(root);
  if (!ok2) {
    send(res, 400, { error: "bad path" });
    return true;
  }
  if (sendFile(res, file)) return true;
  return false;
}

function serveInput(res, urlPath) {
  if (!urlPath.startsWith("/input/")) return false;
  const name = basename(urlPath.split("?")[0]);
  if (!name || name.includes("..")) {
    send(res, 400, { error: "bad path" });
    return true;
  }
  const file = join(P().input, name);
  if (!file.startsWith(P().input)) {
    send(res, 400, { error: "bad path" });
    return true;
  }
  if (sendFile(res, file)) return true;
  send(res, 404, { error: "not found" });
  return true;
}


function mimeOf(file) {
  const ext = extname(file).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

function resourcesPayload() {
  const tg = getTelegramConfig();
  const keys = RESOURCE_KEYS.map((k) => {
    let present = Boolean(process.env[k.env] && String(process.env[k.env]).trim());
    if (k.env === "POLLINATIONS_API_KEY" && !present) {
      present = Boolean(process.env.POLLINATIONS_TOKEN && String(process.env.POLLINATIONS_TOKEN).trim());
    }
    if (k.env === "FAL_KEY" && !present) {
      present = Boolean(process.env.FAL_API_KEY && String(process.env.FAL_API_KEY).trim());
    }
    if (k.env === "COMFYUI_URL" && !present) {
      present = Boolean(process.env.COMFYUI_ENABLED === "1" || (process.env.COMFYUI_URL && String(process.env.COMFYUI_URL).trim()));
    }
    if (k.env === "A1111_URL" && !present) {
      present = Boolean(process.env.A1111_ENABLED === "1" || (process.env.A1111_URL && String(process.env.A1111_URL).trim()) || (process.env.SD_WEBUI_URL && String(process.env.SD_WEBUI_URL).trim()));
    }
    return { name: k.name, present, note: k.note };
  });
  return {
    keys,
    keysConfigured: Boolean(KEYS_PATH),
    keysFileName: KEYS_PATH ? basename(KEYS_PATH) : null,
    keysSource: KEYS_PATH ? "file" : null,
    note: KEYS_PATH
      ? "Keys loaded into the Lab process from a local .env (values never sent to the browser)."
      : "Put keys in a project-local .env (see .env.example) or set SERIES_KEYS_FILE.",
    telegram: {
      configured: tg.configured,
      source: tg.source,
      project: "Series Lab",
    },
    ...providersSnapshot(),
  };
}

async function resourcesPayloadLive() {
  const base = resourcesPayload();
  const [health, float] = await Promise.all([keyHealth(), providerFloatStatus()]);
  return { ...base, health, float, probed_at: new Date().toISOString() };
}

async function runPrimaryGenerate({ wish, engine, strength, useRef = false, makePrimary = true, seed }) {
  const text = String(wish || "").trim();
  if (!text) throw new Error("wish text required");
  const prompt = buildWishPrompt(text);
  const str = clampStrength(strength);
  const ctx = engineCtx(process.env);
  mkdirSync(P().input, { recursive: true });

  let buf;
  let usedEngine;
  let mode;
  let cost = null;
  const primary = listBases().find((f) => f.primary);
  if (useRef && primary) {
    usedEngine = pickAvailableEngine(engine, process.env, ENGINES);
    if (!usedEngine) throw new Error("No image API key for edit engines (REPLICATE / OPENAI / STABILITY / POLLINATIONS)");
    const imgPath = join(P().input, primary.file);
    const image = readFileSync(imgPath);
    const mime = mimeOf(primary.file);
    const eng = getEngine(usedEngine);
    mode = "edit";
    cost = eng.costUsd ?? null;
    assertSpend(cost);
    buf = await paidCall({ source: "studio", kind: "base", engine: usedEngine, costUsd: cost, seed, reference: true }, () =>
      withRetry(() => eng.generate({ prompt: text, image, mime, seed, strength: str }, ctx)),
    );
  } else {
    usedEngine = pickAvailableEngine(engine, process.env, TXT2IMG);
    if (!usedEngine) throw new Error("No image API key for txt2img (OPENAI / REPLICATE / STABILITY / POLLINATIONS)");
    const eng = getTxt2Img(usedEngine);
    mode = "txt2img";
    cost = eng.costUsd ?? null;
    assertSpend(cost);
    buf = await paidCall({ source: "studio", kind: "base", engine: usedEngine, costUsd: cost, seed }, () =>
      withRetry(() => eng.generate({ prompt, seed }, ctx)),
    );
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const candName = `candidate-${stamp}.png`;
  writeFileSync(join(P().input, candName), buf);
  let primaryFile = null;
  if (makePrimary) {
    // move other primary.* / legacy mother.* to trash
    toTrash(
      readdirSync(P().input).filter((n) => /^(primary|mother)\./i.test(n)).map((n) => join(P().input, n)),
      "replaced primary (base generate)",
    );
    primaryFile = "primary.png";
    writeFileSync(join(P().input, primaryFile), buf);
  }
  return {
    ok: true,
    stub: false,
    mode,
    engine: usedEngine,
    costUsd: cost,
    candidate: candName,
    path: `input/${candName}`,
    primary: primaryFile,
    files: listBases(),
  };
}

async function handleApi(req, res, url) {
  const { pathname } = url;

  // Operator-only views in public mode: server keys, server-wide spend, economy, Telegram test.
  if (
    PUBLIC_MODE &&
    ["/api/spend", "/api/resources", "/api/engines/status", "/api/admin/economy", "/api/notifications/test"].includes(pathname) &&
    !isAdmin(currentWallet())
  ) {
    return send(res, 403, { error: "admin only" });
  }

  if (pathname === "/api/me" && req.method === "GET") {
    const gpu = localGpuPolicy();
    if (!PUBLIC_MODE) {
      return send(res, 200, {
        mode: "local",
        admin: true,
        localGpu: gpu,
        creditCosts: Object.fromEntries(
          Object.keys(ENGINES).map((e) => [
            e,
            creditCost(e, { reference: true, costUsd: ENGINES[e].costUsd }),
          ]),
        ),
      });
    }
    const wallet = currentWallet();
    const code = referralCodeFor(wallet);
    return send(res, 200, {
      mode: "public",
      admin: isAdmin(wallet),
      wallet,
      balance: getBalance(wallet),
      packages: Object.entries(PACKAGES).map(([id, p]) => ({ id, ...p })),
      solPay: solPayInfo(process.env, { admin: isAdmin(wallet) }),
      referral: code ? { code, link: `${process.env.AUTH_URI || "https://ai.w3ir.io"}/login?ref=${code}` } : null,
      localGpu: gpu,
      creditCosts: Object.fromEntries(
        Object.keys(ENGINES).map((e) => [
          e,
          LOCAL_ONLY_ENGINES.has(e) && !gpu.enabled
            ? null
            : creditCost(e, { reference: true, costUsd: ENGINES[e].costUsd }),
        ]),
      ),
    });
  }

  if (pathname === "/api/local-gpu" && req.method === "GET") {
    const gpu = localGpuPolicy();
    const probe = url.searchParams.get("probe") === "1" || url.searchParams.get("probe") === "true";
    if (!gpu.enabled) {
      return send(res, 200, {
        ok: true,
        ...gpu,
        probed: false,
        comfyui: { online: false, available: false },
        a1111: { online: false, available: false },
      });
    }
    if (!probe) {
      return send(res, 200, {
        ok: true,
        ...gpu,
        probed: false,
        comfyui: { online: null, url: gpu.urls.comfyui },
        a1111: { online: null, url: gpu.urls.a1111 },
      });
    }
    const [comfy, a1111] = await Promise.all([
      testEngineConnection("comfyui", process.env, globalThis.fetch),
      testEngineConnection("a1111", process.env, globalThis.fetch),
    ]);
    return send(res, 200, {
      ok: true,
      ...gpu,
      probed: true,
      probed_at: new Date().toISOString(),
      comfyui: { ...comfy, url: gpu.urls.comfyui, available: true },
      a1111: { ...a1111, url: gpu.urls.a1111, available: true },
    });
  }

  if (pathname === "/api/credits/history" && req.method === "GET") {
    if (!PUBLIC_MODE) return send(res, 200, { transactions: [] });
    return send(res, 200, { transactions: listTransactions(currentWallet(), 50) });
  }

  if (pathname === "/api/admin/economy" && req.method === "GET") {
    if (PUBLIC_MODE && !isAdmin(currentWallet())) return send(res, 403, { error: "admin only" });
    const raw = String(url.searchParams.get("days") || "all").toLowerCase();
    const days = raw === "7" || raw === "7d" ? 7 : raw === "30" || raw === "30d" ? 30 : null;
    const report = economyReport(days);
    report.funnel_30d = funnel(30);
    return send(res, 200, report);
  }

  // Direct USDC-on-Solana top-up: order → user sends the exact amount → we find it on-chain.
  if (pathname === "/api/credits/sol/order" && req.method === "POST") {
    if (!PUBLIC_MODE) return send(res, 404, { error: "public mode only" });
    rateLimit(req, "credits_sol_order", 20);
    const body = await readBody(req);
    try {
      const wallet = currentWallet();
      return send(res, 200, { order: createSolOrder(wallet, String(body.package || ""), { admin: isAdmin(wallet) }) });
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  }

  // Build unsigned USDC transfer for Phantom confirm (payer signs in the browser).
  if (pathname === "/api/credits/sol/prepare" && req.method === "POST") {
    if (!PUBLIC_MODE) return send(res, 404, { error: "public mode only" });
    rateLimit(req, "credits_sol_prepare", 20);
    const body = await readBody(req);
    try {
      const wallet = currentWallet();
      const prepared = await prepareSolPayment(wallet, String(body.package || ""), String(body.payer || ""), {
        admin: isAdmin(wallet),
      });
      return send(res, 200, prepared);
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  }

  if (pathname === "/api/credits/sol/check" && req.method === "POST") {
    if (!PUBLIC_MODE) return send(res, 404, { error: "public mode only" });
    rateLimit(req, "credits_sol_check", Number.parseInt(process.env.SOLANA_PAY_CHECK_RATE_LIMIT || "", 10) || 20);
    const wallet = currentWallet();
    const r = await checkSolOrders({ wallet, notify: notifyOperator });
    return send(res, 200, {
      credited: r.credited.reduce((n, c) => n + c.credits, 0),
      balance: getBalance(wallet),
      orders: listSolOrders(wallet),
      error: r.error || null,
    });
  }

  if (pathname === "/api/holder" && req.method === "GET") {
    if (!PUBLIC_MODE) return send(res, 404, { error: "public mode only" });
    return send(res, 200, await holderEligibility(currentWallet()));
  }

  if (pathname === "/api/holder/claim" && req.method === "POST") {
    if (!PUBLIC_MODE) return send(res, 404, { error: "public mode only" });
    return send(res, 200, await claimHolderBonus(currentWallet()));
  }

  if (pathname === "/api/publish" && req.method === "POST") {
    if (!PUBLIC_MODE) return send(res, 404, { error: "public mode only" });
    const body = await readBody(req);
    const dir = safeSetName(body.dir);
    const marks = readMarks(dir);
    const onlyKeep = body.onlyKeep !== false && Object.values(marks).includes("keep");
    const images = listSetImages(dir).images
      .filter((img) => !onlyKeep || marks[String(img.edition)] === "keep")
      .map((img) => ({ name: img.file, bytes: readFileSync(join(P().out, dir, img.file)) }));
    const slug = publishCollection(String(body.title || dir), images, { subtitle: body.subtitle || "", wallet: currentWallet() });
    trackFunnel("publish", { slug, count: images.length });
    return send(res, 200, { ok: true, slug, url: `https://w3ir.io/c/${slug}`, path: `/c/${slug}` });
  }

  if (pathname === "/api/health") {
    return send(res, 200, {
      ok: true,
      product: "series-lab",
      layer: "lab+studio-ui",
      port: PORT,
      base: baseStatus(),
      keysConfigured: Boolean(KEYS_PATH),
      keysFileName: KEYS_PATH ? basename(KEYS_PATH) : null,
      engines: {
        edit: Object.keys(ENGINES),
        txt2img: Object.keys(TXT2IMG),
        availableEdit: pickAvailableEngine("kontext", process.env, ENGINES),
        availableTxt2img: pickAvailableEngine("openai", process.env, TXT2IMG),
      },
    });
  }

  if (pathname === "/api/presets" && req.method === "GET") {
    return send(res, 200, { presets: listPresets() });
  }

  if (pathname === "/api/preset" && req.method === "GET") {
    const { preset, file } = loadPresetByFile(url.searchParams.get("file") || "demo-series.json");
    return send(res, 200, { file, preset });
  }

  if (pathname === "/api/templates" && req.method === "GET") {
    return send(res, 200, { templates: listTemplates() });
  }

  if (pathname.startsWith("/api/templates/") && req.method === "GET") {
    const id = decodeURIComponent(pathname.slice("/api/templates/".length));
    const { preset } = loadTemplateById(id);
    return send(res, 200, { preset });
  }


  if (pathname === "/api/trait-packs" && req.method === "GET") {
    return send(res, 200, { packs: listTraitPacks() });
  }

  if (pathname.startsWith("/api/trait-packs/") && req.method === "GET") {
    const id = decodeURIComponent(pathname.slice("/api/trait-packs/".length));
    const { pack, summary, file } = loadTraitPackById(id);
    return send(res, 200, { file, summary, pack });
  }

  if (pathname === "/api/trait-packs/save" && req.method === "POST") {
    const body = await readBody(req);
    const pack = body.pack;
    const val = validateTraitPack(pack);
    if (!val.ok) return send(res, 400, { ok: false, errors: val.errors });
    mkdirSync(P().traits, { recursive: true });
    const id = String(pack.id).replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
    const filePath = join(P().traits, `${id}.json`);
    writeJsonAtomic(filePath, pack);
    return send(res, 200, { ok: true, id, file: `${id}.json`, summary: summarizeTraitPack(pack, `${id}.json`) });
  }

  if (pathname === "/api/trait-packs/export-from-preset" && req.method === "POST") {
    const body = await readBody(req);
    let preset = body.preset;
    if (!preset) {
      preset = loadPresetByFile(body.file || "demo-series.json").preset;
    }
    const pack = exportPresetAsTraitPack(preset, {
      id: body.id,
      name: body.name,
      description: body.description,
      tags: body.tags,
    });
    const val = validateTraitPack(pack);
    if (!val.ok) return send(res, 400, { ok: false, errors: val.errors });
    mkdirSync(P().traits, { recursive: true });
    const id = pack.id;
    const filePath = join(P().traits, `${id}.json`);
    writeJsonAtomic(filePath, pack);
    return send(res, 200, { ok: true, id, file: `${id}.json`, pack, summary: summarizeTraitPack(pack, `${id}.json`) });
  }

  if (pathname.startsWith("/api/trait-packs/") && req.method === "DELETE") {
    const id = decodeURIComponent(pathname.slice("/api/trait-packs/".length)).replace(/[^a-zA-Z0-9_-]/g, "");
    const filePath = join(P().traits, `${id}.json`);
    if (!existsSync(filePath)) return send(res, 404, { error: `trait pack not found: ${id}` });
    const trashed = toTrash([filePath], `trait pack ${id} deleted`);
    return send(res, 200, { ok: true, id, trashId: trashed?.id ?? null });
  }

  if (pathname === "/api/validate" && req.method === "POST") {
    const body = await readBody(req);
    let preset = body.preset;
    if (!preset) {
      preset = loadPresetByFile(body.file || "demo-series.json").preset;
    }
    const checked = checkPreset(preset);
    if (!checked.ok) return send(res, 400, { ok: false, errors: checked.errors });
    return send(res, 200, {
      ok: true,
      id: preset.id,
      size: preset.size,
      traits: loadTraitsFromPreset(preset).length,
    });
  }

  if (pathname === "/api/preset/save" && req.method === "POST") {
    const body = await readBody(req);
    const preset = body.preset;
    if (!preset || typeof preset !== "object") throw new Error("preset required");
    const checked = checkPreset(preset);
    if (!checked.ok) return send(res, 400, { ok: false, errors: checked.errors });
    const id = String(preset.id || "").replace(/[^a-zA-Z0-9._-]/g, "-");
    if (!id) throw new Error("preset.id required");
    mkdirSync(P().presets, { recursive: true });
    // strip UI-only meta if saving as real preset (keep _meta optional)
    const outName = `${id}.json`;
    const outPath = join(P().presets, outName);
    writeJsonAtomic(outPath, preset);
    return send(res, 200, { ok: true, file: outName, path: `presets/${outName}`, id });
  }

  if (pathname === "/api/build" && req.method === "POST") {
    const body = await readBody(req);
    const { preset } = loadPresetByFile(body.file || "demo-series.json");
    const checked = checkPreset(preset);
    if (!checked.ok) return send(res, 400, { ok: false, errors: checked.errors });
    const { archive, dupes } = makeArchive(preset);
    mkdirSync(P().out, { recursive: true });
    const outName = `${preset.id || "archive"}.json`;
    writeJsonAtomic(join(P().out, outName), archive);
    return send(res, 200, {
      ok: true,
      out: `out/${outName}`,
      size: archive.size,
      duplicates: dupes,
      recipes: archive.recipes.map((r) => ({
        index: r.index,
        edition: r.edition,
        line: r.line,
        dna: r.dna,
        prompt: r.prompt,
        traits: r.traits,
        seed: r.seed,
        note: r.note ?? "",
        edited: Boolean(r.edited),
        ...(r.wave != null ? { wave: r.wave } : {}),
      })),
    });
  }

  if (pathname === "/api/diff-seed" && req.method === "POST") {
    const body = await readBody(req);
    const { preset } = loadPresetByFile(body.file || "demo-series.json");
    const checked = checkPreset(preset);
    if (!checked.ok) return send(res, 400, { ok: false, errors: checked.errors });
    const a = buildRecipes(preset).map((r) => r.dna);
    const b = buildRecipes(preset).map((r) => r.dna);
    const ok = a.length === b.length && a.every((d, i) => d === b[i]);
    return send(res, ok ? 200 : 500, { ok, size: a.length });
  }

  if (pathname === "/api/recipes" && req.method === "GET") {
    let file = url.searchParams.get("file");
    if (!file) {
      const list = listArchives();
      if (!list.length) return send(res, 404, { error: "no archives" });
      file = list[0].file;
    }
    const { archive, file: archiveFile } = loadArchiveFile(file);
    const { preset } = loadPresetForArchive(archive);
    return send(res, 200, recipesPayload(archiveFile, archive, preset));
  }

  if (pathname === "/api/rarity" && req.method === "GET") {
    let file = url.searchParams.get("file");
    if (!file) {
      const list = listArchives();
      if (!list.length) return send(res, 404, { error: "no archives" });
      file = list[0].file;
    }
    const { archive, file: archiveFile } = loadArchiveFile(file);
    const { preset } = loadPresetForArchive(archive);
    const rarity = computeRarity(preset, archive.recipes || []);
    return send(res, 200, { file: archiveFile, presetId: archive.presetId, rarity });
  }

  if (pathname === "/api/lint" && req.method === "POST") {
    const body = await readBody(req);
    if (Array.isArray(body.texts)) {
      return send(res, 200, lintPrompts(body.texts.map((t) => String(t ?? ""))));
    }
    const text = String(body.text ?? body.prompt ?? "");
    return send(res, 200, lintPrompt(text));
  }

  if (pathname === "/api/recipe" && req.method === "POST") {
    const body = await readBody(req);
    if (body.file == null || body.index == null) {
      return send(res, 400, { error: "file and index required" });
    }
    const { archive, path: archivePath, file: archiveFile } = loadArchiveFile(body.file);
    const { preset } = loadPresetForArchive(archive);
    const items = loadTraitsFromPreset(preset);
    const traitKeys = items.map((t) => t.key);
    const idx = Number(body.index);
    const recipes = archive.recipes || [];
    const recipe = recipes.find((r) => r.index === idx);
    if (!recipe) return send(res, 404, { error: `recipe index ${idx} not found` });

    if (!recipe.originalTraits) {
      recipe.originalTraits = structuredClone(recipe.traits);
    }
    if (recipe.originalNote === undefined) {
      recipe.originalNote = typeof recipe.note === "string" ? recipe.note : "";
    }

    if (body.reset) {
      recipe.traits = structuredClone(recipe.originalTraits);
      recipe.note = recipe.originalNote ?? "";
    } else {
      if (body.traits && typeof body.traits === "object") {
        // validate values against preset options (line-aware)
        for (const key of traitKeys) {
          if (body.traits[key] == null) continue;
          const traitDef = items.find((t) => t.key === key);
          const allowed = optionsFor(traitDef, recipe.line).map((o) => o.value);
          if (!allowed.includes(body.traits[key])) {
            return send(res, 400, { error: `invalid ${key}: ${body.traits[key]}` });
          }
        }
        recipe.traits = { ...recipe.traits, ...body.traits };
      }
      if (body.note != null) {
        recipe.note = String(body.note).slice(0, 500);
      }
    }

    const conflicts = collectConflicts(preset);
    const conflictCheck = checkConflicts(recipe.traits, conflicts);
    if (!conflictCheck.ok) {
      return send(res, 400, {
        error: `Trait conflict: ${conflictMessage(conflictCheck.hits)}`,
        conflicts: conflictCheck.hits,
      });
    }

    recipe.dna = dna(recipe.line, recipe.traits, traitKeys);
    recipe.prompt = buildPrompt(recipe.line, recipe.traits, preset, recipe.note || "");
    recipe.edited = !(
      traitsEqual(recipe.traits, recipe.originalTraits) &&
      String(recipe.note || "") === String(recipe.originalNote || "")
    );

    const twin = recipes.find((r) => r.index !== recipe.index && r.dna === recipe.dna);
    if (twin) {
      return send(res, 400, {
        error: `Duplicate DNA with edition #${twin.edition}`,
        twin: twin.edition,
      });
    }

    writeJsonAtomic(archivePath, archive);
    try {
      const loaded = loadPresetForArchive(archive);
      const overrides = { ...(loaded.preset.overrides || {}) };
      const key = String(idx);
      if (!recipe.edited) delete overrides[key];
      else overrides[key] = { traits: recipe.traits, note: recipe.note || "" };
      loaded.preset.overrides = overrides;
      writeJsonAtomic(loaded.path, loaded.preset);
    } catch {
      /* the archive still holds the edit if the preset file is missing */
    }
    return send(res, 200, { ok: true, file: archiveFile, recipe: enrichRecipe(recipe) });
  }

  if (pathname === "/api/archive/diff" && req.method === "POST") {
    const body = await readBody(req);
    const left = loadArchiveFile(body.a || body.left || "");
    const right = loadArchiveFile(body.b || body.right || "");
    return send(res, 200, { a: left.file, b: right.file, ...diffArchives(left.archive, right.archive) });
  }

  if (pathname === "/api/preset/spinoff" && req.method === "POST") {
    const body = await readBody(req);
    const { preset } = loadPresetByFile(body.file || "");
    const checked = checkPreset(preset);
    if (!checked.ok) return send(res, 400, { ok: false, errors: checked.errors });
    let next = spinoffPreset(preset, body.suffix ? { suffix: String(body.suffix) } : {});
    let n = 2;
    while (existsSync(join(P().presets, `${next.id}.json`))) {
      next = spinoffPreset(preset, { suffix: `${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${n}` });
      n += 1;
      if (n > 20) return send(res, 409, { error: "could not pick a free spin-off id" });
    }
    mkdirSync(P().presets, { recursive: true });
    const file = `${next.id}.json`;
    writeJsonAtomic(join(P().presets, file), next);
    return send(res, 200, { ok: true, file, preset: next });
  }

  if (pathname === "/api/archive/list" && req.method === "GET") {
    return send(res, 200, { archives: listArchives() });
  }

  if (pathname === "/api/archive/latest" && req.method === "GET") {
    const list = listArchives();
    if (!list.length) return send(res, 404, { error: "no archives" });
    const { archive, file } = loadArchiveFile(list[0].file);
    return send(res, 200, { file, archive });
  }

  if (pathname === "/api/archive/file" && req.method === "GET") {
    const { path, file } = loadArchiveFile(url.searchParams.get("file"));
    return send(res, 200, readFileSync(path), "application/json; charset=utf-8", {
      "Content-Disposition": `attachment; filename="${file}"`,
    });
  }

  if (pathname === "/api/export/csv" && req.method === "GET") {
    let file = url.searchParams.get("file");
    if (!file) {
      const list = listArchives();
      if (!list.length) return send(res, 404, { error: "no archives" });
      file = list[0].file;
    }
    const { archive } = loadArchiveFile(file);
    const csv = archiveToCsv(archive);
    const outName = String(file).replace(/\.json$/i, "") + "-prompts.csv";
    return send(res, 200, csv, "text/csv; charset=utf-8", {
      "Content-Disposition": `attachment; filename="${outName}"`,
    });
  }

  if (pathname === "/api/export/txt" && req.method === "GET") {
    let file = url.searchParams.get("file");
    if (!file) {
      const list = listArchives();
      if (!list.length) return send(res, 404, { error: "no archives" });
      file = list[0].file;
    }
    const { archive } = loadArchiveFile(file);
    const txt = archiveToTxt(archive);
    const outName = String(file).replace(/\.json$/i, "") + "-prompts.txt";
    return send(res, 200, txt, "text/plain; charset=utf-8", {
      "Content-Disposition": `attachment; filename="${outName}"`,
    });
  }

  if (pathname === "/api/base/status" && req.method === "GET") {
    return send(res, 200, baseStatus());
  }

  if (pathname === "/api/base/list" && req.method === "GET") {
    return send(res, 200, { files: listBases(), wish: readWish() });
  }

  if (pathname === "/api/base/upload" && req.method === "POST") {
    const body = await readBody(req);
    if (!body.data) throw new Error("data (base64) required");
    mkdirSync(P().input, { recursive: true });
    const orig = basename(String(body.filename || "primary.png"));
    const ext = extname(orig).toLowerCase() || ".png";
    const allowed = new Set([".png", ".jpg", ".jpeg", ".webp"]);
    if (!allowed.has(ext)) throw new Error("image must be png/jpg/webp");
    const role = String(body.role || "primary");
    let name;
    if (role === "primary") {
      // If a main base already exists, keep it and store the new file as an extra
      // (matches Studio help: don’t silently overwrite the current primary).
      const hasPrimary = listBases().some((f) => f.primary);
      if (hasPrimary) {
        const stamp = Date.now().toString(36);
        const safe = orig.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 40) || "base";
        name = `extra-${stamp}-${safe}`;
        if (!name.endsWith(ext)) name += ext;
      } else {
        name = "primary" + ext;
      }
    } else if (role === "line") {
      const line = String(body.line || "a").replace(/[^a-zA-Z0-9_-]/g, "") || "a";
      name = `base-${line}${ext}`;
    } else if (role === "style") {
      const stamp = Date.now().toString(36);
      name = `style-${stamp}${ext}`;
    } else {
      const stamp = Date.now().toString(36);
      const safe = orig.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 40);
      name = `extra-${stamp}-${safe}`;
      if (!name.endsWith(ext)) name += ext;
    }
    const buf = Buffer.from(body.data, "base64");
    if (buf.length < 32) throw new Error("empty image");
    const outPath = join(P().input, name);
    if (existsSync(outPath)) toTrash([outPath], `overwritten by upload (${name})`);
    writeFileSync(outPath, buf);
    // optional: set as primary by renaming/copying
    if (body.makePrimary && role !== "primary") {
      const primaryName = "primary" + ext;
      if (existsSync(join(P().input, primaryName))) toTrash([join(P().input, primaryName)], "replaced primary (upload)");
      writeFileSync(join(P().input, primaryName), buf);
      name = primaryName;
    }
    return send(res, 200, {
      ok: true,
      path: `input/${name}`,
      file: name,
      bytes: buf.length,
      role: inferRole(name),
      files: listBases(),
    });
  }

  if (pathname === "/api/base/primary" && req.method === "POST") {
    const body = await readBody(req);
    const file = basename(String(body.file || ""));
    if (!file) throw new Error("file required");
    const src = join(P().input, file);
    if (!existsSync(src)) throw new Error("file not found");
    const ext = extname(file).toLowerCase() || ".png";
    const destName = "primary" + ext;
    if (file === destName) return send(res, 200, { ok: true, file: destName, path: `input/${destName}`, files: listBases() });
    const buf = readFileSync(src);
    toTrash(
      readdirSync(P().input).filter((n) => /^(primary|mother)\./i.test(n)).map((n) => join(P().input, n)),
      `replaced primary (set ${file})`,
    );
    writeFileSync(join(P().input, destName), buf);
    return send(res, 200, { ok: true, file: destName, path: `input/${destName}`, files: listBases() });
  }

  if (pathname === "/api/base/delete" && req.method === "POST") {
    const body = await readBody(req);
    const file = basename(String(body.file || ""));
    if (!file || file.includes("..")) throw new Error("bad file");
    const path = join(P().input, file);
    if (!existsSync(path)) throw new Error("not found");
    const trashed = toTrash([path], "base image deleted");
    return send(res, 200, { ok: true, trashId: trashed?.id ?? null, files: listBases() });
  }

  if (pathname === "/api/base/wish" && req.method === "GET") {
    return send(res, 200, { wish: readWish() });
  }

  if (pathname === "/api/base/wish" && req.method === "POST") {
    const body = await readBody(req);
    const text = String(body.wish || "").trim();
    if (!text) throw new Error("wish text required");
    mkdirSync(P().input, { recursive: true });
    const wish = {
      wish: text,
      engine: body.engine || "kontext",
      strength: Number(body.strength ?? 0.45),
      updatedAt: nowIsoKyiv(),
    };
    writeJsonAtomic(join(P().input, "wish.json"), wish);
    return send(res, 200, { ok: true, wish });
  }

  if (pathname === "/api/base/generate" && req.method === "POST") {
    const body = await readBody(req);
    const text = String(body.wish || readWish()?.wish || "").trim();
    if (!text) throw new Error("wish text required");
    {
      const assembled = buildWishPrompt(text);
      const blocked = blockedPrompts([`${assembled}\n${text}`]);
      if (blocked) return send(res, 400, blocked);
    }
    mkdirSync(P().input, { recursive: true });
    const wish = {
      wish: text,
      engine: body.engine || "openai",
      strength: Number(body.strength ?? 0.45),
      updatedAt: nowIsoKyiv(),
    };
    writeJsonAtomic(join(P().input, "wish.json"), wish);
    const result = await runPrimaryGenerate({
      wish: text,
      engine: body.engine || "openai",
      strength: body.strength,
      useRef: Boolean(body.useRef),
      makePrimary: body.makePrimary !== false,
      seed: body.seed != null ? Number(body.seed) : undefined,
    });
    return send(res, 200, { ...result, wish });
  }

  if (pathname === "/api/base/analyze" && req.method === "POST") {
    const body = await readBody(req);
    const bases = listBases();
    let baseFile = body.file ? basename(String(body.file)) : null;
    let target = bases.find((b) => b.file === baseFile) || bases.find((b) => b.primary) || bases[0];
    if (!target) return send(res, 400, { error: "No base image found to analyze" });
    const imgBuf = readFileSync(join(P().input, target.file));
    const mime = mimeOf(target.file);
    const paidVision = Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
    const charge = paidVision ? chargeCredits({ engine: "vision", credits: visionCreditCost(), note: "vision assist", rateLimited: false }) : null;
    let result;
    try {
      result = await analyzeBaseImage({ image: imgBuf, mime }, engineCtx(process.env));
    } catch (e) {
      refundCharge(charge);
      throw e;
    }
    if (charge && String(result?.provider || "").toLowerCase() === "heuristic") refundCharge(charge);
    return send(res, 200, { ...result, file: target.file });
  }

  if (pathname === "/api/estimate" && req.method === "POST") {
    const body = await readBody(req);
    let file = body.file;
    if (!file) {
      const list = listArchives();
      if (!list.length) return send(res, 404, { error: "no archives — build recipes first" });
      file = list[0].file;
    }
    const { archive, file: archiveFile } = loadArchiveFile(file);
    const strength = clampStrength(body.strength);
    const engineWanted = body.engine || "kontext";
    const set = setDirName(engineWanted, strength);
    const sel = resolveGenerateSelection(archive, body, set);
    const unit = ENGINES[engineWanted]?.costUsd ?? ENGINES.kontext?.costUsd ?? 0.04;
    const cost = Math.round(sel.editions.length * unit * 1000) / 1000;
    const cap = spendCap(process.env.SERIES_SPEND_CAP_USD);
    const spent = spentToday(renderLog());
    const capMsg = capError({ cap, spent, planned: cost });
    const creditsNeeded = PUBLIC_MODE ? sel.editions.length * creditCost(engineWanted, { reference: true, costUsd: unit }) : null;
    const creditsBalance = PUBLIC_MODE ? getBalance(currentWallet()) : null;
    const lines = [
      `Archive: ${archiveFile} (${archive.size} recipes)`,
      `Engine: ${engineWanted} · strength ${strength}`,
      `Set folder: out/${set}/`,
      `Mode: ${sel.mode}` + (sel.force ? " · FORCE re-render (old images kept as versions)" : ""),
      `To generate: ${sel.editions.length}` + (sel.editions.length ? ` → #${sel.editions.slice(0, 24).join(", #")}${sel.editions.length > 24 ? "…" : ""}` : ""),
      sel.skippedExisting.length ? `Skip existing: ${sel.skippedExisting.length}` : "Skip existing: 0",
      PUBLIC_MODE
        ? `Cost: ${creditsNeeded} credits (${creditCost(engineWanted, { reference: true, costUsd: unit })}/image) · your balance: ${creditsBalance}`
        : `Est. cost: ~$${cost} ($${unit}/image)`,
      ...(PUBLIC_MODE ? [] : [`Spent today: ~$${spent}` + (cap != null ? ` of $${cap} daily cap` : " (no daily cap — set SERIES_SPEND_CAP_USD)")]),
      ...(capMsg ? ["", PUBLIC_MODE ? "⛔ The service is at its daily capacity — please try again tomorrow." : `⛔ ${capMsg}`] : []),
      "",
      "Estimate is free. Generate will call the image API.",
    ];
    const lint = lintPrompts((sel.recipes || []).map((r) => r.prompt || ""));
    if (!lint.ok) {
      lines.push("", `⚠ Lint warn (will block Generate): ${lint.hits.join(", ")}`);
    }
    return send(res, 200, {
      ok: true,
      file: archiveFile,
      engine: engineWanted,
      strength,
      set,
      mode: sel.mode,
      force: sel.force,
      editions: sel.editions,
      skippedExisting: sel.skippedExisting,
      count: sel.editions.length,
      unitCostUsd: unit,
      costUsd: cost,
      spentTodayUsd: spent,
      creditsNeeded,
      creditsBalance,
      capUsd: cap,
      capError: capMsg,
      text: lines.join("\n"),
      lint: { ok: lint.ok, hits: lint.hits },
    });
  }

  if (pathname === "/api/generate" && req.method === "POST") {
    const body = await readBody(req);
    const primary = listBases().find((f) => f.primary);
    if (!primary) throw new Error("Upload or generate a primary base image first (tab Base)");

    // Legacy single-prompt mode (explicit prompt, no selection mode)
    if (body.prompt && !body.mode && !body.selection && body.only == null && body.pilot == null && body.first == null) {
      const prompt = String(body.prompt || "").trim();
      if (!prompt) throw new Error("prompt required");
      {
        const blocked = blockedPrompts([prompt]);
        if (blocked) return send(res, 400, blocked);
      }
      const engineName = pickAvailableEngine(body.engine || "kontext", process.env, ENGINES);
      if (!engineName) throw new Error("No edit-engine API key available");
      const eng = getEngine(engineName);
      const image = readFileSync(join(P().input, primary.file));
      const mime = mimeOf(primary.file);
      const str = clampStrength(body.strength);
      const ctx = engineCtx(process.env);
      const seed = body.seed != null ? Number(body.seed) : undefined;
      const tag = String(body.edition ?? body.index ?? Date.now()).replace(/[^a-zA-Z0-9_-]/g, "") || String(Date.now());
      assertSpend(eng.costUsd ?? null);
      const buf = await paidCall(
        { source: "studio", kind: "pilot", engine: engineName, edition: tag, costUsd: eng.costUsd ?? null, seed, reference: true },
        () => withRetry(() => eng.generate({ prompt, image, mime, seed, strength: str }, ctx)),
      );
      const dir = join(P().out, "pilots");
      mkdirSync(dir, { recursive: true });
      const name = `pilot-${tag}.png`;
      if (existsSync(join(dir, name))) toTrash([join(dir, name)], `pilot ${name} regenerated`);
      writeFileSync(join(dir, name), buf);
      return send(res, 200, {
        ok: true,
        stub: false,
        engine: engineName,
        costUsd: eng.costUsd,
        path: `out/pilots/${name}`,
        file: name,
      });
    }

    // Batch mode from archive recipes
    let file = body.file;
    if (!file) {
      const list = listArchives();
      if (!list.length) throw new Error("no archives — build recipes first");
      file = list[0].file;
    }
    const { archive, file: archiveFile } = loadArchiveFile(file);
    const dnaDupes = duplicateGroups(archive.recipes);
    if (dnaDupes.length) {
      return send(res, 400, {
        error: `Duplicate DNA before render: ${dnaDupes.map((g) => g.join("+")).join(", ")}`,
        code: "dna",
        duplicates: dnaDupes,
      });
    }
    const strength = clampStrength(body.strength);
    const engineWanted = body.engine || "kontext";
    const engineName = pickAvailableEngine(engineWanted, process.env, ENGINES);
    if (!engineName) throw new Error("No edit-engine API key available");
    const set = setDirName(engineWanted, strength);
    const sel = resolveGenerateSelection(archive, body, set);
    if (!sel.editions.length) {
      return send(res, 200, {
        ok: true,
        file: archiveFile,
        engine: engineName,
        strength,
        set,
        count: 0,
        results: [],
        message: "Nothing to generate (all exist or empty selection). Enable force or pick other editions.",
      });
    }
    {
      const blocked = blockedPrompts((sel.recipes || []).map((r) => r.prompt || ""));
      if (blocked) return send(res, 400, blocked);
    }
    const eng = getEngine(engineName);
    const unitCost = eng.costUsd ?? null;
    assertSpend(unitCost == null ? null : sel.recipes.length * unitCost);
    assertEngineAllowed(engineName);
    if (PUBLIC_MODE) {
      // Check the whole batch up front so it never stops half-way for lack of credits.
      const need = sel.recipes.length * creditCost(engineName, { reference: true, costUsd: unitCost ?? 0 });
      if (need > getBalance(currentWallet())) throw insufficient(currentWallet(), need);
      trackFunnel("generate", { kind: "batch", count: sel.recipes.length, engine: engineName });
    }
    const allBases = listBases();
    const ctx = engineCtx(process.env);
    const outDir = join(P().out, set);
    const breaker = failureBreaker({ maxConsecutive: Number(process.env.SERIES_MAX_CONSECUTIVE_FAILURES) || 5 });
    mkdirSync(outDir, { recursive: true });

    const isStream = Boolean(body.stream) || String(req.headers["accept"] || "").includes("text/event-stream");
    const concurrency = Math.max(1, Math.min(4, Number(body.concurrency) || 2));

    if (isStream) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
      });
      res.write(`data: ${JSON.stringify({ type: "start", total: sel.recipes.length, engine: engineName, strength, set })}\n\n`);
    }

    const results = await mapConcurrent(
      sel.recipes,
      concurrency,
      async (recipe) => {
        let charge = null;
        try {
          await waitForRateSlot();
          charge = chargeCredits({ engine: engineName, costUsd: unitCost ?? 0, reference: true });
          const recipeBase = resolveBaseImageForRecipe(recipe, allBases) || primary;
          const image = readFileSync(join(P().input, recipeBase.file));
          const mime = mimeOf(recipeBase.file);
          const buf = await withRetry(() =>
            eng.generate({
              prompt: recipe.prompt,
              image,
              mime,
              seed: recipe.seed,
              strength,
            }, ctx),
          );
          const name = `${recipe.edition}.png`;
          const v = addVersion(outDir, recipe.edition, buf, { engine: engineName, strength, seed: recipe.seed });
          logRender({ source: "studio", kind: "batch", engine: engineName, set, edition: recipe.edition, v, ok: true, costUsd: unitCost, seed: recipe.seed });
          breaker.record(true);
          return {
            ok: true,
            edition: recipe.edition,
            index: recipe.index,
            file: name,
            v,
            path: `out/${set}/${name}`,
            url: `/out/${set}/${name}?v=${v}`,
          };
        } catch (e) {
          refundCharge(charge);
          logRender({ source: "studio", kind: "batch", engine: engineName, set, edition: recipe.edition, ok: false, costUsd: 0, error: String(e.message || e).slice(0, 300) });
          breaker.record(false);
          return {
            ok: false,
            edition: recipe.edition,
            index: recipe.index,
            error: String(e.message || e),
          };
        }
      },
      (progress) => {
        if (isStream) {
          res.write(`data: ${JSON.stringify({
            type: "progress",
            result: progress.result,
            completed: progress.completed,
            total: progress.total,
          })}\n\n`);
        }
      },
      { signal: breaker.signal },
    );

    const okN = results.filter((r) => r.ok).length;
    const finalPayload = {
      ok: true,
      stub: false,
      file: archiveFile,
      engine: engineName,
      strength,
      set,
      count: okN,
      costUsd: Math.round(okN * (eng.costUsd || 0) * 1000) / 1000,
      stopped: breaker.reason,
      skipped: results.filter((r) => r.skipped).length,
      results,
      thumbs: results.filter((r) => r.ok).map((r) => ({ edition: r.edition, url: r.url, path: r.path })),
    };

    dispatchBatchNotification({
      presetId: archive.presetId,
      total: sel.recipes.length,
      success: okN,
      failed: results.length - okN,
      outputDir: `out/${set}`,
    }).catch(() => {});

    if (isStream) {
      res.write(`data: ${JSON.stringify({ type: "done", ...finalPayload })}\n\n`);
      res.end();
      return;
    }

    return send(res, 200, finalPayload);
  }

  if (pathname === "/api/versions" && req.method === "GET") {
    const dir = safeSetName(url.searchParams.get("dir") || "");
    const edition = url.searchParams.get("edition");
    return send(res, 200, { dir, ...listVersions(join(P().out, dir), dir, edition) });
  }

  if (pathname === "/api/versions/current" && req.method === "POST") {
    const body = await readBody(req);
    const dir = safeSetName(body.dir || "");
    setCurrent(join(P().out, dir), body.edition, body.v);
    return send(res, 200, { ok: true, dir, ...listVersions(join(P().out, dir), dir, body.edition) });
  }

  if (pathname === "/api/versions/drop" && req.method === "POST") {
    const body = await readBody(req);
    const dir = safeSetName(body.dir || "");
    const file = dropVersion(join(P().out, dir), body.edition, body.v);
    const trashed = toTrash([file], `${dir} #${body.edition} v${body.v} dropped`);
    return send(res, 200, { ok: true, dir, trashId: trashed?.id ?? null, ...listVersions(join(P().out, dir), dir, body.edition) });
  }

  if (pathname === "/api/trash" && req.method === "GET") {
    return send(res, 200, { items: listTrash(trashDir()) });
  }

  if (pathname === "/api/trash/restore" && req.method === "POST") {
    const body = await readBody(req);
    const item = restoreTrash({ root: P().root, trashDir: trashDir() }, String(body.id || ""));
    return send(res, 200, { ok: true, restored: item, items: listTrash(trashDir()) });
  }

  if (pathname === "/api/trash/purge" && req.method === "POST") {
    const body = await readBody(req);
    purgeTrash(trashDir(), String(body.id || ""));
    return send(res, 200, { ok: true, items: listTrash(trashDir()) });
  }

  if (pathname === "/api/spend" && req.method === "GET") {
    return send(res, 200, {
      capUsd: spendCap(process.env.SERIES_SPEND_CAP_USD),
      spentTodayUsd: spentToday(renderLog()),
      byEngine: spendByEngineToday(renderLog()),
      engines: engineStatsToday(renderLog()),
      errors: recentEngineErrors(renderLog()),
    });
  }

  if (pathname === "/api/waves" && req.method === "GET") {
    const { preset, file } = loadPresetByFile(url.searchParams.get("file") || "demo-series.json");
    return send(res, 200, { file, size: preset.size, waves: describeSupply(preset) });
  }

  if (pathname === "/api/waves/append" && req.method === "POST") {
    const body = await readBody(req);
    const loaded = loadPresetByFile(body.file || "");
    const preset = appendSupplyWave(loaded.preset, {
      size: body.size,
      seed: body.seed,
      name: body.name,
    });
    const checked = checkPreset(preset);
    if (!checked.ok) return send(res, 400, { ok: false, errors: checked.errors });
    writeJsonAtomic(loaded.path, preset);
    return send(res, 200, { ok: true, file: loaded.file, size: preset.size, waves: describeSupply(preset), preset });
  }

  if (pathname === "/api/gallery/dupes" && req.method === "POST") {
    const body = await readBody(req);
    const dirName = safeSetName(body.dir || "");
    const dir = join(P().out, dirName);
    if (!existsSync(dir)) return send(res, 404, { error: "set not found" });
    const found = findDupes(dir, { maxDistance: body.maxDistance ?? 8 });
    return send(res, 200, { dir: dirName, ...found });
  }

  if (pathname === "/api/sets" && req.method === "GET") {
    return send(res, 200, { sets: listImageSets() });
  }

  if (pathname === "/api/set" && req.method === "GET") {
    const dir = url.searchParams.get("dir");
    if (!dir) return send(res, 400, { error: "dir required" });
    const payload = listSetImages(dir);
    const marks = readMarks(dir);
    return send(res, 200, { ...payload, marks });
  }

  if (pathname === "/api/marks" && req.method === "GET") {
    const dir = url.searchParams.get("dir");
    if (!dir) return send(res, 400, { error: "dir required" });
    return send(res, 200, { dir: safeSetName(dir), marks: readMarks(dir) });
  }

  if (pathname === "/api/marks" && req.method === "POST") {
    const body = await readBody(req);
    if (!body.dir) return send(res, 400, { error: "dir required" });
    const dir = safeSetName(body.dir);
    let marks = readMarks(dir);
    if (body.marks && typeof body.marks === "object") {
      marks = body.marks;
    } else if (body.edition != null) {
      const key = String(body.edition);
      const val = body.mark; // "keep" | "redo" | "" | null
      if (!val) delete marks[key];
      else marks[key] = val === "keep" || val === "redo" ? val : String(val);
    } else {
      return send(res, 400, { error: "marks object or edition+mark required" });
    }
    writeMarks(dir, marks);
    return send(res, 200, { ok: true, dir, marks });
  }

  if (pathname === "/api/qa/triage" && req.method === "POST") {
    const body = await readBody(req);
    const dir = safeSetName(body.dir || body.set);
    if (!dir) return send(res, 400, { error: "dir required" });
    const setDir = join(P().out, dir);
    if (!existsSync(setDir) || !statSync(setDir).isDirectory()) {
      return send(res, 400, { error: `set directory not found: ${dir}` });
    }

    const { images } = listSetImages(dir);
    if (!images.length) {
      return send(res, 200, { ok: true, dir, total: 0, evaluated: 0, results: [], marks: readMarks(dir) });
    }

    // Resolve archive & preset for recipe mapping & styleLock
    let archive = null;
    let preset = null;
    if (body.archiveFile) {
      archive = loadArchiveFile(body.archiveFile).archive;
    } else {
      const list = listArchives();
      if (list.length) archive = loadArchiveFile(list[0].file).archive;
    }

    if (body.presetFile) {
      preset = loadPresetByFile(body.presetFile).preset;
    } else if (archive?.presetId) {
      try {
        preset = loadPresetByFile(`${archive.presetId}.json`).preset;
      } catch {
        preset = null;
      }
    }

    const recipeMap = new Map((archive?.recipes || []).map((r) => [r.edition, r]));
    const currentMarks = readMarks(dir);

    // Target filtering
    const mode = String(body.mode || (Array.isArray(body.editions) ? "specific" : "unmarked"));
    let targetImages = images;
    if (mode === "unmarked") {
      targetImages = images.filter((img) => img.edition != null && !currentMarks[String(img.edition)]);
    } else if (mode === "sample") {
      const limit = Math.max(1, Math.min(50, Number(body.limit) || 10));
      targetImages = images.slice(0, limit);
    } else if (mode === "specific" && Array.isArray(body.editions)) {
      const edSet = new Set(body.editions.map(Number));
      targetImages = images.filter((img) => img.edition != null && edSet.has(img.edition));
    }

    // Resolve provider & apiKey
    let provider = String(body.provider || "heuristic").toLowerCase();
    let apiKey = null;
    if (provider === "vision" || provider === "openai" || provider === "anthropic") {
      if (provider === "anthropic" && process.env.ANTHROPIC_API_KEY) {
        apiKey = process.env.ANTHROPIC_API_KEY;
        provider = "anthropic";
      } else if (process.env.OPENAI_API_KEY) {
        apiKey = process.env.OPENAI_API_KEY;
        provider = "openai";
      } else if (process.env.ANTHROPIC_API_KEY) {
        apiKey = process.env.ANTHROPIC_API_KEY;
        provider = "anthropic";
      } else {
        provider = "heuristic";
      }
    }

    const items = targetImages.map((img) => ({
      edition: img.edition,
      imagePath: join(P().out, dir, img.file),
      recipe: img.edition != null ? recipeMap.get(img.edition) : undefined,
    }));
    const triageCharge = provider !== "heuristic" && items.length
      ? chargeCredits({ engine: provider, credits: items.length * visionCreditCost(), note: "ai triage", rateLimited: false })
      : null;

    const concurrency = Math.max(1, Math.min(4, Number(body.concurrency) || 2));
    let results;
    try {
      results = await triageBatch(items, { concurrency, provider, apiKey, preset });
    } catch (e) {
      refundCharge(triageCharge);
      throw e;
    }

    const autoApply = Boolean(body.autoApplyMarks);
    if (autoApply) {
      for (const resItem of results) {
        if (resItem.edition != null && (resItem.verdict === "keep" || resItem.verdict === "redo")) {
          currentMarks[String(resItem.edition)] = resItem.verdict;
        }
      }
      writeMarks(dir, currentMarks);
    }

    return send(res, 200, {
      ok: true,
      dir,
      provider,
      autoApplied: autoApply,
      total: images.length,
      evaluated: results.length,
      results,
      marks: currentMarks,
    });
  }

  if (pathname === "/api/storage/status" && req.method === "GET") {
    loadKeys();
    return send(res, 200, checkStorageStatus(process.env));
  }

  if (pathname === "/api/storage/pin" && req.method === "POST") {
    loadKeys();
    const body = await readBody(req);
    const dir = safeSetName(body.dir || body.set);
    if (!dir) return send(res, 400, { error: "dir required" });
    const setDir = join(P().out, dir);
    if (!existsSync(setDir) || !statSync(setDir).isDirectory()) {
      return send(res, 400, { error: `set not found: ${dir}` });
    }
    const name = body.name || `series-${dir}`;
    const result = await uploadToPinata({
      dir: setDir,
      name,
    });
    return send(res, 200, result);
  }

  if (pathname === "/api/launchpads" && req.method === "GET") {
    return send(res, 200, { ok: true, profiles: getLaunchpadProfiles() });
  }

  if (pathname === "/api/export/manifest.csv" && req.method === "GET") {
    trackFunnel("export", { kind: "manifest" });
    const archiveName = url.searchParams.get("archive") || url.searchParams.get("file");
    let archive = null;
    if (archiveName) {
      archive = loadArchiveFile(archiveName).archive;
    } else {
      const list = listArchives();
      if (list.length) archive = loadArchiveFile(list[0].file).archive;
    }
    if (!archive || !archive.recipes?.length) {
      return send(res, 400, { error: "No archive recipes available for manifest" });
    }
    let preset = null;
    try {
      preset = loadPresetForArchive(archive)?.preset || null;
    } catch {
      preset = loadPresetFileSafe(`${archive.presetId || "x"}.json`)?.preset || null;
    }
    const traitItems = preset?.traits?.items || preset?.traits || [];
    const profile = url.searchParams.get("profile") || "opensea";
    const zeroIndexed = url.searchParams.get("zeroIndexed") === "true" || url.searchParams.get("zeroIndex") === "true";
    const imageUriPrefix = url.searchParams.get("imageUriPrefix") || url.searchParams.get("imagePrefix") || "";
    const animationUriPrefix = url.searchParams.get("animationUriPrefix") || url.searchParams.get("animPrefix") || "";
    const namePrefix = url.searchParams.get("namePrefix") || `${archive.presetId || "Series"} #`;
    const description = url.searchParams.get("description") || `${preset?.name || archive.presetId || "Series"} — Series Lab export`;

    const csv = exportManifestCsv(archive.recipes, traitItems, {
      profile,
      zeroIndexed,
      imageUriPrefix,
      animationUriPrefix,
      namePrefix,
      description,
    });

    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="manifest-${archive.presetId || "series"}.csv"`,
    });
    return res.end(csv);
  }

  if (pathname === "/api/export/showcase.html" && req.method === "GET") {
    const archiveName = url.searchParams.get("archive") || url.searchParams.get("file");
    let archive = null;
    if (archiveName) {
      archive = loadArchiveFile(archiveName).archive;
    } else {
      const list = listArchives();
      if (list.length) archive = loadArchiveFile(list[0].file).archive;
    }
    if (!archive || !archive.recipes?.length) {
      return send(res, 400, { error: "No archive recipes available for showcase" });
    }
    let preset = null;
    try {
      preset = loadPresetForArchive(archive)?.preset || null;
    } catch {
      preset = loadPresetFileSafe(`${archive.presetId || "x"}.json`)?.preset || null;
    }
    const html = generateShowcaseHtml(archive, preset || {});
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
    });
    return res.end(html);
  }

  if (pathname === "/api/release/portals" && req.method === "GET") {
    const profile = url.searchParams.get("profile") || "opensea";
    const archiveName = url.searchParams.get("archive") || url.searchParams.get("file");
    let archive = null;
    if (archiveName) {
      try { archive = loadArchiveFile(archiveName).archive; } catch {}
    }
    const portal = getLaunchpadPortalUrls(profile, archive || {}, {
      imageUriPrefix: url.searchParams.get("imageUriPrefix") || "",
      creatorAddress: url.searchParams.get("creatorAddress") || "",
    });
    return send(res, 200, { ok: true, portal });
  }

  if (pathname === "/api/release/config" && req.method === "GET") {
    const profile = url.searchParams.get("profile") || "opensea";
    const archiveName = url.searchParams.get("archive") || url.searchParams.get("file");
    let archive = null;
    if (archiveName) {
      try { archive = loadArchiveFile(archiveName).archive; } catch {}
    } else {
      const list = listArchives();
      if (list.length) archive = loadArchiveFile(list[0].file).archive;
    }
    let preset = null;
    if (archive?.presetId) {
      try { preset = loadPresetFileSafe(`${archive.presetId}.json`)?.preset || null; } catch {}
    }
    const opts = {
      creatorAddress: url.searchParams.get("creatorAddress") || "",
      zeroIndexed: url.searchParams.get("zeroIndexed") === "true",
      imageUriPrefix: url.searchParams.get("imageUriPrefix") || "",
      animationUriPrefix: url.searchParams.get("animationUriPrefix") || url.searchParams.get("animPrefix") || "",
      symbol: url.searchParams.get("symbol") || "LAB",
      sellerFeeBasisPoints: url.searchParams.get("sellerFeeBasisPoints") || 500,
      namePrefix: url.searchParams.get("namePrefix") || "",
    };

    if (profile === "magiceden" || profile === "launchmynft") {
      const sugar = buildSugarConfig(archive || {}, preset || {}, opts);
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="sugar.json"`,
      });
      return res.end(JSON.stringify(sugar, null, 2) + "\n");
    }

    const tw = buildThirdwebConfig(archive || {}, preset || {}, opts);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="thirdweb.json"`,
    });
    return res.end(JSON.stringify(tw, null, 2) + "\n");
  }

  if (pathname === "/api/export/preview-meta" && req.method === "POST") {
    const body = await readBody(req);
    const archiveName = body.archive || body.file;
    let archive = null;
    if (archiveName) {
      archive = loadArchiveFile(archiveName).archive;
    } else {
      const list = listArchives();
      if (list.length) archive = loadArchiveFile(list[0].file).archive;
    }
    if (!archive || !archive.recipes?.length) {
      return send(res, 400, { error: "No archive recipes available for preview" });
    }

    const recipe = archive.recipes[0];
    let preset = null;
    try {
      preset = loadPresetForArchive(archive)?.preset || null;
    } catch {
      preset = loadPresetFileSafe(`${archive.presetId || "x"}.json`)?.preset || null;
    }
    const traitItems = preset?.traits?.items || preset?.traits || [];
    const profileKey = body.profile || (body.format === "metaplex" ? "magiceden" : body.format === "ordinals" ? "ordinalsbot" : "opensea");
    const profile = LAUNCHPAD_PROFILES[profileKey] || LAUNCHPAD_PROFILES.opensea;
    const format = profile.format || body.format || "erc721";
    const opts = {
      profile: profileKey,
      creatorAddress: body.creatorAddress || null,
      zeroIndexed: Boolean(body.zeroIndexed || body.zeroIndex),
      imageUriPrefix: body.imageUriPrefix || body.imagePrefix || "",
      animationUriPrefix: body.animationUriPrefix || body.animPrefix || "",
      namePrefix: body.namePrefix || `${archive.presetId || "Series"} #`,
      symbol: body.symbol || profile.defaultSymbol || "LAB",
      sellerFeeBasisPoints: body.sellerFeeBasisPoints ?? profile.defaultFee ?? 500,
      description: body.description || `${preset?.name || archive.presetId || "Series"} — Series Lab export`,
    };

    const preview = generateMetadataPreview(recipe, profileKey, opts, traitItems);
    return send(res, 200, { ok: true, edition: recipe.edition, format, profile: profileKey, preview });
  }

  if (pathname === "/api/export/bundle" && req.method === "POST") {
    trackFunnel("export", { kind: "bundle" });
    const body = await readBody(req);
    const archiveName = body.archive || body.file;
    if (!archiveName) return send(res, 400, { error: "archive required" });
    const profileKey = body.profile || (body.format === "metaplex" ? "magiceden" : body.format === "ordinals" ? "ordinalsbot" : "opensea");
    const profile = LAUNCHPAD_PROFILES[profileKey] || LAUNCHPAD_PROFILES.opensea;
    const format = profile.format || body.format || "erc721";
    const { archive, file: archiveFile } = loadArchiveFile(archiveName);
    const set = safeSetName(body.set);
    const setDir = join(P().out, set);
    if (!existsSync(setDir) || !statSync(setDir).isDirectory()) {
      return send(res, 400, { error: `set not found: ${set}` });
    }
    let preset = null;
    try {
      preset = loadPresetForArchive(archive)?.preset || null;
    } catch {
      preset = loadPresetFileSafe(`${archive.presetId || "x"}.json`)?.preset || null;
    }
    const marks = readMarks(set);
    const locale = resolveLocale(req, body);
    const onlyKeep = body.onlyKeep === undefined ? true : Boolean(body.onlyKeep);
    try {
      const result = await buildBundleZip({
        archive,
        preset,
        setDir,
        set,
        marks,
        bundlesDir: bundlesDir(),
        opts: {
          format,
          profile: profileKey,
          creatorAddress: body.creatorAddress || null,
          zeroIndexed: Boolean(body.zeroIndexed || body.zeroIndex),
          onlyKeep,
          namePrefix: body.namePrefix || `${archive.presetId || "Series"} #`,
          symbol: body.symbol || profile.defaultSymbol || "LAB",
          sellerFeeBasisPoints: body.sellerFeeBasisPoints ?? profile.defaultFee ?? 500,
          description:
            body.description ||
            `${preset?.name || archive.presetId || "Series"} — Series Lab export`,
          imageUriPrefix: body.imageUriPrefix || body.imagePrefix || "",
          animationUriPrefix: body.animationUriPrefix || body.animPrefix || "",
          locale,
          upscale: Boolean(body.upscale),
        },
      });
      return send(res, 200, {
        ok: true,
        file: result.file,
        path: result.path,
        count: result.count,
        missing: result.missing || [],
        format: result.format,
        profile: result.profile,
        provenanceHash: result.provenanceHash || null,
        upscaled: result.upscaled,
        upscaleSkipped: result.upscaleSkipped || null,
        fallback: result.fallback || null,
        archive: archiveFile,
        set,
        downloadUrl: `/${result.path}`,
      });
    } catch (e) {
      const status =
        e.status || (e.code === "bundle_select" || e.code === "bundle_empty" ? 400 : 500);
      return send(res, status, { error: String(e.message || e), code: e.code || "bundle" });
    }
  }

  if (pathname === "/api/export/provenance" && req.method === "GET") {
    const setName = safeSetName(url.searchParams.get("set") || url.searchParams.get("dir"));
    if (!setName) return send(res, 400, { error: "set parameter required" });
    const setDir = join(P().out, setName);
    if (!existsSync(setDir) || !statSync(setDir).isDirectory()) {
      return send(res, 404, { error: `set directory not found: ${setName}` });
    }
    const files = readdirSync(setDir);
    const images = [];
    for (const f of files) {
      const m = f.match(/^(\d+)\.(png|jpe?g|webp)$/i);
      if (m) images.push({ edition: Number(m[1]), path: join(setDir, f), file: f });
    }
    if (!images.length) {
      return send(res, 400, { error: `no image files found in set: ${setName}` });
    }
    const prov = calculateCollectionProvenance(images);
    return send(res, 200, { ok: true, set: setName, provenance: prov });
  }

  if (pathname === "/api/export/dataset" && req.method === "POST") {
    trackFunnel("export", { kind: "dataset" });
    const body = await readBody(req);
    const archiveName = body.archive || body.file;
    if (!archiveName) return send(res, 400, { error: "archive required" });
    const { archive } = loadArchiveFile(archiveName);
    const setName = safeSetName(body.set);
    const setDir = join(P().out, setName);
    if (!existsSync(setDir) || !statSync(setDir).isDirectory()) {
      return send(res, 400, { error: `set not found: ${setName}` });
    }
    let preset = null;
    try {
      preset = loadPresetForArchive(archive)?.preset || null;
    } catch {
      preset = loadPresetFileSafe(`${archive.presetId || "x"}.json`)?.preset || null;
    }
    const marks = readMarks(setName);
    const triggerWord = body.triggerWord || body.trigger || "";
    const format = body.format === "prose" ? "prose" : "tags";
    const onlyKeep = body.onlyKeep === undefined ? false : Boolean(body.onlyKeep);

    mkdirSync(bundlesDir(), { recursive: true });
    const zipName = `dataset-${archive.presetId || "series"}-${setName}-${Date.now().toString(36)}.zip`;
    const outPath = join(bundlesDir(), zipName);

    try {
      const resData = await exportDatasetZip({
        archive,
        preset,
        setDir,
        marks,
        opts: {
          triggerWord,
          format,
          onlyKeep,
          outPath,
        },
      });
      return send(res, 200, {
        ok: true,
        file: zipName,
        path: `out/bundles/${zipName}`,
        downloadUrl: `/out/bundles/${zipName}`,
        count: resData.count,
        triggerWord: resData.triggerWord,
        format: resData.format,
      });
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  }

  if (pathname === "/api/notifications/test" && req.method === "POST") {
    if (PUBLIC_MODE && !isAdmin(currentWallet())) return send(res, 403, { error: "admin only" });
    const body = await readBody(req);
    // Optional override for one-off tests; otherwise Series Lab config (SERIES_TELEGRAM_* / TELEGRAM_*).
    if (body.botToken && body.chatId) {
      const text = body.message || "🔔 *Series Lab*\nТестове сповіщення успішно надіслано!";
      const resNotify = await sendTelegramNotification({ botToken: body.botToken, chatId: body.chatId, text });
      return send(res, resNotify.ok ? 200 : 400, { ...resNotify, project: "Series Lab" });
    }
    const resNotify = await sendTelegramTest();
    return send(res, resNotify.ok ? 200 : 400, { ...resNotify, project: "Series Lab" });
  }

  if (pathname === "/api/matrix/preview" && req.method === "POST") {
    const body = await readBody(req);
    const recipe = body.recipe;
    const engine = body.engine || "flux";
    const preset = body.preset || {};
    if (!recipe) return send(res, 400, { error: "recipe object required" });
    const formatted = formatEnginePrompt(recipe, engine, preset);
    return send(res, 200, { ok: true, engine, prompt: formatted });
  }

  if (pathname === "/api/traits/matrix" && req.method === "GET") {
    const archiveName = url.searchParams.get("archive") || url.searchParams.get("file");
    if (!archiveName) return send(res, 400, { error: "archive parameter required" });
    const { archive } = loadArchiveFile(archiveName);
    const cooccurrence = {};
    const recipes = archive.recipes || [];
    for (const r of recipes) {
      const traits = Object.entries(r.traits || {}).filter(([, v]) => v && v !== "None");
      for (let i = 0; i < traits.length; i++) {
        for (let j = i + 1; j < traits.length; j++) {
          const pairKey = `${traits[i][0]}:${traits[i][1]} | ${traits[j][0]}:${traits[j][1]}`;
          cooccurrence[pairKey] = (cooccurrence[pairKey] || 0) + 1;
        }
      }
    }
    const topPairs = Object.entries(cooccurrence)
      .map(([pair, count]) => ({ pair, count, percentage: Math.round((count / (recipes.length || 1)) * 100) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50);
    return send(res, 200, { ok: true, totalRecipes: recipes.length, topPairs });
  }

  if (pathname === "/api/engines/status" && req.method === "GET") {
    const list = ["fal", "comfyui", "a1111", "replicate", "openai", "stability"];
    const statuses = await Promise.all(
      list.map((eng) => testEngineConnection(eng, process.env, globalThis.fetch)),
    );
    return send(res, 200, { ok: true, engines: statuses });
  }

  if (pathname === "/api/engines/test" && req.method === "POST") {
    const body = await readBody(req);
    const eng = body.engine || "fal";
    const result = await testEngineConnection(eng, process.env, globalThis.fetch);
    return send(res, 200, { ok: true, ...result });
  }

  if (pathname === "/api/comfyui/workflow" && req.method === "GET") {
    const wfPath = join(ROOT, "templates", "comfyui-workflow.json");
    if (!existsSync(wfPath)) return send(res, 404, { error: "comfyui-workflow.json not found" });
    const json = JSON.parse(readFileSync(wfPath, "utf8"));
    return send(res, 200, json);
  }

  if (pathname === "/api/doctor" && req.method === "GET") {
    const { runDoctorDiagnostics } = await import("../src/doctor.mjs");
    const report = await runDoctorDiagnostics({ rootDir: ROOT, env: process.env });
    return send(res, 200, report);
  }

  if (pathname === "/api/checklist" && req.method === "GET") {
    const archiveName = url.searchParams.get("archive") || url.searchParams.get("file");
    const setName = url.searchParams.get("set") || url.searchParams.get("dir");
    let archive = null;
    let archiveFile = null;
    if (archiveName) {
      try {
        const loaded = loadArchiveFile(archiveName);
        archive = loaded.archive;
        archiveFile = loaded.file;
      } catch (e) {
        return send(res, 404, { error: String(e.message || e) });
      }
    } else {
      const list = listArchives();
      if (list.length) {
        const loaded = loadArchiveFile(list[0].file);
        archive = loaded.archive;
        archiveFile = loaded.file;
      }
    }
    let preset = null;
    if (archive) {
      try {
        preset = loadPresetForArchive(archive)?.preset || null;
      } catch {
        preset = loadPresetFileSafe(`${archive.presetId || "x"}.json`)?.preset || null;
      }
    }
    if (!preset && url.searchParams.get("preset")) {
      preset = loadPresetFileSafe(url.searchParams.get("preset"))?.preset || null;
    }
    let marks = {};
    let images = [];
    const set = setName ? safeSetName(setName) : null;
    if (set) {
      try {
        marks = readMarks(set);
        images = listSetImages(set).images;
      } catch {
        images = [];
      }
    }
    const base = baseStatus();
    const items = runChecklist({
      preset,
      archive,
      marks,
      images,
      baseExists: Boolean(base.exists),
    });
    return send(res, 200, { ok: true, archive: archiveFile, set, items });
  }

  if (pathname === "/api/workspace" && req.method === "GET") {
    const data = readWorkspace();
    return send(res, 200, { ok: true, workspace: data, exists: Boolean(data) });
  }

  if (pathname === "/api/workspace" && req.method === "POST") {
    const body = await readBody(req);
    const prev = readWorkspace() || {};
    if (body.clear) {
      const cleared = writeWorkspace({
        presetId: null,
        locale: body.locale || prev.locale || null,
        lastArchive: null,
        lastSet: null,
        overview: {},
      });
      return send(res, 200, { ok: true, workspace: cleared });
    }
    const next = {
      ...prev,
      presetId: body.presetId ?? prev.presetId ?? null,
      locale: body.locale ?? prev.locale ?? null,
      lastArchive: body.lastArchive ?? prev.lastArchive ?? null,
      lastSet: body.lastSet ?? prev.lastSet ?? null,
    };
    if (body.overview && typeof body.overview === "object") {
      next.overview = { ...(prev.overview || {}), ...body.overview };
    }
    const saved = writeWorkspace(next);
    return send(res, 200, { ok: true, workspace: saved });
  }

  if (pathname === "/api/resources" && req.method === "GET") {
    const probe = url.searchParams.get("probe") === "1" || url.searchParams.get("probe") === "true";
    if (probe) return send(res, 200, await resourcesPayloadLive());
    return send(res, 200, resourcesPayload());
  }

  return send(res, 404, { error: "not found" });
}

/** Per-wallet data tree (public mode); seeded with the shared presets and trait packs. */
function userPaths(wallet) {
  const safe = String(wallet).replace(/[^a-zA-Z0-9]/g, "");
  const base = join(DATA_DIR, "users", safe);
  const paths = {
    root: base,
    input: join(base, "input"),
    presets: join(base, "presets"),
    traits: join(base, "traits"),
    out: join(base, "out"),
    workspace: join(base, "workspace"),
  };
  for (const [key, shared] of [["presets", LOCAL_PATHS.presets], ["traits", LOCAL_PATHS.traits]]) {
    if (existsSync(paths[key])) continue;
    mkdirSync(paths[key], { recursive: true });
    if (!existsSync(shared)) continue;
    for (const f of readdirSync(shared)) {
      if (f.endsWith(".json")) writeFileSync(join(paths[key], f), readFileSync(join(shared, f)));
    }
  }
  return paths;
}

const isPageRequest = (pathname) => pathname === "/" || pathname === "/studio" || pathname === "/studio/" || pathname.endsWith(".html");

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
    if (PLATFORM_ON && (await handlePlatform(req, res, url))) return;
    if (!PUBLIC_MODE) return await handleRequest(req, res, url);
    const wallet = sessionWallet(req);
    if (!wallet) {
      if (url.pathname.startsWith("/api/")) return send(res, 401, { error: "Sign in with your wallet first", code: "auth" });
      if (isPageRequest(url.pathname)) return send(res, 302, "", "text/plain", { Location: `/login${url.search}` });
      if (url.pathname.startsWith("/out/") || url.pathname.startsWith("/input/")) return send(res, 401, "Sign in required", "text/plain");
    }
    const store = wallet ? { wallet, paths: userPaths(wallet) } : undefined;
    return await reqCtx.run(store, () => handleRequest(req, res, url));
  } catch (e) {
    if (res.headersSent) {
      res.end();
      return;
    }
    send(res, e.status || 500, { error: String(e.message || e), ...(e.extra || {}) });
  }
});

async function handleRequest(req, res, url) {
  {
    if (url.pathname.startsWith("/api/")) {
      const blocked = checkApiRequest(req, { allowedHosts: ALLOWED_HOSTS, port: PORT });
      if (blocked) return send(res, 403, { error: blocked });
      await handleApi(req, res, url);
      return;
    }
    if (serveInput(res, url.pathname)) return;
    if (serveOut(res, url.pathname)) return;
    if (serveUi(res, url.pathname)) return;
    // legacy public redirect page
    if (url.pathname === "/old" || url.pathname.startsWith("/public/")) {
      const rel = url.pathname.replace(/^\/public/, "") || "/index.html";
      const file = join(PUBLIC, rel === "/" ? "/index.html" : rel);
      if (sendFile(res, file)) return;
    }
    send(res, 404, "Not found", "text/plain; charset=utf-8");
  }
}

try {
  const days = Number(process.env.SERIES_TRASH_DAYS ?? 30);
  if (days > 0) {
    const trashDirs = [trashDir()];
    const usersDir = join(DATA_DIR, "users");
    if (PUBLIC_MODE && existsSync(usersDir)) {
      for (const u of readdirSync(usersDir)) trashDirs.push(join(usersDir, u, "out", "trash"));
    }
    let purged = 0;
    for (const dir of trashDirs) purged += pruneTrash(dir, days).length;
    if (purged) console.log(`Trash: purged ${purged} item(s) older than ${days} days`);
  }
} catch (e) {
  console.warn(`Trash prune skipped: ${e.message}`);
}

if (PLATFORM_ON) startPlatformBackground();

const openErr = openAccessError(HOST, PUBLIC_MODE);
if (openErr) {
  console.error(openErr);
  process.exit(1);
}

server.listen(PORT, HOST, () => {
  const href = `http://${HOST}:${PORT}/studio/`;
  console.log(`Series Lab Studio (${PUBLIC_MODE ? "public" : "local"})  ${href}`);
  console.log(`Also: http://${HOST}:${PORT}/`);
  console.log("Lab + Studio: keys from Prompt .env; generate is live. Ctrl+C to stop.");
  if (OPEN) {
    const cmd =
      process.platform === "win32"
        ? `cmd /c start "" "${href}"`
        : process.platform === "darwin"
          ? `open "${href}"`
          : `xdg-open "${href}"`;
    exec(cmd, { windowsHide: true }, () => {});
  }
});
