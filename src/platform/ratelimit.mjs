/**
 * In-memory sliding-window rate limiter (single process) and client IP resolution.
 */
const hits = new Map();

export function allowRequest(key, limit, windowSeconds = Number(process.env.API_RATE_WINDOW_SECONDS || 60)) {
  const now = Date.now() / 1000;
  const recent = (hits.get(key) || []).filter((t) => now - t < windowSeconds);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] >= windowSeconds) hits.delete(k);
  return true;
}

export const resetRateLimits = () => hits.clear();

/** Cloudflare's CF-Connecting-IP first; X-Forwarded-For only when trusted. */
export function clientIp(req) {
  const cf = String(req.headers["cf-connecting-ip"] || "").trim();
  if (cf) return cf;
  if (process.env.RATE_LIMIT_TRUST_XFF === "1") {
    const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (fwd) return fwd;
  }
  return req.socket?.remoteAddress || "unknown";
}

/** Throws a 429 error when the bucket for this client is exhausted. */
export function rateLimit(req, bucket, limit) {
  if (!allowRequest(`${bucket}:${clientIp(req)}`, limit)) {
    throw Object.assign(new Error("Too many requests"), { status: 429 });
  }
}
