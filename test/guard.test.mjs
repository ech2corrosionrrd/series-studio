import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedHostnames, checkApiRequest, openAccessError } from "../server/guard.mjs";

const opts = { allowedHosts: allowedHostnames("127.0.0.1"), port: 5344 };
const req = (headers, method = "POST") => ({ method, headers });
const json = { "content-type": "application/json" };

test("guard: same-origin Studio requests are allowed", () => {
  assert.equal(checkApiRequest(req({ host: "127.0.0.1:5344", ...json }), opts), null);
  assert.equal(
    checkApiRequest(req({ host: "localhost:5344", origin: "http://localhost:5344", ...json }), opts),
    null,
  );
  assert.equal(checkApiRequest(req({ host: "127.0.0.1:5344" }, "GET"), opts), null);
});

test("guard: cross-site POST is blocked (CSRF)", () => {
  const r = req({ host: "127.0.0.1:5344", origin: "https://evil.example", "content-type": "text/plain" });
  assert.match(checkApiRequest(r, opts), /cross-origin/);
  assert.match(checkApiRequest(req({ host: "127.0.0.1:5344", origin: "null", ...json }), opts), /cross-origin/);
});

test("guard: non-JSON POST is blocked even without Origin", () => {
  assert.match(
    checkApiRequest(req({ host: "127.0.0.1:5344", "content-type": "text/plain" }), opts),
    /Content-Type/,
  );
});

test("guard: foreign Host header is blocked (DNS rebinding)", () => {
  assert.match(checkApiRequest(req({ host: "evil.example:5344", ...json }), opts), /host not allowed/);
  assert.match(checkApiRequest(req({ host: "127.0.0.1:9999", ...json }), opts), /host not allowed/);
  assert.match(checkApiRequest(req({ ...json }), opts), /missing Host/);
});

test("guard: wildcard HOST skips Host check but keeps same-origin check", () => {
  const any = { allowedHosts: allowedHostnames("0.0.0.0"), port: 5344 };
  assert.equal(checkApiRequest(req({ host: "192.168.1.5:5344", origin: "http://192.168.1.5:5344", ...json }), any), null);
  assert.match(
    checkApiRequest(req({ host: "192.168.1.5:5344", origin: "https://evil.example", ...json }), any),
    /cross-origin/,
  );
});

test("guard: SERIES_ALLOWED_HOSTS extends the allowlist", () => {
  const ext = { allowedHosts: allowedHostnames("127.0.0.1", "studio.local, lab.lan"), port: 5344 };
  assert.equal(checkApiRequest(req({ host: "studio.local:5344", ...json }), ext), null);
  assert.equal(checkApiRequest(req({ host: "[::1]:5344", ...json }), ext), null);
});

test("guard: public bind enforces SERIES_ALLOWED_HOSTS", () => {
  const pub = { allowedHosts: allowedHostnames("0.0.0.0", "next.w3ir.io"), port: 5344 };
  assert.equal(checkApiRequest(req({ host: "next.w3ir.io", origin: "https://next.w3ir.io", ...json }), pub), null);
  assert.equal(checkApiRequest(req({ host: "next.w3ir.io:443", ...json }), pub), null);
  assert.equal(checkApiRequest(req({ host: "127.0.0.1:5344", ...json }), pub), null);
  assert.match(checkApiRequest(req({ host: "evil.example", ...json }), pub), /host not allowed/);
  assert.match(checkApiRequest(req({ host: "127.0.0.1:9999", ...json }), pub), /host not allowed/);
  assert.match(checkApiRequest(req({ host: "next.w3ir.io:9999", ...json }), pub), /host not allowed/);
});

test("guard: open access is loopback development only", () => {
  assert.equal(openAccessError("127.0.0.1", false), null);
  assert.equal(openAccessError("localhost", false), null);
  assert.equal(openAccessError("0.0.0.0", true), null);
  assert.match(openAccessError("0.0.0.0", false), /SERIES_MODE=local/);
  assert.match(openAccessError("192.168.1.5", false), /127\.0\.0\.1/);
});
