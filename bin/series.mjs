#!/usr/bin/env node
/**
 * Series Lab CLI — validate / build / diff-seed / render.
 * Fast deterministic operations + optional headless render pipeline.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
  buildThirdwebConfig,
  generateShowcaseHtml,
  calculateRarityScores,
} from "../src/index.mjs";
import { loadKeys } from "../src/keys.mjs";
import { ENGINES, getEngine, withRetry, engineCtx } from "../src/engines.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function usage(code = 0) {
  const text = `series — Series Lab CLI (preset → recipes / render / triage / pin / manifest / release / showcase)

Usage:
  series validate <preset.json>
  series build <preset.json> [-o archive.json]
  series diff-seed <preset.json>
  series showcase <archive.json> [options]
  series manifest <archive.json> [options]
  series release-config <archive.json> [options]
  series render <preset.json> [options]
  series triage <set-dir> [options]
  series pin <set-dir> [options]

Options:
  -o, --out <path>        Output archive, manifest CSV, config, or render directory
  -e, --engine <name>     AI engine for render (kontext, openai, stability, pollinations)
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
  writeFileSync(out, JSON.stringify(archive, null, 2) + "\n", "utf8");
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

  const unitCost = ENGINES[engine]?.costUsd || 0.04;
  const estCost = Math.round(targetRecipes.length * unitCost * 1000) / 1000;
  console.log(`Estimated cost: ~$${estCost} ($${unitCost}/img)`);

  if (opts.dryRun) {
    console.log(`[DRY-RUN] Prepared ${targetRecipes.length} recipes. API calls skipped.`);
    return;
  }

  loadKeys();
  const eng = getEngine(engine);
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
      const buf = await withRetry(() =>
        eng.generate({
          prompt: recipe.prompt,
          image,
          mime,
          seed: recipe.seed,
          strength,
        }, ctx),
      );
      const outFile = join(outDir, `${recipe.edition}.png`);
      writeFileSync(outFile, buf);
      return { ok: true, edition: recipe.edition, path: outFile };
    },
    (p) => {
      const pct = Math.round((p.completed / p.total) * 100);
      process.stdout.write(`\r[${p.completed}/${p.total}] (${pct}%) Rendered #${p.item.edition}...`);
    },
  );

  console.log(`\nDone! Successfully rendered ${results.filter((r) => r.ok).length} images to ${outDir}`);
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
    writeFileSync(marksPath, JSON.stringify(currentMarks, null, 2) + "\n", "utf8");
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

  if (profile === "magiceden" || profile === "launchmynft") {
    const sugar = buildSugarConfig(archive, preset || {}, configOpts);
    const out = resolve(opts.out || join("out", `sugar-${archive.presetId || "series"}.json`));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(sugar, null, 2) + "\n", "utf8");
    console.log(`Wrote Metaplex Sugar CLI config: ${out} (profile: ${profile})`);
  } else {
    const tw = buildThirdwebConfig(archive, preset || {}, configOpts);
    const out = resolve(opts.out || join("out", `thirdweb-${archive.presetId || "series"}.json`));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(tw, null, 2) + "\n", "utf8");
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
  }
  return opts;
}

async function main(argv) {
  const args = argv.slice(2);
  if (!args.length || args.includes("-h") || args.includes("--help")) usage(0);
  const cmd = args[0];
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
  console.error(`Unknown command: ${cmd}`);
  usage(1);
}

main(process.argv);

