import test from "node:test";
import assert from "node:assert/strict";
import { applySecurityHeaders, isHttpsRequest, SECURITY_HEADERS, HSTS_VALUE } from "../src/security-headers.mjs";

const fakeRes = () => {
  const h = {};
  return { h, setHeader: (k, v) => { h[k] = v; } };
};

test("security headers are always set, HSTS only over https", () => {
  const plain = fakeRes();
  applySecurityHeaders({ headers: {} }, plain);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) assert.equal(plain.h[k], v);
  assert.equal(plain.h["Strict-Transport-Security"], undefined);

  const viaCaddy = fakeRes();
  applySecurityHeaders({ headers: { "x-forwarded-proto": "https" } }, viaCaddy);
  assert.equal(viaCaddy.h["Strict-Transport-Security"], HSTS_VALUE);

  const viaCloudflare = fakeRes();
  applySecurityHeaders({ headers: { "cf-visitor": '{"scheme":"https"}' } }, viaCloudflare);
  assert.equal(viaCloudflare.h["Strict-Transport-Security"], HSTS_VALUE);
});

test("isHttpsRequest ignores http and junk", () => {
  assert.equal(isHttpsRequest({ "x-forwarded-proto": "http" }), false);
  assert.equal(isHttpsRequest({ "cf-visitor": '{"scheme":"http"}' }), false);
  assert.equal(isHttpsRequest({ "x-forwarded-proto": "https, http" }), true);
  assert.equal(isHttpsRequest(undefined), false);
});

test("no Content-Security-Policy is sent (it would break the inline UI and wallet login)", () => {
  assert.equal("Content-Security-Policy" in SECURITY_HEADERS, false);
});
