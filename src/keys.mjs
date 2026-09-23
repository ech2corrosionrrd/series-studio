/**
 * Завантаження API-ключів із .env сусіднього проєкту W3IR. Ключі не
 * копіюються в цей проєкт: лише читаються в пам'ять процесу.
 *
 * Власний парсер замість `node --env-file`: у Node 20 апостроф у коментарі
 * (`# … обов'язкові`) відкриває «лапки» і ковтає наступний рядок — саме так
 * губився OPENAI_API_KEY з C:\Промт\.env.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const DEFAULT_KEYS_FILE = "C:\\Промт\\.env";

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

/** Додає ключі у process.env, не перекриваючи вже задані. Повертає шлях або null. */
export function loadKeys(path = process.env.SERIES_KEYS_FILE || DEFAULT_KEYS_FILE, env = process.env) {
  const localEnv = resolve(process.cwd(), ".env");
  const candidates = [path, env.SERIES_KEYS_FILE, localEnv, DEFAULT_KEYS_FILE].filter(Boolean);
  const loaded = [];
  for (const cand of [...new Set(candidates)]) {
    if (!existsSync(cand)) continue;
    for (const [k, v] of Object.entries(parseEnv(readFileSync(cand, "utf8")))) {
      if (env[k] === undefined) env[k] = v;
    }
    loaded.push(cand);
  }
  return loaded[0] || null;
}

/** Load additional env files (e.g. package-local .env) without overriding existing keys. */
export function loadKeysExtra(paths, env = process.env) {
  const loaded = [];
  for (const cand of paths || []) {
    if (!cand || !existsSync(cand)) continue;
    for (const [k, v] of Object.entries(parseEnv(readFileSync(cand, "utf8")))) {
      if (env[k] === undefined) env[k] = v;
    }
    loaded.push(cand);
  }
  return loaded;
}

export function keyPresence(names, env = process.env) {
  return names.map((name) => ({
    name,
    present: Boolean(env[name] && String(env[name]).trim()),
  }));
}
