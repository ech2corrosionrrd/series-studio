import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { findEditionMedia, listImageEditions } from "./export-bundle.mjs";

/**
 * Builds training captions for recipes to train LoRA / fine-tuned models.
 *
 * @param {Array<object>} recipes - List of recipe objects from archive
 * @param {object} preset - Series preset object
 * @param {object} [opts={}]
 * @param {string} [opts.triggerWord=''] - Primary trigger token for model training
 * @param {'tags' | 'prose'} [opts.format='tags'] - 'tags' (comma-separated Danbooru style) or 'prose' (natural language)
 * @param {boolean} [opts.includeKeep=true] - Whether to prepend keep items or prompt prefix
 * @param {boolean} [opts.includeSuffix=false] - Whether to append prompt suffix
 * @param {string} [opts.customPrefix=''] - Custom prefix string
 * @returns {Array<{ edition: number, fileName: string, caption: string, tags: string[] }>}
 */
export function buildDatasetCaptions(recipes = [], preset = {}, opts = {}) {
  const triggerWord = String(opts.triggerWord || opts.trigger || "").trim();
  const format = opts.format === "prose" ? "prose" : "tags";
  const customPrefix = String(opts.customPrefix || "").trim();
  const includeSuffix = Boolean(opts.includeSuffix);

  return recipes.map((recipe) => {
    const ed = Number(recipe.edition);
    const tags = [];

    // 1. Trigger word
    if (triggerWord) {
      tags.push(triggerWord);
    }

    // 2. Custom prefix
    if (customPrefix) {
      tags.push(customPrefix);
    }

    // 3. Line archetype / who
    if (recipe.who && typeof recipe.who === "string") {
      tags.push(recipe.who.trim());
    }

    // 4. Traits
    if (recipe.traits && typeof recipe.traits === "object") {
      for (const [key, val] of Object.entries(recipe.traits)) {
        if (!val || val === "None" || val === "none") continue;
        const cleanVal = String(val).toLowerCase().trim();
        tags.push(cleanVal);
      }
    }

    // 5. Keep elements if tags format and enabled
    if (opts.includeKeep && Array.isArray(preset?.promptTemplate?.keep)) {
      for (const k of preset.promptTemplate.keep) {
        if (k && typeof k === "string") tags.push(k.trim().toLowerCase());
      }
    }

    // 6. Suffix if enabled
    if (includeSuffix && preset?.promptTemplate?.suffix) {
      tags.push(String(preset.promptTemplate.suffix).trim().toLowerCase());
    }

    let caption = "";
    if (format === "prose") {
      // Natural language sentence formatting (optimal for Flux / SD3)
      const lead = triggerWord ? `A detailed image of ${triggerWord}` : "A detailed portrait";
      const subject = recipe.who ? `, depicting ${recipe.who}` : "";
      const traitList = Object.entries(recipe.traits || {})
        .filter(([, v]) => v && v !== "None")
        .map(([k, v]) => `${k} is ${v}`)
        .join(", ");
      const traitSentence = traitList ? ` Features include: ${traitList}.` : "";
      caption = `${lead}${subject}.${traitSentence}`.replace(/\s+/g, " ").trim();
    } else {
      // Danbooru / Tag style (optimal for SDXL / SD1.5 / Kohya_ss)
      // Deduplicate tags while preserving order
      const seen = new Set();
      const deduped = [];
      for (const t of tags) {
        const lower = t.toLowerCase();
        if (!seen.has(lower)) {
          seen.add(lower);
          deduped.push(t);
        }
      }
      caption = deduped.join(", ");
    }

    return {
      edition: ed,
      fileName: `${ed}.txt`,
      caption,
      tags,
    };
  });
}

/**
 * Exports a complete, training-ready dataset ZIP containing pairs of:
 * `[edition].png` + `[edition].txt`, along with dataset-info.json.
 *
 * @param {object} params
 * @param {object} params.archive - Series archive
 * @param {object} params.preset - Series preset
 * @param {string} params.setDir - Directory with generated images
 * @param {object} [params.opts={}] - Options (triggerWord, format, onlyKeep, outPath)
 * @param {object} [params.marks={}] - Keep/redo review marks
 * @returns {Promise<{
 *   ok: boolean,
 *   count: number,
 *   triggerWord: string,
 *   format: string,
 *   zipBuffer: Buffer,
 *   outputPath?: string
 * }>}
 */
export async function exportDatasetZip(params) {
  const { archive, preset, setDir, opts = {}, marks = {} } = params;

  if (!setDir || !fs.existsSync(setDir)) {
    throw new Error(`setDir does not exist: ${setDir}`);
  }

  const allRecipes = archive?.recipes || [];
  const onlyKeep = Boolean(opts.onlyKeep);
  const triggerWord = String(opts.triggerWord || opts.trigger || "").trim();
  const format = opts.format === "prose" ? "prose" : "tags";

  const imageEditions = listImageEditions(setDir);

  // Filter recipes based on image availability and keep marks
  let filtered = allRecipes.filter((r) => imageEditions.has(Number(r.edition)));
  if (onlyKeep && marks && Object.keys(marks).length > 0) {
    filtered = filtered.filter((r) => marks[r.edition]?.mark === "keep");
  }

  if (filtered.length === 0) {
    throw new Error("No images available to export for dataset");
  }

  const captions = buildDatasetCaptions(filtered, preset, opts);
  const captionMap = new Map(captions.map((c) => [c.edition, c.caption]));

  const zip = new JSZip();
  const datasetFolder = zip.folder("dataset");

  let includedCount = 0;
  for (const recipe of filtered) {
    const ed = recipe.edition;
    const media = findEditionMedia(setDir, ed);
    if (!media.imagePath) continue;

    const imgExt = path.extname(media.imagePath).slice(1) || "png";
    const imgBuf = fs.readFileSync(media.imagePath);
    const captionText = captionMap.get(ed) || triggerWord || `edition_${ed}`;

    datasetFolder.file(`${ed}.${imgExt}`, imgBuf);
    datasetFolder.file(`${ed}.txt`, captionText + "\n");
    includedCount++;
  }

  // Metadata summary file for trainer setup (Kohya_ss, Flux Gym, etc.)
  const datasetInfo = {
    generator: "Series Lab — Dataset Exporter v1.0",
    presetId: archive?.presetId || preset?.id || "series",
    presetName: preset?.name || archive?.presetId || "Series",
    count: includedCount,
    triggerWord: triggerWord || null,
    format,
    trainingTips: {
      kohya_ss: "Extract dataset folder directly. Set repeat counts (e.g. 10_mytoken).",
      flux_gym: "Use the txt files directly as target captions for LoRA training.",
      recommendedResolution: "1024x1024",
    },
    sampleCaptions: captions.slice(0, 3).map((c) => ({ edition: c.edition, caption: c.caption })),
    timestamp: new Date().toISOString(),
  };

  zip.file("dataset-info.json", JSON.stringify(datasetInfo, null, 2) + "\n");

  const zipBuffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  if (opts.outPath) {
    const dir = path.dirname(opts.outPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(opts.outPath, zipBuffer);
  }

  return {
    ok: true,
    count: includedCount,
    triggerWord,
    format,
    zipBuffer,
    outputPath: opts.outPath || null,
  };
}
