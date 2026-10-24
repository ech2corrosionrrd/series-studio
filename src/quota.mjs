/**
 * Limits that keep one wallet from filling the shared disk or sending the engines a giant job.
 *
 * Disk: everything under the wallet folder counts (base images, layers, frame sets, bundles, trash).
 *   WALLET_DISK_QUOTA_MB   default 2048; 0 turns the disk limit off
 * Preset size (the collection a preset describes):
 *   PRESET_MAX_SIZE        NFTs in one series, default 10000; 0 = off
 *   PRESET_MAX_TRAITS      traits per preset, default 40; 0 = off
 *   PRESET_MAX_OPTIONS     options per trait, default 200; 0 = off
 *   PRESET_MAX_BYTES       the preset JSON itself, default 1048576; 0 = off
 *
 * The folder size is walked once and cached for a few seconds; writes that happen in between are added with noteWrite(),
 * so a batch of frames sees its own growth without walking the disk again for every frame.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const QUOTA_DEFAULTS = Object.freeze({
  diskMb: 2048,
  presetSize: 10_000,
  presetTraits: 40,
  presetOptions: 200,
  presetBytes: 1024 * 1024,
});

const intEnv = (v, def) => {
  const n = Number.parseInt(String(v ?? "").trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : def;
};

export function quotaConfig(env = process.env) {
  return {
    diskMb: intEnv(env.WALLET_DISK_QUOTA_MB, QUOTA_DEFAULTS.diskMb),
    presetSize: intEnv(env.PRESET_MAX_SIZE, QUOTA_DEFAULTS.presetSize),
    presetTraits: intEnv(env.PRESET_MAX_TRAITS, QUOTA_DEFAULTS.presetTraits),
    presetOptions: intEnv(env.PRESET_MAX_OPTIONS, QUOTA_DEFAULTS.presetOptions),
    presetBytes: intEnv(env.PRESET_MAX_BYTES, QUOTA_DEFAULTS.presetBytes),
  };
}

/** Bytes of all regular files below `dir` (symlinks are not followed). */
export function walkBytes(dir) {
  let total = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) total += walkBytes(p);
    else if (e.isFile()) {
      try {
        total += statSync(p).size;
      } catch {
        /* the file went away while walking */
      }
    }
  }
  return total;
}

const cache = new Map(); // root → { at, bytes }
const TTL_MS = 15_000;

export function usedBytes(root, { now = Date.now(), ttlMs = TTL_MS } = {}) {
  const hit = cache.get(root);
  if (hit && now - hit.at < ttlMs) return hit.bytes;
  const bytes = walkBytes(root);
  cache.set(root, { at: now, bytes });
  return bytes;
}

/** Tell the cache about a write that just happened (so the next check sees it without a new walk). */
export function noteWrite(root, bytes) {
  const hit = cache.get(root);
  if (hit && Number.isFinite(bytes) && bytes > 0) hit.bytes += bytes;
}

export const forgetUsage = (root) => (root ? cache.delete(root) : cache.clear());

/**
 * @returns {{ ok: boolean, used: number, limit: number }} limit 0 = no limit. `extra` is what is about to be written.
 */
export function diskStatus(root, extra = 0, cfg = quotaConfig()) {
  const limit = cfg.diskMb * 1024 * 1024;
  const used = usedBytes(root);
  return { ok: !limit || used + Math.max(0, extra) <= limit, used, limit };
}

const mb = (n) => Math.round((n / (1024 * 1024)) * 10) / 10;

export const diskMessage = (s) =>
  `Disk quota reached: ${mb(s.used)} of ${mb(s.limit)} MB used. Delete old frame sets or projects (or empty the trash), then try again.`;

/** Human-readable problems with a preset's size; an empty list means it is within the limits. */
export function presetLimitIssues(preset, cfg = quotaConfig()) {
  const issues = [];
  if (!preset || typeof preset !== "object") return issues;
  if (cfg.presetSize && Number(preset.size) > cfg.presetSize) {
    issues.push(`size ${preset.size} is above the limit of ${cfg.presetSize} NFTs per series`);
  }
  const items = Array.isArray(preset.traits?.items) ? preset.traits.items : [];
  if (cfg.presetTraits && items.length > cfg.presetTraits) {
    issues.push(`${items.length} traits is above the limit of ${cfg.presetTraits}`);
  }
  if (cfg.presetOptions) {
    for (const t of items) {
      const n = Array.isArray(t?.options) ? t.options.length : 0;
      if (n > cfg.presetOptions) issues.push(`trait ${t?.key ?? "?"} has ${n} options, the limit is ${cfg.presetOptions}`);
    }
  }
  if (cfg.presetBytes) {
    let bytes = 0;
    try {
      bytes = Buffer.byteLength(JSON.stringify(preset));
    } catch {
      /* not serializable: schema validation reports it */
    }
    if (bytes > cfg.presetBytes) issues.push(`the preset is ${bytes} bytes, the limit is ${cfg.presetBytes}`);
  }
  return issues;
}
