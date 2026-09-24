/**
 * Sign-in sessions: one-time nonces + HMAC session token.
 * Port of Промт `services/auth_gateway.py`. The token format is byte-identical
 * (base64url(sorted compact JSON) + "." + base64url(HMAC-SHA256)), so with the
 * same AUTH_SESSION_SECRET a user logged in on Промт stays logged in after the
 * switch to Series Lab.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeAddr } from "./wallet.mjs";

export const SESSION_COOKIE = "w3ir_session";
export const NONCE_TTL_SECONDS = 5 * 60;
export const SESSION_TTL_SECONDS = 4 * 60 * 60;

function sessionSecret(secret) {
  const s = String(secret ?? process.env.AUTH_SESSION_SECRET ?? "").trim();
  if (!s) throw new Error("AUTH_SESSION_SECRET is not configured — sign-in disabled (tokens would be forgeable)");
  return s;
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");

/** Python json.dumps(obj, separators=(",", ":"), sort_keys=True) for flat objects. */
function canonicalJson(obj) {
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${JSON.stringify(obj[k])}`).join(",")}}`;
}

export function issueSessionToken(address, { secret, ttl = SESSION_TTL_SECONDS, now } = {}) {
  const t = Math.floor(now ?? Date.now() / 1000);
  const body = b64url(canonicalJson({ addr: normalizeAddr(address), exp: t + ttl, iat: t }));
  const sig = createHmac("sha256", sessionSecret(secret)).update(body).digest();
  return `${body}.${b64url(sig)}`;
}

/** Returns the address when the token is authentic and not expired, else null. */
export function verifySessionToken(token, { secret, now } = {}) {
  const t = Math.floor(now ?? Date.now() / 1000);
  if (!token || typeof token !== "string" || token.split(".").length !== 2) return null;
  const [body, sig] = token.split(".");
  const expected = b64url(createHmac("sha256", sessionSecret(secret)).update(body).digest());
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object" || t > Number(payload.exp || 0)) return null;
  return typeof payload.addr === "string" && payload.addr ? payload.addr : null;
}

/** In-memory one-time nonce store (single process), same contract as Промт NonceStore. */
export class NonceStore {
  constructor(ttl = NONCE_TTL_SECONDS) {
    this.ttl = ttl;
    this.data = new Map();
  }

  issue(nonce, address, message, now = Date.now() / 1000) {
    this.prune(now);
    this.data.set(nonce, { address: normalizeAddr(address), message, expiry: now + this.ttl });
    return nonce;
  }

  consume(nonce, now = Date.now() / 1000) {
    const entry = this.data.get(nonce);
    this.data.delete(nonce);
    if (!entry || now > entry.expiry) return null;
    return { address: entry.address, message: entry.message };
  }

  prune(now) {
    for (const [n, e] of this.data) if (now > e.expiry) this.data.delete(n);
  }
}

/** Reads a cookie value from a raw Cookie header. */
export function readCookie(header, name) {
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function sessionCookie(token, { maxAge = SESSION_TTL_SECONDS, secure = true } = {}) {
  return `${SESSION_COOKIE}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export const clearSessionCookie = (secure = true) =>
  `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
