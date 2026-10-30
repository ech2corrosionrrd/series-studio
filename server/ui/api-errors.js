/**
 * Map API error payloads to locale keys.
 * Server strings stay stable for tests; the UI shows the selected language.
 * Unknown text is wrapped as api.unknown so the chrome is still localized.
 */

const EXACT = {
  "Series Lab does not accept private keys, seed phrases, or secrets. Sign from your own wallet.": "api.secrets",
  "Prompt blocked by brand/franchise lint": "api.lint",
  "bad path": "api.badPath",
  "confirmation required": "api.confirmRequired",
  "project not found": "api.projectNotFound",
  "trash item is not a project": "api.notProject",
  "A project file with this name already exists: delete or rename it first.": "api.projectExists",
  "A file with this name already exists: move or delete it first.": "api.fileExists",
  "not found": "api.notFound",
  "admin only": "api.adminOnly",
  "public mode only": "api.publicOnly",
  "no archives": "api.noArchives",
  "file and index required": "api.fileIndex",
  "could not pick a free spin-off id": "api.spinId",
  "No base image found to analyze": "api.noBase",
  "Image-to-image needs a primary base image.": "api.noPrimary",
  "FLUX.1 [dev] weights need a licence warning before a credit charge.": "api.licenseWarning",
  "no archives — build recipes first": "api.noArchivesRecipes",
  "set not found": "api.setMissing",
  "sharp_not_installed": "api.sharpMissing",
  "nothing to delete": "api.nothingToDelete",
  "no current image to drop": "api.noCurrentDrop",
  "version file already exists": "api.versionExists",
  "dir required": "api.dirRequired",
  "set required": "api.setRequiredSet",
  "edition must be a whole number from 1": "api.editionWhole",
  "frame offset must stay within \u00b12000 px": "api.frameOffsetRange",
  "marks object or edition+mark required": "api.marksRequired",
  "No archive recipes available for manifest": "api.noArchiveManifest",
  "No archive recipes available for showcase": "api.noArchiveShowcase",
  "No archive recipes available for preview": "api.noArchivePreview",
  "archive required": "api.archiveRequired",
  "file required": "api.fileRequired",
  "archive parameter required": "api.archiveRequired",
  "set parameter required": "api.setRequired",
  "recipe object required": "api.recipeRequired",
  "comfyui-workflow.json not found": "api.noWorkflow",
  "Sign in with your wallet first": "api.auth",
  "Sign in required": "api.auth",
  "not signed in": "api.auth",
  "The service is at its daily capacity — please try again tomorrow.": "api.capacity",
  "Generation rate limit reached — wait a minute (a top-up or a credit grant lifts the limit).": "api.rate",
  "ComfyUI / Automatic1111 need Studio on your PC (HOST=127.0.0.1 or SERIES_LOCAL_GPU=1). On the public website use cloud engines — GPU fees fund Lab; local GPU charges a small support fee in credits.": "api.localGpu",
  "missing Host header": "api.hostMissing",
  "host not allowed": "api.hostDenied",
  "bad origin": "api.badOrigin",
  "cross-origin request blocked": "api.cors",
  "Content-Type must be application/json": "api.contentType",
  "Empty ZIP file": "api.emptyZip",
  "У гаманця-отримувача ще немає USDC-рахунку — він з'явиться після першого переказу.": "api.noUsdcAccount",
  "Очікується EVM-адреса 0x… або Solana-адреса": "api.needAddr",
  "Невалідна адреса (EVM 0x… або Solana)": "api.badAddr",
  "Nonce недійсний або протух — оновіть сторінку": "api.nonceStale",
  "Адреса не збігається з nonce": "api.addrMismatch",
  "Підпис не пройшов перевірку": "api.badSig",
  "Internal Server Error": "api.internal",
  "nonce error": "api.nonce",
  "verify failed": "api.verify",
  "Payload too large": "api.payload",
  "Invalid or inactive B2B API key": "api.b2bKey",
  "Invalid or missing X-TMA-Key or X-W3IR-B2B-Key": "api.b2bHeader",
  "Access by invitation only on this server": "api.invite",
  "wallet is required": "api.walletRequired",
  "invalid wallet or date (expected YYYY-MM-DD)": "api.badWalletDate",
  "generator unavailable": "api.generator",
  "VAULT_WALLET_ADDRESS is not configured in environment": "api.vaultEnv",
  "multipart field 'file' is required": "api.fileRequired",
  "Only .zip files are supported": "api.zipOnly",
  "legal docs not found": "api.legalMissing",
  "collection not found": "api.collectionMissing",
  "image not found": "api.imageMissing",
  "login.html не знайдено": "api.loginMissing",
  "login.js not found": "api.loginMissing",
  "Image data is required for vision analysis": "api.visionData",
  "Missing required parameters: botToken, chatId, or text": "api.tgParams",
  "Telegram notifications not configured (set SERIES_TELEGRAM_BOT_TOKEN + SERIES_TELEGRAM_CHAT_ID)": "api.tgOff",
  "not_configured": "api.notConfigured",
  "Cannot estimate the cost of this run — refused because a daily spend cap is set.": "api.spendEstimate",
  "onlyKeep is set but marks have no keep entries and no images found — mark keep in Review or generate images": "api.onlyKeepEmpty",
  "onlyKeep is set but no keep-marked editions match the archive — mark keep in Review": "api.onlyKeepMiss",
  "preset traits are required to compose layers": "api.composeTraits",
  "items must be an array": "api.itemsArray",
  "no layer PNGs found: upload a ZIP of <trait>/<value>.png first": "api.noLayerPngs",
  "csv text is required": "api.csvRequired",
  "choose two different archives": "api.sameArchive",
  "layers directory must stay inside the project": "api.composeLayersEscape",
  "bad set name": "api.badSetName",
  "preview must be an edition number": "api.previewBad",
};

const PATTERNS = [
  [/^trait pack not found: (.+)$/, "api.traitPackMissing", (m) => ({ id: m[1] })],
  [/^recipe index (\S+) not found$/, "api.recipeMissing", (m) => ({ idx: m[1] })],
  [/^invalid ([^:]+): (.+)$/, "api.invalidTrait", (m) => ({ key: m[1], value: m[2] })],
  [/^Trait conflict: (.+)$/, "api.traitConflict", (m) => ({ detail: m[1] })],
  [/^Duplicate DNA with edition #(\S+)$/, "api.dupDnaEdition", (m) => ({ n: m[1] })],
  [/^Duplicate DNA before render: (.+)$/, "api.dupDnaRender", (m) => ({ list: m[1] })],
  [/^set directory not found: (.+)$/, "api.setDirMissing", (m) => ({ name: m[1] })],
  [/^frame not found: (.+)$/, "api.previewFrameMissing", (m) => ({ name: m[1] })],
  [/^preview: edition (S+) is not in the archive$/, "api.previewNoEdition", (m) => ({ n: m[1] })],
  [/^layers directory not found: (.+)$/, "api.composeLayersMissing", (m) => ({ path: m[1] })],
  [/^csv is larger than (.+) characters$/, "api.csvLarge", (m) => ({ n: m[1] })],
  [/^row (.+): (.+)$/, "api.csvRow", (m) => ({ row: m[1], msg: m[2] })],
  [/^base image not found: (.+)$/, "api.composeBaseMissing", (m) => ({ path: m[1] })],
  [/^set not found: (.+)$/, "api.setMissingNamed", (m) => ({ name: m[1] })],
  [/^bad edition: (.+)$/, "api.badEdition", () => ({})],
  [/^no image files found in set: (.+)$/, "api.noImages", (m) => ({ name: m[1] })],
  [/^Unknown stage: (.+)$/, "api.unknownStage", (m) => ({ stage: m[1] })],
  [/^Project limit: (\S+) of (\S+) free projects are used; a new project costs (\S+) credits\./, "api.projectCharge", (m) => ({ used: m[1], free: m[2], cost: m[3] })],
  [/^Not enough credits: need (\S+), balance (\S+)\b/, "api.credits", (m) => ({ needed: m[1], balance: m[2] })],
  [/^Invalid ZIP file format: (.+)$/, "api.badZip", (m) => ({ msg: m[1] })],
  [/^Security violation: dangerous path in zip: (.+)$/, "api.zipPath", (m) => ({ name: m[1] })],
  [/^Invalid JSON: (.+)$/, "api.badJson", (m) => ({ msg: m[1] })],
  [/^invalid or missing (.+)$/, "api.badHeader", (m) => ({ name: m[1] })],
  [/^(.+) not found$/, "api.namedMissing", (m) => ({ name: m[1] })],
  [/^Bundle too large \(limit (.+) MB\)$/, "api.bundleLarge", (m) => ({ mb: m[1] })],
  [/^Prompt blocked by content safety policy \((.+)\)$/, "api.safety", (m) => ({ cat: m[1] })],
  [/^Engine (.+) is currently unavailable$/, "api.engineDown", (m) => ({ engine: m[1] })],
  [/^Engine unavailable for (edit|txt2img): (.+)$/, "api.engineUnavailable", (m) => ({ mode: m[1], engine: m[2] })],
  [/^Generation failed on AI engine \((.+)\)$/, "api.genFailed", (m) => ({ detail: m[1] })],
  [/^vault catalog invalid: (.+)$/, "api.vaultCatalog", (m) => ({ msg: m[1] })],
  [/^aborted: (.+)$/, "api.aborted", (m) => ({ msg: m[1] })],
  [/^getSignaturesForAddress: (.+)$/, "api.rpc", (m) => ({ msg: m[1] })],
  [/^write file: (.+)$/, "api.writeFile", (m) => ({ msg: m[1] })],
  [/^HTTP (\S+)$/, "api.http", (m) => ({ status: m[1] })],
  [/^Daily spend cap \$(\S+): today ≈ \$(\S+) spent, this run ≈ \$(\S+), \$(\S+) left\./, "api.spendCapDetail", (m) => ({
    cap: m[1], spent: m[2], planned: m[3], left: m[4],
  })],
];

/** Preset problems: JSON-schema errors ("/size must be integer"), the semantic checks of src/validate.mjs and the quota limits of src/quota.mjs. */
const PRESET_PATTERNS = [
  [/^\/size must be integer$/, "api.preset.sizeInteger", () => ({})],
  [/^\/size must be >= (\d+)$/, "api.preset.sizeMin", (m) => ({ min: m[1] })],
  [/^\/name must NOT have fewer than \d+ characters$/, "api.preset.nameEmpty", () => ({})],
  [/^\/seed must NOT have fewer than \d+ characters$/, "api.preset.seedEmpty", () => ({})],
  [/^\/id must NOT have fewer than \d+ characters$/, "api.preset.idEmpty", () => ({})],
  [/^\/lines\/(\S+)\/quota must be >= (\d+)$/, "api.preset.quotaMin", (m) => ({ line: m[1], min: m[2] })],
  [/^\/lines\/(\S+)\/quota must be integer$/, "api.preset.quotaInteger", (m) => ({ line: m[1] })],
  [/^preset id "(.*)" must use Latin letters/, "api.preset.idFormat", (m) => ({ id: m[1] })],
  [/^duplicate trait key: (.+)$/, "api.preset.dupTrait", (m) => ({ key: m[1] })],
  [/^trait (.+) has no options$/, "api.preset.noOptions", (m) => ({ key: m[1] })],
  [/^trait (.+) has zero total weight$/, "api.preset.zeroWeight", (m) => ({ key: m[1] })],
  [/^promptTemplate references unknown trait: (.+)$/, "api.preset.unknownTrait", (m) => ({ key: m[1] })],
  [/^line quotas sum to (\d+), size is (\d+)$/, "api.preset.quotaSum", (m) => ({ sum: m[1], size: m[2] })],
  [/^size (\d+) is above the limit of (\d+) NFTs per series$/, "api.preset.sizeLimit", (m) => ({ n: m[1], max: m[2] })],
  [/^(\d+) traits is above the limit of (\d+)$/, "api.preset.traitsLimit", (m) => ({ n: m[1], max: m[2] })],
  [/^trait (.+) has (\d+) options, the limit is (\d+)$/, "api.preset.optionsLimit", (m) => ({ key: m[1], n: m[2], max: m[3] })],
  [/^the preset is (\d+) bytes, the limit is (\d+)$/, "api.preset.bytesLimit", (m) => ({ n: m[1], max: m[2] })],
  [/^(\/\S*) (must .+)$/, "api.preset.field", (m) => ({ path: m[1], msg: m[2] })],
];

function translatePresetIssue(item, translate) {
  for (const [re, key, varsOf] of PRESET_PATTERNS) {
    const m = item.match(re);
    if (!m) continue;
    const hit = applyKey(translate, key, varsOf(m));
    if (hit) return hit;
  }
  return "";
}

const CODE_KEYS = {
  auth: "api.auth",
  secrets: "api.secrets",
  lint: "api.lint",
  credits: "api.credits",
  rate: "api.rate",
  local_gpu: "api.localGpu",
  capacity: "api.capacity",
  spend_cap: "api.spendCap",
  no_primary: "api.noPrimary",
  engine_unavailable: "api.engineUnavailable",
  license_warning: "api.licenseWarning",
  layers_unsafe_path: "api.layers.unsafe_path",
  layers_name_too_long: "api.layers.name_too_long",
  layers_not_png: "api.layers.not_png",
  layers_png_dimensions: "api.layers.png_dimensions",
  layers_bad_zip: "api.layers.bad_zip",
  layers_empty: "api.layers.empty",
  layers_too_many_files: "api.layers.too_many_files",
  layers_no_layers: "api.layers.no_layers",
  layers_duplicate: "api.layers.duplicate",
  layers_file_too_large: "api.layers.file_too_large",
  layers_upload_too_large: "api.layers.upload_too_large",
  layers_folder_full: "api.layers.folder_full",
  layers_zip_too_large: "api.layers.zip_too_large",
};

function rawMessage(data) {
  if (!data || typeof data !== "object") return "";
  if (typeof data.error === "string") return data.error;
  if (typeof data.detail === "string") return data.detail;
  if (Array.isArray(data.errors)) return data.errors.map(String).join(" · ");
  return "";
}

function applyKey(translate, key, vars) {
  const out = translate(key, vars);
  return out === key ? "" : out;
}

/** @returns {string} localized message, or "" when nothing was recognized */
export function translateApiError(data, translate) {
  // A validation answer is a list of problems (one string, or several joined with "; "): say each in the author's language.
  if (Array.isArray(data?.errors) && data.errors.length) {
    const parts = data.errors.flatMap((e) => String(e).split("; ")).map((s) => s.trim()).filter(Boolean);
    const said = parts.map((p) => translatePresetIssue(p, translate));
    if (said.some(Boolean)) return said.map((s, i) => s || parts[i]).join(" · ");
  }
  const raw = rawMessage(data);
  if (raw && EXACT[raw]) {
    const hit = applyKey(translate, EXACT[raw], data);
    if (hit) return hit;
  }
  if (raw) {
    for (const [re, key, varsOf] of PATTERNS) {
      const m = raw.match(re);
      if (!m) continue;
      const hit = applyKey(translate, key, { ...data, ...varsOf(m) });
      if (hit) return hit;
    }
  }
  const code = data?.code;
  if (code && CODE_KEYS[code]) {
    const hit = applyKey(translate, CODE_KEYS[code], data);
    if (hit) return hit;
  }
  return "";
}

/** Message for the UI: known translation, or a localized wrapper around unknown text. */
export function presentApiError(data, translate) {
  const known = translateApiError(data, translate);
  if (known) return known;
  const raw = rawMessage(data);
  if (!raw) return translate("api.generic");
  return translate("api.unknown", { msg: raw });
}

export function exactErrorKeys() {
  return EXACT;
}

export function errorPatternCovers(sample) {
  return PATTERNS.some(([re]) => re.test(sample));
}
