#!/usr/bin/env node
/**
 * Series Lab Studio.
 * Development placement: http://127.0.0.1:5344/studio/ (HOST).
 * Creator docs (uk and en): http://127.0.0.1:5344/studio/docs/ — no public-site deploy.
 * The same process can listen for a host (HOST=0.0.0.0 plus SERIES_ALLOWED_HOSTS
 * and a matching AUTH_DOMAIN). studio.w3ir.io is the static site, not this process.
 * The product itself is always the full platform: wallet sign-in, per-wallet
 * data, credits. SERIES_MODE=local is an explicit file-folder workshop and
 * may listen only on loopback.
 */
import "../src/require-node.mjs";
import { createServer } from "node:http";
import { AsyncLocalStorage } from "node:async_hooks";
import { exec } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeSetQuality } from "../src/quality.mjs";
import { ensurePng, imageFormat } from "../src/png-normalize.mjs";
import { compressSet, COMPRESS_TARGET_BYTES } from "../src/compress.mjs";
import { loadSharp } from "../src/upscale.mjs";
import {
  buildRecipes,
  drySimulate,
  buildPrompt,
  appendSupplyWave,
  describeSupply,
  findDupes,
  similarityToBase,
  SIMILARITY_METHOD,
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
  countMissingTraitFrames,
  triageImageOffline,
  triageImageVision,
  checkStorageStatus,
  uploadToIrys,
  generateMetadataPreview,
  calculateDeterministicCid,
  LAUNCHPAD_PROFILES,
  exportManifestCsv,
  generateShowcaseHtml,
  calculateRarityScores,
  calculateCollectionProvenance,
  verifyProvenance,
  duplicateImages,
  exportDatasetZip,
  dispatchBatchNotification,
  sendTelegramNotification,
  sendTelegramTest,
  getTelegramConfig,
  formatEnginePrompt,
} from "../src/index.mjs";
import { quoteStage, listStagePrices } from "../src/platform/stage-pricing.mjs";
import { composeArchive, overlaySet, previewEdition } from "../src/layers.mjs";
import { loadKeys, loadKeysExtra } from "../src/keys.mjs";
import {
  ENGINES,
  TXT2IMG,
  buildWishPrompt,
  engineCtx,
  getEngine,
  getTxt2Img,
  pickAvailableEngine,
  listSelectableEngines,
  planPrimaryGenerate,
  primaryGenerateArgs,
  withRetry,
  clampStrength,
} from "../src/engines.mjs";
import { imagesDirName } from "../src/reference.mjs";
import { licenseWarning, engineModelId, platformFluxModel } from "../src/license.mjs";
import { studioDocsResponse } from "../scripts/site-html.mjs";

import { genesisEnabled, syncGenesisImage, withGenesis } from "../src/genesis.mjs";
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
  layers: join(ROOT, "layers"),
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
import { handleAdminRoutes } from "./routes/admin.mjs";
import { handleKitRoutes } from "./routes/kits.mjs";
import { allowedHostnames, checkApiRequest, hostedConfigError, hostedConfigWarning, openAccessError } from "./guard.mjs";
import { handlePlatform, sessionWallet, startPlatformBackground } from "./platform.mjs";
import { send, writeSse, attachStopOnDisconnect, readBody, httpError } from "./http.mjs";
import { PACKAGES, checkGenerationRate, creditCost, deductCredits, getBalance,
  listTransactions, recordFunnelEvent, referralCodeFor, refundCredits, localGpuCreditCost,
} from "../src/platform/billing.mjs";
import { rateLimit } from "../src/platform/ratelimit.mjs";
import { checkSolOrders, createSolOrder, listSolOrders, prepareSolPayment, solPayInfo } from "../src/platform/solpay.mjs";
import { isAdmin, notifyOperator } from "../src/platform/ops.mjs";
import { providersSnapshot, keyHealth, providerFloatStatus } from "../src/platform/providers.mjs";
import { claim as claimHolderBonus, eligibility as holderEligibility } from "../src/platform/holders.mjs";
import { checkPromptSafetySync, safetyMessage } from "../src/platform/safety.mjs";
import { publishCollection } from "../src/platform/site.mjs";
import { isInsideDir, writeJsonAtomic } from "../src/fs-safe.mjs";
import { adoptLegacyAssets, admitProject, convertLegacyProjectTrash, initialActiveProject, deletedProjectFile, describeProjects, ensureProjectDirs, isProject, listDeletedProjects, loadProjects, moveSetBetweenProjects, projectAssetStats, pruneWalletTrash, purgeDeletedProject, trashDaysLeft, trashRetentionDays, projectPaths, projectQuota, projectsConfig, readActiveProject, registerProject, restoreDeletedProject, saveProjects, trashProject, writeActiveProject } from "../src/projects.mjs";
import { eraseWalletRecords } from "../src/platform/erase.mjs";
import { LAYER_LIMITS, LayersZipError, clearLayers, importLayersZip, layersStatus, listLayerFiles } from "../src/layers-zip.mjs";
import { addVersion, dropVersion, editionAssetFiles, listShelved, listVersions, setCurrent, shelveCurrent, versionCounts } from "../src/versions.mjs";
import { containsSecretField } from "../src/secrets.mjs";
import { modelTitle, promptHash, sha256Hex } from "../src/creation.mjs";
import { listTrash, pruneTrash, purgeTrash, restoreTrash, trashFiles } from "../src/trash.mjs";
import { anonymizeRenderLog, appendRenderLog, capError, spendCap, spentToday } from "../src/spend.mjs";
import { failureBreaker } from "../src/pool.mjs";
import { applySecurityHeaders } from "../src/security-headers.mjs";
import { staticResponse } from "../src/static-cache.mjs";
import { openDb } from "../src/platform/db.mjs";
import { backupStatus, buildAlerts, createRequestMetrics, diskSnapshot, fileMb, platformCounts, processSnapshot, treeBytesCached } from "../src/sysinfo.mjs";
import { CSP_REPORT_PATH, applyCsp, createCspLog, cspMode, summarizeReport } from "../src/csp.mjs";

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
  { name: "IRYS_PRIVATE_KEY", env: "IRYS_PRIVATE_KEY", note: "Irys Arweave Storage Dispatcher" },
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

/** Raw (binary) request body with its own cap; JSON bodies keep readBody's 25 MB. */
function readRawBody(req, max) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > max) {
        const err = new LayersZipError("zip_too_large", `upload is larger than ${Math.round(max / 1048576)} MB`);
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Moves files to out/trash instead of deleting them. */
function toTrash(paths, reason) {
  return trashFiles({ root: P().root, trashDir: trashDir() }, paths, reason);
}

/**
 * Selection deletes frames for good: a frame removed in review or a dropped version is not kept anywhere (only whole
 * projects have a trash). Refuses anything outside the project's `out/` folder.
 */
function discardSelectionFiles(paths) {
  const root = resolve(P().out);
  for (const p of paths) {
    const abs = resolve(p);
    const rel = relative(root, abs);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw httpError(400, "bad path");
    rmSync(abs, { force: true });
  }
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
// it fails — the money path (debit note "image generation",
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
    throw httpError(429, "Generation rate limit reached — wait a minute (a top-up or a credit grant lifts the limit).", { code: "rate" });
  }
  const debitNote = note
    || (LOCAL_ONLY_ENGINES.has(engine) ? "Lab support · local GPU" : undefined);
  if (!deductCredits(wallet, amount, { engine, ...(debitNote ? { note: debitNote } : {}) })) throw insufficient(wallet, amount);
  return { wallet, amount, engine, note: debitNote };
}

function refundCharge(charge) {
  if (!charge) return;
  try {
    refundCredits(charge.wallet, charge.amount, { engine: charge.engine, ...(charge.note ? { note: `refund: ${charge.note} failed` } : {}) });
  } catch (e) {
    console.error(`[credits] refund failed for ${charge.wallet}: ${e.message}`);
  }
}

function rejectSecrets(res, body) {
  if (!containsSecretField(body)) return false;
  send(res, 400, {
    error: "Series Lab does not accept private keys, seed phrases, or secrets. Sign from your own wallet.",
    code: "secrets",
  });
  return true;
}

const LICENSE_WARNING_ERROR = "FLUX.1 [dev] weights need a licence warning before a credit charge.";

function licenseForBody(engineName, body, mode = "edit") {
  const model = body?.model || engineModelId(engineName, mode);
  return licenseWarning(engineName, model, { fluxDevWeights: Boolean(body?.fluxDevWeights) });
}

/** Public mode must show the warning before any credit debit. Local studio is not blocked. */
function blockLicenseCharge(res, warning, body) {
  if (!warning || !PUBLIC_MODE || body?.ackLicense) return false;
  send(res, 409, {
    error: LICENSE_WARNING_ERROR,
    code: "license_warning",
    licenseWarning: warning,
    charged: false,
  });
  return true;
}

/**
 * Flat stage fee (archive / deploy kit / marketplace kit / optional Arweave upload).
 * Does not use the generation rate limit. Local mode does not charge.
 */
function refundStage(paid) {
  const charge = paid?.charge;
  if (!charge) return;
  try {
    refundCredits(charge.wallet, charge.amount, { engine: charge.engine, note: `refund: ${charge.note}` });
  } catch (e) {
    console.error(`[credits] stage refund failed for ${charge.wallet}: ${e.message}`);
  }
}

function chargeStage(stage, opts = {}) {
  const quote = quoteStage(stage, opts);
  if (!PUBLIC_MODE) return { quote, charge: null };
  const wallet = currentWallet();
  if (!wallet) throw httpError(401, "Sign in with your wallet first", { code: "auth" });
  if (!quote.credits) return { quote, charge: null };
  const note = (opts.storage ?? opts.ipfs) && opts.zip === false ? "arweave upload" : String(stage).replaceAll("_", " ");
  const engine = `stage:${stage}`;
  if (!deductCredits(wallet, quote.credits, { engine, note })) throw insufficient(wallet, quote.credits);
  return { quote, charge: { wallet, amount: quote.credits, engine, note } };
}

/**
 * Archive as it is released: with the genesis lot (base image = edition #0) when the series
 * asks for it. Copies the base into the set folder as 0.<ext> so every consumer finds it.
 */
function releaseArchive(archive, preset, setDir) {
  if (!genesisEnabled(preset)) return archive;
  try {
    syncGenesisImage({ inputDir: P().input, setDir });
  } catch (e) {
    console.warn(`[genesis] base image not synced: ${e.message}`);
  }
  return withGenesis(archive, preset);
}

function loadSeriesContext(archiveName) {
  if (!archiveName) {
    const err = new Error("archive required");
    err.status = 400;
    throw err;
  }
  const { archive, file } = loadArchiveFile(archiveName);
  let preset = null;
  try {
    preset = loadPresetForArchive(archive)?.preset || null;
  } catch {
    preset = loadPresetFileSafe(`${archive.presetId || "x"}.json`)?.preset || null;
  }
  return { archive, archiveFile: file, preset };
}

/** Waits (max ~2 min) for a free per-minute slot — batch mode. */
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

/** The series base as PNG bytes for the similarity metric (PNG only). JPEG/WebP bases are converted; null when that is impossible. */
async function primaryBasePng() {
  const primary = listBases().find((f) => f.primary) || listBases()[0];
  if (!primary) return { exists: false, buf: null };
  let raw;
  try {
    raw = readFileSync(join(P().input, primary.file));
  } catch {
    return { exists: false, buf: null };
  }
  const { buffer } = await ensurePng(raw);
  return { exists: true, buf: imageFormat(buffer) === "png" ? buffer : null, raw };
}

/** File names of the template presets shipped with Series Lab: they are not projects until saved under the user's own id. */
function templatePresetFiles() {
  try {
    return new Set(readdirSync(LOCAL_PATHS.presets).filter((f) => f.endsWith(".json")));
  } catch {
    return new Set();
  }
}

const walletProjects = () => loadProjects(P(), templatePresetFiles());

/**
 * Creating a project is free within PROJECTS_FREE and costs PROJECT_EXTRA_CREDITS once beyond it (admins are exempt;
 * local mode has no credits). Editing an existing project never costs anything.
 * → { isNew, charge: the reservation to refund if the save fails, or null }
 */
function admitNewProject(file, body = {}) {
  const list = walletProjects();
  const cfg = projectsConfig();
  const verdict = admitProject(list, file, cfg);
  if (!verdict.isNew) return { isNew: false, charge: null, credits: 0 };
  const wallet = currentWallet();
  const exempt = !PUBLIC_MODE || !wallet || isAdmin(wallet);
  if (exempt || verdict.charge <= 0) return { isNew: true, charge: null, credits: 0 };
  const q = projectQuota(list, cfg);
  if (body.confirmCharge !== true) {
    recordFunnelEvent(wallet, "project_charge", { cost: verdict.charge, used: q.used });
    throw httpError(402, `Project limit: ${q.used} of ${q.free} free projects are used; a new project costs ${verdict.charge} credits. Confirm to continue.`, {
      code: "project_charge", cost: verdict.charge, free: q.free, used: q.used, balance: getBalance(wallet),
    });
  }
  const note = `New project #${q.used + 1} beyond ${q.free} free`;
  if (!deductCredits(wallet, verdict.charge, { engine: "project", note })) throw insufficient(wallet, verdict.charge);
  recordFunnelEvent(wallet, "project_paid", { cost: verdict.charge, used: q.used });
  return { isNew: true, charge: { wallet, amount: verdict.charge, engine: "project", note }, credits: verdict.charge };
}

/**
 * Put a deleted project back. A restored project is a new project for the limit: beyond the free ones it asks to confirm
 * and charges once (so deleting does not dodge the price).
 */
function restoreProjectFromTrash(trashId, body) {
  if (!trashId) throw httpError(400, "file required");
  const file = deletedProjectFile(P(), trashId);
  if (!file) throw httpError(404, "trash item is not a project");
  const admission = admitNewProject(file, body);
  try {
    restoreDeletedProject(P(), trashId, { legacyArchiveTarget: PUBLIC_MODE ? null : join(P().out, file) });
    commitNewProject(file, admission);
  } catch (e) {
    refundCharge(admission.charge);
    throw e.status ? httpError(e.status, e.message) : e;
  }
  return { file, charged: admission.credits };
}

function commitNewProject(file, admission) {
  if (!admission.isNew) return;
  registerProject(P(), walletProjects(), file, { charge: admission.credits });
  writeActiveProject(P(), file); // the new project is the one the user works on now
}

function safeJsonName(file, fallback = "demo-series.json") {
  const base = basename(String(file || fallback)).replace(/[/\\]/g, "");
  if (!base.endsWith(".json")) throw httpError(400, "file must be *.json");
  if (base.includes("..")) throw httpError(400, "bad path");
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
  if (!id) throw Object.assign(new Error("archive.presetId missing"), { status: 400 });
  const candidates = [
    join(P().presets, `${id}.json`),
    join(P().presets, id.endsWith(".json") ? id : `${id}.json`),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      return { path, file: basename(path), preset: JSON.parse(readFileSync(path, "utf8")) };
    }
  }
  // 404, а не 500: це стан даних користувача, а не збій сервера
  throw Object.assign(new Error(`preset not found for archive.presetId=${id}`), { status: 404 });
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
  return imagesDirName(engine, strength);
}

function safeSetName(name) {
  const base = basename(String(name || "")).replace(/[/\\]/g, "");
  if (!base || base.includes("..") || !/^[a-z0-9._-]+$/i.test(base)) {
    throw httpError(400, "bad set name");
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
    const names = readdirSync(dir);
    const files = names.filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
    const shelvedN = names.includes("versions") ? listShelved(dir, name).length : 0;
    // A set stays listed after its last frame is deleted or parked in versions/,
    // so Review can restore it. marks.json is written on delete for that reason.
    if (!files.length && !shelvedN && !names.includes("marks.json")) continue;
    let mtime = st.mtimeMs;
    sets.push({
      dir: name,
      count: files.length,
      mtime,
    });
  }
  return sets.sort((a, b) => b.mtime - a.mtime);
}

/**
 * Review shows the base image as edition #0 when the series has a genesis lot. The preset is
 * found through the set's archive (out/<presetId>*.json); a set with no known preset is left alone.
 */
function presetForSet(_dirName) {
  const newest = listArchives().sort((x, y) => y.mtime - x.mtime)[0];
  if (!newest?.presetId) return null;
  return loadPresetFileSafe(`${newest.presetId}.json`)?.preset || null;
}

function syncGenesisForSet(setName) {
  try {
    const dirName = safeSetName(setName);
    const setDir = join(P().out, dirName);
    if (!existsSync(setDir) || !statSync(setDir).isDirectory()) return;
    const preset = presetForSet(dirName);
    if (genesisEnabled(preset)) syncGenesisImage({ inputDir: P().input, setDir });
  } catch (e) {
    console.warn(`[genesis] review sync skipped: ${e.message}`);
  }
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
      // The version in the URL makes the browser re-fetch a frame that was re-rendered or re-composed.
      url: `/out/${dirName}/${f}?v=${Math.round(statSync(abs).mtimeMs)}`,
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

function setPayload(setName) {
  syncGenesisForSet(setName);
  const payload = listSetImages(setName);
  return {
    ...payload,
    marks: readMarks(payload.dir),
    shelved: listShelved(join(P().out, payload.dir), payload.dir),
  };
}

/** Drop the edition's keep/redo mark. Always rewrites marks.json so an emptied set stays listed. */
function clearEditionMark(dirName, edition) {
  const marks = readMarks(dirName);
  delete marks[String(edition)];
  writeMarks(dirName, marks);
  return marks;
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

function serveStudioDocs(res, urlPath) {
  const hit = studioDocsResponse(urlPath);
  if (!hit) return false;
  if (hit.location) {
    send(res, hit.status, "", "text/plain; charset=utf-8", { Location: hit.location });
    return true;
  }
  send(res, hit.status, hit.body, hit.type);
  return true;
}

/** Файл інтерфейсу з ETag: браузер перепитує, а не качає заново (src/static-cache.mjs). */
function sendUiFile(req, res, filePath) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return false;
  const buf = readFileSync(filePath);
  const { status, headers } = staticResponse(buf, req.headers);
  if (status === 304) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }
  send(res, 200, buf, MIME[extname(filePath).toLowerCase()] || "application/octet-stream", headers);
  return true;
}

function serveUi(req, res, urlPath) {
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
  if (sendUiFile(req, res, file)) return true;
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
  if (!text) throw httpError(400, "wish text required");
  const ctx = engineCtx(process.env);
  mkdirSync(P().input, { recursive: true });

  const primary = listBases().find((f) => f.primary);
  let plan;
  try {
    plan = planPrimaryGenerate({
      useRef: Boolean(useRef),
      hasPrimary: Boolean(primary),
      engine,
      env: process.env,
    });
  } catch (e) {
    if (e.code === "no_primary" || e.code === "engine_unavailable") {
      throw httpError(400, e.message, { code: e.code, requestedEngine: engine || "" });
    }
    throw e;
  }

  let buf;
  const usedEngine = plan.engine;
  const mode = plan.mode;
  let cost = null;
  if (mode === "edit") {
    const imgPath = join(P().input, primary.file);
    const image = readFileSync(imgPath);
    const mime = mimeOf(primary.file);
    const args = primaryGenerateArgs({ mode, wish: text, strength, seed, image, mime });
    const eng = getEngine(usedEngine);
    cost = eng.costUsd ?? null;
    assertSpend(cost);
    buf = await paidCall({ source: "studio", kind: "base", engine: usedEngine, costUsd: cost, seed, reference: true }, () =>
      withRetry(() => eng.generate(args, ctx)),
    );
  } else {
    const args = primaryGenerateArgs({ mode, wish: text, seed });
    const eng = getTxt2Img(usedEngine);
    cost = eng.costUsd ?? null;
    assertSpend(cost);
    buf = await paidCall({ source: "studio", kind: "base", engine: usedEngine, costUsd: cost, seed }, () =>
      withRetry(() => eng.generate(args, ctx)),
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
    requestedEngine: plan.requestedEngine,
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
    ["/api/spend", "/api/resources", "/api/engines/status", "/api/admin/economy", "/api/admin/resources/plan", "/api/admin/resources/balance", "/api/admin/resources/alert", "/api/admin/resources/note", "/api/notifications/test"].includes(pathname) &&
    !isAdmin(currentWallet())
  ) {
    return send(res, 403, { error: "admin only" });
  }

  // ---- "Delete my data" (privacy right). Files + behavioural rows go; the financial trail stays. ----
  if (pathname === "/api/account/delete-data" && req.method === "POST") {
    if (!PUBLIC_MODE) return send(res, 400, { error: "public mode only" });
    const wallet = currentWallet();
    if (!wallet) return send(res, 401, { error: "Sign in with your wallet first", code: "auth" });
    const body = await readBody(req);
    if (String(body.confirm || "") !== "DELETE") {
      return send(res, 400, { error: "confirmation required", code: "confirm" });
    }
    const usersRoot = join(DATA_DIR, "users");
    const walletRoot = userPaths(wallet).root;
    let filesRemoved = false;
    if (isInsideDir(usersRoot, walletRoot) && walletRoot !== resolve(usersRoot)) {
      rmSync(walletRoot, { recursive: true, force: true });
      filesRemoved = true;
    }
    const rows = eraseWalletRecords(wallet);
    const logLines = anonymizeRenderLog(renderLog(), wallet);
    console.warn(`[erase] data erased for ${String(wallet).slice(0, 6)}… (files ${filesRemoved ? "yes" : "no"}, rows ${Object.values(rows).reduce((a, b) => a + b, 0)}, log ${logLines})`);
    return send(res, 200, { ok: true, filesRemoved, rows, logLines });
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
      projects: (() => {
        const q = projectQuota(walletProjects(), projectsConfig());
        return isAdmin(wallet) ? { ...q, needsCharge: false, exempt: true } : { ...q, exempt: false };
      })(),
      packages: Object.entries(PACKAGES).map(([id, p]) => ({ id, ...p })),
      solPay: solPayInfo(process.env, { admin: isAdmin(wallet) }),
      referral: code ? { code, link: `${process.env.AUTH_URI || "https://lab.w3ir.io"}/login?ref=${code}` } : null,
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

  // Operator routes (admin system, resources, economy, spend, engine status) live in server/routes/admin.mjs.
  if (
    await handleAdminRoutes({
      req, res, url, pathname, PUBLIC_MODE, readBody, rejectSecrets, systemPayload, renderLog, resourcesPayload, resourcesPayloadLive,
      send: (...a) => { send(...a); return true; },
      isAdminNow: () => isAdmin(currentWallet()),
    })
  ) return;

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
        readyEdit: listSelectableEngines(process.env, ENGINES),
        readyTxt2img: listSelectableEngines(process.env, TXT2IMG),
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
    if (!preset || typeof preset !== "object") throw httpError(400, "preset required");
    const checked = checkPreset(preset);
    if (!checked.ok) return send(res, 400, { ok: false, errors: checked.errors });
    const id = String(preset.id || "").replace(/[^a-zA-Z0-9._-]/g, "-");
    if (!id) throw new Error("preset.id required");
    mkdirSync(P().presets, { recursive: true });
    // strip UI-only meta if saving as real preset (keep _meta optional)
    const outName = `${id}.json`;
    const outPath = join(P().presets, outName);
    const admission = admitNewProject(outName, body);
    try {
      writeJsonAtomic(outPath, preset);
      commitNewProject(outName, admission);
    } catch (e) {
      refundCharge(admission.charge);
      throw e;
    }
    return send(res, 200, { ok: true, file: outName, path: `presets/${outName}`, id, project: { new: admission.isNew, charged: admission.credits } });
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

  if (pathname === "/api/simulate" && req.method === "POST") {
    const body = await readBody(req);
    let preset = body.preset;
    if (!preset) {
      preset = loadPresetByFile(body.file || "demo-series.json").preset;
    }
    const checked = checkPreset(preset);
    if (!checked.ok) return send(res, 400, { ok: false, errors: checked.errors });
    try {
      const sim = drySimulate(preset, body.pack || null);
      return send(res, 200, { ok: true, ...sim });
    } catch (e) {
      return send(res, 400, { ok: false, error: String(e.message || e), code: "simulate" });
    }
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
    const admission = admitNewProject(file, body);
    try {
      writeJsonAtomic(join(P().presets, file), next);
      commitNewProject(file, admission);
    } catch (e) {
      refundCharge(admission.charge);
      throw e;
    }
    return send(res, 200, { ok: true, file, preset: next, project: { new: true, charged: admission.credits } });
  }

  if (pathname === "/api/projects" && req.method === "GET") {
    const list = walletProjects();
    const cfg = projectsConfig();
    const quota = projectQuota(list, cfg);
    const exempt = !PUBLIC_MODE || isAdmin(currentWallet());
    const rows = describeProjects(P(), list).map((p) => ({ ...p, assets: projectAssetStats(P(), p.file) }));
    return send(res, 200, {
      projects: rows,
      deleted: listDeletedProjects(P()).map((d) => ({ ...d, daysLeft: trashDaysLeft(d.at) })),
      trashDays: trashRetentionDays(),
      active: readActiveProject(P()),
      assetsPerProject: PUBLIC_MODE,
      quota: { ...quota, needsCharge: exempt ? false : quota.needsCharge, exempt },
    });
  }

  if (pathname === "/api/projects/open" && req.method === "POST") {
    const body = await readBody(req);
    const file = String(body.file || "");
    const list = walletProjects();
    if (!isProject(list, file)) return send(res, 404, { error: "project not found" });
    writeActiveProject(P(), file); // every asset route now works on this project (base, layers, sets, archive)
    return send(res, 200, { ok: true, active: file });
  }

  if (pathname === "/api/projects/move-set" && req.method === "POST") {
    const body = await readBody(req);
    const from = String(body.from || readActiveProject(P()) || "");
    const to = String(body.to || "");
    const list = walletProjects();
    if (!PUBLIC_MODE) throw httpError(400, "projects keep separate sets only on the hosted studio");
    if (!isProject(list, from) || !isProject(list, to)) return send(res, 404, { error: "project not found" });
    try {
      return send(res, 200, { ok: true, ...moveSetBetweenProjects(P(), from, to, safeSetName(body.dir || "")) });
    } catch (e) {
      throw e.status ? httpError(e.status, e.message) : e;
    }
  }

  if (pathname === "/api/projects/delete" && req.method === "POST") {
    const body = await readBody(req);
    const file = String(body.file || "");
    if (!/^[a-zA-Z0-9._-]+\.json$/.test(file) || file.includes("..")) throw httpError(400, "bad file");
    const list = walletProjects();
    if (!isProject(list, file)) return send(res, 404, { error: "project not found" });
    if (body.confirm !== true) throw httpError(400, "confirmation required");
    // Reversible: the preset, the recipe archive and the project's own base image, layers and frame sets go to the trash together.
    const trashId = trashProject(P(), file, { legacyArchive: PUBLIC_MODE ? null : join(P().out, file) });
    const next = list.filter((p) => p.file !== file);
    saveProjects(P(), next);
    if (readActiveProject(P()) === file) writeActiveProject(P(), next[0]?.file || null);
    return send(res, 200, { ok: true, file, trashId, active: readActiveProject(P()), quota: projectQuota(next, projectsConfig()) });
  }

  if (pathname === "/api/projects/purge" && req.method === "POST") {
    const body = await readBody(req);
    if (body.confirm !== true) throw httpError(400, "confirmation required");
    try {
      purgeDeletedProject(P(), String(body.id || ""));
    } catch (e) {
      throw e.status ? httpError(e.status, e.message) : e;
    }
    return send(res, 200, { ok: true, id: String(body.id) });
  }

  if (pathname === "/api/projects/restore" && req.method === "POST") {
    const body = await readBody(req);
    const done = restoreProjectFromTrash(String(body.id || ""), body);
    return send(res, 200, { ok: true, ...done, project: { new: true, charged: done.charged } });
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
    if (!body.data) throw httpError(400, "data (base64) required");
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
    if (!file) throw httpError(400, "file required");
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
    if (!file || file.includes("..")) throw httpError(400, "bad file");
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
    if (!text) throw httpError(400, "wish text required");
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
    if (!text) throw httpError(400, "wish text required");
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
    const licenseNotice = licenseForBody(engineWanted, body);
    if (licenseNotice) {
      lines.push("", `Licence: ${licenseNotice.en}`);
    }
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
      licenseWarning: licenseNotice,
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
      const requestedEngine = body.engine || "kontext";
      const engineName = pickAvailableEngine(requestedEngine, process.env, ENGINES, { exact: true });
      if (!engineName) {
        throw httpError(400, `Engine unavailable for edit: ${requestedEngine}`, {
          code: "engine_unavailable",
          requestedEngine,
        });
      }
      const eng = getEngine(engineName);
      const licenseNotice = licenseForBody(engineName, body);
      if (blockLicenseCharge(res, licenseNotice, body)) return;
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
        requestedEngine,
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
    const licenseNotice = licenseForBody(engineWanted, body);
    if (blockLicenseCharge(res, licenseNotice, body)) return;
    const engineName = pickAvailableEngine(engineWanted, process.env, ENGINES, { exact: true });
    if (!engineName) {
      throw httpError(400, `Engine unavailable for edit: ${engineWanted}`, {
        code: "engine_unavailable",
        requestedEngine: engineWanted,
      });
    }
    const set = setDirName(engineWanted, strength);
    const sel = resolveGenerateSelection(archive, body, set);
    if (!sel.editions.length) {
      // Do not open SSE. A finished JSON body is the whole reply; the panel
      // must not sit on a 0% "live stream" waiting for a done event.
      return send(res, 200, {
        ok: true,
        stream: false,
        file: archiveFile,
        engine: engineName,
        requestedEngine: engineWanted,
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
    const stop = new AbortController();
    ctx.signal = stop.signal;
    const timedFetch = ctx.fetch;
    ctx.fetch = (url, init = {}) => {
      const signal = init.signal ? AbortSignal.any([init.signal, stop.signal]) : stop.signal;
      return timedFetch(url, { ...init, signal });
    };
    const outDir = join(P().out, set);
    const breaker = failureBreaker({ maxConsecutive: Number(process.env.SERIES_MAX_CONSECUTIVE_FAILURES) || 5 });
    mkdirSync(outDir, { recursive: true });

    const isStream = Boolean(body.stream) || String(req.headers["accept"] || "").includes("text/event-stream");
    const concurrency = Math.max(1, Math.min(4, Number(body.concurrency) || 2));
    const batchSignal = AbortSignal.any([breaker.signal, stop.signal]);
    attachStopOnDisconnect(res, stop);

    if (isStream) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        Connection: "keep-alive",
      });
      res.flushHeaders?.();
      res.socket?.setNoDelay?.(true);
      writeSse(res, {
        type: "start",
        total: sel.recipes.length,
        engine: engineName,
        requestedEngine: engineWanted,
        strength,
        set,
        licenseWarning: licenseNotice,
      });
    }

    let results;
    try {
      results = await mapConcurrent(
        sel.recipes,
        concurrency,
        async (recipe) => {
          let charge = null;
          try {
            if (stop.signal.aborted) {
              return { ok: false, skipped: true, edition: recipe.edition, index: recipe.index, code: "stopped" };
            }
            await waitForRateSlot();
            if (stop.signal.aborted) {
              return { ok: false, skipped: true, edition: recipe.edition, index: recipe.index, code: "stopped" };
            }
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
            if (stop.signal.aborted) {
              refundCharge(charge);
              return { ok: false, skipped: true, edition: recipe.edition, index: recipe.index, code: "stopped" };
            }
            const name = `${recipe.edition}.png`;
            const v = addVersion(outDir, recipe.edition, buf, {
              engine: engineName,
              model: modelTitle(engineName, "edit"),
              strength,
              seed: recipe.seed,
              promptHash: promptHash(recipe.prompt),
              baseSha256: sha256Hex(image),
              ...(licenseNotice ? { licenseWarning: licenseNotice } : {}),
            });
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
            const stopped = stop.signal.aborted || e?.name === "AbortError";
            if (!stopped) {
              logRender({ source: "studio", kind: "batch", engine: engineName, set, edition: recipe.edition, ok: false, costUsd: 0, error: String(e.message || e).slice(0, 300) });
              breaker.record(false);
            }
            return {
              ok: false,
              skipped: stopped,
              edition: recipe.edition,
              index: recipe.index,
              ...(stopped ? { code: "stopped" } : { error: String(e.message || e) }),
            };
          }
        },
        (progress) => {
          if (isStream) {
            writeSse(res, {
              type: "progress",
              result: progress.result,
              completed: progress.completed,
              total: progress.total,
            });
          }
        },
        { signal: batchSignal },
      );
    } catch (e) {
      if (isStream) {
        writeSse(res, { type: "error", error: String(e.message || e) });
        if (!res.writableEnded) {
          try { res.end(); } catch { /* client already gone */ }
        }
        return;
      }
      throw e;
    }

    const okN = results.filter((r) => r.ok).length;
    const finalPayload = {
      ok: true,
      stub: false,
      file: archiveFile,
      engine: engineName,
      requestedEngine: engineWanted,
      strength,
      set,
      count: okN,
      costUsd: Math.round(okN * (eng.costUsd || 0) * 1000) / 1000,
      stopped: breaker.reason || (stop.signal.aborted ? "stopped" : null),
      skipped: results.filter((r) => r.skipped).length,
      results,
      thumbs: results.filter((r) => r.ok).map((r) => ({ edition: r.edition, url: r.url, path: r.path })),
    };

    // Operator batch summary names the series and its folder. On a public host that would send every
    // user's work to the operator's chat, so it stays a local-studio feature (payments still notify).
    if (!PUBLIC_MODE) {
      dispatchBatchNotification({
        presetId: archive.presetId,
        total: sel.recipes.length,
        success: okN,
        failed: results.length - okN,
        outputDir: `out/${set}`,
      }).catch(() => {});
    }

    if (isStream) {
      writeSse(res, { type: "done", ...finalPayload });
      if (!res.writableEnded) {
        try { res.end(); } catch { /* client already gone */ }
      }
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
    discardSelectionFiles([file]);
    return send(res, 200, { ok: true, dir, ...listVersions(join(P().out, dir), dir, body.edition) });
  }

  if (pathname === "/api/trash" && req.method === "GET") {
    return send(res, 200, { items: listTrash(trashDir()) });
  }

  if (pathname === "/api/trash/restore" && req.method === "POST") {
    const body = await readBody(req);
    const trashId = String(body.id || "");
    let item;
    try {
      item = restoreTrash({ root: P().root, trashDir: trashDir() }, trashId);
    } catch (e) {
      if (/already exists/.test(String(e.message))) throw httpError(409, "A file with this name already exists: move or delete it first.");
      throw e;
    }
    return send(res, 200, { ok: true, restored: item, items: listTrash(trashDir()) });
  }

  if (pathname === "/api/trash/purge" && req.method === "POST") {
    const body = await readBody(req);
    purgeTrash(trashDir(), String(body.id || ""));
    return send(res, 200, { ok: true, items: listTrash(trashDir()) });
  }

  if (pathname === "/api/similarity" && req.method === "GET") {
    const dirName = safeSetName(url.searchParams.get("dir") || "");
    const setDir = join(P().out, dirName);
    if (!existsSync(setDir)) return send(res, 400, { error: "set not found" });
    const base = await primaryBasePng();
    if (!base.exists) return send(res, 400, { error: "No base image found to analyze" });
    if (!base.buf) return send(res, 200, { ok: true, method: SIMILARITY_METHOD, offline: true, editions: [], baseUnusable: true });
    const baseBuf = base.buf;
    const editions = [];
    for (const name of readdirSync(setDir)) {
      const m = /^(\d+)\.png$/i.exec(name);
      if (!m) continue;
      try {
        const row = similarityToBase(readFileSync(join(setDir, name)), baseBuf);
        editions.push({ edition: Number(m[1]), ...row });
      } catch {
        editions.push({ edition: Number(m[1]), similarity: null, warn: false, skipped: true });
      }
    }
    editions.sort((a, b) => a.edition - b.edition);
    return send(res, 200, { ok: true, method: SIMILARITY_METHOD, offline: true, editions });
  }

  if (pathname === "/api/set/compress" && req.method === "POST") {
    const body = await readBody(req);
    const dirName = safeSetName(body.dir || "");
    const setDir = join(P().out, dirName);
    if (!dirName || !existsSync(setDir) || !statSync(setDir).isDirectory()) return send(res, 404, { error: "set not found" });
    const maxBytes = Math.max(100_000, Math.min(20 * 1024 * 1024, Number(body.maxBytes) || COMPRESS_TARGET_BYTES));
    const dryRun = Boolean(body.dryRun);
    if (!dryRun && !(await loadSharp())) return send(res, 400, { error: "sharp_not_installed", sharp: false });
    const report = await compressSet(setDir, { maxBytes, dryRun });
    return send(res, 200, { ok: true, dir: dirName, dryRun, ...report });
  }

  if (pathname === "/api/quality" && req.method === "GET") {
    const dirName = safeSetName(url.searchParams.get("dir") || "");
    const setDir = join(P().out, dirName);
    if (!dirName || !existsSync(setDir) || !statSync(setDir).isDirectory()) return send(res, 400, { error: "set not found" });
    const base = await primaryBasePng();
    const report = await analyzeSetQuality({ setDir, baseBuf: base.buf, marks: readMarks(dirName) });
    // A base that exists but cannot be decoded must not read as "all good": say that similarity was not checked.
    return send(res, 200, { ok: true, dir: dirName, ...report, hasBase: base.exists, baseUnusable: base.exists && (!base.buf || (report.total > 0 && !report.similarity)) });
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
    return send(res, 200, setPayload(dir));
  }

  if (pathname === "/api/set/delete" && req.method === "POST") {
    const body = await readBody(req);
    const dir = safeSetName(body.dir || "");
    const setDir = join(P().out, dir);
    if (!existsSync(setDir) || !statSync(setDir).isDirectory()) return send(res, 404, { error: "set not found" });
    let files;
    try {
      files = editionAssetFiles(setDir, body.edition);
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
    if (!files.length) return send(res, 400, { error: "nothing to delete" });
    discardSelectionFiles(files);
    clearEditionMark(dir, body.edition);
    return send(res, 200, { ok: true, dir, edition: Number(body.edition), ...setPayload(dir) });
  }

  if (pathname === "/api/set/drop" && req.method === "POST") {
    const body = await readBody(req);
    const dir = safeSetName(body.dir || "");
    const setDir = join(P().out, dir);
    if (!existsSync(setDir) || !statSync(setDir).isDirectory()) return send(res, 404, { error: "set not found" });
    let shelved;
    try {
      shelved = shelveCurrent(setDir, body.edition);
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
    clearEditionMark(dir, body.edition);
    return send(res, 200, { ok: true, dir, shelved, ...setPayload(dir) });
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
    const missingTraits = countMissingTraitFrames(results);
    writeJsonAtomic(join(setDir, "triage.json"), {
      at: new Date().toISOString(),
      provider,
      results,
      missingTraitFrames: missingTraits.frames,
    });

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
      missingTraitFrames: missingTraits.frames,
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
    const paid = chargeStage("archive", { storage: true, zip: false });
    let result;
    try {
      result = await uploadToIrys({
        dir: setDir,
      });
    } catch (e) {
      refundStage(paid);
      throw e;
    }
    if (result && result.ok === false) refundStage(paid);
    return send(res, 200, { ...result, quote: paid.quote, chargedCredits: paid.charge?.amount || 0 });
  }

  // Release kits: launchpad profiles, portals and config, launch advisor, deploy kit and marketplace kit.
  if (
    await handleKitRoutes({
      req, res, url, pathname, P, bundlesDir, chargeStage, listArchives, loadArchiveFile, loadPresetFileSafe, loadSeriesContext, readMarks, refundStage, rejectSecrets, releaseArchive, resolveLocale, safeSetName,
    })
  ) return;

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
    const bundleOpts = {
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
      aiMark: body.aiMark !== false,
      authorship: body.authorship && typeof body.authorship === "object" ? body.authorship : null,
    };
    try {
      const result = await buildBundleZip({
        archive: releaseArchive(archive, preset, setDir),
        preset,
        setDir,
        set,
        marks,
        bundlesDir: bundlesDir(),
        opts: { ...bundleOpts, gate: true },
      });
      let paid;
      try {
        paid = chargeStage("archive", { zip: true, storage: false });
      } catch (e) {
        try { unlinkSync(join(bundlesDir(), result.file)); } catch { /* already gone */ }
        throw e;
      }
      return send(res, 200, {
        ok: true,
        ready: result.ready === true,
        file: result.file,
        path: result.path,
        count: result.count,
        missing: result.missing || [],
        format: result.format,
        profile: result.profile,
        chain: result.chain,
        provenanceHash: result.provenanceHash || null,
        upscaled: result.upscaled,
        upscaleSkipped: result.upscaleSkipped || null,
        fallback: result.fallback || null,
        archive: archiveFile,
        set,
        downloadUrl: `/${result.path}`,
        preflight: result.preflight,
        report: result.preflight?.report || "",
        quote: paid.quote,
        chargedCredits: paid.charge?.amount || 0,
      });
    } catch (e) {
      if (e.extra?.code === "credits" || e.extra?.code === "auth" || e.status === 401) throw e;
      const status =
        e.status || (e.code === "bundle_select" || e.code === "bundle_empty" ? 400 : 500);
      return send(res, status, {
        error: e.report || String(e.message || e),
        code: e.code || e.extra?.code || "bundle",
        ready: false,
        preflight: e.preflight || null,
        report: e.report || e.preflight?.report || "",
        ...(e.extra || {}),
      });
    }
  }

  if (pathname === "/api/preflight" && req.method === "POST") {
    const body = await readBody(req);
    if (rejectSecrets(res, body)) return;
    const archiveName = body.archive || body.file;
    const profileKey = body.profile || (body.format === "metaplex" ? "magiceden" : body.format === "ordinals" ? "ordinalsbot" : "opensea");
    const profile = LAUNCHPAD_PROFILES[profileKey] || LAUNCHPAD_PROFILES.opensea;
    const format = profile.format || body.format || "erc721";
    let loaded;
    try {
      loaded = loadSeriesContext(archiveName);
    } catch (e) {
      return send(res, e.status || 404, { error: String(e.message || e) });
    }
    const set = safeSetName(body.set);
    const setDir = join(P().out, set);
    if (!existsSync(setDir) || !statSync(setDir).isDirectory()) {
      return send(res, 400, { error: `set not found: ${set}` });
    }
    const locale = resolveLocale(req, body);
    try {
      const result = await buildBundleZip({
        archive: releaseArchive(loaded.archive, loaded.preset, setDir),
        preset: loaded.preset,
        setDir,
        set,
        marks: readMarks(set),
        bundlesDir: bundlesDir(),
        opts: {
          format,
          profile: profileKey,
          creatorAddress: body.creatorAddress || null,
          zeroIndexed: Boolean(body.zeroIndexed || body.zeroIndex),
          onlyKeep: body.onlyKeep === undefined ? true : Boolean(body.onlyKeep),
          namePrefix: body.namePrefix || `${loaded.archive.presetId || "Series"} #`,
          symbol: body.symbol || profile.defaultSymbol || "LAB",
          sellerFeeBasisPoints: body.sellerFeeBasisPoints ?? profile.defaultFee ?? 500,
          description: body.description || `${loaded.preset?.name || loaded.archive.presetId || "Series"} — Series Lab export`,
          imageUriPrefix: body.imageUriPrefix || "",
          animationUriPrefix: body.animationUriPrefix || "",
          locale,
          dryRun: true,
        },
      });
      return send(res, 200, {
        ok: true,
        ready: result.ready === true,
        count: result.count,
        chain: result.chain,
        profile: result.profile,
        preflight: result.preflight,
        report: result.preflight?.report || "",
      });
    } catch (e) {
      const status = e.status || (e.code === "bundle_select" || e.code === "bundle_empty" ? 400 : 500);
      return send(res, status, { error: String(e.message || e), code: e.code || "preflight", ready: false });
    }
  }

  if (pathname === "/api/stages/quotes" && req.method === "GET") {
    const count = Number(url.searchParams.get("count") || 1);
    const engine = url.searchParams.get("engine") || "kontext";
    const provider = url.searchParams.get("provider") || "heuristic";
    return send(res, 200, {
      ok: true,
      quotes: {
        generation: quoteStage("generation", { engine, count, reference: true }),
        curation: quoteStage("curation", { provider, count }),
        archive: quoteStage("archive", { zip: true }),
        archive_storage: quoteStage("archive", { zip: false, storage: true }),
        deploy_kit: quoteStage("deploy_kit"),
        marketplace_kit: quoteStage("marketplace_kit"),
      },
    });
  }

  if (pathname === "/api/stages/quote" && req.method === "GET") {
    const stage = url.searchParams.get("stage") || "archive";
    try {
      const quote = quoteStage(stage, {
        engine: url.searchParams.get("engine") || "kontext",
        count: Number(url.searchParams.get("count") || 1),
        reference: url.searchParams.get("reference") !== "0",
        provider: url.searchParams.get("provider") || "heuristic",
        storage: url.searchParams.get("storage") === "1" || url.searchParams.get("ipfs") === "1",
        zip: url.searchParams.get("zip") !== "0",
      });
      return send(res, 200, { ok: true, quote });
    } catch (e) {
      return send(res, e.status || 400, { error: String(e.message || e) });
    }
  }

  // ---- PNG layers as a ZIP (the hosted studio gives the user no file system) ----
  if (pathname === "/api/layers/status" && req.method === "GET") {
    let items = null;
    const archiveName = url.searchParams.get("archive");
    if (archiveName) {
      try {
        items = loadSeriesContext(archiveName).preset?.traits?.items || null;
      } catch {
        items = null;
      }
    }
    return send(res, 200, { ok: true, limits: LAYER_LIMITS, ...layersStatus(P().layers, items) });
  }

  if (pathname === "/api/layers/upload" && req.method === "POST") {
    try {
      const buffer = await readRawBody(req, LAYER_LIMITS.zipBytes);
      const result = await importLayersZip(buffer, P().layers, {
        clear: url.searchParams.get("clear") === "1",
        // Replacing is reversible: the old layers go to the trash (Resources → Trash), like other deletions.
        onClear: (dir) => {
          const old = listLayerFiles(dir);
          if (old.length) toTrash(old, "layers replaced");
        },
      });
      let items = null;
      const archiveName = url.searchParams.get("archive");
      if (archiveName) {
        try {
          items = loadSeriesContext(archiveName).preset?.traits?.items || null;
        } catch {
          items = null;
        }
      }
      return send(res, 200, { ok: true, ...result, status: layersStatus(P().layers, items) });
    } catch (e) {
      if (e instanceof LayersZipError) return send(res, e.status, { error: e.message, code: `layers_${e.code}` });
      throw e;
    }
  }

  if (pathname === "/api/layers/clear" && req.method === "POST") {
    const old = listLayerFiles(P().layers);
    const trashed = old.length ? toTrash(old, "layers cleared") : null;
    clearLayers(P().layers);
    return send(res, 200, { ok: true, removed: old.length, trashId: trashed?.id ?? null });
  }

  if (pathname === "/api/compose" && req.method === "POST") {
    const body = await readBody(req);
    if (rejectSecrets(res, body)) return;
    let loaded;
    try {
      loaded = loadSeriesContext(body.archive || body.file);
    } catch (e) {
      return send(res, e.status || 400, { error: String(e.message || e) });
    }
    const items = loaded.preset?.traits?.items;
    if (!Array.isArray(items) || !items.length) {
      return send(res, 400, { error: "preset traits are required to compose layers" });
    }
    const root = resolve(P().root);
    const layerDir = body.layers ? resolve(root, String(body.layers)) : resolve(P().layers);
    if (!isInsideDir(root, layerDir)) {
      return send(res, 400, { error: "layers directory must stay inside the project" });
    }
    if (!existsSync(layerDir)) {
      return send(res, 400, { error: `layers directory not found: ${layerDir}` });
    }
    // Перегляд одного кадру: складаємо одне видання в пам'яті, нічого не пишемо на диск.
    const previewing = body.preview !== undefined && body.preview !== null && body.preview !== "";
    if (previewing && !/^\d{1,9}$/.test(String(body.preview))) {
      return send(res, 400, { error: "preview must be an edition number" });
    }
    // Гібрид: ручні шари поверх кадрів, які вже намалювала модель (набір `out/<over>`).
    if (body.over) {
      let setName;
      try {
        setName = safeSetName(body.over);
      } catch {
        return send(res, 400, { error: "bad set name" });
      }
      const setDir = join(P().out, setName);
      if (!existsSync(setDir) || !statSync(setDir).isDirectory()) {
        return send(res, 404, { error: `set directory not found: ${setName}` });
      }
      const only = Array.isArray(body.only) ? body.only.map((k) => String(k)).filter((k) => items.some((i) => i.key === k)) : null;
      const outName = `${setName}-layers`;
      if (previewing) {
        const frameFile = join(setDir, `${Number(body.preview)}.png`);
        if (!existsSync(frameFile)) {
          return send(res, 404, { error: `frame not found: ${setName}/${Number(body.preview)}.png` });
        }
        try {
          const frame = previewEdition({ archive: loaded.archive, items, edition: body.preview, basePng: readFileSync(frameFile), layerDir, only, skipMissing: true });
          return send(res, 200, {
            ok: true,
            mode: "preview",
            over: setName,
            edition: Number(body.preview),
            layers: frame.layers.filter((l) => l !== "base"),
            skipped: frame.skipped,
            sha256: frame.sha256,
            png: `data:image/png;base64,${frame.png.toString("base64")}`,
          });
        } catch (e) {
          return send(res, e.status || 400, { error: String(e.message || e), code: "compose" });
        }
      }
      try {
        const report = overlaySet({ archive: loaded.archive, items, setDir, layerDir, outDir: join(P().out, outName), only, limit: body.limit });
        return send(res, 200, {
          ok: true,
          mode: "overlay",
          count: report.count,
          painted: report.painted,
          unpainted: report.unpainted,
          missingFrames: report.missingFrames.slice(0, 20),
          missingFramesCount: report.missingFrames.length,
          dir: `out/${outName}`,
          set: outName,
        });
      } catch (e) {
        return send(res, 400, { error: String(e.message || e), code: "compose" });
      }
    }
    const base = baseStatus();
    const baseName = body.base ? basename(String(body.base)) : base.file;
    const basePath = join(P().input, baseName);
    if (!existsSync(basePath)) {
      return send(res, 400, { error: `base image not found: input/${baseName}` });
    }
    if (previewing) {
      try {
        const frame = previewEdition({ archive: loaded.archive, items, edition: body.preview, basePng: readFileSync(basePath), layerDir });
        return send(res, 200, {
          ok: true,
          mode: "preview",
          over: null,
          edition: Number(body.preview),
          layers: frame.layers.filter((l) => l !== "base"),
          skipped: frame.skipped,
          sha256: frame.sha256,
          png: `data:image/png;base64,${frame.png.toString("base64")}`,
        });
      } catch (e) {
        return send(res, e.status || 400, { error: String(e.message || e), code: "compose" });
      }
    }
    const outDir = join(P().out, "layers");
    try {
      const report = composeArchive({
        archive: loaded.archive,
        items,
        basePng: readFileSync(basePath),
        layerDir,
        outDir,
        limit: body.limit,
      });
      return send(res, 200, { ok: true, count: report.count, dir: "out/layers", editions: report.editions });
    } catch (e) {
      return send(res, 400, { error: String(e.message || e), code: "compose" });
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
    return send(res, 200, { ok: true, set: setName, provenance: prov, duplicates: duplicateImages(prov.records), check: verifyProvenance(prov, setDir) });
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
    layers: join(base, "layers"),
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

/**
 * The folders a signed-in wallet works in: the ACTIVE project's base image, layers and frame sets (everything else stays
 * at user level). Before the first project exists everything is the old shared layout; the moment a project exists, the
 * assets the wallet already had move into it once (see adoptLegacyAssets).
 */
function scopedPaths(wallet) {
  const user = userPaths(wallet);
  const list = loadProjects(user, templatePresetFiles());
  if (!list.length) return user;
  let active = readActiveProject(user);
  if (!active || !isProject(list, active)) {
    active = initialActiveProject(user, list);
    writeActiveProject(user, active);
  }
  adoptLegacyAssets(user, active, list.map((p) => p.file));
  convertLegacyProjectTrash(user);
  const paths = projectPaths(user, active);
  ensureProjectDirs(paths);
  return paths;
}

const isPageRequest = (pathname) => pathname === "/" || pathname === "/studio" || pathname === "/studio/" || pathname.endsWith(".html");

const cspLog = createCspLog();
const requestMetrics = createRequestMetrics();
const SERVER_STARTED = Date.now();
const APP_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version || "";
  } catch {
    return "";
  }
})();
const APP_REVISION = (() => {
  try {
    return readFileSync(join(ROOT, "REVISION"), "utf8").trim().slice(0, 40);
  } catch {
    return "";
  }
})();

/** Усе, що показує вкладка адмінки «Система»: без секретів, прапорці булеві. */
function systemPayload() {
  const proc = processSnapshot(SERVER_STARTED);
  const disk = diskSnapshot(DATA_DIR);
  const backup = backupStatus(DATA_DIR);
  const requests = requestMetrics.snapshot();
  const csp = cspLog.counts();
  const cspTotal = Object.values(csp).reduce((a, b) => a + b, 0);
  let platform = null;
  if (PLATFORM_ON) {
    try {
      platform = platformCounts(openDb());
    } catch {
      platform = null;
    }
  }
  const dbFile = process.env.USERS_DB_PATH || join(DATA_DIR, "users.db");
  const usersDir = join(DATA_DIR, "users");
  let wallets = null;
  try {
    wallets = readdirSync(usersDir).length;
  } catch {
    wallets = null;
  }
  const tg = getTelegramConfig();
  return {
    generatedAt: new Date().toISOString(),
    app: {
      version: APP_VERSION,
      revision: APP_REVISION,
      mode: PUBLIC_MODE ? "public" : "local",
      node: process.version,
      flags: {
        platform: PLATFORM_ON,
        payments: Boolean(solPayInfo().enabled),
        telegram: Boolean(tg.configured),
        csp: cspMode(),
        spendCapUsd: spendCap(process.env.SERIES_SPEND_CAP_USD),
      },
    },
    process: proc,
    disk,
    data: {
      dbMb: fileMb(dbFile),
      walMb: fileMb(`${dbFile}-wal`),
      wallets,
      tree: treeBytesCached(DATA_DIR),
    },
    backup,
    platform,
    requests,
    csp: { total: cspTotal, top: Object.entries(csp).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([key, count]) => ({ key, count })) },
    alerts: buildAlerts({ disk, process: proc, backup, requests, cspTotal }),
  };
}

/** Приймач звітів CSP: без авторизації (сторінка входу теж шле), тіло до 8 КБ, завжди 204. */
async function handleCspReport(req, res) {
  try {
    cspLog.record(summarizeReport((await readRawBody(req, 8192)).toString("utf8")));
  } catch { /* зайве чи надто велике тіло ігноруємо */ }
  res.writeHead(204);
  res.end();
}

const server = createServer(async (req, res) => {
  applySecurityHeaders(req, res);
  applyCsp(req, res);
  const startedHr = process.hrtime.bigint();
  res.on("finish", () => {
    try {
      const type = String(res.getHeader("content-type") || "");
      requestMetrics.record({
        method: req.method,
        pathname: String(req.url || "/").split("?")[0],
        status: res.statusCode,
        ms: Number(process.hrtime.bigint() - startedHr) / 1e6,
        stream: type.includes("text/event-stream"),
      });
    } catch { /* метрики не мають ламати відповідь */ }
  });
  if (req.method === "POST" && String(req.url || "").split("?")[0] === CSP_REPORT_PATH) return handleCspReport(req, res);
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
    const store = wallet ? { wallet, paths: scopedPaths(wallet) } : undefined;
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
      const blocked = checkApiRequest({ method: req.method, headers: req.headers, path: url.pathname }, { allowedHosts: ALLOWED_HOSTS, port: PORT });
      if (blocked) return send(res, 403, { error: blocked });
      await handleApi(req, res, url);
      return;
    }
    if (serveInput(res, url.pathname)) return;
    if (serveOut(res, url.pathname)) return;
    if (serveStudioDocs(res, url.pathname)) return;
    if (serveUi(req, res, url.pathname)) return;
    // legacy public redirect page
    if (url.pathname === "/old" || url.pathname.startsWith("/public/")) {
      const rel = url.pathname.replace(/^\/public/, "") || "/index.html";
      const file = join(PUBLIC, rel === "/" ? "/index.html" : rel);
      if (sendFile(res, file)) return;
    }
    send(res, 404, "Not found", "text/plain; charset=utf-8");
  }
}

/** Purge trash older than SERIES_TRASH_DAYS: at start and then once a day (deleted projects and every project's file trash). */
function pruneAllTrash() {
  try {
    const days = trashRetentionDays();
    if (!days) return;
    let purged = pruneTrash(trashDir(), days).length;
    const usersDir = join(DATA_DIR, "users");
    if (PUBLIC_MODE && existsSync(usersDir)) {
      for (const u of readdirSync(usersDir)) purged += pruneWalletTrash(join(usersDir, u), days);
    }
    if (purged) console.log(`Trash: purged ${purged} item(s) older than ${days} days`);
  } catch (e) {
    console.warn(`Trash prune skipped: ${e.message}`);
  }
}
pruneAllTrash();
setInterval(pruneAllTrash, 86_400_000).unref();

const openErr = openAccessError(HOST, PUBLIC_MODE) || hostedConfigError(HOST, PUBLIC_MODE, process.env);
if (openErr) {
  console.error(openErr);
  process.exitCode = 1;
} else {
  const hostWarn = hostedConfigWarning(HOST, PUBLIC_MODE, process.env);
  if (hostWarn) console.warn(hostWarn);

  if (PLATFORM_ON) startPlatformBackground();

  server.listen(PORT, HOST, () => {
    const href = `http://${HOST}:${PORT}/studio/`;
    console.log(`Series Lab Studio (${PUBLIC_MODE ? "public" : "local"})  ${href}`);
    console.log(`Also: http://${HOST}:${PORT}/`);
    if (!isLoopbackHost(HOST)) {
      console.log(`Hosted studio names: ${process.env.SERIES_ALLOWED_HOSTS || HOST}`);
    }
    console.log("API keys stay in this process environment and are not sent to the browser. Ctrl+C to stop.");
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
}
