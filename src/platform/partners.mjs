/**
 * Partner API logic: Gremlin Passport avatars, Telegram Mini-App packs, B2B keys,
 * launchpad bundle inspection. Ports of Промт `services/gremlin_generate.py`,
 * `routers/tma.py`, `services/b2b_service.py`, `services/launchpad_service.py`.
 * Pure where possible; HTTP wiring lives in server/platform.mjs.
 */
import { randomBytes } from "node:crypto";
import JSZip from "jszip";
import { nowIso, openDb } from "./db.mjs";
import { ENGINE_FLUX, ENGINE_GPT_IMAGE, ENGINE_STABILITY, ENGINES } from "./imagegen.mjs";

// ── Gremlin Passport ─────────────────────────────────────────────────────────
export const TRAIT_OPTIONS = {
  body: ["void", "ember", "moss", "signal"],
  eyes: ["glow", "slit", "wide", "pixel"],
  accessory: ["none", "antenna", "hoodie", "crown"],
  backdrop: ["nebula", "grid", "forest", "studio"],
};
const BODY = {
  void: "deep void-black skin with faint purple sheen",
  ember: "glowing ember-orange skin with warm cracks of light",
  moss: "mossy green skin with mottled texture",
  signal: "electric cyan skin with neon signal glow",
};
const EYES = { glow: "big glowing luminous eyes", slit: "sharp reptilian slit-pupil eyes", wide: "wide round curious eyes", pixel: "blocky pixelated 8-bit eyes" };
const ACCESSORY = { none: "", antenna: "a small antenna on its head", hoodie: "wearing a cozy hoodie", crown: "wearing a tiny golden crown" };
const BACKDROP = { nebula: "cosmic nebula background", grid: "glowing cyberpunk grid background", forest: "dark enchanted forest background", studio: "clean neutral studio background" };
export const MAX_SEED = 1_000_000;

export class TraitError extends Error {}

export function validateTraits(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new TraitError("traits must be an object");
  const out = {};
  for (const [key, allowed] of Object.entries(TRAIT_OPTIONS)) {
    const v = payload[key];
    if (typeof v !== "string" || !allowed.includes(v)) throw new TraitError(`invalid trait: ${key}`);
    out[key] = v;
  }
  return out;
}

export function validateSeed(seed) {
  if (typeof seed !== "number" || !Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) throw new TraitError("invalid seed");
  return seed;
}

export function buildGremlinPrompt(t) {
  const parts = ["a portrait of a cute mischievous gremlin creature", BODY[t.body], EYES[t.eyes]];
  if (ACCESSORY[t.accessory]) parts.push(ACCESSORY[t.accessory]);
  parts.push(BACKDROP[t.backdrop], "digital art, character design, centered, highly detailed");
  return parts.join(", ");
}

// ── Telegram Mini-App ────────────────────────────────────────────────────────
export const STYLE_PRESETS = {
  sticker: "die-cut vinyl sticker design, bold clean white outline, vibrant flat colors, isolated on solid white background",
  anime_chibi: "cute 3D chibi figurine style, soft studio lighting, big expressive eyes, premium toy render",
  gremlin: "gremlin lore style, mischievous cute gremlin creature, vibrant green and purple accents, expressive oversized ears and glowing eyes, detailed digital art sticker",
  cyberpunk: "cyberpunk style, glowing neon lights, futuristic high-tech details, vivid colors, 8k render",
  pixel_art: "pixel art 16-bit retro arcade aesthetic, clean sharp pixel lines, colorful game sprite",
  vector_clean: "flat 2D vector art, bold clean outlines, vibrant solid colors, modern mascot design, isolated on white background",
  comic_pop: "vintage comic book pop art style, bold dynamic ink outlines, classic halftone dots, expressive Marvel DC aesthetic",
  clay_plasticine: "charming handmade clay plasticine claymation style, soft tactile rounded forms, cute stop-motion figurine, warm studio light",
  mecha_robot: "futuristic mecha robot armor, glowing energetic panels, intricate mechanical joints, sci-fi battle anime aesthetic",
  retro_anime: "retro 90s vintage anime cel animation style, nostalgic grain, vibrant aesthetic, Studio Ghibli inspired details",
  dark_fantasy: "dark fantasy epic concept art, intricate magical details, dramatic atmosphere, cinematic lighting",
  synthwave: "retro 80s synthwave vaporwave aesthetic, chrome reflections, neon grid, sunset magenta glow",
  watercolor: "delicate watercolor and ink illustration, artistic paint splashes, gentle soft textured colors",
  funko_pop: "vinyl toy collectible figurine style, oversized cute square head, shiny glossy plastic texture, isolated white background",
  street_graffiti: "bold street art graffiti spray paint style, dynamic stencil splatters, edgy urban hip-hop character, vivid neon drips",
  holographic: "iridescent holographic prism aesthetic, shimmering rainbow foil reflections, futuristic translucent crystal glow",
};
export const TMA_ENGINE_ALIASES = { flux: ENGINE_FLUX, stability: ENGINE_STABILITY, "gpt-image-1": ENGINE_GPT_IMAGE };

export function resolveTmaEngine(raw) {
  const key = String(raw ?? "").trim();
  const alias = TMA_ENGINE_ALIASES[key.toLowerCase()];
  if (alias) return alias;
  if (ENGINES.includes(key)) return key;
  throw new Error(`Unknown engine: ${JSON.stringify(raw)}`);
}

export function resolveTmaStyle(raw) {
  const key = String(raw ?? "").trim().toLowerCase();
  if (key in STYLE_PRESETS) return key;
  throw new Error(`Unknown style: ${JSON.stringify(raw)}`);
}

export function enhanceTmaPrompt(userPrompt, styleKey) {
  const suffix = STYLE_PRESETS[styleKey.toLowerCase().trim()];
  const cleaned = String(userPrompt || "").trim();
  return cleaned ? `${cleaned}, ${suffix}` : suffix;
}

/** Validates the TMA request body like the pydantic model. → normalized body or throws {status:422}. */
export function parseTmaBody(body) {
  const b = body && typeof body === "object" ? body : {};
  const fail = (msg) => { throw Object.assign(new Error(msg), { status: 422 }); };
  if (typeof b.prompt !== "string" || b.prompt.length < 1 || b.prompt.length > 1000) fail("prompt: 1..1000 characters required");
  const count = b.count ?? 4;
  if (!Number.isInteger(count) || count < 1 || count > 4) fail("count: integer 1..4");
  const strength = b.strength ?? 0.85;
  if (strength !== null && (typeof strength !== "number" || strength < 0.1 || strength > 0.95)) fail("strength: 0.1..0.95");
  return {
    prompt: b.prompt,
    style: b.style ?? "sticker",
    count,
    engine: b.engine ?? "flux",
    reference_image: b.reference_image ?? null,
    strength,
  };
}

/** data URI or bare base64 → {bytes, mime, strength}; sniffs the real type. */
export function decodeReferenceImage(raw, strength) {
  let b64 = String(raw || "").trim();
  if (!b64) throw new Error("Empty reference_image");
  let mime = "image/png";
  if (b64.startsWith("data:")) {
    const i = b64.indexOf(",");
    const prefix = i >= 0 ? b64.slice(0, i) : b64;
    b64 = i >= 0 ? b64.slice(i + 1).trim() : "";
    if (/image\/jpe?g/.test(prefix)) mime = "image/jpeg";
    else if (prefix.includes("image/webp")) mime = "image/webp";
    if (!b64) throw new Error("Empty reference_image");
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4 !== 0) throw new Error("Invalid reference_image encoding");
  const bytes = Buffer.from(b64, "base64");
  if (!bytes.length) throw new Error("Empty reference_image");
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) mime = "image/jpeg";
  else if (bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(0, 12).includes(Buffer.from("WEBP"))) mime = "image/webp";
  else if (bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) mime = "image/png";
  return { bytes, mime, strength: strength ?? 0.85 };
}

// ── B2B keys (table b2b_keys in users.db) ────────────────────────────────────
export const STAGING_KEY = "b2b_test_key_w3ir_2026";
const isProduction = () => ["production", "prod"].includes(String(process.env.APP_ENV || process.env.ENVIRONMENT || "").trim().toLowerCase());

function b2bDb() {
  const db = openDb();
  if (!isProduction()) {
    db.prepare("INSERT OR IGNORE INTO b2b_keys (api_key, client_name, quota, used, active, created_at) VALUES (?, ?, ?, 0, 1, ?)").run(STAGING_KEY, "Staging Partner DAO", 1000, nowIso());
  }
  return db;
}

export function verifyB2bKey(apiKey) {
  if (!apiKey) return null;
  const envKeys = String(process.env.W3IR_B2B_KEYS || "").split(",");
  if (apiKey.trim() && envKeys.includes(apiKey)) return { client_name: "Partner Client", quota: 999999, used: 0, active: true };
  const row = b2bDb().prepare("SELECT client_name, quota, used, active FROM b2b_keys WHERE api_key = ?").get(apiKey);
  if (!row) return null;
  const client = { client_name: row.client_name, quota: Number(row.quota), used: Number(row.used), active: !!row.active };
  return client.active && client.used < client.quota ? client : null;
}

export function recordB2bUsage(apiKey, count = 1) {
  if (!apiKey || count <= 0) return false;
  return b2bDb().prepare("UPDATE b2b_keys SET used = used + ? WHERE api_key = ? AND active = 1 AND used + ? <= quota").run(count, apiKey, count).changes > 0;
}

export function generateB2bKey(clientName, quota = 500) {
  const key = `w3ir_b2b_${randomBytes(12).toString("hex")}`;
  b2bDb().prepare("INSERT INTO b2b_keys (api_key, client_name, quota, used, active, created_at) VALUES (?, ?, ?, 0, 1, ?)").run(key, clientName, Math.trunc(quota), nowIso());
  return key;
}

// ── Launchpad bundle inspection ──────────────────────────────────────────────
const MAX_JSON_MEMBER_BYTES = 2 * 1024 * 1024;

async function readJsonMember(zip, name) {
  try {
    const f = zip.file(name);
    const size = f?._data?.uncompressedSize;
    if (!f || (Number.isFinite(size) && size > MAX_JSON_MEMBER_BYTES)) return null;
    const buf = await f.async("nodebuffer");
    if (buf.length > MAX_JSON_MEMBER_BYTES) return null;
    const data = JSON.parse(buf.toString("utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

export async function inspectBundleZip(bytes) {
  if (!bytes?.length) return { valid: false, error: "Empty ZIP file" };
  let zip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (e) {
    return { valid: false, error: `Invalid ZIP file format: ${e.message}` };
  }
  const names = Object.keys(zip.files);
  for (const n of names) {
    if (n.startsWith("/") || n.includes("..") || n.includes("\\")) return { valid: false, error: `Security violation: dangerous path in zip: ${n}` };
  }
  const hasManifest = names.some((n) => n.endsWith("manifest.json"));
  const hasConfig = names.some((n) => n.endsWith("config.json"));
  let assets = names.filter((n) => n.includes("assets/") && !n.endsWith("/")).length;
  let name = "Custom Collection";
  let symbol = "NFT";
  let description = "";
  const mName = names.find((n) => n.endsWith("manifest.json"));
  const m = mName && (await readJsonMember(zip, mName));
  if (m) {
    name = m.name || m.collection_name || name;
    symbol = m.symbol || symbol;
    description = m.description || description;
  }
  const cName = names.find((n) => n.endsWith("config.json"));
  const c = cName && (await readJsonMember(zip, cName));
  if (c) {
    if ("number" in c) assets = c.number;
    if ("symbol" in c) symbol = c.symbol;
  }
  const sugarReady = hasConfig && assets > 0;
  return {
    valid: true,
    collection_name: name,
    symbol,
    description,
    items_count: assets,
    sugar_ready: sugarReady,
    has_manifest: hasManifest,
    has_config: hasConfig,
    total_files: names.length,
    message: sugarReady ? "Bundle valid and ready for launch." : "Bundle inspected.",
  };
}
