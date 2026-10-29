/**
 * Validate series-preset/v0 and series-archive/v0 against JSON Schema (Ajv).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DIR = join(__dirname, "..", "schemas");

function loadSchema(name) {
  const raw = readFileSync(join(SCHEMAS_DIR, name), "utf8");
  return JSON.parse(raw);
}

function makeAjv() {
  return new Ajv({
    allErrors: true,
    strict: false,
    validateFormats: false,
  });
}

function formatErrors(errors) {
  if (!errors?.length) return "invalid";
  return errors
    .map((e) => `${e.instancePath || "/"} ${e.message}`)
    .join("; ");
}

/**
 * @param {object} preset
 * @returns {{ ok: true } | { ok: false, errors: string }}
 */
export function validatePreset(preset) {
  const schema = loadSchema("series-preset-v0.json");
  const ajv = makeAjv();
  const validate = ajv.compile(schema);
  if (validate(preset)) return { ok: true };
  return { ok: false, errors: formatErrors(validate.errors) };
}

/**
 * @param {object} archive
 * @returns {{ ok: true } | { ok: false, errors: string }}
 */
export function validateArchive(archive) {
  const schema = loadSchema("series-archive-v0.json");
  const ajv = makeAjv();
  const validate = ajv.compile(schema);
  if (validate(archive)) return { ok: true };
  return { ok: false, errors: formatErrors(validate.errors) };
}

/** Extra semantic checks beyond JSON Schema (quotas, trait refs, uniqueness capacity). */
/** A preset id becomes a file name (presets/<id>.json, out/<id>.json): Latin letters, digits, dot, dash, underscore. */
export const PRESET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function validatePresetSemantics(preset) {
  const issues = [];
  if (typeof preset?.id === "string" && !PRESET_ID_PATTERN.test(preset.id)) {
    issues.push(`preset id "${preset.id}" must use Latin letters, digits, dot, dash or underscore, starting with a letter or digit (no spaces, no Cyrillic)`);
  }
  const items = preset?.traits?.items ?? [];
  const keys = new Set();
  for (const t of items) {
    if (keys.has(t.key)) issues.push(`duplicate trait key: ${t.key}`);
    keys.add(t.key);
    if (!t.options?.length) issues.push(`trait ${t.key} has no options`);
    const total = (t.options ?? []).reduce((s, o) => s + (o.weight ?? 0), 0);
    if (total <= 0) issues.push(`trait ${t.key} has zero total weight`);
  }

  const tpl = preset.promptTemplate ?? {};
  for (const k of [...(tpl.changeKeys ?? []), ...(tpl.extraKeys ?? [])]) {
    if (!keys.has(k)) issues.push(`promptTemplate references unknown trait: ${k}`);
  }

  if (preset.lines) {
    const quotas = Object.values(preset.lines)
      .map((l) => l?.quota)
      .filter((q) => typeof q === "number");
    if (quotas.length === Object.keys(preset.lines).length) {
      const sum = quotas.reduce((a, b) => a + b, 0);
      if (sum !== preset.size) {
        issues.push(`line quotas sum to ${sum}, size is ${preset.size}`);
      }
    }
  }

  if (issues.length) return { ok: false, errors: issues.join("; ") };
  return { ok: true };
}
