// Contract test over EVERY route found in the server code (so a new route is covered automatically):
//   1. without a session, /api/* answers 401 (never data, never 5xx);
//   2. with a normal signed-in wallet and an empty request, no route answers 5xx (bad input is a 4xx);
//   3. operator routes answer 403 to a normal wallet and work for the admin wallet.
// Routes that call paid providers or the network are listed in SKIP_EMPTY_CALL: they have dedicated tests.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startStudio } from "./helpers/studio-server.mjs";

function routeTable() {
  const src = ["server/index.mjs", "server/platform.mjs"].map((f) => readFileSync(f, "utf8")).join("\n");
  const rows = new Map();
  for (const line of src.split("\n")) {
    const m = /(?:pathname|path) === "(\/[^"]+)"/.exec(line);
    if (!m) continue;
    const meth = /(?:req\.)?method === "([A-Z]+)"/.exec(line);
    rows.set(`${meth ? meth[1] : "GET"} ${m[1]}`, { method: meth ? meth[1] : "GET", path: m[1] });
  }
  return [...rows.values()];
}

const ROUTES = routeTable();
// Reachable without a session on purpose (pages, health, sign-in, public collection pages).
const PUBLIC = /^(\/health|\/api\/health|\/login|\/login\.js|\/favicon\.ico|\/sitemap\.xml|\/robots\.txt|\/legal|\/legal\/en|\/studio|\/old|\/auth\/|\/api\/csp-report|\/api\/vault\/status)/;
// Partner-key routes answer 401 with their own scheme, not the wallet session.
const PARTNER = /^\/(api\/v1\/|gremlin\/)/;
// Paid or network-bound: covered by their own tests (engines, solpay, storage, deploy).
const SKIP_EMPTY_CALL = /^(POST \/api\/(generate|base\/generate|base\/analyze|engines\/test|storage\/pin|holder\/claim|credits\/sol\/check|deploy-kit|marketplace-kit|v1\/generate\/tma)|POST \/gremlin\/generate)$/;
const OPERATOR = /^\/api\/(admin\/|spend$|resources$|engines\/status$|notifications\/test$)/;
// A dormant feature may answer 503 instead of 4xx.
const MAY_BE_UNAVAILABLE = new Set(["GET /api/vault/status"]);

describe("route table", () => {
  it("is parsed from the server code and is not trivially small", () => {
    assert.ok(ROUTES.length >= 100, `found ${ROUTES.length} routes`);
    assert.ok(ROUTES.some((r) => r.path === "/api/export/bundle" && r.method === "POST"));
  });
});

describe("API contract (normal wallet)", () => {
  let s;
  before(async () => {
    s = await startStudio({ adminWallet: false });
  });
  after(async () => {
    await s?.stop();
  });

  it("without a session every /api route answers 401 (except the public ones)", async () => {
    const bad = [];
    for (const r of ROUTES) {
      if (PUBLIC.test(r.path) || PARTNER.test(r.path)) continue;
      if (!r.path.startsWith("/api/")) continue;
      const res = await s.call(r.method, r.path, { auth: false, body: r.method === "POST" ? {} : undefined, timeoutMs: 8000 });
      if (res.status !== 401) bad.push(`${r.method} ${r.path} → ${res.status}`);
    }
    assert.deepEqual(bad, []);
  });

  it("with a session and an empty request no route answers 5xx or hangs", async () => {
    await s.signIn();
    const bad = [];
    for (const r of ROUTES) {
      const key = `${r.method} ${r.path}`;
      if (SKIP_EMPTY_CALL.test(key)) continue;
      let res;
      try {
        res = await s.call(r.method, r.path, { body: r.method === "POST" ? {} : undefined, timeoutMs: 10_000 });
      } catch (e) {
        bad.push(`${key} → ${e.message}`);
        continue;
      }
      if (res.status >= 500 && !MAY_BE_UNAVAILABLE.has(key)) bad.push(`${key} → ${res.status} ${res.text.slice(0, 80)}`);
    }
    assert.deepEqual(bad, [], "validation problems must be 4xx, not 5xx");
  });

  it("operator routes refuse a normal wallet with 403", async () => {
    const bad = [];
    for (const r of ROUTES.filter((x) => OPERATOR.test(x.path))) {
      const res = await s.call(r.method, r.path, { body: r.method === "POST" ? {} : undefined });
      if (res.status !== 403) bad.push(`${r.method} ${r.path} → ${res.status}`);
    }
    assert.deepEqual(bad, []);
    assert.ok(ROUTES.filter((x) => OPERATOR.test(x.path)).length >= 8);
  });
});

describe("API contract (admin wallet)", () => {
  let s;
  before(async () => {
    s = await startStudio({ adminWallet: true });
    await s.signIn();
  });
  after(async () => {
    await s?.stop();
  });

  it("operator routes work for the admin wallet and report themselves as admin", async () => {
    assert.equal((await s.call("GET", "/api/me")).json.admin, true);
    for (const p of ["/api/admin/economy", "/api/admin/system", "/api/admin/resources/plan", "/api/spend", "/api/resources", "/api/engines/status"]) {
      const res = await s.call("GET", p, { timeoutMs: 15_000 });
      assert.equal(res.status, 200, `${p}: ${res.status} ${res.text.slice(0, 100)}`);
    }
  });
});
