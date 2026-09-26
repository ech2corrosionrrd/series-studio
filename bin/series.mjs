#!/usr/bin/env node
/**
 * Series Lab CLI — validate / build / diff-seed / render.
 * Fast deterministic operations + optional headless render pipeline.
 */
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
  uploadToPinata,
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
  series engines
  series doctor
  series upscale <images-dir> [options]
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
  --image-prefix <uri>    URI prefix for images (e.g. ipfs://CID/)
  --anim-prefix <uri>     URI prefix for animations/videos (e.g. ipfs://CID/)
  --name-prefix <str>     Token name prefix (e.g. Series #)
  --name <str>            Collection name for IPFS pin
  --provider <name>       Triage/Storage provider (heuristic, vision, pinata)
  --apply                 Apply triage keep/redo verdicts to marks.json
  --limit <num>           Process only first N recipes/images
  --dry-run               Simulate execution without external API calls
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
    console.log(`[DRY-RUN] Simulated IPFS CID: ${mockCid}`);
    console.log(`[DRY-RUN] Gateway URI: ipfs://${mockCid}/`);
    return;
  }

  loadKeys();
  const name = opts.name || `series-${basename(setDir)}`;
  const res = await uploadToPinata({
    dir: setDir,
    name,
  });

  console.log(`\nSuccessfully pinned to IPFS!`);
  console.log(`IPFS CID:    ${res.ipfsHash}`);
  console.log(`IPFS URI:    ${res.ipfsUri}`);
  console.log(`Gateway URL: ${res.gatewayUrl}`);
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
  if (cmd === "notify") {
    const opts = parseOpts(args.slice(1));
    await cmdNotify(args[1], opts);
    return;
  }
  console.error(`Unknown command: ${cmd}`);
  usage(1);
}

main(process.argv);

