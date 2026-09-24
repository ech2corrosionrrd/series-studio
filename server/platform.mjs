/**
 * Public platform HTTP layer — the routes Промт's FastAPI serves today, with the
 * same paths, status codes and JSON shapes ({"detail": …} errors), so Passport,
 * the Telegram Mini-App gateway, Helio and existing links keep working unchanged
 * when w3ir.io / ai. / gen. / pay. are switched to Series Lab.
 *
 * `handlePlatform(req, res, url)` returns true when it answered the request.
 */
import { existsSync, readFileSync } from "node:fs";
import { openDb } from "../src/platform/db.mjs";
import { completeWalletSignIn, getBalance, normalizeWallet, recordReferral, resolveReferrer, welcomeOffer } from "../src/platform/billing.mjs";
import { processHelioWebhookPayload, reconcilePayments, verifyHelioSignature, helioKeys } from "../src/platform/helio.mjs";
import { claimNftFulfillment } from "../src/platform/billing.mjs";
import { syncGenesisMints, walletGenesisCount } from "../src/platform/holders.mjs";
import { engineStatus, generateImage, ENGINE_FLUX } from "../src/platform/imagegen.mjs";
import { isAdmin, notifyOperator } from "../src/platform/ops.mjs";
import {
  STYLE_PRESETS, TMA_ENGINE_ALIASES, TraitError, buildGremlinPrompt, decodeReferenceImage, enhanceTmaPrompt,
  inspectBundleZip, parseTmaBody, recordB2bUsage, resolveTmaEngine, resolveTmaStyle, validateSeed, validateTraits, verifyB2bKey,
} from "../src/platform/partners.mjs";
import { rateLimit } from "../src/platform/ratelimit.mjs";
import { checkPromptSafety } from "../src/platform/safety.mjs";
import { NonceStore, SESSION_COOKIE, clearSessionCookie, issueSessionToken, readCookie, sessionCookie, SESSION_TTL_SECONDS, verifySessionToken } from "../src/platform/session.mjs";
import { collectionImagePath, mediaType, renderCollectionHtml, renderLanding, renderLegalHtml, siteFile } from "../src/platform/site.mjs";
import { walletActivity } from "../src/platform/stats.mjs";
import { VaultError, loadCatalog, reconcileFulfillments, resolveMint, runFulfillment, vaultRpcUrl, vaultTokenMints } from "../src/platform/vault.mjs";
import { buildSiweMessage, buildSolanaMessage, isEvmWallet, isSolanaWallet, newNonce, normalizeAddr, verifyEvmSignature, verifySolanaSignature } from "../src/platform/wallet.mjs";

const envInt = (k, d) => Number.parseInt(process.env[k] || "", 10) || d;
const LIMITS = {
  nonce: () => envInt("AUTH_NONCE_RATE_LIMIT", 30),
  verify: () => envInt("AUTH_VERIFY_RATE_LIMIT", 20),
  webhook: () => envInt("HELIO_WEBHOOK_RATE_LIMIT", 120),
  gremlinGenerate: () => envInt("GREMLIN_GENERATE_RATE_LIMIT", 10),
  gremlinHolder: () => envInt("GREMLIN_HOLDER_RATE_LIMIT", 60),
  launchpad: () => envInt("LAUNCHPAD_RATE_LIMIT", 30),
  vault: () => envInt("VAULT_STATUS_RATE_LIMIT", 60),
  tma: () => envInt("TMA_GENERATE_RATE_LIMIT", 120),
};
const hostSet = (key, def) => new Set(String(process.env[key] ?? def).split(",").map((h) => h.trim().toLowerCase()).filter(Boolean));
const FAVICON_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><defs><linearGradient id='t' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#6e56cf'/><stop offset='1' stop-color='#4c3a9e'/></linearGradient></defs><rect width='32' height='32' rx='7' fill='url(#t)'/><path d='M16 4 L26.4 10 L26.4 22 L16 28 L5.6 22 L5.6 10 Z' fill='none' stroke='#fff' stroke-opacity='0.92' stroke-width='1.8' stroke-linejoin='round'/><g fill='#fff'><path d='M16 9.5 L21.6 12.75 L16 16 L10.4 12.75 Z' fill-opacity='0.96'/><path d='M10.4 12.75 L16 16 L16 22.5 L10.4 19.25 Z' fill-opacity='0.78'/><path d='M21.6 12.75 L16 16 L16 22.5 L21.6 19.25 Z' fill-opacity='0.6'/></g></svg>";
const CACHE = { landing: "public, max-age=300, stale-while-revalidate=60, stale-if-error=86400", asset: "public, max-age=86400, stale-if-error=604800", seo: "public, max-age=3600, stale-if-error=604800" };

const nonces = new NonceStore();
let gremlinRunning = 0;
const gremlinQueue = [];

class HttpError extends Error {
  constructor(status, detail) {
    super(detail);
    this.status = status;
  }
}

function send(res, status, body, type = "application/json", headers = {}) {
  const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": type, ...headers });
  res.end(res.req?.method === "HEAD" ? undefined : data);
}

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, "Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req, limit = 2 * 1024 * 1024) {
  const raw = await readRaw(req, limit);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch (e) {
    throw new HttpError(400, `Invalid JSON: ${e.message}`);
  }
}

/** Wallet of the signed-in user (session cookie), or null. */
export function sessionWallet(req) {
  try {
    return verifySessionToken(readCookie(req.headers.cookie, SESSION_COOKIE));
  } catch {
    return null; // AUTH_SESSION_SECRET missing → nobody is signed in
  }
}

const secureCookies = () => process.env.AUTH_COOKIE_INSECURE !== "1";

function requireKey(req, header, expected, missingStatus = 503, missingDetail = "generator not configured") {
  if (!expected) throw new HttpError(missingStatus, missingDetail);
  const got = String(req.headers[header] || "").trim();
  if (!got || got.length !== expected.length || !Buffer.from(got).equals(Buffer.from(expected))) {
    throw new HttpError(401, `invalid or missing ${header.replace(/(^|-)([a-z])/g, (_, d, c) => d + c.toUpperCase())}`);
  }
}

const requireGremlinKey = (req) => requireKey(req, "x-gremlin-key", process.env.GREMLIN_API_KEY || "");

function requireB2bClient(req) {
  const key = String(req.headers["x-w3ir-b2b-key"] || "").trim();
  const client = verifyB2bKey(key);
  if (!client) throw new HttpError(401, "Invalid or inactive B2B API key");
  return { key, client };
}

function requireTmaAuth(req) {
  const tmaKey = process.env.TMA_API_KEY || process.env.GREMLIN_API_KEY || "";
  const tma = String(req.headers["x-tma-key"] || "").trim();
  const b2b = String(req.headers["x-w3ir-b2b-key"] || "").trim();
  if (tmaKey && tma && tma.length === tmaKey.length && Buffer.from(tma).equals(Buffer.from(tmaKey))) return;
  if (b2b) {
    requireB2bClient(req);
    return;
  }
  if (!tmaKey && !b2b) return; // dev fallback, as in Промт
  throw new HttpError(401, "Invalid or missing X-TMA-Key or X-W3IR-B2B-Key");
}

function loginPage() {
  const p = siteFile("login.html");
  if (!existsSync(p)) return null;
  // Промт redirected to its Streamlit app; Series Lab opens the studio on this origin.
  return readFileSync(p, "utf8").replace("const APP_URL = 'https://ai.w3ir.io';", `const APP_URL = ${JSON.stringify(process.env.AUTH_APP_URL || "/studio/")};`);
}

async function routes(req, res, url) {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method;
  const host = String(req.headers.host || "").split(":")[0].toLowerCase();

  // pay.w3ir.io exposes only the webhook and health (Промт restrict_pay_subdomain).
  if (hostSet("PAY_SUBDOMAIN_HOSTS", "pay.w3ir.io").has(host) && !["/health", "/webhooks/helio"].includes(path)) {
    send(res, 404, "Not Found", "text/plain");
    return true;
  }

  if (path === "/health" && (method === "GET" || method === "HEAD")) {
    send(res, 200, { status: "ok", service: "nft-prompt-builder-payments" });
    return true;
  }

  if (path === "/" && (method === "GET" || method === "HEAD") && hostSet("LANDING_HOSTS", "w3ir.io,www.w3ir.io").has(host)) {
    const page = renderLanding();
    if (!page) throw new HttpError(404, "landing.html not found");
    send(res, 200, page, "text/html; charset=utf-8", { "Cache-Control": CACHE.landing });
    return true;
  }

  if (method === "GET") {
    if (path === "/og-card.png" || path === "/sitemap.xml" || path === "/robots.txt") {
      const file = siteFile(path.slice(1));
      if (!existsSync(file)) throw new HttpError(404, `${path.slice(1)} not found`);
      const type = { "/og-card.png": "image/png", "/sitemap.xml": "application/xml", "/robots.txt": "text/plain" }[path];
      send(res, 200, readFileSync(file), type, { "Cache-Control": path === "/og-card.png" ? CACHE.asset : CACHE.seo });
      return true;
    }
    if (path === "/favicon.ico") {
      send(res, 200, FAVICON_SVG, "image/svg+xml", { "Cache-Control": CACHE.asset });
      return true;
    }
    if (path === "/legal" || path === "/legal/en") {
      const page = renderLegalHtml(path === "/legal/en" ? "en" : "uk");
      if (!page) throw new HttpError(404, "legal docs not found");
      send(res, 200, page, "text/html; charset=utf-8");
      return true;
    }
    let m = /^\/c\/([^/]+)$/.exec(path);
    if (m) {
      const page = renderCollectionHtml(decodeURIComponent(m[1]));
      if (!page) throw new HttpError(404, "collection not found");
      send(res, 200, page, "text/html; charset=utf-8");
      return true;
    }
    m = /^\/c\/([^/]+)\/img\/([^/]+)$/.exec(path);
    if (m) {
      const file = collectionImagePath(decodeURIComponent(m[1]), decodeURIComponent(m[2]));
      if (!file) throw new HttpError(404, "image not found");
      send(res, 200, readFileSync(file), mediaType(file));
      return true;
    }
    if (path === "/login") {
      const page = loginPage();
      if (!page) throw new HttpError(404, "login.html не знайдено");
      send(res, 200, page, "text/html; charset=utf-8");
      return true;
    }
    if (path === "/auth/welcome-offer") {
      try {
        send(res, 200, welcomeOffer());
      } catch {
        send(res, 200, {}); // fail-open: the banner must not break the login screen
      }
      return true;
    }
    if (path === "/auth/nonce") {
      rateLimit(req, "auth_nonce", LIMITS.nonce());
      const address = url.searchParams.get("address") || "";
      const chainRaw = url.searchParams.get("chain_id");
      const nonce = newNonce();
      let message;
      if (isEvmWallet(address)) {
        const chainId = chainRaw != null && /^\d+$/.test(chainRaw) && Number(chainRaw) > 0 ? Number(chainRaw) : undefined;
        message = buildSiweMessage(address, nonce, chainId ? { chainId } : {});
      } else if (isSolanaWallet(address)) {
        message = buildSolanaMessage(address, nonce);
      } else {
        throw new HttpError(400, "Очікується EVM-адреса 0x… або Solana-адреса");
      }
      nonces.issue(nonce, address, message);
      send(res, 200, { nonce, message });
      return true;
    }
    if (path === "/auth/me") {
      const wallet = sessionWallet(req);
      if (!wallet) throw new HttpError(401, "not signed in");
      send(res, 200, { wallet, balance: getBalance(wallet) });
      return true;
    }
  }

  if (path === "/auth/verify" && method === "POST") {
    rateLimit(req, "auth_verify", LIMITS.verify());
    const body = await readJson(req);
    const address = String(body.address || "");
    const evm = isEvmWallet(address);
    if (!evm && !isSolanaWallet(address)) throw new HttpError(400, "Невалідна адреса (EVM 0x… або Solana)");
    const entry = nonces.consume(String(body.nonce || ""));
    if (!entry) throw new HttpError(401, "Nonce недійсний або протух — оновіть сторінку");
    if (entry.address !== normalizeAddr(address)) throw new HttpError(401, "Адреса не збігається з nonce");
    const ok = evm ? verifyEvmSignature(address, entry.message, String(body.signature || "")) : verifySolanaSignature(address, entry.message, String(body.signature || ""));
    if (!ok) throw new HttpError(401, "Підпис не пройшов перевірку");
    // Staging / invite-only: only listed wallets (and admins) may sign in.
    const invited = String(process.env.SERIES_ALLOWED_WALLETS || "").split(",").map((w) => normalizeAddr(w)).filter(Boolean);
    if (invited.length && !invited.includes(normalizeAddr(address)) && !isAdmin(address)) {
      throw new HttpError(403, "Access by invitation only on this server");
    }
    const token = issueSessionToken(address);
    // Промт gave the welcome grant on the first Streamlit page load; here it
    // happens right after the verified signature (same rules, same ledger).
    const wallet = normalizeWallet(address);
    const signIn = await completeWalletSignIn(wallet);
    const ref = String(body.ref || "").trim();
    if (ref) {
      const referrer = resolveReferrer(ref);
      if (referrer) recordReferral(wallet, referrer);
    }
    send(res, 200, { ok: true, address: normalizeAddr(address), welcomed: signIn.welcomed, balance: signIn.balance }, "application/json", {
      "Set-Cookie": sessionCookie(token, { maxAge: SESSION_TTL_SECONDS, secure: secureCookies() }),
    });
    return true;
  }

  if (path === "/auth/logout" && method === "POST") {
    send(res, 200, { ok: true }, "application/json", { "Set-Cookie": clearSessionCookie(secureCookies()) });
    return true;
  }

  if (path === "/webhooks/helio" && method === "POST") {
    rateLimit(req, "helio_webhook", LIMITS.webhook());
    const body = await readRaw(req, 1024 * 1024);
    let valid;
    try {
      valid = verifyHelioSignature(body, req.headers["x-helio-signature"] || req.headers["x-signature"]);
    } catch (e) {
      throw new HttpError(e.status || 500, e.message);
    }
    if (!valid) throw new HttpError(401, "Invalid webhook signature");
    let payload;
    try {
      payload = JSON.parse(body.toString("utf8"));
    } catch (e) {
      throw new HttpError(400, `Invalid JSON: ${e.message}`);
    }
    if (payload && typeof payload === "object" && payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)) payload = payload.data;
    const paylinkId = String(payload?.paylinkId || payload?.paylink || payload?.meta?.paylinkId || "");
    const mintPaylink = process.env.HELIO_MINT_PAYLINK_ID;
    if (mintPaylink && paylinkId === mintPaylink) {
      send(res, 200, await vaultTransferFromWebhook(payload));
      return true;
    }
    const r = processHelioWebhookPayload(payload && typeof payload === "object" ? payload : {}, { notify: notifyOperator });
    console.log(`Helio webhook: credited=${r.credited} — ${r.message}`);
    send(res, 200, { ok: true, credited: r.credited, message: r.message });
    return true;
  }

  if (path === "/gremlin/holder" && method === "GET") {
    requireGremlinKey(req);
    rateLimit(req, "gremlin_holder", LIMITS.gremlinHolder());
    const wallet = String(url.searchParams.get("wallet") || "").trim();
    if (!wallet) throw new HttpError(400, "wallet is required");
    const chain = String(url.searchParams.get("chain") || "solana").trim().toLowerCase();
    if (chain !== "solana") {
      send(res, 200, { wallet, chain, isGenesisHolder: false, genesisCount: 0 });
      return true;
    }
    const count = await walletGenesisCount(wallet);
    send(res, 200, { wallet, chain, isGenesisHolder: count > 0, genesisCount: count });
    return true;
  }

  if (path === "/gremlin/activity" && method === "GET") {
    requireGremlinKey(req);
    rateLimit(req, "gremlin_activity", LIMITS.gremlinHolder());
    const wallet = String(url.searchParams.get("wallet") || "").trim();
    if (!wallet) throw new HttpError(400, "wallet is required");
    try {
      send(res, 200, walletActivity(wallet, url.searchParams.get("date")));
    } catch {
      throw new HttpError(400, "invalid wallet or date (expected YYYY-MM-DD)");
    }
    return true;
  }

  if (path === "/gremlin/generate" && method === "POST") {
    requireGremlinKey(req);
    rateLimit(req, "gremlin_generate", LIMITS.gremlinGenerate());
    const body = await readJson(req);
    let traits, seed;
    try {
      traits = validateTraits(body.traits ?? {});
      seed = validateSeed(body.seed ?? 0);
    } catch (e) {
      if (e instanceof TraitError) throw new HttpError(400, e.message);
      throw e;
    }
    const prompt = buildGremlinPrompt(traits);
    const max = Math.max(1, envInt("GREMLIN_MAX_CONCURRENCY", 3));
    if (gremlinRunning >= max) await new Promise((r) => gremlinQueue.push(r));
    gremlinRunning += 1;
    let png;
    try {
      if (engineStatus()[ENGINE_FLUX]) throw new Error("flux not configured");
      png = await generateImage(ENGINE_FLUX, prompt, { width: 1024, height: 1024, seed });
    } catch (e) {
      console.warn(`gremlin_generate unavailable: ${e.message}`);
      throw new HttpError(503, "generator unavailable");
    } finally {
      gremlinRunning -= 1;
      gremlinQueue.shift()?.();
    }
    send(res, 200, png, "image/png");
    return true;
  }

  if (path === "/api/vault/status" && method === "GET") {
    rateLimit(req, "vault_status", LIMITS.vault());
    const vault = String(process.env.VAULT_WALLET_ADDRESS || "").trim();
    if (!vault) throw new HttpError(500, "VAULT_WALLET_ADDRESS is not configured in environment");
    let catalog;
    try { catalog = loadCatalog(); } catch (e) { throw new HttpError(500, `vault catalog invalid: ${e.message}`); }
    let held;
    try { held = await vaultTokenMints(vaultRpcUrl(), vault); } catch (e) { throw new HttpError(502, e.message); }
    const available = [];
    const sold = [];
    for (const item of catalog) (held.has(item.mint) ? available : sold).push(item.index);
    send(res, 200, { success: true, vault_address: vault, available_indexes: available, sold_indexes: sold });
    return true;
  }

  if (path === "/api/v1/launchpad/inspect-bundle" && method === "POST") {
    const { key } = requireB2bClient(req);
    rateLimit(req, "launchpad_inspect", LIMITS.launchpad());
    const maxMb = envInt("LAUNCHPAD_MAX_UPLOAD_MB", 25);
    const raw = await readRaw(req, maxMb * 1024 * 1024 + 64 * 1024);
    let file;
    try {
      const form = await new Response(raw, { headers: { "content-type": req.headers["content-type"] || "" } }).formData();
      file = form.get("file");
    } catch {
      throw new HttpError(422, "multipart field 'file' is required");
    }
    if (!file || typeof file === "string") throw new HttpError(422, "multipart field 'file' is required");
    if (!file.name || !file.name.endsWith(".zip")) throw new HttpError(400, "Only .zip files are supported");
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length > maxMb * 1024 * 1024) throw new HttpError(413, `Bundle too large (limit ${maxMb} MB)`);
    const report = await inspectBundleZip(bytes);
    if (!report.valid) throw new HttpError(400, report.error || "Invalid bundle");
    recordB2bUsage(key, 1);
    send(res, 200, report);
    return true;
  }

  if (path === "/api/v1/b2b/status" && method === "GET") {
    const { client } = requireB2bClient(req);
    send(res, 200, { ok: true, client_name: client.client_name, quota: client.quota, used: client.used, remaining: Math.max(0, client.quota - client.used) });
    return true;
  }

  if (path === "/api/v1/tma/contract" && method === "GET") {
    requireTmaAuth(req);
    const status = engineStatus();
    send(res, 200, {
      ok: true,
      styles: Object.keys(STYLE_PRESETS).sort(),
      engines: Object.fromEntries(Object.entries(TMA_ENGINE_ALIASES).map(([wire, internal]) => [wire, status[internal] === ""])),
    });
    return true;
  }

  if (path === "/api/v1/generate/tma" && method === "POST") {
    requireTmaAuth(req);
    rateLimit(req, "tma_generate", LIMITS.tma());
    const body = parseTmaBody(await readJson(req, 16 * 1024 * 1024));
    const safety = await checkPromptSafety(body.prompt);
    if (!safety.ok) throw new HttpError(400, `Prompt blocked by content safety policy (${safety.category || "blocked"})`);
    let style, engine;
    try {
      style = resolveTmaStyle(body.style);
      engine = resolveTmaEngine(body.engine);
    } catch (e) {
      throw new HttpError(400, e.message);
    }
    if (engineStatus()[engine]) throw new HttpError(503, `Engine ${engine} is currently unavailable`);
    let reference = null;
    if (body.reference_image) {
      try { reference = decodeReferenceImage(body.reference_image, body.strength ?? 0.85); } catch (e) { throw new HttpError(400, e.message); }
    }
    const prompt = enhanceTmaPrompt(body.prompt, style);
    const frames = await Promise.allSettled(Array.from({ length: body.count }, async (_, i) => {
      let last;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const png = await generateImage(engine, prompt, { width: 1024, height: 1024, seed: (i + 1) * 1337 + attempt * 1009, reference });
          return `data:image/png;base64,${png.toString("base64")}`;
        } catch (e) {
          last = e;
          console.warn(`TMA frame ${i + 1}/${body.count} attempt ${attempt + 1}/3 failed: ${e.message}`);
        }
      }
      throw last;
    }));
    const failed = frames.filter((f) => f.status === "rejected");
    if (failed.length) {
      console.error(`TMA generation error (${failed.length}/${body.count} frames)`);
      throw new HttpError(500, `Generation failed on AI engine (${failed.length}/${body.count} frames)`);
    }
    send(res, 200, { ok: true, images: frames.map((f) => f.value), count: frames.length, style: body.style, engine, prompt: body.prompt });
    return true;
  }

  return false;
}

async function vaultTransferFromWebhook(payload) {
  const customer = payload?.meta?.customerWallet;
  if (!customer) return { ok: false, error: "missing customerWallet" };
  if (!isSolanaWallet(customer)) return { ok: false, error: "invalid customerWallet" };
  const txId = String(payload.id || payload.transactionId || payload.transaction || payload.meta?.id || "").trim();
  if (!txId) return { ok: false, error: "missing transaction id" };
  const selected = payload?.meta?.selectedIndex;
  if (selected == null) return { ok: false, error: "missing selectedIndex" };
  const idx = Number.parseInt(selected, 10);
  if (!Number.isInteger(idx) || String(idx) !== String(selected).trim()) return { ok: false, error: "invalid selectedIndex parameter" };
  let mint;
  try {
    mint = resolveMint(loadCatalog(), idx);
    const vault = String(process.env.VAULT_WALLET_ADDRESS || "").trim();
    if (!vault) throw new VaultError("VAULT_WALLET_ADDRESS is not configured");
    if (!(await vaultTokenMints(vaultRpcUrl(), vault)).has(mint)) throw new VaultError(`mint ${mint} (index ${idx}) is not held by the vault`);
  } catch (e) {
    console.error(`Helio NFT transfer REJECTED (index ${selected}): ${e.message}`);
    return { ok: false, error: "vault item unavailable" };
  }
  try {
    if (!claimNftFulfillment(txId, customer, "transfer", mint)) return { ok: true, message: "already processed" };
    runFulfillment(txId, customer, "transfer", mint).catch(() => {});
    return { ok: true, message: `Transfer task queued for index ${idx}` };
  } catch {
    return { ok: false, error: "transfer could not be queued" };
  }
}

/** Handles platform routes. true = answered. Errors are rendered as {"detail"}. */
export async function handlePlatform(req, res, url) {
  try {
    return await routes(req, res, url);
  } catch (e) {
    if (res.headersSent) {
      res.end();
      return true;
    }
    const status = e.status || 500;
    if (status >= 500 && !(e instanceof HttpError)) console.error(`[platform] ${e.stack || e}`);
    send(res, status, { detail: status >= 500 && !(e instanceof HttpError) ? "Internal Server Error" : e.message });
    return true;
  }
}

/** Background loops (Helio reconcile, holder sync, fulfillment retry) — as in Промт lifespan. */
export function startPlatformBackground({ log = console } = {}) {
  const timers = [];
  const every = (seconds, fn, delay = 0) => {
    if (!(seconds > 0)) return;
    const run = () => fn().catch((e) => log.error?.(`[platform] ${e.message}`));
    timers.push(setTimeout(function tick() { run(); timers.push(setTimeout(tick, seconds * 1000)); }, delay * 1000));
  };
  if (helioKeys()) {
    every(envInt("HELIO_RECONCILE_INTERVAL_SECONDS", 300), async () => {
      const r = await reconcilePayments({ notify: notifyOperator });
      if (r.newTx) log.log?.(`Helio reconcile: +${r.newTx} tx, +${r.credited} credits`);
      if (r.error) log.warn?.(`Helio reconcile: ${r.error}`);
    });
  }
  every(envInt("HOLDER_SYNC_INTERVAL_SECONDS", 120), async () => {
    const r = await syncGenesisMints();
    if (!r.success) log.warn?.(`Holder sync: ${r.error}`);
  }, 10);
  every(envInt("FULFILLMENT_RECONCILE_INTERVAL_SECONDS", 300), () => reconcileFulfillments({ log }), 20);
  openDb(); // create/migrate the schema at startup, not on the first request
  return () => timers.forEach(clearTimeout);
}
