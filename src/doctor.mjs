/**
 * System Doctor & Health Diagnostics for Series Lab.
 * Verifies environment, presets, trait packs, base images, and generation engines.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, mkdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { validatePreset } from "./validate.mjs";
import { validateTraitPack } from "./traits.mjs";
import { ENGINES, TXT2IMG } from "./engines.mjs";
import { loadSharp } from "./upscale.mjs";
import { detectImageMagic } from "./imageqa.mjs";
import { testEngineConnection } from "./connectors.mjs";

export async function runDoctorDiagnostics({ rootDir = process.cwd(), env = process.env } = {}) {
  const report = {
    ok: true,
    timestamp: new Date().toISOString(),
    system: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      nodeOk: Number(process.versions.node.split(".")[0]) >= 20,
    },
    directories: {},
    presets: { total: 0, valid: 0, errors: [] },
    traitPacks: { total: 0, valid: 0, errors: [] },
    baseImage: { exists: false, file: null, valid: false },
    sharp: { installed: false },
    engines: [],
  };

  if (!report.system.nodeOk) report.ok = false;

  // 1. Directories
  const requiredDirs = ["input", "out", "presets", "libraries/traits", "templates", "workspace"];
  for (const dir of requiredDirs) {
    const full = resolve(rootDir, dir);
    const exists = existsSync(full);
    report.directories[dir] = exists;
    if (!exists) {
      try {
        mkdirSync(full, { recursive: true });
        report.directories[dir] = true;
      } catch {
        report.ok = false;
      }
    }
  }

  // 2. Validate all presets
  const presetsDir = resolve(rootDir, "presets");
  if (existsSync(presetsDir)) {
    const files = readdirSync(presetsDir).filter((f) => f.endsWith(".json"));
    report.presets.total = files.length;
    for (const f of files) {
      try {
        const json = JSON.parse(readFileSync(join(presetsDir, f), "utf8"));
        const val = validatePreset(json);
        if (val.ok) {
          report.presets.valid++;
        } else {
          report.presets.errors.push(`${f}: ${val.errors.join(", ")}`);
          report.ok = false;
        }
      } catch (err) {
        report.presets.errors.push(`${f}: ${err.message}`);
        report.ok = false;
      }
    }
  }

  // 3. Validate all trait packs
  const traitsDir = resolve(rootDir, "libraries/traits");
  if (existsSync(traitsDir)) {
    const files = readdirSync(traitsDir).filter((f) => f.endsWith(".json"));
    report.traitPacks.total = files.length;
    for (const f of files) {
      try {
        const json = JSON.parse(readFileSync(join(traitsDir, f), "utf8"));
        const val = validateTraitPack(json);
        if (val.ok) {
          report.traitPacks.valid++;
        } else {
          report.traitPacks.errors.push(`${f}: ${val.errors.join(", ")}`);
          report.ok = false;
        }
      } catch (err) {
        report.traitPacks.errors.push(`${f}: ${err.message}`);
        report.ok = false;
      }
    }
  }

  // 4. Base image check
  const inputDir = resolve(rootDir, "input");
  if (existsSync(inputDir)) {
    const files = readdirSync(inputDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
    if (files.length > 0) {
      const primary = files.find((f) => f.startsWith("primary")) || files[0];
      const buf = readFileSync(join(inputDir, primary));
      const magic = detectImageMagic(buf);
      report.baseImage = {
        exists: true,
        file: primary,
        sizeBytes: buf.length,
        format: magic,
        valid: Boolean(magic),
      };
    }
  }

  // 5. Sharp library check
  const sharpMod = await loadSharp();
  report.sharp.installed = Boolean(sharpMod);

  // 6. Engines evaluation
  const engineNames = ["mock", "fal", "comfyui", "a1111", "replicate", "openai", "stability"];
  for (const name of engineNames) {
    const diag = await testEngineConnection(name, env, globalThis.fetch);
    report.engines.push(diag);
  }

  return report;
}

export function formatDoctorReport(report) {
  const lines = [];
  lines.push("╔════════════════════════════════════════════════════════════╗");
  lines.push("║             SERIES LAB SYSTEM DOCTOR & HEALTH              ║");
  lines.push("╚════════════════════════════════════════════════════════════╝\n");

  const check = (val) => (val ? "✓ OK" : "✗ FAIL");

  // System
  lines.push(`• Node.js: ${report.system.node} (${check(report.system.nodeOk)}) [Platform: ${report.system.platform} ${report.system.arch}]`);

  // Directories
  const dirPassed = Object.values(report.directories).every(Boolean);
  lines.push(`• Directories: ${check(dirPassed)} (${Object.keys(report.directories).length} verified)`);

  // Presets
  const presetsOk = report.presets.total > 0 && report.presets.errors.length === 0;
  lines.push(`• Presets: ${check(presetsOk)} (${report.presets.valid}/${report.presets.total} valid)`);
  if (report.presets.errors.length) {
    report.presets.errors.forEach((e) => lines.push(`    [ERROR] ${e}`));
  }

  // Trait packs
  const traitsOk = report.traitPacks.total > 0 && report.traitPacks.errors.length === 0;
  lines.push(`• Trait Packs: ${check(traitsOk)} (${report.traitPacks.valid}/${report.traitPacks.total} valid)`);
  if (report.traitPacks.errors.length) {
    report.traitPacks.errors.forEach((e) => lines.push(`    [ERROR] ${e}`));
  }

  // Base Image
  if (report.baseImage.exists) {
    lines.push(`• Base Image: ✓ OK (File: ${report.baseImage.file}, Format: ${report.baseImage.format}, Size: ${Math.round(report.baseImage.sizeBytes / 1024)} KB)`);
  } else {
    lines.push("• Base Image: ℹ No primary.png in input/ (Optional: generate or place reference image)");
  }

  // Sharp (Upscaler)
  if (report.sharp.installed) {
    lines.push("• Sharp Upscaler: ✓ Installed (Hardware-accelerated 2x/4x upscale enabled)");
  } else {
    lines.push("• Sharp Upscaler: ℹ Optional (Install via 'npm i sharp' for 2x upscaling in ZIP bundles)");
  }

  // Engines
  lines.push("\n--- Generation Engines Status ---");
  for (const eng of report.engines) {
    const badge = eng.online ? "✓ READY" : "— OFFLINE";
    const ping = eng.pingMs ? ` (${eng.pingMs}ms)` : "";
    const local = eng.local ? " [LOCAL $0]" : "";
    lines.push(`  • ${eng.engine.toUpperCase().padEnd(10)} | ${badge.padEnd(11)}${ping}${local} | ${eng.message}`);
  }

  if (report.release) {
    const rel = report.release;
    lines.push("\n--- Release on this PC ---");
    lines.push(`• Node.js for release: ${rel.node} (${rel.nodeOk ? "✓ OK" : "✗ need >= 22.13"})`);
    lines.push(`• mplx: ${rel.mplx.found ? "✓ on PATH" : "✗ not found — install the Metaplex CLI before creating a Candy Machine"}`);
    if (rel.keypair.checked) {
      lines.push(`• Keypair file (${rel.keypair.path}): ${rel.keypair.exists ? "✓ exists" : "✗ missing"} — contents were not read`);
    } else {
      lines.push("• Keypair file: not checked (pass --keypair <file>; the file is never opened)");
    }
    if (rel.cache.checked) {
      lines.push(`• cache.json (${rel.cache.path}): ${rel.cache.exists ? "✓ exists" : "✗ missing"}`);
    } else {
      lines.push("• cache.json: not checked (pass --cache <file> after an upload, to see that a resume point exists)");
    }
    lines.push(`Release ready: ${rel.ready ? "✓ YES" : "✗ NO"}`);
  }

  lines.push(`\nOverall Health: ${report.ok ? "✓ ALL CORE SYSTEMS OPERATIONAL" : "⚠ ISSUES DETECTED"}`);
  return lines.join("\n");
}

/** Node required to release (`package.json` engines). Studio health stays at the older floor. */
export function nodeMeetsRelease(version = process.versions.node) {
  const [maj, min] = String(version).replace(/^v/, "").split(".").map((n) => Number(n) || 0);
  if (maj > 22) return true;
  if (maj < 22) return false;
  return min >= 13;
}

/**
 * Is `name` on PATH? `runner` is injectable so tests do not depend on a real mplx install.
 * The runner is `spawnSync(finder, [name], …)`.
 */
export function commandOnPath(name, { env = process.env, runner = spawnSync, platform = process.platform } = {}) {
  const finder = platform === "win32" ? "where" : "which";
  let found = false;
  try {
    const result = runner(finder, [name], { env, encoding: "utf8", timeout: 4000, windowsHide: true });
    found = result?.status === 0 && Boolean(String(result.stdout || "").trim());
  } catch {
    found = false;
  }
  return { name, found };
}

/**
 * Whether a keypair path exists. The file is never opened: a release check must not load a secret into the process.
 */
export function keypairFileStatus(filePath) {
  if (!filePath) return { checked: false, exists: false, read: false, path: "" };
  const path = resolve(filePath);
  let exists = false;
  let bytes = null;
  try {
    exists = existsSync(path);
    if (exists) bytes = statSync(path).size;
  } catch {
    exists = false;
  }
  return { checked: true, exists, bytes, read: false, path };
}

export function cacheFileStatus(filePath) {
  if (!filePath) return { checked: false, exists: false, path: "" };
  const path = resolve(filePath);
  return { checked: true, exists: existsSync(path), path };
}

/**
 * Checks for the author's PC before `series upload` / `mplx`. Does not change studio `report.ok`.
 * A missing optional path is simply not checked. A given path that is absent makes `ready` false.
 */
export function checkReleaseReadiness({
  keypair = "",
  cache = "",
  env = process.env,
  runner,
  platform,
  nodeVersion = process.versions.node,
} = {}) {
  const nodeOk = nodeMeetsRelease(nodeVersion);
  const mplx = commandOnPath("mplx", { env, runner, platform });
  const key = keypairFileStatus(keypair);
  const cacheStatus = cacheFileStatus(cache);
  const keyOk = !key.checked || key.exists;
  const cacheOk = !cacheStatus.checked || cacheStatus.exists;
  return {
    node: String(nodeVersion),
    nodeOk,
    mplx,
    keypair: key,
    cache: cacheStatus,
    ready: Boolean(nodeOk && mplx.found && keyOk && cacheOk),
  };
}
