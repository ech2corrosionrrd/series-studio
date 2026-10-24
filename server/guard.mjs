/**
 * Request guard for the local Studio API.
 *
 * Blocks cross-site requests (CSRF) and DNS-rebinding attacks: any web page
 * open in the browser could otherwise POST to http://127.0.0.1:PORT/api/*
 * and spend the user's API keys or modify local files.
 */

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * SERIES_MODE=local (no wallet session) may listen only on loopback.
 * Sign-in is the product; 127.0.0.1 is just where the development server sits.
 * Returns an error string, or null when the bind is allowed.
 */
export function openAccessError(host, publicMode) {
  const h = String(host || "").toLowerCase();
  if (publicMode || LOOPBACK.has(h)) return null;
  return "SERIES_MODE=local cannot listen outside loopback. Sign-in is part of the product; 127.0.0.1 is only where the development server is placed.";
}
const WILDCARD = new Set(["0.0.0.0", "::", "[::]"]);

function hostList(extra) {
  const out = [];
  for (const x of String(extra || "").split(",")) {
    const v = x.trim().toLowerCase();
    if (v) out.push(v);
  }
  return out;
}

/**
 * Public mode on a non-loopback address is the hosted studio process.
 * It must name the hostname people type, and the SIWE domain must be that
 * name. studio.w3ir.io is not assumed: that name is the static Pages site.
 * Returns an error string, or null when the process may listen.
 */
export function hostedConfigError(host, publicMode, env = {}) {
  const h = String(host || "").toLowerCase();
  if (!publicMode || LOOPBACK.has(h)) return null;
  const extras = hostList(env.SERIES_ALLOWED_HOSTS);
  if (WILDCARD.has(h) && extras.length === 0) {
    return "Public studio listening on all interfaces needs SERIES_ALLOWED_HOSTS set to the hostname people type in the browser. Without it the Host check is skipped. studio.w3ir.io is the static site, not this process.";
  }
  const names = new Set(extras);
  if (!WILDCARD.has(h)) names.add(h);
  const domain = String(env.AUTH_DOMAIN || "").trim().toLowerCase();
  if (!domain) {
    return "AUTH_DOMAIN is not set. Set it to the hostname people type in the browser (it goes into the wallet sign-in text and must be one of the studio hostnames).";
  }
  if (!names.has(domain)) {
    return `AUTH_DOMAIN (${domain}) must be one of the studio hostnames (${[...names].join(", ")}). Wallet sign-in text has to match the address people open. The Pages site studio.w3ir.io is not this process.`;
  }
  return null;
}

/** Non-fatal: the landing hostname was pasted onto the studio process. */
export function hostedConfigWarning(host, publicMode, env = {}) {
  const h = String(host || "").toLowerCase();
  if (!publicMode || LOOPBACK.has(h)) return null;
  const names = new Set([...hostList(env.SERIES_ALLOWED_HOSTS), String(env.AUTH_DOMAIN || "").trim().toLowerCase()].filter(Boolean));
  if (!names.has("studio.w3ir.io")) return null;
  return "studio.w3ir.io is the Cloudflare Pages landing and has no studio API. This process is separate. Use that name here only after DNS has been moved on purpose.";
}

/**
 * Hostnames (without port) the API accepts in the Host header.
 * Listening on all interfaces skips the Host check only when SERIES_ALLOWED_HOSTS
 * is empty — same-origin still applies. The studio process refuses to start in
 * that state (`hostedConfigError`). Once any public name is listed, that list
 * (plus loopback) is enforced, including on 0.0.0.0.
 * Returns null when the Host check should be skipped.
 */
export function allowedHostnames(host, extra = "") {
  const h = String(host || "").toLowerCase();
  const extras = [];
  for (const x of String(extra || "").split(",")) {
    const v = x.trim().toLowerCase();
    if (v) extras.push(v);
  }
  if (WILDCARD.has(h) && extras.length === 0) return null;
  const set = new Set(LOOPBACK);
  if (!WILDCARD.has(h)) set.add(h.includes(":") && !h.startsWith("[") ? `[${h}]` : h);
  for (const v of extras) set.add(v);
  return set;
}

function hostnameOf(hostHeader) {
  const h = String(hostHeader || "").toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  return h.split(":")[0];
}

function headerPort(hostHeader) {
  const h = String(hostHeader || "").toLowerCase();
  if (h.startsWith("[")) {
    const rest = h.slice(h.indexOf("]") + 1);
    return rest.startsWith(":") ? rest.slice(1) : "";
  }
  const i = h.indexOf(":");
  return i === -1 ? "" : h.slice(i + 1);
}

/**
 * Loopback must use the listen port (blocks 127.0.0.1:9999 rebinding).
 * Public names also accept :80 and :443 — that is how a TLS proxy presents them.
 */
function portAllowed(hostHeader, listenPort) {
  const p = headerPort(hostHeader);
  if (!p) return true;
  const n = Number(p);
  if (n === Number(listenPort)) return true;
  if (!LOOPBACK.has(hostnameOf(hostHeader)) && (n === 80 || n === 443)) return true;
  return false;
}

/**
 * @param {{ method?: string, path?: string, headers: Record<string, string|undefined> }} req
 * @param {{ allowedHosts: Set<string>|null, port: number }} opts
 * @returns {string|null} rejection reason, or null when the request is allowed
 */
/**
 * Binary uploads that may use their own Content-Type instead of JSON. `application/zip` is not a
 * CORS-safelisted type, so a cross-site page cannot send it without a preflight (which the server
 * never grants); the Origin check above still applies.
 */
const RAW_UPLOADS = new Map([["/api/layers/upload", new Set(["application/zip", "application/x-zip-compressed"])]]);

export function checkApiRequest(req, { allowedHosts, port }) {
  const hostHeader = String(req.headers.host || "").toLowerCase();
  if (!hostHeader) return "missing Host header";
  if (allowedHosts) {
    if (!allowedHosts.has(hostnameOf(hostHeader))) return "host not allowed";
    if (!portAllowed(hostHeader, port)) return "host not allowed";
  }

  const origin = req.headers.origin;
  if (origin && origin !== "null") {
    let o;
    try {
      o = new URL(origin);
    } catch {
      return "bad origin";
    }
    if (o.host.toLowerCase() !== hostHeader) return "cross-origin request blocked";
  } else if (origin === "null") {
    return "cross-origin request blocked";
  }

  const method = String(req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const ct = String(req.headers["content-type"] || "").toLowerCase();
    const rawTypes = RAW_UPLOADS.get(String(req.path || ""));
    const rawOk = rawTypes && [...rawTypes].some((t) => ct === t || ct.startsWith(`${t};`));
    if (!ct.startsWith("application/json") && !rawOk) return "Content-Type must be application/json";
  }
  return null;
}
