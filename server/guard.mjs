/**
 * Request guard for the local Studio API.
 *
 * Blocks cross-site requests (CSRF) and DNS-rebinding attacks: any web page
 * open in the browser could otherwise POST to http://127.0.0.1:PORT/api/*
 * and spend the user's API keys or modify local files.
 */

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const WILDCARD = new Set(["0.0.0.0", "::", "[::]"]);

/**
 * Hostnames (without port) the API accepts in the Host header.
 * Returns null when the server listens on all interfaces (Host check skipped;
 * the same-origin check still applies).
 */
export function allowedHostnames(host, extra = "") {
  const h = String(host || "").toLowerCase();
  if (WILDCARD.has(h)) return null;
  const set = new Set(LOOPBACK);
  set.add(h.includes(":") && !h.startsWith("[") ? `[${h}]` : h);
  for (const x of String(extra || "").split(",")) {
    const v = x.trim().toLowerCase();
    if (v) set.add(v);
  }
  return set;
}

function hostnameOf(hostHeader) {
  const h = String(hostHeader || "").toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  return h.split(":")[0];
}

/**
 * @param {{ method?: string, headers: Record<string, string|undefined> }} req
 * @param {{ allowedHosts: Set<string>|null, port: number }} opts
 * @returns {string|null} rejection reason, or null when the request is allowed
 */
export function checkApiRequest(req, { allowedHosts, port }) {
  const hostHeader = String(req.headers.host || "").toLowerCase();
  if (!hostHeader) return "missing Host header";
  if (allowedHosts) {
    if (!allowedHosts.has(hostnameOf(hostHeader))) return "host not allowed";
    const p = hostHeader.startsWith("[")
      ? hostHeader.slice(hostHeader.indexOf("]") + 2)
      : hostHeader.split(":")[1];
    if (p && Number(p) !== Number(port)) return "host not allowed";
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
    if (!ct.startsWith("application/json")) return "Content-Type must be application/json";
  }
  return null;
}
