import test from "node:test";
import assert from "node:assert/strict";
import { allowRequest, clientIp, rateLimit, resetRateLimits } from "../src/platform/ratelimit.mjs";

const req = (headers = {}, remoteAddress = "10.0.0.5") => ({ headers, socket: { remoteAddress } });

test("ratelimit: blocks after the limit and keeps buckets apart", () => {
  resetRateLimits();
  assert.equal(allowRequest("a", 2, 60), true);
  assert.equal(allowRequest("a", 2, 60), true);
  assert.equal(allowRequest("a", 2, 60), false);
  assert.equal(allowRequest("b", 2, 60), true, "another key is independent");
});

test("ratelimit: the window expires", async () => {
  resetRateLimits();
  assert.equal(allowRequest("w", 1, 0.05), true);
  assert.equal(allowRequest("w", 1, 0.05), false);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(allowRequest("w", 1, 0.05), true);
});

test("ratelimit: rateLimit throws 429 when exhausted", () => {
  resetRateLimits();
  const r = req();
  rateLimit(r, "t", 1);
  assert.throws(() => rateLimit(r, "t", 1), (e) => e.status === 429);
});

test("ratelimit: client IP prefers CF-Connecting-IP, trusts X-Forwarded-For only on request", () => {
  const saved = process.env.RATE_LIMIT_TRUST_XFF;
  try {
    delete process.env.RATE_LIMIT_TRUST_XFF;
    assert.equal(clientIp(req({ "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" })), "1.2.3.4");
    assert.equal(clientIp(req({ "x-forwarded-for": "9.9.9.9" })), "10.0.0.5", "XFF ignored by default");
    process.env.RATE_LIMIT_TRUST_XFF = "1";
    assert.equal(clientIp(req({ "x-forwarded-for": "9.9.9.9, 8.8.8.8" })), "9.9.9.9");
    assert.equal(clientIp({ headers: {}, socket: {} }), "unknown");
  } finally {
    if (saved === undefined) delete process.env.RATE_LIMIT_TRUST_XFF;
    else process.env.RATE_LIMIT_TRUST_XFF = saved;
  }
});
