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
import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { exec } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { ensurePng, imageFormat } from "../src/png-normalize.mjs";
import { buildRecipes, appendSupplyWave, describeSupply, dna, duplicates, loadTraitsFromPreset, validatePreset, validatePresetSemantics, validateArchive, lintPrompt, lintPrompts, computeRarity, collectConflicts, checkImageFile, runChecklist, filterRedoEditions, sendTelegramNotification, sendTelegramTest, getTelegramConfig, formatEnginePrompt } from "../src/index.mjs";
import { quoteStage } from "../src/platform/stage-pricing.mjs";
import { archiveSync } from "../src/archive-sync.mjs";
import { readSetLineage } from "../src/set-lineage.mjs";
import { readTriageDoc, readVisibilityAck } from "../src/trait-visibility.mjs";
import { loadKeys, loadKeysExtra } from "../src/keys.mjs";
import { ENGINES, engineCtx, getEngine, getTxt2Img, planPrimaryGenerate, primaryGenerateArgs, withRetry } from "../src/engines.mjs";
import { imagesDirName } from "../src/reference.mjs";
import { licenseWarning, engineModelId } from "../src/license.mjs";
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
import { handleProjectRoutes } from "./routes/projects.mjs";
import { handleBaseRoutes } from "./routes/base.mjs";
import { handleGenerateRoutes } from "./routes/generate.mjs";
import { handleExportRoutes } from "./routes/export.mjs";
import { handleReviewRoutes } from "./routes/review.mjs";
import { handleStorageRoutes } from "./routes/storage.mjs";
import { handlePlatformRoutes } from "./routes/platform.mjs";
import { handleCreditRoutes } from "./routes/credits.mjs";
import { handleVersionTrashRoutes } from "./routes/versions-trash.mjs";
import { handleLayerRoutes } from "./routes/layers.mjs";
import { handleRecipeRoutes } from "./routes/recipes.mjs";
import { handlePresetRoutes } from "./routes/presets.mjs";
import { allowedHostnames, checkApiRequest, hostedConfigError, hostedConfigWarning, openAccessError } from "./guard.mjs";
import { handlePlatform, sessionWallet, startPlatformBackground } from "./platform.mjs";
import { send, readBody, httpError } from "./http.mjs";
import { checkGenerationRate, creditCost, deductCredits, getBalance, recordFunnelEvent, refundCredits, localGpuCreditCost } from "../src/platform/billing.mjs";
import { rateLimit } from "../src/platform/ratelimit.mjs";
import { solPayInfo } from "../src/platform/solpay.mjs";
import { isAdmin } from "../src/platform/ops.mjs";
import { providersSnapshot, keyHealth, providerFloatStatus } from "../src/platform/providers.mjs";
import { checkPromptSafetySync, safetyMessage } from "../src/platform/safety.mjs";
import { writeJsonAtomic } from "../src/fs-safe.mjs";
import { diskMessage, diskStatus, noteWrite, presetLimitIssues, quotaConfig } from "../src/quota.mjs";
import { adoptLegacyAssets, admitProject, convertLegacyProjectTrash, initialActiveProject, deletedProjectFile, ensureProjectDirs, isProject, loadProjects, pruneWalletTrash, trashRetentionDays, projectIdOf, projectPaths, projectQuota, projectsConfig, readActiveProject, registerProject, restoreDeletedProject, saveProjects, writeActiveProject } from "../src/projects.mjs";
import { LayersZipError } from "../src/layers-zip.mjs";
import { listShelved, versionCounts } from "../src/versions.mjs";
import { containsSecretField } from "../src/secrets.mjs";
import { pruneTrash, trashFiles } from "../src/trash.mjs";
import { appendRenderLog, capError, spendCap, spentToday } from "../src/spend.mjs";
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
let templateFilesCache = { sig: null, set: new Set() };
function templatePresetFiles() {
  let sig = null;
  try {
    sig = String(statSync(LOCAL_PATHS.presets).mtimeMs);
  } catch {
    return new Set();
  }
  if (templateFilesCache.sig === sig) return templateFilesCache.set; // the folder is unchanged: no need to list it again
  let set;
  try {
    set = new Set(readdirSync(LOCAL_PATHS.presets).filter((f) => f.endsWith(".json")));
  } catch {
    set = new Set();
  }
  templateFilesCache = { sig, set };
  return set;
}

const walletProjects = () => loadProjects(P(), templatePresetFiles());

/**
 * Saving under the id of ANOTHER existing project would silently replace it: the server cannot tell "save changes" from
 * "create a new one with a taken name". Editing is the normal save: the open (active) project, or the file the client
 * says it loaded (`editing`). Any other existing project needs `overwrite: true`, and its previous version goes to
 * the trash first.
 * → true when an overwrite was confirmed (the caller trashes the old file)
 */
function guardProjectOverwrite(file, body = {}) {
  if (!isProject(walletProjects(), file)) return false;
  if (readActiveProject(P()) === file || body.editing === file) return false;
  if (body.overwrite !== true) {
    throw httpError(409, `A project named "${projectIdOf(file)}" already exists. Pick another name or confirm the overwrite.`, {
      code: "project_exists", file,
    });
  }
  return true;
}

/**
 * Creating a project is free within PROJECTS_FREE and costs PROJECT_EXTRA_CREDITS once beyond it (admins are exempt;
 * local mode has no credits). Editing an existing project never costs anything.
 *
 * Nothing is debited here: the balance is only checked. The debit happens in commitNewProject AFTER the project is
 * registered, so a crash can lose a charge (the project is then free) but never charge twice for one project.
 * → { isNew, credits, charge: what commitNewProject debits, or null }
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
  if (getBalance(wallet) < verdict.charge) throw insufficient(wallet, verdict.charge);
  const note = `New project #${q.used + 1} beyond ${q.free} free`;
  return { isNew: true, charge: { wallet, amount: verdict.charge, engine: "project", note, used: q.used }, credits: verdict.charge };
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
    throw e.status ? httpError(e.status, e.message) : e;
  }
  return { file, charged: admission.credits };
}

/**
 * Register first, debit second. If the debit is refused the registration is undone, so a failed payment leaves no
 * free project behind.
 */
function commitNewProject(file, admission) {
  if (!admission.isNew) return;
  const before = walletProjects();
  registerProject(P(), before, file, { charge: admission.credits });
  const c = admission.charge;
  if (c) {
    if (!deductCredits(c.wallet, c.amount, { engine: c.engine, note: c.note })) {
      saveProjects(P(), before);
      throw insufficient(c.wallet, c.amount);
    }
    recordFunnelEvent(c.wallet, "project_paid", { cost: c.amount, used: c.used });
  }
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

/** Short content hash of a preset file: the client sends it back as `baseRev` so a stale save is detected. */
function presetRev(path) {
  try {
    return createHash("sha1").update(readFileSync(path)).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
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

/** Quotas apply to signed-in wallets on the hosted studio; admins and the local studio are exempt. */
const quotaApplies = () => PUBLIC_MODE && !isAdmin(currentWallet());
const IMAGE_EST_BYTES = 6 * 1024 * 1024; // room kept for one more generated frame

/** Refuse a write that would take the wallet over its disk quota (`extra` = bytes about to be written). */
function assertWalletDisk(extra = 0) {
  if (!quotaApplies()) return;
  const s = diskStatus(P().root, extra);
  if (!s.ok) throw httpError(413, diskMessage(s), { code: "disk_quota", used: s.used, limit: s.limit });
}
const noteDiskWrite = (bytes) => {
  if (quotaApplies()) noteWrite(P().root, bytes);
};
const storageInfo = () => {
  const exempt = !quotaApplies();
  const s = diskStatus(P().root, 0);
  return { used: s.used, limit: exempt ? 0 : s.limit, exempt };
};

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
  if (quotaApplies()) {
    const issues = presetLimitIssues(preset, quotaConfig());
    if (issues.length) return { ok: false, errors: issues };
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
    lineage: readSetLineage(P().out, payload.dir),
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
  assertWalletDisk(IMAGE_EST_BYTES);
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
    noteDiskWrite(buf.length);
  }
  noteDiskWrite(buf.length);
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
  // platform routes live in server/routes/platform.mjs.
  if (
    await handlePlatformRoutes({
      req, res, url, pathname, DATA_DIR, KEYS_PATH, LOCAL_ONLY_ENGINES, P, PORT, PUBLIC_MODE, baseStatus, currentWallet, listSetImages, localGpuPolicy, readMarks, renderLog, safeSetName, storageInfo, trackFunnel, userPaths, walletProjects,
    })
  ) return;

  // credits routes live in server/routes/credits.mjs.
  if (
    await handleCreditRoutes({
      req, res, url, pathname, PUBLIC_MODE, currentWallet,
    })
  ) return;

  // Operator routes (admin system, resources, economy, spend, engine status) live in server/routes/admin.mjs.
  if (
    await handleAdminRoutes({
      req, res, url, pathname, PUBLIC_MODE, readBody, rejectSecrets, systemPayload, renderLog, resourcesPayload, resourcesPayloadLive,
      send: (...a) => { send(...a); return true; },
      isAdminNow: () => isAdmin(currentWallet()),
    })
  ) return;

  // presets routes live in server/routes/presets.mjs.
  if (
    await handlePresetRoutes({
      req, res, url, pathname, P, admitNewProject, checkPreset, commitNewProject, guardProjectOverwrite, listPresets, listTemplates, listTraitPacks, loadPresetByFile, loadTemplateById, loadTraitPackById, presetRev, summarizeTraitPack, toTrash,
    })
  ) return;

  // recipes routes live in server/routes/recipes.mjs.
  if (
    await handleRecipeRoutes({
      req, res, url, pathname, P, checkPreset, enrichRecipe, listArchives, loadArchiveFile, loadPresetByFile, loadPresetForArchive, makeArchive, recipesPayload, traitsEqual,
    })
  ) return;

  // projects routes live in server/routes/projects.mjs.
  if (
    await handleProjectRoutes({
      req, res, url, pathname, P, PUBLIC_MODE, currentWallet, restoreProjectFromTrash, safeSetName, storageInfo, walletProjects,
    })
  ) return;

  if (pathname === "/api/archive/list" && req.method === "GET") {
    return send(res, 200, { archives: listArchives() });
  }

  // Чи архів досі збігається з пресетом, з якого його зібрано (рецепти перебудовуються й порівнюються за DNA і промптом).
  if (pathname === "/api/archive/sync" && req.method === "GET") {
    const name = url.searchParams.get("file");
    if (!name) return send(res, 400, { error: "file required" });
    let loaded;
    try {
      loaded = loadArchiveFile(name);
    } catch (e) {
      return send(res, e.status || 404, { error: String(e.message || e) });
    }
    let preset = null;
    try {
      preset = loadPresetForArchive(loaded.archive)?.preset || null;
    } catch {
      preset = null;
    }
    return send(res, 200, { file: loaded.file, ...archiveSync(preset, loaded.archive) });
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

  // base routes live in server/routes/base.mjs.
  if (
    await handleBaseRoutes({
      req, res, url, pathname, P, assertWalletDisk, baseStatus, blockedPrompts, chargeCredits, inferRole, listBases, mimeOf, noteDiskWrite, nowIsoKyiv, readWish, refundCharge, runPrimaryGenerate, toTrash, visionCreditCost,
    })
  ) return;

  // generate routes live in server/routes/generate.mjs.
  if (
    await handleGenerateRoutes({
      req, res, url, pathname, IMAGE_EST_BYTES, P, PUBLIC_MODE, assertEngineAllowed, assertSpend, assertWalletDisk, blockLicenseCharge, blockedPrompts, chargeCredits, currentWallet, insufficient, licenseForBody, listArchives, listBases, loadArchiveFile, logRender, mimeOf, noteDiskWrite, paidCall, refundCharge, renderLog, resolveGenerateSelection, safeSetName, setDirName, toTrash, trackFunnel, waitForRateSlot,
    })
  ) return;

  // versions-trash routes live in server/routes/versions-trash.mjs.
  if (
    await handleVersionTrashRoutes({
      req, res, url, pathname, P, discardSelectionFiles, safeSetName, trashDir,
    })
  ) return;

  // review routes live in server/routes/review.mjs.
  if (
    await handleReviewRoutes({
      req, res, url, pathname, P, chargeCredits, clearEditionMark, discardSelectionFiles, listArchives, listImageSets, listSetImages, loadArchiveFile, loadPresetByFile, primaryBasePng, readMarks, refundCharge, safeSetName, setPayload, visionCreditCost, writeMarks,
    })
  ) return;

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

  // storage routes live in server/routes/storage.mjs.
  if (
    await handleStorageRoutes({
      req, res, url, pathname, P, chargeStage, refundStage, safeSetName,
    })
  ) return;

  // Release kits: launchpad profiles, portals and config, launch advisor, deploy kit and marketplace kit.
  if (
    await handleKitRoutes({
      req, res, url, pathname, P, bundlesDir, chargeStage, listArchives, loadArchiveFile, loadPresetFileSafe, loadSeriesContext, readMarks, refundStage, rejectSecrets, releaseArchive, resolveLocale, safeSetName,
    })
  ) return;

  // export routes live in server/routes/export.mjs.
  if (
    await handleExportRoutes({
      req, res, url, pathname, P, bundlesDir, chargeStage, listArchives, loadArchiveFile, loadPresetFileSafe, loadPresetForArchive, loadSeriesContext, readMarks, rejectSecrets, releaseArchive, resolveLocale, safeSetName, trackFunnel,
    })
  ) return;

  // layers routes live in server/routes/layers.mjs.
  if (
    await handleLayerRoutes({
      req, res, url, pathname, P, assertWalletDisk, baseStatus, loadPresetByFile, loadSeriesContext, readRawBody, rejectSecrets, safeSetName, toTrash,
    })
  ) return;

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
    let triage = null;
    let visibilityAck = null;
    const set = setName ? safeSetName(setName) : null;
    if (set) {
      try {
        marks = readMarks(set);
        images = listSetImages(set).images;
        triage = readTriageDoc(join(P().out, set));
        visibilityAck = readVisibilityAck(join(P().out, set));
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
      triage,
      visibilityAck,
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
const migratedWallets = new Set(); // wallet folders whose one-time asset migrations are done (each leaves a marker file)
function scopedPaths(wallet) {
  const user = userPaths(wallet);
  const list = loadProjects(user, templatePresetFiles());
  if (!list.length) return user;
  let active = readActiveProject(user);
  if (!active || !isProject(list, active)) {
    active = initialActiveProject(user, list);
    writeActiveProject(user, active);
  }
  // Both migrations write a marker when done and do nothing afterwards: run them once per wallet and process,
  // not on every request.
  if (!migratedWallets.has(user.root)) {
    adoptLegacyAssets(user, active, list.map((p) => p.file));
    convertLegacyProjectTrash(user);
    migratedWallets.add(user.root);
  }
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
