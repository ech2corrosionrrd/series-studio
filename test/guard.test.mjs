import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { allowedHostnames, checkApiRequest, hostedConfigError, hostedConfigWarning, openAccessError } from "../server/guard.mjs";

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

test("guard: hosted studio requires a hostname and a matching sign-in domain", () => {
  assert.equal(hostedConfigError("127.0.0.1", true, {}), null);
  assert.equal(hostedConfigError("0.0.0.0", false, {}), null);
  assert.match(hostedConfigError("0.0.0.0", true, {}), /SERIES_ALLOWED_HOSTS/);
  assert.match(hostedConfigError("0.0.0.0", true, { SERIES_ALLOWED_HOSTS: "next.w3ir.io" }), /AUTH_DOMAIN/);
  assert.equal(
    hostedConfigError("0.0.0.0", true, { SERIES_ALLOWED_HOSTS: "next.w3ir.io", AUTH_DOMAIN: "next.w3ir.io" }),
    null,
  );
  assert.equal(hostedConfigError("10.0.0.8", true, { AUTH_DOMAIN: "10.0.0.8" }), null);
});

test("server refuses a public bind without a studio hostname", async () => {
  const child = spawn(process.execPath, ["server/index.mjs"], {
    env: {
      ...process.env,
      SERIES_MODE: "public",
      HOST: "0.0.0.0",
      PORT: "5391",
      SERIES_ALLOWED_HOSTS: "",
      AUTH_DOMAIN: "",
      SERIES_SKIP_DOTENV: "1",
      SERIES_KEYS_FILE: "",
      SERIES_PLATFORM_ENV: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let err = "";
  child.stderr.on("data", (d) => { err += d; });
  const code = await new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      child.kill();
      reject(new Error(`server kept running\n${err}`));
    }, 20_000);
    child.on("exit", (c) => {
      clearTimeout(t);
      resolve(c);
    });
  });
  assert.equal(code, 1);
  assert.match(err, /SERIES_ALLOWED_HOSTS/);
});

test("guard: studio.w3ir.io on the studio process is a warning, not the landing", () => {
  const env = { SERIES_ALLOWED_HOSTS: "studio.w3ir.io", AUTH_DOMAIN: "studio.w3ir.io" };
  assert.equal(hostedConfigError("0.0.0.0", true, env), null);
  assert.match(hostedConfigWarning("0.0.0.0", true, env), /Pages/);
  assert.equal(hostedConfigWarning("127.0.0.1", true, env), null);
  assert.equal(hostedConfigWarning("0.0.0.0", true, { SERIES_ALLOWED_HOSTS: "next.w3ir.io", AUTH_DOMAIN: "next.w3ir.io" }), null);
});

test("guard: application/zip is accepted only for the layers upload; everything else stays JSON-only", () => {
  const zip = { "content-type": "application/zip" };
  const up = (headers, path = "/api/layers/upload") => ({ method: "POST", path, headers: { host: "127.0.0.1:5344", ...headers } });
  assert.equal(checkApiRequest(up(zip), opts), null);
  assert.equal(checkApiRequest(up({ "content-type": "application/zip; charset=binary" }), opts), null);
  assert.equal(checkApiRequest(up({ "content-type": "application/x-zip-compressed" }), opts), null);
  assert.match(checkApiRequest(up(zip, "/api/preset/save"), opts), /Content-Type/, "another route is still JSON-only");
  assert.match(checkApiRequest(up({ "content-type": "text/plain" }), opts), /Content-Type/);
  assert.match(checkApiRequest(up({ "content-type": "multipart/form-data" }), opts), /Content-Type/);
  assert.match(checkApiRequest(up({ ...zip, origin: "http://evil.example" }), opts), /cross-origin/, "Origin check still applies");
  assert.match(checkApiRequest(up({}), opts), /Content-Type/, "no content type at all");
});

