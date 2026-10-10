import test from "node:test";
import assert from "node:assert/strict";
import { CSP_REPORT_PATH, applyCsp, buildCsp, createCspLog, cspMode, summarizeReport } from "../src/csp.mjs";

const fakeRes = () => {
  const h = {};
  return { h, setHeader: (k, v) => { h[k] = v; } };
};

test("mode comes from SERIES_CSP and falls back to report", () => {
  assert.equal(cspMode({}), "report");
  assert.equal(cspMode({ SERIES_CSP: "ENFORCE" }), "enforce");
  assert.equal(cspMode({ SERIES_CSP: "off" }), "off");
  assert.equal(cspMode({ SERIES_CSP: "nonsense" }), "report");
});

test("report mode sends Report-Only, enforce sends the real header, off sends nothing", () => {
  const a = fakeRes();
  applyCsp({ url: "/studio/" }, a, {});
  assert.ok(a.h["Content-Security-Policy-Report-Only"]);
  assert.equal(a.h["Content-Security-Policy"], undefined);
  const b = fakeRes();
  applyCsp({ url: "/studio/" }, b, { SERIES_CSP: "enforce" });
  assert.ok(b.h["Content-Security-Policy"]);
  assert.equal(b.h["Content-Security-Policy-Report-Only"], undefined);
  const c = fakeRes();
  applyCsp({ url: "/studio/" }, c, { SERIES_CSP: "off" });
  assert.deepEqual(c.h, {});
});

test("the studio policy is strict on scripts; only the login page allows inline scripts", () => {
  const studio = buildCsp("/studio/");
  assert.match(studio, /script-src 'self' https:\/\/static\.cloudflareinsights\.com(;|$)/);
  assert.doesNotMatch(studio, /script-src[^;]*unsafe-inline/);
  assert.match(studio, /object-src 'none'/);
  assert.match(studio, /static\.cloudflareinsights\.com/);
  assert.match(studio, /connect-src 'self' https:\/\/cloudflareinsights\.com/);
  assert.match(studio, /frame-ancestors 'self'/);
  assert.match(studio, new RegExp(`report-uri ${CSP_REPORT_PATH.replace(/\//g, "\/")}`));
  const login = buildCsp("/login");
  assert.doesNotMatch(login, /script-src[^;]*unsafe-inline/);
  assert.match(login, /fonts\.googleapis\.com/);
  assert.equal(buildCsp("/login?next=1".split("?")[0]), login);
});

test("query strings do not change the policy chosen for /login", () => {
  const r = fakeRes();
  applyCsp({ url: "/login?x=1" }, r, {});
  assert.match(r.h["Content-Security-Policy-Report-Only"], /fonts\.googleapis\.com/);
});

test("summarizeReport reads both report formats and strips query strings", () => {
  const legacy = summarizeReport(JSON.stringify({ "csp-report": { "violated-directive": "script-src-elem", "blocked-uri": "https://evil.test/x.js?token=1", "document-uri": "https://lab.w3ir.io/studio/?a=b" } }));
  assert.equal(legacy.directive, "script-src-elem");
  assert.equal(legacy.blocked, "https://evil.test/x.js");
  assert.equal(legacy.document, "https://lab.w3ir.io/studio/");
  const modern = summarizeReport({ effectiveDirective: "x", "effective-directive": "img-src", blockedURL: "data" });
  assert.equal(modern.directive, "img-src");
  assert.equal(summarizeReport("not json"), null);
  assert.equal(summarizeReport("{}"), null);
  assert.equal(summarizeReport(null), null);
});

test("the log prints the first occurrence, counts repeats and caps distinct entries", () => {
  const lines = [];
  const log = createCspLog({ max: 2, log: (l) => lines.push(l) });
  const a = { directive: "img-src", blocked: "a", document: "d" };
  for (let i = 0; i < 3; i++) log.record(a);
  assert.equal(lines.length, 1);
  assert.equal(log.counts()["img-src|a|d"], 3);
  log.record({ ...a, blocked: "b" });
  assert.equal(log.record({ ...a, blocked: "c" }), false, "third distinct entry is dropped");
  assert.equal(log.record(null), false);
});
