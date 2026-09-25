#!/usr/bin/env node
/**
 * Dev server + Cloudflare named tunnel for EXTERNAL testing (public mode on this PC).
 *
 *   npm run lab:tunnel                       # https://lab-dev.w3ir.space → Studio on :5345
 *   TUNNEL_ALLOWED_WALLETS=0xabc..,So1..  npm run lab:tunnel
 *
 * The overrides below live only for this run — the normal `.env` (AUTH_DOMAIN of the
 * production site, plain http on localhost) is not touched, so `npm run lab` keeps working.
 * One-time DNS step (needs ~/.cloudflared/cert.pem):
 *   cloudflared tunnel route dns w3ir-tunnel lab-dev.w3ir.space
 *
 * Env: TUNNEL_HOST · TUNNEL_NAME · TUNNEL_PORT · TUNNEL_ALLOWED_WALLETS and/or the `.tunnel-wallets`
 * file (default when both are empty: ADMIN_WALLETS from .env) · TUNNEL_SPEND_CAP_USD (default 5) ·
 * TUNNEL_WELCOME_REQUIRE_BALANCE (default 0) · CLOUDFLARED (path to the binary).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOST = process.env.TUNNEL_HOST || "lab-dev.w3ir.space";
const NAME = process.env.TUNNEL_NAME || "w3ir-tunnel";
const PORT = process.env.TUNNEL_PORT || "5345";
const SPEND_CAP = process.env.TUNNEL_SPEND_CAP_USD || "5";

function envFileValue(key) {
  try {
    const line = readFileSync(join(ROOT, ".env"), "utf8").split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim() : "";
  } catch {
    return "";
  }
}

// Invited testers: TUNNEL_ALLOWED_WALLETS and/or `.tunnel-wallets` (one per line or comma-separated, `#` comments).
function fileWallets() {
  try {
    return readFileSync(join(ROOT, ".tunnel-wallets"), "utf8").split(/\r?\n/).map((l) => l.replace(/#.*/, "")).join(",");
  } catch {
    return "";
  }
}
// An empty invite list means "everyone" — never for a server that spends real API money.
const invited = [process.env.TUNNEL_ALLOWED_WALLETS || "", fileWallets()].join(",").split(/[\s,]+/).filter(Boolean);
const wallets = [...new Set(invited.length ? invited : envFileValue("ADMIN_WALLETS").split(/[\s,]+/).filter(Boolean))].join(",");
if (!wallets) {
  console.error("Немає кого пускати: додайте гаманці в .tunnel-wallets або TUNNEL_ALLOWED_WALLETS=гаманець1,гаманець2 (або ADMIN_WALLETS у .env).");
  process.exit(1);
}

const cfPath = [process.env.CLOUDFLARED, "C:\\Cloudflare\\cloudflared.exe"].find((p) => p && existsSync(p)) || "cloudflared";
const cfDir = join(homedir(), ".cloudflared");
const baseConfig = join(cfDir, "config.yml");
if (!existsSync(baseConfig)) {
  console.error(`Немає ${baseConfig} — тунель ${NAME} не налаштований на цьому ПК.`);
  process.exit(1);
}

// Same tunnel config plus our hostname, inserted before the catch-all rule.
const lines = readFileSync(baseConfig, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/);
const catchAll = lines.findIndex((l) => /^\s*-\s*service:/.test(l));
if (catchAll < 0) {
  console.error("У config.yml не знайдено фінального правила `- service:` — не можу додати адресу.");
  process.exit(1);
}
lines.splice(catchAll, 0, `  - hostname: ${HOST}`, `    service: http://127.0.0.1:${PORT}`);
const tmpConfig = join(mkdtempSync(join(tmpdir(), "lab-tunnel-")), "config.yml");
writeFileSync(tmpConfig, lines.join("\n"));

const serverEnv = {
  ...process.env,
  HOST: "127.0.0.1",
  PORT,
  SERIES_MODE: "public",
  AUTH_DOMAIN: HOST,
  AUTH_URI: `https://${HOST}`,
  AUTH_COOKIE_INSECURE: "0", // the browser talks https to the tunnel
  SERIES_ALLOWED_HOSTS: HOST,
  SERIES_ALLOWED_WALLETS: wallets,
  SERIES_SPEND_CAP_USD: SPEND_CAP,
  SERIES_LOCAL_GPU: "0", // otherwise remote testers would use THIS PC's ComfyUI/A1111
  // Invite-only, so the "non-empty wallet" sybil guard only blocks honest testers with fresh wallets.
  WELCOME_REQUIRE_BALANCE: process.env.TUNNEL_WELCOME_REQUIRE_BALANCE ?? "0",
};

const children = [];
function stopAll(code = 0) {
  for (const c of children) if (c.exitCode === null) c.kill();
  process.exit(code);
}
process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

const server = spawn(process.execPath, ["server/index.mjs"], { cwd: ROOT, env: serverEnv, stdio: ["ignore", "pipe", "inherit"] });
children.push(server);
server.on("exit", (c) => { console.error(`Lab-сервер зупинився (код ${c}).`); stopAll(1); });
server.stdout.on("data", (d) => {
  process.stdout.write(d);
  if (String(d).includes("Series Lab Studio") && children.length === 1) startTunnel();
});

function startTunnel() {
  const cf = spawn(cfPath, ["tunnel", "--no-autoupdate", "--config", tmpConfig, "run", NAME], { stdio: ["ignore", "pipe", "pipe"] });
  children.push(cf);
  cf.on("exit", (c) => { console.error(`cloudflared зупинився (код ${c}).`); stopAll(1); });
  const onLog = (d) => {
    const s = String(d);
    if (s.includes("Registered tunnel connection") && !onLog.ready) {
      onLog.ready = true;
      console.log(`\n✔ Тунель активний: https://${HOST}/login`);
      console.log(`  Пускаємо: ${wallets.split(",").length} гаманець(ів) · ліміт витрат $${SPEND_CAP}/день · локальний GPU вимкнено`);
      console.log("  Зупинити: Ctrl+C\n");
    } else if (/\b(ERR|error)\b/i.test(s)) process.stderr.write(`[cloudflared] ${s}`);
  };
  cf.stdout.on("data", onLog);
  cf.stderr.on("data", onLog);
}
