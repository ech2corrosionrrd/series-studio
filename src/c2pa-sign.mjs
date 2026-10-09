/**
 * Крок 2 плану docs/C2PA.md: C2PA-підпис кадрів набору на ПК користувача.
 *
 * `series c2pa <тека-набору> --cert <ланцюжок.pem> --key <ключ.pem>` копіює набір у нову теку
 * й підписує в копії кожен `N.png` маніфестом C2PA («створено» + тип джерела
 * trainedAlgorithmicMedia). Ключ читається з файлу на ПК і нікуди не передається; на сервері
 * цього коду немає. Бібліотеку `@contentauth/c2pa-node` (нативний бінарник, ~150 залежностей)
 * ставить сам користувач і не додано в package.json; тут її передають параметром, щоб код
 * можна було тестувати без неї.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { AI_SOURCE_TYPE } from "./ai-mark.mjs";

export const C2PA_ALGS = ["es256", "es384", "es512", "ps256", "ps384", "ps512", "ed25519"];
export const C2PA_INSTALL_HINT =
  "Install the signing library on this PC (it is not part of Series Lab): npm install --no-save @contentauth/c2pa-node";

/** Завантажує бібліотеку підпису; зрозуміла помилка, якщо її не встановлено. */
export async function loadC2pa() {
  try {
    return await import("@contentauth/c2pa-node");
  } catch (e) {
    const err = new Error(`@contentauth/c2pa-node is not installed. ${C2PA_INSTALL_HINT}`);
    err.code = "c2pa_missing";
    err.cause = e;
    throw err;
  }
}

/** Кадри набору: `N.png` у корені теки, за номером. */
export function listSetPngs(dir) {
  return readdirSync(dir)
    .filter((f) => /^\d+\.png$/i.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
}

const UNTRUSTED = "signingCredential.untrusted";

/** Розбирає звіт читача: чи є активний маніфест і які коди перевірки, крім «не з довіреного списку». */
export function summarizeReader(json) {
  const active = json?.active_manifest;
  const manifest = active ? json?.manifests?.[active] : null;
  const status = Array.isArray(json?.validation_status) ? json.validation_status : [];
  const codes = status.map((s) => s.code).filter(Boolean);
  return {
    hasManifest: Boolean(manifest),
    untrusted: codes.includes(UNTRUSTED),
    problems: codes.filter((c) => c !== UNTRUSTED),
    signer: manifest?.signature_info?.common_name || null,
    issuer: manifest?.signature_info?.issuer || null,
    alg: manifest?.signature_info?.alg || null,
  };
}

/**
 * Підписує кадри. Повертає звіт; пише `c2pa-report.json` у вихідну теку.
 * `c2pa` — модуль бібліотеки ({ Builder, LocalSigner, Reader }).
 */
export async function signSet({ setDir, outDir, certPath, keyPath, alg = "es256", tsaUrl = "", version = "", c2pa, dryRun = false }) {
  const src = resolve(setDir);
  const dst = resolve(outDir);
  if (!existsSync(src) || !statSync(src).isDirectory()) throw new Error(`Set folder not found: ${src}`);
  if (!C2PA_ALGS.includes(alg)) throw new Error(`Unknown algorithm "${alg}". Use one of: ${C2PA_ALGS.join(", ")}`);
  const files = listSetPngs(src);
  if (!files.length) throw new Error(`No N.png frames in ${src}`);
  if (dryRun) return { dryRun: true, files, outDir: dst };
  if (!certPath || !keyPath) throw new Error("--cert and --key are required (certificate chain PEM and private key PEM)");
  if (existsSync(dst) && readdirSync(dst).length) throw new Error(`Output folder is not empty: ${dst} (pick another with -o)`);
  if (!c2pa) throw new Error("c2pa library not provided");

  const cert = readFileSync(resolve(certPath));
  const key = readFileSync(resolve(keyPath));
  const signer = c2pa.LocalSigner.newSigner(cert, key, alg, tsaUrl || undefined);

  mkdirSync(dst, { recursive: true });
  cpSync(src, dst, { recursive: true });

  const signed = [];
  const failed = [];
  const info = { signer: null, issuer: null, alg: null };
  let untrusted = false;
  for (const f of files) {
    const target = join(dst, f);
    const tmp = `${target}.c2pa-tmp`;
    try {
      const builder = await c2pa.Builder.withJsonAsync({
        claim_generator_info: [{ name: "Series Lab", ...(version ? { version } : {}) }],
        title: f,
      });
      builder.setIntent({ create: AI_SOURCE_TYPE });
      builder.sign(signer, { buffer: readFileSync(target), mimeType: "image/png" }, { path: tmp });
      renameSync(tmp, target);
      const reader = await c2pa.Reader.fromAsset({ path: target, mimeType: "image/png" });
      const s = summarizeReader(reader.json());
      if (!s.hasManifest || s.problems.length) throw new Error(s.hasManifest ? `validation: ${s.problems.join(", ")}` : "no manifest after signing");
      untrusted ||= s.untrusted;
      info.signer ||= s.signer;
      info.issuer ||= s.issuer;
      info.alg ||= s.alg;
      signed.push(f);
    } catch (e) {
      rmSync(tmp, { force: true });
      failed.push({ file: f, error: String(e?.message || e).slice(0, 300) });
    }
  }

  const report = {
    schema: "series-c2pa-report/v1",
    digitalSourceType: AI_SOURCE_TYPE,
    signedAt: new Date().toISOString(),
    signed: signed.length,
    failed: failed.length,
    signer: info.signer,
    issuer: info.issuer,
    alg: info.alg,
    trust: untrusted ? "untrusted" : "unknown",
    note: untrusted
      ? "The signature is valid but the certificate is not on the C2PA trust list, so validators show it as untrusted (docs/C2PA.md, option B)."
      : "Trust was not evaluated against the C2PA trust list (docs/C2PA.md).",
    files: signed,
    errors: failed,
  };
  writeFileSync(join(dst, "c2pa-report.json"), JSON.stringify(report, null, 2) + "\n");
  return { ...report, outDir: dst };
}
