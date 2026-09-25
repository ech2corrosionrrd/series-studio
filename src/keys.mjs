/**
 * Load API keys from .env into process memory. Keys are not copied into this
 * project — only read into process.env.
 *
 * Custom parser instead of `node --env-file`: in Node 20 an apostrophe inside a
 * comment (`# … обов'язкові`) opens "quotes" and swallows the next line — that
 * is how OPENAI_API_KEY was lost from some .env files.
 *
 * Resolution order for loadKeys:
 *   1) explicit path argument (if provided)
 *   2) process.env.SERIES_KEYS_FILE (before reading project .env)
 *   3) .env in process.cwd()
 *   4) SERIES_DEFAULT_KEYS_FILE / SERIES_KEYS_FILE discovered from files already loaded
 *
 * Series Lab is self-contained: all keys, Helio paylinks, Telegram, AUTH_* live
 * in this project's .env. SERIES_PLATFORM_ENV is ignored (deprecated).
 * Never hardcode a machine-specific absolute path in source.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function parseEnv(text) {
  const out = {};
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    const q = value[0];
    if ((q === '"' || q === "'") && value.endsWith(q) && value.length >= 2) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");
    out[m[1]] = value;
  }
  return out;
}

function mergeFile(cand, env, loaded) {
  if (!cand || !existsSync(cand) || loaded.includes(cand)) return false;
  for (const [k, v] of Object.entries(parseEnv(readFileSync(cand, "utf8")))) {
    if (env[k] === undefined) env[k] = v;
  }
  loaded.push(cand);
  return true;
}

/** Merge keys into env without overriding existing values. Returns first loaded path or null. */
export function loadKeys(path, env = process.env) {
  const loaded = [];
  const firstPass = [];
  if (path) firstPass.push(path);
  if (env.SERIES_KEYS_FILE) firstPass.push(env.SERIES_KEYS_FILE);
  firstPass.push(resolve(process.cwd(), ".env"));
  if (env.SERIES_DEFAULT_KEYS_FILE) firstPass.push(env.SERIES_DEFAULT_KEYS_FILE);

  for (const cand of [...new Set(firstPass.filter(Boolean))]) {
    mergeFile(cand, env, loaded);
  }

  // Optional extra Lab key files only (never SERIES_PLATFORM_ENV / foreign projects).
  let grew = true;
  while (grew) {
    grew = false;
    for (const key of ["SERIES_KEYS_FILE", "SERIES_DEFAULT_KEYS_FILE"]) {
      if (mergeFile(env[key], env, loaded)) grew = true;
    }
  }

  if (env.SERIES_PLATFORM_ENV && !env.SERIES_PLATFORM_ENV_SILENCE) {
    console.warn(
      "[series-lab] SERIES_PLATFORM_ENV is ignored — put Helio/API/Telegram keys in this project's .env (self-contained).",
    );
  }

  return loaded[0] || null;
}

/** Load additional env files (e.g. package-local .env) without overriding existing keys. */
export function loadKeysExtra(paths, env = process.env) {
  const loaded = [];
  for (const cand of paths || []) {
    mergeFile(cand, env, loaded);
  }
  return loaded;
}

export function keyPresence(names, env = process.env) {
  return names.map((name) => ({
    name,
    present: Boolean(env[name] && String(env[name]).trim()),
  }));
}
