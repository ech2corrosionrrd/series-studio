/**
 * Archive preflight — the gate before a collection is marked ready to upload.
 * Warnings are allowed. Errors block download. No network, no keys.
 */
import { createHash } from "node:crypto";
import { pngDimensions } from "./png-fit.mjs";
import { dna } from "./recipes.mjs";
import { aHashPng, hamming, AHASH_WARN_DISTANCE } from "./dupes.mjs";

export const DEFAULT_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
/**
 * Metaplex Core Candy Machine preparing-assets: "keep file sizes under 1 MB where possible".
 * A file over this size is a warning. The hard stop stays PREFLIGHT_MAX_IMAGE_BYTES.
 */
export const PREFLIGHT_RECOMMENDED_IMAGE_BYTES = 1 * 1024 * 1024;
const PLACEHOLDER_ADDRESSES = new Set([
  "11111111111111111111111111111111",
  "0x0000000000000000000000000000000000000000",
]);

function envInt(env, name, def) {
  const n = Number.parseInt(env?.[name] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

export function imageDigest(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * One DNA helper for recipes and preflight. Stored recipe.dna wins;
 * otherwise the same `dna()` the builder uses.
 */
export function dnaKey(recipe, traitKeys) {
  if (recipe?.dna) return String(recipe.dna);
  const traits = recipe?.traits && typeof recipe.traits === "object" ? recipe.traits : {};
  const keys = Array.isArray(traitKeys) && traitKeys.length
    ? traitKeys
    : Object.keys(traits).sort();
  return dna(recipe?.line || "", traits, keys);
}

export function sniffImage(buf, filename = "") {
  const bytes = buf?.length || 0;
  const name = String(filename || "").toLowerCase();
  let format = null;
  if (buf && buf.length >= 12) {
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) format = "png";
    else if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) format = "jpeg";
    else if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf.toString("ascii", 8, 12) === "WEBP") format = "webp";
    else if (buf.length >= 6 && (buf.toString("ascii", 0, 6) === "GIF87a" || buf.toString("ascii", 0, 6) === "GIF89a")) format = "gif";
  }
  if (!format) {
    const ext = name.match(/\.([a-z0-9]+)$/)?.[1];
    if (ext === "jpg") format = null;
  }
  const dim = format === "png" ? pngDimensions(buf) : null;
  return { format, bytes, width: dim?.width ?? null, height: dim?.height ?? null };
}

/**
 * @param {object} meta
 * @param {"erc721"|"metaplex"|"ordinals"} standard
 * @returns {string[]} problem descriptions (empty = schema ok)
 */
export function metadataSchemaIssues(meta, standard) {
  const issues = [];
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return ["metadata is not an object"];
  }
  if (typeof meta.name !== "string" || !meta.name.trim()) issues.push("name is missing");
  if (meta.description != null && typeof meta.description !== "string") issues.push("description must be a string");
  if (typeof meta.image !== "string" || !meta.image.trim()) issues.push("image is missing");
  if (!Array.isArray(meta.attributes)) issues.push("attributes must be an array");
  else {
    meta.attributes.forEach((attr, i) => {
      if (!attr || typeof attr !== "object") {
        issues.push(`attributes[${i}] is not an object`);
        return;
      }
      if (typeof attr.trait_type !== "string" || !attr.trait_type) issues.push(`attributes[${i}].trait_type is missing`);
      if (attr.value == null || (typeof attr.value !== "string" && typeof attr.value !== "number")) {
        issues.push(`attributes[${i}].value must be a string or number`);
      }
    });
  }
  if (standard === "metaplex") {
    if (typeof meta.symbol !== "string" || !meta.symbol.trim()) issues.push("symbol is missing");
    if (!Number.isInteger(meta.seller_fee_basis_points)) issues.push("seller_fee_basis_points must be an integer");
    const files = meta.properties?.files;
    if (!Array.isArray(files) || !files.length) issues.push("properties.files is missing");
    else if (typeof files[0]?.uri !== "string" || !files[0].uri) issues.push("properties.files[0].uri is missing");
  }
  if (standard === "ordinals") {
    if (meta.properties?.edition == null || Number.isNaN(Number(meta.properties.edition))) {
      issues.push("properties.edition is missing");
    }
    if (typeof meta.properties?.collection !== "string" || !meta.properties.collection.trim()) {
      issues.push("properties.collection is missing");
    }
  }
  return issues;
}

/**
 * Royalty settings must be a sane on-chain fee, not a guess pasted from a key field.
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function assessRoyalties(royalties = {}) {
  const errors = [];
  const warnings = [];
  const fee = royalties.sellerFeeBasisPoints;
  if (!Number.isInteger(fee)) errors.push("sellerFeeBasisPoints must be an integer (basis points, 100 = 1%)");
  else if (fee < 0 || fee > 10000) errors.push(`sellerFeeBasisPoints ${fee} is outside 0–10000`);
  else if (fee > 5000) warnings.push(`royalty ${fee} bps is above 50% — marketplaces may reject it`);
  else if (fee === 0) warnings.push("royalty is 0 bps — creators receive no secondary-sale fee");
  const creators = Array.isArray(royalties.creators) ? royalties.creators : [];
  if (creators.length) {
    let share = 0;
    for (const c of creators) {
      const s = Number(c?.share);
      if (!Number.isFinite(s) || s < 0) errors.push("creator share must be a non-negative number");
      else share += s;
      const addr = String(c?.address || "").trim();
      if (!addr) errors.push("creator address is empty");
      else if (PLACEHOLDER_ADDRESSES.has(addr)) warnings.push("creator address is still a placeholder — replace it with your wallet before deploy");
    }
    if (Math.abs(share - 100) > 0.001) errors.push(`creator shares sum to ${share}, expected 100`);
  } else if (fee > 0) {
    warnings.push("no creator address yet — add your wallet in the deploy kit (Series Lab never asks for the private key)");
  }
  return { errors, warnings };
}

function push(checks, errors, warnings, level, code, message) {
  checks.push({ level, code, message });
  if (level === "error") errors.push({ code, message });
  else if (level === "warning") warnings.push({ code, message });
}

/**
 * @param {object} input
 * @param {Array<object>} input.recipes
 * @param {Array<{ edition: number, filename?: string, buffer: Buffer }>} input.images
 * @param {Array<{ edition: number, meta: object }>} input.metadata
 * @param {object} [input.royalties]
 * @param {"erc721"|"metaplex"|"ordinals"} [input.standard]
 * @param {string} [input.description]
 * @param {boolean} [input.coverPresent]
 * @param {object} [env]
 */
export function runPreflight(input = {}, env = process.env) {
  const uk = String(input.locale || "en").toLowerCase().startsWith("uk");
  const standard = input.standard === "metaplex" || input.standard === "ordinals" ? input.standard : "erc721";
  const maxBytes = envInt(env, "PREFLIGHT_MAX_IMAGE_BYTES", DEFAULT_MAX_IMAGE_BYTES);
  const recipes = Array.isArray(input.recipes) ? input.recipes : [];
  const images = Array.isArray(input.images) ? input.images : [];
  const metadata = Array.isArray(input.metadata) ? input.metadata : [];
  const checks = [];
  const errors = [];
  const warnings = [];
  const L = (en, ua) => (uk ? ua : en);

  const traitKeys = Array.isArray(input.traitKeys) ? input.traitKeys : null;
  const dnaGroups = new Map();
  for (const r of recipes) {
    const key = dnaKey(r, traitKeys);
    const list = dnaGroups.get(key) || [];
    list.push(r.edition);
    dnaGroups.set(key, list);
  }
  const dnaDupes = [...dnaGroups.entries()].filter(([, eds]) => eds.length > 1);
  if (!recipes.length) {
    push(checks, errors, warnings, "error", "empty", L("No items selected for the archive", "У архів не вибрано жодного предмета"));
  } else if (dnaDupes.length) {
    const sample = dnaDupes.slice(0, 5).map(([, eds]) => eds.join("+")).join(", ");
    push(checks, errors, warnings, "error", "duplicate_dna", L(
      `Duplicate DNA in editions ${sample}`,
      `Однакова DNA у виданнях ${sample}`,
    ));
  } else {
    push(checks, errors, warnings, "ok", "duplicate_dna", L(
      `DNA is unique across ${recipes.length} items`,
      `DNA унікальна для ${recipes.length} предметів`,
    ));
  }

  const hashGroups = new Map();
  for (const img of images) {
    if (!img?.buffer) continue;
    const hash = imageDigest(img.buffer);
    const list = hashGroups.get(hash) || [];
    list.push(img.edition);
    hashGroups.set(hash, list);
  }
  const imgDupes = [...hashGroups.entries()].filter(([, eds]) => eds.length > 1);
  if (!images.length) {
    push(checks, errors, warnings, "error", "duplicate_image", L("No image files", "Немає файлів зображень"));
  } else if (imgDupes.length) {
    const sample = imgDupes.slice(0, 5).map(([, eds]) => eds.join("+")).join(", ");
    push(checks, errors, warnings, "error", "duplicate_image", L(
      `Duplicate image bytes (same SHA-256) in editions ${sample}`,
      `Однакові байти зображень (той самий SHA-256) у виданнях ${sample}`,
    ));
  } else {
    push(checks, errors, warnings, "ok", "duplicate_image", L(
      `${images.length} images have distinct bytes`,
      `${images.length} зображень мають різні байти`,
    ));
  }

  const imageEds = new Set(images.map((i) => Number(i.edition)));
  const metaEds = new Set(metadata.map((m) => Number(m.edition)));
  const missingImg = [...metaEds].filter((ed) => !imageEds.has(ed));
  const missingMeta = [...imageEds].filter((ed) => !metaEds.has(ed));
  if (images.length !== metadata.length || missingImg.length || missingMeta.length) {
    push(checks, errors, warnings, "error", "count", L(
      `File count ${images.length} does not match metadata count ${metadata.length}`
        + (missingImg.length ? ` (no image for ${missingImg.slice(0, 12).join(", ")})` : "")
        + (missingMeta.length ? ` (no metadata for ${missingMeta.slice(0, 12).join(", ")})` : ""),
      `Кількість файлів ${images.length} не збігається з метаданими ${metadata.length}`
        + (missingImg.length ? ` (немає зображення для ${missingImg.slice(0, 12).join(", ")})` : "")
        + (missingMeta.length ? ` (немає метаданих для ${missingMeta.slice(0, 12).join(", ")})` : ""),
    ));
  } else if (images.length) {
    push(checks, errors, warnings, "ok", "count", L(
      `${images.length} images match ${metadata.length} metadata files`,
      `${images.length} зображень відповідають ${metadata.length} файлам метаданих`,
    ));
  }

  let schemaBad = 0;
  for (const row of metadata) {
    const issues = metadataSchemaIssues(row.meta, standard);
    if (issues.length) {
      schemaBad += 1;
      if (schemaBad <= 8) {
        push(checks, errors, warnings, "error", "schema", L(
          `Metadata #${row.edition} (${standard}): ${issues.join("; ")}`,
          `Метадані #${row.edition} (${standard}): ${issues.join("; ")}`,
        ));
      }
    }
  }
  if (metadata.length && schemaBad === 0) {
    push(checks, errors, warnings, "ok", "schema", L(
      `Metadata matches the ${standard} shape`,
      `Метадані відповідають формі ${standard}`,
    ));
  } else if (schemaBad > 8) {
    push(checks, errors, warnings, "error", "schema", L(
      `${schemaBad} metadata files failed schema checks`,
      `${schemaBad} файлів метаданих не пройшли перевірку схеми`,
    ));
  }

  const royalties = assessRoyalties(input.royalties || {});
  for (const message of royalties.errors) {
    push(checks, errors, warnings, "error", "royalties", uk ? translateRoyalty(message) : message);
  }
  for (const message of royalties.warnings) {
    push(checks, errors, warnings, "warning", "royalties", uk ? translateRoyalty(message) : message);
  }
  if (!royalties.errors.length && !royalties.warnings.length) {
    const fee = input.royalties?.sellerFeeBasisPoints;
    push(checks, errors, warnings, "ok", "royalties", L(
      `Royalty ${fee} bps is within 0–10000 and creator shares sum to 100`,
      `Роялті ${fee} bps у межах 0–10000, частки творців дають 100`,
    ));
  } else if (!royalties.errors.length) {
    push(checks, errors, warnings, "ok", "royalties", L(
      "Royalty numbers are inside the allowed range (see warnings)",
      "Числа роялті в дозволеному діапазоні (див. попередження)",
    ));
  }

  let formatBad = 0;
  for (const img of images) {
    const info = sniffImage(img.buffer, img.filename);
    if (!info.format) {
      formatBad += 1;
      push(checks, errors, warnings, "error", "format", L(
        `Edition #${img.edition}: file is not PNG, JPEG, WebP, or GIF`,
        `Видання #${img.edition}: файл не PNG, JPEG, WebP і не GIF`,
      ));
      continue;
    }
    if (info.bytes > maxBytes) {
      formatBad += 1;
      push(checks, errors, warnings, "error", "size", L(
        `Edition #${img.edition}: ${info.bytes} bytes exceeds the limit of ${maxBytes} (PREFLIGHT_MAX_IMAGE_BYTES)`,
        `Видання #${img.edition}: ${info.bytes} байт понад ліміт ${maxBytes} (PREFLIGHT_MAX_IMAGE_BYTES)`,
      ));
    } else if (info.bytes > PREFLIGHT_RECOMMENDED_IMAGE_BYTES) {
      push(checks, errors, warnings, "warning", "size", L(
        `Edition #${img.edition}: ${info.bytes} bytes is over 1 MB. Metaplex asks to keep files under 1 MB where possible. The ZIP still builds.`,
        `Видання #${img.edition}: ${info.bytes} байт понад 1 МБ. Metaplex просить тримати файли до 1 МБ, де це можливо. ZIP усе одно збереться.`,
      ));
    } else if (info.bytes < 1024) {
      push(checks, errors, warnings, "warning", "size", L(
        `Edition #${img.edition}: only ${info.bytes} bytes — very small for a marketplace image`,
        `Видання #${img.edition}: лише ${info.bytes} байт — замало для зображення на маркетплейсі`,
      ));
    }
    if (info.width != null && (info.width < 32 || info.height < 32)) {
      push(checks, errors, warnings, "warning", "dimensions", L(
        `Edition #${img.edition}: ${info.width}×${info.height}px is below 32px`,
        `Видання #${img.edition}: ${info.width}×${info.height}px менше за 32px`,
      ));
    }
  }
  if (images.length && formatBad === 0) {
    push(checks, errors, warnings, "ok", "format", L(
      "Image formats and sizes are inside the configured limits",
      "Формати й розміри зображень у заданих межах",
    ));
  }

  const perceptual = [];
  for (const img of images) {
    if (!img?.buffer) continue;
    const info = sniffImage(img.buffer, img.filename);
    if (info.format !== "png") continue;
    try {
      perceptual.push({ edition: img.edition, hash: aHashPng(img.buffer), digest: imageDigest(img.buffer) });
    } catch {
      /* undecodable png is already a format error or not a real png */
    }
  }
  const near = [];
  for (let i = 0; i < perceptual.length; i++) {
    for (let j = i + 1; j < perceptual.length; j++) {
      const a = perceptual[i];
      const b = perceptual[j];
      if (a.digest === b.digest) continue;
      const distance = hamming(a.hash, b.hash);
      if (distance <= AHASH_WARN_DISTANCE) {
        near.push({ editions: [a.edition, b.edition], distance });
      }
    }
  }
  if (near.length) {
    const sample = near.slice(0, 8).map((p) => `${p.editions.join("+")} (d=${p.distance})`).join(", ");
    push(checks, errors, warnings, "warning", "near_duplicate", L(
      `Perceptual near-duplicates (aHash): ${sample}. This does not block the ZIP.`,
      `Майже-дублікати (aHash): ${sample}. Це не блокує ZIP.`,
    ));
  }

  const description = String(input.description ?? "");
  if (!description.trim()) {
    push(checks, errors, warnings, "warning", "description", L(
      "Collection description is empty — marketplaces will show a blank text",
      "Опис колекції порожній — на маркетплейсі буде порожній текст",
    ));
  } else {
    push(checks, errors, warnings, "ok", "description", L("Collection description is set", "Опис колекції задано"));
  }
  if (input.coverPresent === false) {
    push(checks, errors, warnings, "error", "cover", L("Collection cover is missing", "Немає обкладинки колекції"));
  } else if (input.coverPresent) {
    push(checks, errors, warnings, "ok", "cover", L("Collection cover is included", "Обкладинку колекції включено"));
  }

  const localImages = images.filter((img) => {
    const meta = metadata.find((m) => Number(m.edition) === Number(img.edition))?.meta;
    const image = String(meta?.image || "");
    return image && !/^(ipfs|https?|ar):/i.test(image);
  });
  if (localImages.length) {
    push(checks, errors, warnings, "warning", "uri", L(
      "Image URIs are local filenames. Set an IPFS or HTTPS prefix before you list the collection.",
      "Посилання на зображення — локальні імена файлів. Перед лістингом задайте префікс IPFS або HTTPS.",
    ));
  }

  const ready = errors.length === 0;
  const result = {
    ready,
    status: ready ? "ready" : "blocked",
    standard,
    errors,
    warnings,
    checks,
    counts: { items: recipes.length, images: images.length, metadata: metadata.length },
  };
  result.report = formatPreflightReport(result, input.locale);
  return result;
}

function translateRoyalty(message) {
  const map = [
    ["sellerFeeBasisPoints must be an integer (basis points, 100 = 1%)", "sellerFeeBasisPoints має бути цілим числом (базисні пункти, 100 = 1%)"],
    ["creator share must be a non-negative number", "частка творця має бути невід'ємним числом"],
    ["creator address is empty", "адреса творця порожня"],
    ["creator address is still a placeholder — replace it with your wallet before deploy", "адреса творця досі заглушка — замініть її на свій гаманець перед деплоєм"],
    ["no creator address yet — add your wallet in the deploy kit (Series Lab never asks for the private key)", "адреси творця ще немає — додайте гаманець у наборі деплою (Series Lab не питає приватний ключ)"],
    ["royalty is 0 bps — creators receive no secondary-sale fee", "роялті 0 bps — з вторинних продажів творцю нічого не йде"],
  ];
  for (const [en, ua] of map) if (message === en) return ua;
  if (message.startsWith("sellerFeeBasisPoints ")) {
    return message.replace("is outside 0–10000", "поза межами 0–10000");
  }
  if (message.startsWith("royalty ") && message.includes("above 50%")) {
    return message.replace("royalty ", "роялті ").replace(" is above 50% — marketplaces may reject it", " перевищує 50% — маркетплейс може відхилити");
  }
  if (message.startsWith("creator shares sum to ")) {
    return message.replace("creator shares sum to ", "сума часток творців ").replace(", expected 100", ", очікується 100");
  }
  return message;
}

export function formatPreflightReport(result, locale = "en") {
  const uk = String(locale || "en").toLowerCase().startsWith("uk");
  const lines = [
    uk ? "Перевірка архіву перед публікацією" : "Archive preflight",
    "================================",
    result.ready
      ? (uk ? "СТАТУС: готовий (ready). Попередження не блокують завантаження." : "STATUS: ready. Warnings do not block download.")
      : (uk ? "СТАТУС: заблоковано. Виправте помилки — попередження можна лишити." : "STATUS: blocked. Fix the errors. Warnings may stay."),
    "",
  ];
  for (const c of result.checks || []) {
    const mark = c.level === "error" ? "ERROR" : c.level === "warning" ? "WARN" : "OK";
    lines.push(`[${mark}] ${c.message}`);
  }
  lines.push("");
  lines.push(uk
    ? "Архів позначається готовим лише коли немає жодної помилки. Ключі гаманця сюди не входять і не потрібні."
    : "The archive is marked ready only when there are zero errors. Wallet keys are not part of this check and are never requested.");
  return lines.join("\n");
}
