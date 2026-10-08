#!/usr/bin/env node
/**
 * Series Lab CLI — validate / build / diff-seed / render.
 * Fast deterministic operations + optional headless render pipeline.
 */
import "../src/require-node.mjs";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJsonAtomic } from "../src/fs-safe.mjs";
import { addVersion } from "../src/versions.mjs";
import { appendRenderLog, capError, spendCap, spentToday } from "../src/spend.mjs";
import { failureBreaker } from "../src/pool.mjs";
import {
  buildRecipes,
  duplicates,
  loadTraitsFromPreset,
  validatePreset,
  validatePresetSemantics,
  validateArchive,
  lintPrompts,
  clampStrength,
  mapConcurrent,
  triageBatch,
  uploadToIrys,
  calculateDeterministicCid,
  exportManifestCsv,
  buildSugarConfig,
  buildCoreCandyConfig,
  buildThirdwebConfig,
  generateShowcaseHtml,
  calculateRarityScores,
  calculateCollectionProvenance,
  verifyProvenance,
  exportDatasetZip,
  dispatchBatchNotification,
  sendTelegramNotification,
} from "../src/index.mjs";
import { loadKeys } from "../src/keys.mjs";
import { repairPngFiles } from "../src/png-normalize.mjs";
import { uploadBundle, planUpload, loadKeypairFile } from "../src/arweave-upload.mjs";
import { releaseFromArchive, validateRelease, guardUpdateConfig, coreGuardConfig, allowlistOf } from "../src/release-config.mjs";
import { verifyRelease } from "../src/candy-verify.mjs";
import { parseAllowlistText } from "../src/allowlist.mjs";
import { hiddenSettings, loadRevealItems, placeholderMetadata, placeholderPng, revealUpdates, checkReveal } from "../src/reveal.mjs";
import {
  appendMintRecord,
  generateAssetKeypair,
  keypairFromFile,
  loadMints,
  markRevealed,
  planCoreMint,
  planCoreReveal,
  readCollectionAuthority,
  readMintState,
  selectMintGroup,
  sendInstructions,
} from "../src/core-flow.mjs";
import { composeArchive } from "../src/layers.mjs";
import { ENGINES, TXT2IMG, getEngine, withRetry, engineCtx } from "../src/engines.mjs";
import { modelTitle, promptHash, sha256Hex } from "../src/creation.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function usage(code = 0) {
  const text = `series — Series Lab CLI (preset → recipes / render / triage / pin / manifest / release / showcase / provenance / dataset / engines)

Usage:
  series validate <preset.json>
  series build <preset.json> [-o archive.json]
  series diff-seed <preset.json>
  series showcase <archive.json> [options]
  series manifest <archive.json> [options]
  series release-config <archive.json> [options]
  series provenance <images-dir> [options]
  series dataset <archive.json> [options]
  series render <preset.json> [options]
  series triage <set-dir> [options]
  series pin <set-dir> [options]
  series release-init <archive.json> [-o release.json] [options]
  series upload <bundle-dir> --keypair <file> [--dry-run] [--max-price <sol>] [--no-fund]
  series guards <release.json> [-o guard-config.json] [--allowlist <file>]
  series hidden <bundle-dir> --uri <hidden.json-link> [--uri-prefix <prefix>] [--name <text>]
  series mint <release.json> --keypair <file> [--group <label>] [--public] [--dry-run]
  series reveal <bundle-dir> [--keypair <file>] [--check <revealed.json>] [--dry-run]
  series compose <archive.json> --layers <dir> --base <png> [-o out/layers]
  series verify <release.json> [--rpc <url>]
  series engines
  series doctor
  series upscale <images-dir> [options]
  series repair-png <set-dir> [--dry-run]
  series notify [options]

Options:
  -o, --out <path>        Output archive, manifest CSV, config, or render directory
  -e, --engine <name>     AI engine for render (fal, kontext, comfyui, a1111, runware, openai, stability, pollinations, mock)
  -s, --strength <num>    Reference strength (0.1..0.95, default 0.45)
  -c, --concurrency <num> Concurrency limit for batch (1..4, default 2)
  -a, --archive <path>    Path to archive.json for recipe matching
  -p, --preset <path>     Path to preset.json for style rules/traits
  --profile <name>        Launchpad profile (opensea, magiceden, launchmynft, ordinalsbot)
  --creator <address>     Creator / royalty wallet address
  --price <num>           Mint price in native token (SOL / ETH)
  --fee <bps>             Seller fee basis points (e.g. 500 = 5%)
  --symbol <str>          Collection token symbol
  --zero-index            Use 0-based edition indexing
  --image-prefix <uri>    URI prefix for images (e.g. ar://<id>/ or ipfs://<cid>/)
  --anim-prefix <uri>     URI prefix for animations/videos (e.g. ar://<id>/ or ipfs://<cid>/)
  --name-prefix <str>     Token name prefix (e.g. Series #)
  --name <str>            Collection name
  --provider <name>       Triage/Storage provider (heuristic, vision)
  --apply                 Apply triage keep/redo verdicts to marks.json
  --limit <num>           Process only first N recipes/images
  --dry-run               Simulate execution without external API calls
  --keypair <file>        Solana keypair JSON (upload, mint, reveal). Stays on this machine
  --group <label>         Candy Guard group for series mint
  --public                series mint uses the default guard set, not the allowlist
  --bundle <dir>          Bundle directory where series mint writes mints.json
  --mints <file>          Mint record series reveal signs
  --release <file>        release.json used to find the collection for series reveal
  --index <n>             Dry-run only: pretend itemsRedeemed is n
  --max-price <sol>       Refuse upload when the estimated cost is higher
  --no-fund               Do not top up the Irys balance automatically
  --rpc <url>             Solana RPC for upload / verify
  --allowlist <file>      Wallet list (one address per line) merged into series guards
  --uri <url>             Uploaded hidden.json link for series hidden
  --uri-prefix <prefix>   Build reveal URIs as <prefix><index>.json instead of cache.json
  --layers <dir>          PNG layers directory for series compose
  --base <png>            Base image under the trait layers
  --check <file>          Revealed name/uri list to compare in series reveal
  -h, --help              Show help
`;
  process.stdout.write(text);
  process.exit(code);
}

function loadJson(path) {
  const abs = resolve(path);
  return JSON.parse(readFileSync(abs, "utf8"));
}

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
  const y = get("year");
  const m = get("month");
  const day = get("day");
  const h = get("hour");
  const min = get("minute");
  const s = get("second");
  let offset = "+03:00";
  const tz = get("timeZoneName");
  if (tz && /^GMT[+-]/.test(tz)) {
    const m2 = tz.match(/GMT([+-])(\d+)(?::?(\d+))?/);
    if (m2) {
      offset = `${m2[1]}${pad(Number(m2[2]))}:${pad(Number(m2[3] || 0))}`;
    }
  }
  return `${y}-${m}-${day}T${h}:${min}:${s}${offset}`;
}

function defaultOutPath(presetPath) {
  return resolve("out", "archive.json");
}

function cmdValidate(presetPath) {
  const preset = loadJson(presetPath);
  const schema = validatePreset(preset);
  if (!schema.ok) {
    console.error(`Schema invalid: ${schema.errors}`);
    process.exit(1);
  }
  const semantics = validatePresetSemantics(preset);
  if (!semantics.ok) {
    console.error(`Semantic invalid: ${semantics.errors}`);
    process.exit(1);
  }
  console.log(`OK  ${preset.id}  size=${preset.size}  traits=${preset.traits.items.length}`);
}

function makeArchive(preset) {
  const recipes = buildRecipes(preset);
  const traitKeys = loadTraitsFromPreset(preset).map((t) => t.key);
  const dups = duplicates(recipes, traitKeys);
  if (dups.length) {
    throw new Error(`duplicate DNA groups: ${JSON.stringify(dups)}`);
  }
  const archive = {
    schema: "series-archive/v0",
    presetId: preset.id,
    createdAt: nowIsoKyiv(),
    seed: preset.seed,
    size: preset.size,
    recipes,
  };
  const av = validateArchive(archive);
  if (!av.ok) throw new Error(`archive schema invalid: ${av.errors}`);
  return archive;
}

function cmdBuild(presetPath, outPath) {
  const preset = loadJson(presetPath);
  const schema = validatePreset(preset);
  if (!schema.ok) {
    console.error(`Schema invalid: ${schema.errors}`);
    process.exit(1);
  }
  const semantics = validatePresetSemantics(preset);
  if (!semantics.ok) {
    console.error(`Semantic invalid: ${semantics.errors}`);
    process.exit(1);
  }
  const archive = makeArchive(preset);
  const out = resolve(outPath || defaultOutPath(presetPath));
  mkdirSync(dirname(out), { recursive: true });
  writeJsonAtomic(out, archive);
  console.log(`Wrote ${out}  (${archive.recipes.length} recipes)`);
}

function cmdDiffSeed(presetPath) {
  const preset = loadJson(presetPath);
  const schema = validatePreset(preset);
  if (!schema.ok) {
    console.error(`Schema invalid: ${schema.errors}`);
    process.exit(1);
  }
  const a = buildRecipes(preset).map((r) => r.dna);
  const b = buildRecipes(preset).map((r) => r.dna);
  const same =
    a.length === b.length && a.every((d, i) => d === b[i]);
  if (same) {
    console.log(`OK  seed-stable  ${a.length} DNA identical`);
    return;
  }
  console.error("FAIL  DNA lists differ between two builds with the same seed");
  process.exit(1);
}

async function cmdRender(presetPath, opts = {}) {
  const preset = loadJson(presetPath);
  const val = validatePreset(preset);
  if (!val.ok) {
    console.error(`Schema invalid: ${val.errors}`);
    process.exit(1);
  }
  const archive = makeArchive(preset);
  const engine = opts.engine || preset.engine?.default || "kontext";
  const strength = clampStrength(opts.strength ?? preset.engine?.strength ?? 0.45);
  const limit = opts.limit ? Number(opts.limit) : archive.recipes.length;
  const targetRecipes = archive.recipes.slice(0, limit);
  const outDir = resolve(opts.out || join("out", `${engine}-s${strength.toFixed(2)}`));

  console.log(`Series Lab CLI Render — ${preset.name || preset.id}`);
  console.log(`Engine: ${engine} | Strength: ${strength} | Count: ${targetRecipes.length} | Output: ${outDir}`);

  const lint = lintPrompts(targetRecipes.map((r) => r.prompt));
  if (!lint.ok) {
    console.warn(`[WARN] Prompt lint hits: ${lint.hits.join(", ")}`);
  }

  const unitCost = ENGINES[engine]?.costUsd ?? 0.04;
  const estCost = Math.round(targetRecipes.length * unitCost * 1000) / 1000;
  console.log(`Estimated cost: ~$${estCost} ($${unitCost}/img)`);

  if (opts.dryRun) {
    console.log(`[DRY-RUN] Prepared ${targetRecipes.length} recipes. API calls skipped.`);
    return;
  }

  loadKeys();
  const eng = getEngine(engine);
  const renderLog = resolve("out", "render-log.jsonl");
  const capMsg = capError({
    cap: spendCap(process.env.SERIES_SPEND_CAP_USD),
    spent: spentToday(renderLog),
    planned: eng.costUsd == null ? null : targetRecipes.length * eng.costUsd,
  });
  if (capMsg) {
    console.error(`[ERROR] ${capMsg}`);
    process.exit(1);
  }
  const breaker = failureBreaker({ maxConsecutive: Number(process.env.SERIES_MAX_CONSECUTIVE_FAILURES) || 5 });
  const log = (entry) => {
    try {
      appendRenderLog(renderLog, { source: "cli", kind: "batch", engine, set: outDir, ...entry });
    } catch { /* logging must not break a render */ }
  };
  const inputDir = resolve("input");
  let primaryFile = "primary.png";
  if (!existsSync(join(inputDir, primaryFile))) {
    if (existsSync(inputDir)) {
      const found = readdirSync(inputDir).find((f) => /\.(png|jpe?g|webp)$/i.test(f));
      if (found) primaryFile = found;
    }
  }

  const primaryPath = join(inputDir, primaryFile);
  if (!existsSync(primaryPath)) {
    console.error(`[ERROR] Base image not found at ${primaryPath}. Please place primary.png in input/`);
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });
  const concurrency = Math.max(1, Math.min(4, Number(opts.concurrency) || 2));
  console.log(`Starting render with concurrency ${concurrency}...`);

  const results = await mapConcurrent(
    targetRecipes,
    concurrency,
    async (recipe) => {
      const mime = primaryFile.endsWith(".png") ? "image/png" : "image/jpeg";
      const image = readFileSync(primaryPath);
      const ctx = engineCtx(process.env);
      let buf;
      try {
        buf = await withRetry(() =>
          eng.generate({
            prompt: recipe.prompt,
            image,
            mime,
            seed: recipe.seed,
            strength,
          }, ctx),
        );
      } catch (e) {
        log({ edition: recipe.edition, ok: false, costUsd: 0, error: String(e.message || e).slice(0, 300) });
        breaker.record(false);
        throw e;
      }
      const v = addVersion(outDir, recipe.edition, buf, {
        engine,
        model: modelTitle(engine, "edit"),
        strength,
        seed: recipe.seed,
        promptHash: promptHash(recipe.prompt),
        baseSha256: sha256Hex(image),
        source: "cli",
      });
      log({ edition: recipe.edition, v, ok: true, costUsd: eng.costUsd ?? null, seed: recipe.seed });
      breaker.record(true);
      return { ok: true, edition: recipe.edition, v, path: join(outDir, `${recipe.edition}.png`) };
    },
    (p) => {
      const pct = Math.round((p.completed / p.total) * 100);
      process.stdout.write(`\r[${p.completed}/${p.total}] (${pct}%) Rendered #${p.item.edition}...`);
    },
    { signal: breaker.signal },
  );
  if (breaker.reason) console.error(`\n[STOPPED] ${breaker.reason}`);

  const okCount = results.filter((r) => r.ok).length;
  console.log(`\nDone! Successfully rendered ${okCount} images to ${outDir}`);

  if (opts.notify) {
    const notifyRes = await dispatchBatchNotification({
      presetId: preset.id,
      presetName: preset.name,
      total: targetRecipes.length,
      success: okCount,
      failed: targetRecipes.length - okCount,
      outputDir: outDir,
    });
    if (notifyRes.sent) {
      console.log(`Telegram notification sent successfully!`);
    } else {
      console.log(`Telegram notification skipped/failed: ${notifyRes.error}`);
    }
  }
}

async function cmdTriage(setDirPath, opts = {}) {
  const setDir = resolve(setDirPath);
  if (!existsSync(setDir)) {
    console.error(`[ERROR] Set directory not found: ${setDir}`);
    process.exit(1);
  }

  const files = readdirSync(setDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
  if (!files.length) {
    console.error(`[ERROR] No image files found in ${setDir}`);
    process.exit(1);
  }

  let preset = null;
  if (opts.preset) {
    preset = loadJson(opts.preset);
  }

  let archive = null;
  if (opts.archive) {
    archive = loadJson(opts.archive);
  }

  const recipeMap = new Map((archive?.recipes || []).map((r) => [r.edition, r]));
  let items = files
    .map((f) => {
      const m = f.match(/^(\d+)/);
      const edition = m ? Number(m[1]) : null;
      return {
        edition,
        imagePath: join(setDir, f),
        recipe: edition != null ? recipeMap.get(edition) : undefined,
      };
    })
    .sort((a, b) => (a.edition ?? 0) - (b.edition ?? 0));

  if (opts.limit) {
    items = items.slice(0, Number(opts.limit));
  }

  console.log(`Series Lab CLI Triage — ${items.length} images in ${setDir}`);
  const provider = opts.provider || "heuristic";
  console.log(`Provider: ${provider} | Concurrency: ${opts.concurrency || 2}`);

  if (opts.dryRun) {
    console.log(`[DRY-RUN] Prepared ${items.length} items for triage. Evaluation skipped.`);
    return;
  }

  loadKeys();
  let apiKey = null;
  if (provider === "vision" || provider === "openai" || provider === "anthropic") {
    apiKey = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
  }

  const results = await triageBatch(items, {
    concurrency: opts.concurrency || 2,
    provider: apiKey ? provider : "heuristic",
    apiKey,
    preset,
  });

  console.log("\n--- Triage Results ---");
  let keeps = 0, redos = 0, reviews = 0;
  for (const r of results) {
    const verdictUpper = r.verdict.toUpperCase().padEnd(6);
    console.log(`#${String(r.edition || "?").padStart(3)} | [${verdictUpper}] (${r.score}/10) | Issues: ${(r.issues || []).join(", ")} | ${r.reason}`);
    if (r.verdict === "keep") keeps++;
    else if (r.verdict === "redo") redos++;
    else reviews++;
  }
  console.log(`\nSummary: ${keeps} keep, ${redos} redo, ${reviews} review (Total: ${results.length})`);

  if (opts.apply) {
    const marksPath = join(setDir, "marks.json");
    let currentMarks = {};
    if (existsSync(marksPath)) {
      try { currentMarks = JSON.parse(readFileSync(marksPath, "utf8")); } catch {}
    }
    for (const r of results) {
      if (r.edition != null && (r.verdict === "keep" || r.verdict === "redo")) {
        currentMarks[String(r.edition)] = r.verdict;
      }
    }
    writeJsonAtomic(marksPath, currentMarks);
    console.log(`Applied marks to ${marksPath}`);
  }
}

async function cmdPin(setDirPath, opts = {}) {
  const setDir = resolve(setDirPath);
  if (!existsSync(setDir)) {
    console.error(`[ERROR] Set directory not found: ${setDir}`);
    process.exit(1);
  }
  const files = readdirSync(setDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
  if (!files.length) {
    console.error(`[ERROR] No image files found in ${setDir}`);
    process.exit(1);
  }

  console.log(`Series Lab CLI Pin — ${files.length} images in ${setDir}`);

  if (opts.dryRun) {
    const mockCid = calculateDeterministicCid(files.join(","));
    console.log(`[DRY-RUN] Local stand-in, not an Arweave id: ${mockCid}`);
    console.log(`[DRY-RUN] Would upload ${files.length} files to Arweave (Irys): ar://<manifest-id>/`);
    return;
  }

  loadKeys();
  const res = await uploadToIrys({ dir: setDir });

  console.log("\nSuccessfully uploaded to Arweave (Irys)!");
  console.log(`Manifest ID: ${res.arweaveId}`);
  console.log(`URI:         ${res.arweaveUri}`);
  console.log(`Gateway URL: ${res.gatewayUrl}`);
}


function cmdReleaseInit(archivePath, opts = {}) {
  const archive = loadJson(archivePath);
  let preset = {};
  const presetPath = opts.preset || (archive.presetId ? resolve("presets", `${archive.presetId}.json`) : null);
  if (presetPath && existsSync(presetPath)) {
    try { preset = loadJson(presetPath); } catch {}
  }
  const cfg = releaseFromArchive(archive, preset, opts);
  const out = resolve(opts.out || "release.json");
  if (existsSync(out)) {
    console.error(`[ERROR] ${out} already exists; remove it or pass -o`);
    process.exit(1);
  }
  writeJsonAtomic(out, cfg);
  console.log(`Release config written: ${out}`);
  console.log("Fill in creators[0].address, price, mint.startDate and mint.limitPerWallet.");
  console.log("Allowlist: set allowlist to a list of wallets (or { label, wallets }), then: series guards release.json");
  console.log("Hidden reveal: series upload, series hidden --uri <hidden.json link>, series mint --keypair, then series reveal --keypair.");
}

function cmdGuards(releasePath, opts = {}) {
  const cfg = loadJson(releasePath);
  if (opts.allowlist) {
    const text = readFileSync(resolve(opts.allowlist), "utf8");
    cfg.allowlist = { ...(typeof cfg.allowlist === "object" && cfg.allowlist ? cfg.allowlist : {}), wallets: parseAllowlistText(text) };
  }
  const { errors, warnings } = validateRelease(cfg);
  for (const w of warnings) console.log(`warning: ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`[ERROR] ${e}`);
    process.exit(1);
  }
  const out = resolve(opts.out || "guard-config.json");
  if (cfg.standard === "core") {
    const conf = coreGuardConfig(cfg);
    writeJsonAtomic(out, conf);
    console.log(`Core guard config written: ${out}`);
    console.log(JSON.stringify(conf.guardConfig));
    console.log("Format: guardConfig (and groups, when an allowlist is set) for an `mplx cm create` config. Prices are lamports.");
    console.log("The default guard set is the public phase. allowList is the wl group: a group replaces the default set, so payment is repeated there.");
    console.log("mplx has no command to change guards on an existing Core Candy Machine. Use it when creating the machine,");
    console.log("or apply the same set with the SDK (updateCandyGuard), which REPLACES all guards: keep the payment rule.");
    if (conf.guardConfig.startDate) console.log("Note: the Metaplex docs show the start date only for the SDK (ISO 8601); run `mplx cm validate` to confirm your mplx version accepts it in JSON.");
    console.log("Check on chain afterwards: series verify release.json");
    writeAllowlistProofs(cfg, out);
    if (conf.groups) console.log(JSON.stringify(conf.groups));
    return;
  }
  const conf = guardUpdateConfig(cfg);
  writeJsonAtomic(out, conf);
  console.log(`Guard config written: ${out}`);
  console.log(JSON.stringify(conf.guards.default));
  console.log("Guard update REPLACES the whole rule set; the payment rule is always included.");
  console.log(`Apply (Sugar / Candy Machine v3): sugar guard update --config ${out} --cache cache.json --keypair <deployer.json>`);
  writeAllowlistProofs(cfg, out);
}

function writeAllowlistProofs(cfg, guardFile) {
  const al = allowlistOf(cfg);
  if (!al) return;
  const proofs = resolve(dirname(guardFile), "allowlist-proofs.json");
  writeJsonAtomic(proofs, {
    label: al.label,
    algorithm: al.algorithm,
    merkleRoot: al.merkleRoot,
    merkleRootBase58: al.merkleRootBase58,
    wallets: al.proofs,
  });
  console.log(`Allowlist ${al.label}: ${al.wallets.length} wallets, merkle root ${al.merkleRoot}`);
  console.log(`Proofs: ${proofs}`);
}

function cmdHidden(bundleDir, opts = {}) {
  const dir = resolve(bundleDir);
  if (!existsSync(dir)) {
    console.error(`[ERROR] Directory not found: ${dir}`);
    process.exit(1);
  }
  const uri = String(opts.uri || "").trim();
  if (!uri) {
    console.error("[ERROR] --uri <link of the uploaded hidden.json> is required");
    process.exit(1);
  }
  let items;
  try {
    items = loadRevealItems(dir, { uriPrefix: opts.uriPrefix });
  } catch (e) {
    console.error(`[ERROR] ${e.message}`);
    process.exit(1);
  }
  const name = opts.name || "Hidden #";
  let settings;
  try {
    settings = hiddenSettings({ name, uri, revealData: items });
  } catch (e) {
    console.error(`[ERROR] ${e.message}`);
    process.exit(1);
  }
  writeJsonAtomic(join(dir, "reveal-data.json"), items);
  writeJsonAtomic(join(dir, "hidden-settings.json"), settings);
  writeJsonAtomic(join(dir, "hidden.json"), placeholderMetadata({ name, description: opts.description || "Hidden until reveal." }));
  const png = join(dir, "hidden.png");
  if (!existsSync(png)) writeFileSync(png, placeholderPng());
  console.log(`Hidden settings written: ${join(dir, "hidden-settings.json")}`);
  console.log(`hash ${settings.hash}`);
  console.log(`${items.length} reveal rows in reveal-data.json`);
  console.log("Put hiddenSettings on the Core Candy Machine (config lines off). Then: series mint <release.json> --keypair <minter.json>");
}

function mintRecordPath(releasePath, opts) {
  if (opts.out) return resolve(opts.out);
  if (opts.bundle) return join(resolve(opts.bundle), "mints.json");
  return join(dirname(resolve(releasePath)), "mints.json");
}

function requireKeypair(opts, purpose) {
  if (!opts.keypair) {
    console.error(`[ERROR] --keypair <file> is required (${purpose}). The key stays on this machine.`);
    process.exit(1);
  }
  try {
    return keypairFromFile(loadKeypairFile(resolve(opts.keypair)));
  } catch (e) {
    console.error(`[ERROR] ${e.message}`);
    process.exit(1);
  }
}

async function cmdMint(releasePath, opts = {}) {
  const cfg = loadJson(releasePath);
  if (opts.index != null && !opts.dryRun) {
    console.error("[ERROR] --index is only for --dry-run. A live mint reads itemsRedeemed from the machine.");
    process.exit(1);
  }
  const payer = requireKeypair(opts, "the minter wallet");
  const minter = payer.publicKey.toBase58();
  let label;
  try {
    label = selectMintGroup({ release: cfg, minter, group: opts.group || null, publicPhase: Boolean(opts.public) });
  } catch (e) {
    console.error(`[ERROR] ${e.message}`);
    process.exit(1);
  }
  const asset = generateAssetKeypair();
  let index = opts.index != null ? Number(opts.index) : 0;
  let hidden = true;
  let chain = null;
  if (!opts.dryRun) {
    try {
      const state = await readMintState(cfg, { rpcUrl: opts.rpc });
      index = state.itemsRedeemed;
      hidden = state.hiddenSettings;
      chain = state.guard;
      if (index >= state.itemsAvailable) {
        console.error("[ERROR] candy machine has no items left");
        process.exit(1);
      }
    } catch (e) {
      console.error(`[ERROR] ${e.message}`);
      process.exit(1);
    }
  }
  let plan;
  try {
    plan = planCoreMint({ release: cfg, minter, asset: asset.publicKey.toBase58(), index, label, chain, hidden });
  } catch (e) {
    console.error(`[ERROR] ${e.message}`);
    process.exit(1);
  }
  const phase = plan.label ? `group ${plan.label}` : "public guard set";
  console.log(`Core mint ${phase}, index ${plan.index}, asset ${plan.asset}`);
  if (plan.proofPda) console.log(`allowList route, proof PDA ${plan.proofPda}`);
  if (plan.mintCounter) console.log(`mintLimit counter ${plan.mintCounter}`);
  console.log(`${plan.instructions.map((ix) => ix.name).join(" + ")}`);
  if (!plan.hidden) console.log("warning: this machine has no hidden settings, so the index is not a reveal row");
  if (opts.dryRun) {
    console.log("dry-run: transaction was not sent. A live mint reads itemsRedeemed and writes mints.json.");
    return;
  }
  const file = mintRecordPath(releasePath, opts);
  try {
    const signature = await sendInstructions({
      instructions: plan.instructions,
      signers: [payer, asset],
      rpcUrl: opts.rpc || process.env.SOLANA_RPC_URL || "https://solana-rpc.publicnode.com",
      feePayer: payer.publicKey,
    });
    appendMintRecord(file, { ...plan, mintSignature: signature });
    console.log(`Mint signature: ${signature}`);
    console.log(`Recorded index ${plan.index} in ${file}`);
    console.log("After the sale: series reveal <bundle> --keypair <collection-update-authority.json>");
  } catch (e) {
    console.error(`[ERROR] ${e.message}`);
    console.error(`The asset key was ${plan.asset}. It was not written to mints.json because the mint was not confirmed.`);
    process.exit(1);
  }
}

async function cmdReveal(bundleDir, opts = {}) {
  const dir = resolve(bundleDir);
  if (!existsSync(dir)) {
    console.error(`[ERROR] Directory not found: ${dir}`);
    process.exit(1);
  }
  const dataFile = join(dir, "reveal-data.json");
  let items;
  if (existsSync(dataFile)) items = loadJson(dataFile);
  else {
    try {
      items = loadRevealItems(dir, { uriPrefix: opts.uriPrefix });
    } catch (e) {
      console.error(`[ERROR] ${e.message}`);
      process.exit(1);
    }
  }
  const hiddenFile = join(dir, "hidden-settings.json");
  const hidden = existsSync(hiddenFile) ? loadJson(hiddenFile) : null;
  if (opts.check) {
    const actual = loadJson(opts.check);
    const report = checkReveal(items, actual);
    if (!report.ok) {
      for (const p of report.problems) console.error(`[PROBLEM] ${p}`);
      process.exit(1);
    }
    if (hidden?.hash && hidden.hash !== report.hash) {
      console.error(`[PROBLEM] hidden-settings hash ${hidden.hash} != ${report.hash}`);
      process.exit(1);
    }
    console.log(`Reveal matches (${report.hash})`);
    return;
  }
  let updates;
  try {
    updates = revealUpdates(items, hidden);
  } catch (e) {
    console.error(`[ERROR] ${e.message}`);
    process.exit(1);
  }
  const out = join(dir, "reveal-updates.json");
  writeJsonAtomic(out, updates);
  console.log(`Reveal updates: ${out}`);
  console.log(`hash ${updates.hash} · ${updates.items.length} items`);
  if (!opts.keypair) {
    console.log("Hidden settings mint in order 0, 1, 2, …. Pass --keypair <collection-update-authority.json> to sign each Core asset.");
    console.log("Without --keypair this command does not sign. EVM delayed reveal stays in the thirdweb dashboard.");
    return;
  }
  const mintsFile = resolve(opts.mints || join(dir, "mints.json"));
  if (!existsSync(mintsFile)) {
    console.error(`[ERROR] ${mintsFile} not found. series mint records each asset there. A mint made elsewhere needs { items: [{ index, asset }] }.`);
    process.exit(1);
  }
  const payer = requireKeypair(opts, "the collection update authority");
  const mints = loadMints(mintsFile);
  if (!mints.collection && opts.release) {
    const rel = loadJson(opts.release);
    mints.collection = rel.deployed?.collection || null;
  }
  let plan;
  try {
    plan = planCoreReveal({ updates, mints, payer: payer.publicKey.toBase58() });
  } catch (e) {
    console.error(`[ERROR] ${e.message}`);
    process.exit(1);
  }
  console.log(`Core updates to sign: ${plan.pending.length} (collection ${plan.collection})`);
  for (const row of plan.skipped) console.log(`skip index ${row.index}: ${row.reason}`);
  if (opts.dryRun) {
    for (const row of plan.pending) console.log(`dry-run: ${row.asset} ← ${row.name}`);
    console.log("dry-run: transactions were not sent. EVM delayed reveal stays in the thirdweb dashboard.");
    return;
  }
  const rpcUrl = opts.rpc || process.env.SOLANA_RPC_URL || "https://solana-rpc.publicnode.com";
  try {
    const authority = await readCollectionAuthority(plan.collection, { rpcUrl });
    if (authority !== payer.publicKey.toBase58()) {
      console.error(`[ERROR] this key is ${payer.publicKey.toBase58()}, the collection update authority is ${authority}.`);
      process.exit(1);
    }
  } catch (e) {
    console.error(`[ERROR] ${e.message}`);
    process.exit(1);
  }
  for (const row of plan.pending) {
    try {
      const signature = await sendInstructions({
        instructions: [row.instruction],
        signers: [payer],
        rpcUrl,
        feePayer: payer.publicKey,
      });
      markRevealed(mintsFile, row.index, signature);
      console.log(`Revealed ${row.index} ${row.asset}: ${signature}`);
    } catch (e) {
      console.error(`[ERROR] index ${row.index}: ${e.message}`);
      process.exit(1);
    }
  }
  console.log("EVM delayed reveal stays in the thirdweb dashboard.");
}

function cmdCompose(archivePath, opts = {}) {
  const archive = loadJson(archivePath);
  let preset = {};
  const presetPath = opts.preset || (archive.presetId ? resolve("presets", `${archive.presetId}.json`) : null);
  if (presetPath && existsSync(presetPath)) preset = loadJson(presetPath);
  const items = preset?.traits?.items;
  if (!Array.isArray(items) || !items.length) {
    console.error("[ERROR] preset traits are required (pass --preset)");
    process.exit(1);
  }
  if (!opts.layers || !opts.base) {
    console.error("[ERROR] --layers <dir> and --base <png> are required");
    process.exit(1);
  }
  const layerDir = resolve(opts.layers);
  const baseFile = resolve(opts.base);
  if (!existsSync(layerDir) || !existsSync(baseFile)) {
    console.error("[ERROR] layers directory or base image is missing");
    process.exit(1);
  }
  const outDir = resolve(opts.out || join("out", "layers"));
  try {
    const report = composeArchive({
      archive,
      items,
      basePng: readFileSync(baseFile),
      layerDir,
      outDir,
      limit: opts.limit,
    });
    console.log(`Composed ${report.count} editions → ${outDir}`);
    console.log("Prompts on the recipes were left as they are. DNA is in dna.json.");
  } catch (e) {
    console.error(`[ERROR] ${e.message}`);
    process.exit(1);
  }
}

async function cmdUpload(bundleDir, opts = {}) {
  const dir = resolve(bundleDir);
  if (opts.dryRun && !opts.keypair) {
    const p = planUpload(dir);
    console.log(`${p.total} entries, ${p.uploaded} already uploaded, ${p.todo.length} to upload (${(p.bytes / 1024 / 1024).toFixed(2)} MB). Price needs --keypair.`);
    return;
  }
  if (!opts.keypair) {
    console.error("[ERROR] --keypair <file> is required (the key never leaves this machine)");
    process.exit(1);
  }
  const res = await uploadBundle({
    bundleDir: dir,
    key: loadKeypairFile(resolve(opts.keypair)),
    rpcUrl: opts.rpc || process.env.SOLANA_RPC_URL || undefined,
    dryRun: Boolean(opts.dryRun),
    fund: !opts.noFund,
    maxPriceSol: Number.isFinite(opts.maxPrice) ? opts.maxPrice : undefined,
    log: (m) => console.log(m),
  });
  console.log(`
Done: ${res.uploadedNow} uploaded now, ${res.alreadyUploaded} were already in cache. Cache: ${res.cacheFile}`);
}

async function cmdVerify(releasePath, opts = {}) {
  const cfg = loadJson(releasePath);
  const r = await verifyRelease(cfg, { rpcUrl: opts.rpc });
  console.log(`Candy Machine (${r.standard}): ${r.minted} of ${r.total} minted`);
  console.log(`Guard authority: ${r.authority}`);
  console.log(`Guards on chain: ${Object.keys(r.guards).join(", ") || "(none)"}`);
  if (r.ok) console.log("Matches release.json ✓");
  else {
    for (const p of r.problems) console.error(`[PROBLEM] ${p}`);
    process.exit(1);
  }
}

function cmdManifest(archivePath, opts = {}) {
  const archive = loadJson(archivePath);
  let preset = null;
  if (opts.preset) {
    preset = loadJson(opts.preset);
  } else if (archive.presetId) {
    const defaultPresetPath = resolve("presets", `${archive.presetId}.json`);
    if (existsSync(defaultPresetPath)) {
      try {
        preset = loadJson(defaultPresetPath);
      } catch {}
    }
  }

  const traitItems = preset?.traits?.items || preset?.traits || [];
  const profile = opts.profile || "opensea";
  const isZeroIndex = Boolean(opts.zeroIndex || opts.zeroIndexed);
  const imageUriPrefix = opts.imagePrefix || opts.imageUriPrefix || "";
  const animationUriPrefix = opts.animPrefix || opts.animationUriPrefix || "";
  const namePrefix = opts.namePrefix || (archive.presetId ? `${archive.presetId} #` : "Series #");
  const description = opts.description || (preset?.description || "");

  const csv = exportManifestCsv(archive.recipes || [], traitItems, {
    profile,
    zeroIndexed: isZeroIndex,
    imageUriPrefix,
    animationUriPrefix,
    namePrefix,
    description,
  });

  const out = resolve(opts.out || join("out", `manifest-${archive.presetId || "series"}.csv`));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, csv, "utf8");
  console.log(`Wrote launchpad CSV manifest: ${out} (${(archive.recipes || []).length} items, profile: ${profile})`);
}

function cmdReleaseConfig(archivePath, opts = {}) {
  const archive = loadJson(archivePath);
  let preset = null;
  if (opts.preset) {
    preset = loadJson(opts.preset);
  } else if (archive.presetId) {
    const defaultPresetPath = resolve("presets", `${archive.presetId}.json`);
    if (existsSync(defaultPresetPath)) {
      try {
        preset = loadJson(defaultPresetPath);
      } catch {}
    }
  }

  const profile = opts.profile || "opensea";
  const isZeroIndex = Boolean(opts.zeroIndex || opts.zeroIndexed);
  const creatorAddress = opts.creator || opts.creatorAddress || "";
  const price = opts.price != null ? Number(opts.price) : 0.1;
  const imageUriPrefix = opts.imagePrefix || opts.imageUriPrefix || "";
  const animationUriPrefix = opts.animPrefix || opts.animationUriPrefix || "";
  const symbol = opts.symbol || (archive.presetId ? archive.presetId.toUpperCase().slice(0, 5) : "LAB");
  const fee = opts.fee != null ? Number(opts.fee) : 500;
  const namePrefix = opts.namePrefix || (archive.presetId ? `${archive.presetId} #` : "Series #");

  const configOpts = {
    creatorAddress,
    zeroIndexed: isZeroIndex,
    price,
    imageUriPrefix,
    animationUriPrefix,
    symbol,
    sellerFeeBasisPoints: fee,
    namePrefix,
  };

  if (profile === "launchmynft" || (profile === "magiceden" && opts.legacy)) {
    const sugar = buildSugarConfig(archive, preset || {}, configOpts);
    const out = resolve(opts.out || join("out", `sugar-${archive.presetId || "series"}.json`));
    mkdirSync(dirname(out), { recursive: true });
    writeJsonAtomic(out, sugar);
    console.log(`Wrote legacy Sugar config: ${out} (profile: ${profile})`);
  } else if (profile === "magiceden") {
    const core = buildCoreCandyConfig(archive, preset || {}, configOpts);
    const out = resolve(opts.out || join("out", `cm-config-${archive.presetId || "series"}.json`));
    mkdirSync(dirname(out), { recursive: true });
    writeJsonAtomic(out, core);
    console.log(`Wrote Core Candy Machine config: ${out} (profile: ${profile})`);
  } else {
    const tw = buildThirdwebConfig(archive, preset || {}, configOpts);
    const out = resolve(opts.out || join("out", `thirdweb-${archive.presetId || "series"}.json`));
    mkdirSync(dirname(out), { recursive: true });
    writeJsonAtomic(out, tw);
    console.log(`Wrote Thirdweb / EVM Drop config: ${out} (profile: ${profile})`);
  }
}

function cmdShowcase(archivePath, opts = {}) {
  const archive = loadJson(archivePath);
  let preset = null;
  if (opts.preset) {
    preset = loadJson(opts.preset);
  } else if (archive.presetId) {
    const defaultPresetPath = resolve("presets", `${archive.presetId}.json`);
    if (existsSync(defaultPresetPath)) {
      try { preset = loadJson(defaultPresetPath); } catch {}
    }
  }

  const html = generateShowcaseHtml(archive, preset || {}, {
    title: opts.namePrefix ? opts.namePrefix.replace(/\s*#$/, "") : undefined,
  });

  const out = resolve(opts.out || join("out", `showcase-${archive.presetId || "series"}.html`));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html, "utf8");
  console.log(`Generated Collection Showcase & Rarity Scorecard: ${out} (${(archive.recipes || []).length} editions)`);
}

function cmdProvenance(targetDir, opts = {}) {
  const dir = resolve(targetDir);
  if (!existsSync(dir)) {
    console.error(`Error: target directory does not exist: ${dir}`);
    process.exit(1);
  }

  // Check if verify mode
  if (opts.verify) {
    const provPath = opts.provenance ? resolve(opts.provenance) : join(dir, "provenance.json");
    if (!existsSync(provPath)) {
      console.error(`Error: provenance file not found for verification: ${provPath}`);
      process.exit(1);
    }
    const provData = JSON.parse(readFileSync(provPath, "utf8"));
    const result = verifyProvenance(provData, dir);
    if (result.valid) {
      console.log(`✅ Provenance Verification PASSED: ${provData.provenanceHash} (${provData.count} items)`);
      process.exit(0);
    } else {
      console.error(`❌ Provenance Verification FAILED:`);
      for (const err of result.errors) console.error(`  - ${err}`);
      process.exit(1);
    }
  }

  // Calculate mode
  const files = readdirSync(dir);
  const images = [];
  for (const f of files) {
    const m = f.match(/^(\d+)\.(png|jpe?g|webp)$/i);
    if (m) {
      images.push({
        edition: Number(m[1]),
        path: join(dir, f),
        file: f,
      });
    }
  }

  if (!images.length) {
    console.error(`Error: no image files (1.png, 2.png...) found in ${dir}`);
    process.exit(1);
  }

  const prov = calculateCollectionProvenance(images);
  console.log(`Generated Provenance Hash for ${prov.count} images:`);
  console.log(`  Provenance Hash : ${prov.provenanceHash}`);
  console.log(`  Algorithm       : ${prov.algorithm}`);
  console.log(`  Timestamp       : ${prov.timestamp}`);

  if (opts.out) {
    const out = resolve(opts.out);
    mkdirSync(dirname(out), { recursive: true });
    writeJsonAtomic(out, prov);
    console.log(`Wrote provenance file: ${out}`);
  }
}

async function cmdDataset(archivePath, opts = {}) {
  const archive = loadJson(archivePath);
  let preset = null;
  if (opts.preset) {
    preset = loadJson(opts.preset);
  } else if (archive.presetId) {
    const defaultPresetPath = resolve("presets", `${archive.presetId}.json`);
    if (existsSync(defaultPresetPath)) {
      try { preset = loadJson(defaultPresetPath); } catch {}
    }
  }

  const imagesDir = opts.images ? resolve(opts.images) : resolve("out", archive.presetId || "series");
  if (!existsSync(imagesDir)) {
    console.error(`Error: images directory does not exist: ${imagesDir}`);
    process.exit(1);
  }

  const outZip = resolve(opts.out || join("out", `dataset-${archive.presetId || "series"}.zip`));

  console.log(`Exporting LoRA training dataset for ${archive.presetId || "series"}...`);
  console.log(`  Source Images : ${imagesDir}`);
  console.log(`  Trigger Word  : ${opts.trigger || opts.triggerWord || "(none)"}`);
  console.log(`  Format        : ${opts.format || "tags"}`);

  const res = await exportDatasetZip({
    archive,
    preset,
    setDir: imagesDir,
    opts: {
      ...opts,
      triggerWord: opts.trigger || opts.triggerWord,
      outPath: outZip,
    },
  });

  console.log(`✅ Wrote LoRA Training Dataset ZIP: ${outZip} (${res.count} pairs [image + txt])`);
}

async function cmdNotify(message, opts = {}) {
  loadKeys();
  const text = message || opts.message || "🔔 *Series Lab*: Тестове сповіщення з терміналу CLI успішно надіслано!";
  console.log(`Sending Telegram notification...`);
  const res = await dispatchBatchNotification({
    presetName: "Series Lab CLI",
    total: 1,
    success: 1,
    failed: 0,
  });
  if (res.sent) {
    console.log(`✅ Telegram notification sent successfully!`);
  } else {
    console.log(`❌ Telegram notification failed: ${res.error}`);
  }
}

function parseOpts(args) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-o" || a === "--out") opts.out = args[++i];
    else if (a === "-e" || a === "--engine") opts.engine = args[++i];
    else if (a === "-s" || a === "--strength") opts.strength = Number(args[++i]);
    else if (a === "-c" || a === "--concurrency") opts.concurrency = Number(args[++i]);
    else if (a === "-a" || a === "--archive") opts.archive = args[++i];
    else if (a === "-p" || a === "--preset") opts.preset = args[++i];
    else if (a === "--profile") opts.profile = args[++i];
    else if (a === "--creator" || a === "--creator-address") opts.creator = args[++i];
    else if (a === "--price") opts.price = Number(args[++i]);
    else if (a === "--fee") opts.fee = Number(args[++i]);
    else if (a === "--symbol") opts.symbol = args[++i];
    else if (a === "--zero-index" || a === "--zero-indexed") opts.zeroIndex = true;
    else if (a === "--image-prefix" || a === "--image-uri-prefix") opts.imagePrefix = args[++i];
    else if (a === "--anim-prefix" || a === "--animation-prefix" || a === "--animation-uri-prefix") opts.animPrefix = args[++i];
    else if (a === "--name-prefix") opts.namePrefix = args[++i];
    else if (a === "--description") opts.description = args[++i];
    else if (a === "--name") opts.name = args[++i];
    else if (a === "--provider") opts.provider = args[++i];
    else if (a === "--apply") opts.apply = true;
    else if (a === "--limit" || a === "--sample") opts.limit = Number(args[++i]);
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--keypair") opts.keypair = args[++i];
    else if (a === "--max-price") opts.maxPrice = Number(args[++i]);
    else if (a === "--no-fund") opts.noFund = true;
    else if (a === "--rpc") opts.rpc = args[++i];
    else if (a === "--allowlist") opts.allowlist = args[++i];
    else if (a === "--uri") opts.uri = args[++i];
    else if (a === "--uri-prefix") opts.uriPrefix = args[++i];
    else if (a === "--layers") opts.layers = args[++i];
    else if (a === "--base") opts.base = args[++i];
    else if (a === "--check") opts.check = args[++i];
    else if (a === "--group") opts.group = args[++i];
    else if (a === "--public") opts.public = true;
    else if (a === "--bundle") opts.bundle = args[++i];
    else if (a === "--mints") opts.mints = args[++i];
    else if (a === "--release") opts.release = args[++i];
    else if (a === "--index") opts.index = Number(args[++i]);
    else if (a === "--notify") opts.notify = true;
    else if (a === "--trigger" || a === "--trigger-word") opts.trigger = args[++i];
    else if (a === "--images" || a === "--set-dir") opts.images = args[++i];
    else if (a === "--format") opts.format = args[++i];
    else if (a === "--legacy") opts.legacy = true;
    else if (a === "--verify") opts.verify = true;
    else if (a === "--provenance") opts.provenance = args[++i];
  }
  return opts;
}

async function cmdEngines() {
  loadKeys();
  console.log("=== Series Lab Image Engines ===\n");
  console.log("Edit / img2img engines (with base reference image):");
  for (const [id, eng] of Object.entries(ENGINES)) {
    const key = eng.key;
    let available = Boolean(process.env[key]);
    if (id === "comfyui") available = Boolean(process.env.COMFYUI_URL || process.env.COMFYUI_ENABLED === "1");
    if (id === "a1111") available = Boolean(process.env.A1111_URL || process.env.SD_WEBUI_URL || process.env.A1111_ENABLED === "1");
    if (id === "fal" && !available) available = Boolean(process.env.FAL_API_KEY);
    const status = available ? "✓ READY" : "— missing key/URL";
    console.log(`  • ${id.padEnd(12)} | $${String(eng.costUsd).padEnd(5)} | ${status.padEnd(20)} | ${eng.title}`);
  }

  console.log("\nText-to-Image (txt2img) engines:");
  for (const [id, eng] of Object.entries(TXT2IMG)) {
    const key = eng.key;
    let available = Boolean(process.env[key]);
    if (id === "comfyui") available = Boolean(process.env.COMFYUI_URL || process.env.COMFYUI_ENABLED === "1");
    if (id === "a1111") available = Boolean(process.env.A1111_URL || process.env.SD_WEBUI_URL || process.env.A1111_ENABLED === "1");
    if (id === "fal" && !available) available = Boolean(process.env.FAL_API_KEY);
    if (id === "mock") available = true;
    const status = available ? "✓ READY" : "— missing key/URL";
    console.log(`  • ${id.padEnd(12)} | $${String(eng.costUsd).padEnd(5)} | ${status.padEnd(20)} | ${eng.title}`);
  }
}

async function cmdDoctor() {
  loadKeys();
  const { runDoctorDiagnostics, formatDoctorReport } = await import("../src/doctor.mjs");
  console.log("Running Series Lab diagnostic checks...\n");
  const report = await runDoctorDiagnostics({ rootDir: resolve("."), env: process.env });
  console.log(formatDoctorReport(report));
  if (!report.ok) process.exitCode = 1;
}

async function cmdUpscale(dirPath, opts = {}) {
  const abs = resolve(dirPath);
  if (!existsSync(abs)) {
    console.error(`[ERROR] Directory not found: ${abs}`);
    process.exit(1);
  }
  const files = readdirSync(abs).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
  if (!files.length) {
    console.log(`No images found in ${abs}`);
    return;
  }
  const outDir = opts.out ? resolve(opts.out) : abs;
  mkdirSync(outDir, { recursive: true });
  console.log(`Upscaling ${files.length} images from ${abs}...`);

  const { loadSharp, upscale2x } = await import("../src/upscale.mjs");
  const sharpMod = await loadSharp();
  if (!sharpMod) {
    console.warn("[WARN] 'sharp' is not installed. To enable hardware 2x upscaling, run: npm install sharp");
    return;
  }

  let count = 0;
  for (const f of files) {
    const src = join(abs, f);
    const buf = readFileSync(src);
    const up = await upscale2x(buf, { format: "png" });
    if (up.ok && up.buffer) {
      writeFileSync(join(outDir, f), up.buffer);
      count++;
    }
  }
  console.log(`Done! Successfully upscaled ${count}/${files.length} images to ${outDir}`);
}

async function cmdRepairPng(dir, opts = {}) {
  const r = await repairPngFiles(resolve(dir), { dryRun: Boolean(opts.dryRun) });
  const verb = opts.dryRun ? "would convert" : "converted";
  console.log(`Scanned ${r.scanned} .png files: ${r.png} already PNG, ${verb} ${r.converted.length}, failed ${r.failed.length}.`);
  for (const f of r.converted) console.log(`  ${verb}: ${f}`);
  for (const f of r.failed) console.error(`  failed: ${f}`);
  if (r.failed.length || (!r.sharp && r.converted.length === 0 && r.scanned > r.png)) {
    console.error("sharp is not installed: run `npm i sharp`, then repeat.");
    process.exit(1);
  }
  if (!opts.dryRun && r.converted.length) {
    console.log("Hashes of converted files changed: rebuild any bundle, provenance or upload made from this set before.");
  }
}

async function main(argv) {
  const args = argv.slice(2);
  if (!args.length || args.includes("-h") || args.includes("--help")) usage(0);
  const cmd = args[0];
  if (cmd === "engines") {
    await cmdEngines();
    return;
  }
  if (cmd === "doctor") {
    await cmdDoctor();
    return;
  }
  if (cmd === "repair-png") {
    if (!args[1]) usage(1);
    const opts = parseOpts(args.slice(2));
    await cmdRepairPng(args[1], opts);
    return;
  }
  if (cmd === "upscale") {
    if (!args[1]) usage(1);
    const opts = parseOpts(args.slice(2));
    await cmdUpscale(args[1], opts);
    return;
  }
  if (cmd === "validate") {
    if (!args[1]) usage(1);
    cmdValidate(args[1]);
    return;
  }
  if (cmd === "build") {
    if (!args[1]) usage(1);
    const opts = parseOpts(args.slice(2));
    cmdBuild(args[1], opts.out);
    return;
  }
  if (cmd === "diff-seed") {
    if (!args[1]) usage(1);
    cmdDiffSeed(args[1]);
    return;
  }
  if (cmd === "showcase") {
    if (!args[1]) usage(1);
    const opts = parseOpts(args.slice(2));
    cmdShowcase(args[1], opts);
    return;
  }
  if (cmd === "manifest") {
    if (!args[1]) usage(1);
    const opts = parseOpts(args.slice(2));
    cmdManifest(args[1], opts);
    return;
  }
  if (cmd === "release-config") {
    if (!args[1]) usage(1);
    const opts = parseOpts(args.slice(2));
    cmdReleaseConfig(args[1], opts);
    return;
  }
  if (cmd === "provenance") {
    if (!args[1]) usage(1);
    const opts = parseOpts(args.slice(2));
    cmdProvenance(args[1], opts);
    return;
  }
  if (cmd === "dataset") {
    if (!args[1]) usage(1);
    const opts = parseOpts(args.slice(2));
    await cmdDataset(args[1], opts);
    return;
  }
  if (cmd === "render") {
    if (!args[1]) usage(1);
    const opts = parseOpts(args.slice(2));
    await cmdRender(args[1], opts);
    return;
  }
  if (cmd === "triage") {
    if (!args[1]) usage(1);
    const opts = parseOpts(args.slice(2));
    await cmdTriage(args[1], opts);
    return;
  }
  if (cmd === "pin") {
    if (!args[1]) usage(1);
    const opts = parseOpts(args.slice(2));
    await cmdPin(args[1], opts);
    return;
  }
  if (cmd === "release-init") {
    if (!args[1]) usage(1);
    cmdReleaseInit(args[1], parseOpts(args.slice(2)));
    return;
  }
  if (cmd === "guards") {
    if (!args[1]) usage(1);
    cmdGuards(args[1], parseOpts(args.slice(2)));
    return;
  }
  if (cmd === "hidden") {
    if (!args[1]) usage(1);
    cmdHidden(args[1], parseOpts(args.slice(2)));
    return;
  }
  if (cmd === "mint") {
    if (!args[1]) usage(1);
    await cmdMint(args[1], parseOpts(args.slice(2)));
    return;
  }
  if (cmd === "reveal") {
    if (!args[1]) usage(1);
    await cmdReveal(args[1], parseOpts(args.slice(2)));
    return;
  }
  if (cmd === "compose") {
    if (!args[1]) usage(1);
    cmdCompose(args[1], parseOpts(args.slice(2)));
    return;
  }
  if (cmd === "upload") {
    if (!args[1]) usage(1);
    await cmdUpload(args[1], parseOpts(args.slice(2)));
    return;
  }
  if (cmd === "verify") {
    if (!args[1]) usage(1);
    await cmdVerify(args[1], parseOpts(args.slice(2)));
    return;
  }
  if (cmd === "notify") {
    const opts = parseOpts(args.slice(1));
    await cmdNotify(args[1], opts);
    return;
  }
  console.error(`Unknown command: ${cmd}`);
  usage(1);
}

main(process.argv);

