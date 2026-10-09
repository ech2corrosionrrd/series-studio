import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAlerts, backupStatus, cgroupMemory, createRequestMetrics, diskSnapshot, normalizeRoute, percentile, platformCounts, processSnapshot, treeBytes, treeBytesCached } from "../src/sysinfo.mjs";
import { DatabaseSync } from "node:sqlite";

test("normalizeRoute collapses ids, slugs and static files into groups", () => {
  assert.equal(normalizeRoute("/api/credits/sol/order?x=1"), "/api/credits/sol/order");
  assert.equal(normalizeRoute("/out/set/12.png"), "/out/*");
  assert.equal(normalizeRoute("/studio/app.js"), "/studio/*");
  assert.equal(normalizeRoute("/studio/"), "/studio/");
  assert.equal(normalizeRoute("/studio/docs/export"), "/studio/docs/*");
  assert.equal(normalizeRoute("/c/my-lions"), "/c/:slug");
  assert.equal(normalizeRoute("/api/recipes/123/edit"), "/api/recipes/:id/edit");
  assert.equal(normalizeRoute("/api/x/deadbeef1234"), "/api/x/:id");
  assert.equal(normalizeRoute(""), "/");
});

test("percentile handles empty, single and ordered data", () => {
  assert.equal(percentile([], 95), 0);
  assert.equal(percentile([7], 50), 7);
  const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentile(s, 50), 5);
  assert.equal(percentile(s, 95), 10);
});

test("request metrics: classes, percentiles, slowest routes, 5xx tail and the ring cap", () => {
  let t = 1_000_000;
  const m = createRequestMetrics({ max: 50, now: () => t });
  for (let i = 0; i < 6; i++) m.record({ pathname: "/api/slow", status: 200, ms: 400 + i });
  for (let i = 0; i < 20; i++) m.record({ pathname: "/studio/app.js", status: 304, ms: 2 });
  m.record({ pathname: "/api/boom", status: 500, ms: 30, method: "POST" });
  m.record({ pathname: "/api/nope", status: 404, ms: 1 });
  t += 1000;
  const s = m.snapshot();
  assert.equal(s.total, 28);
  assert.deepEqual(s.byClass, { "2xx": 6, "3xx": 20, "4xx": 1, "5xx": 1, other: 0 });
  assert.equal(s.slowest[0].route, "/api/slow");
  assert.ok(s.slowest[0].p95 >= 400);
  assert.equal(s.busiest[0].route, "/studio/*");
  assert.equal(s.recentErrors[0].route, "/api/boom");
  assert.equal(s.recentErrors[0].method, "POST");
  assert.equal(s.errorSample, 28);
  assert.ok(s.errorRateRecent > 0.03 && s.errorRateRecent < 0.04);
  for (let i = 0; i < 200; i++) m.record({ pathname: "/health", status: 200, ms: 1 });
  assert.equal(m.snapshot().window, 50, "the ring keeps only the last `max` samples");
  assert.equal(m.snapshot().total, 228, "the total keeps counting");
});

test("streamed responses (SSE) count in totals but not in timings",()=>{
  const m = createRequestMetrics({ now: () => 1000 });
  m.record({ pathname: "/api/generate", status: 200, ms: 180000, stream: true });
  for (let i = 0; i < 4; i++) m.record({ pathname: "/api/x", status: 200, ms: 10 });
  const s = m.snapshot();
  assert.equal(s.total, 5);
  assert.equal(s.byClass["2xx"], 5);
  assert.equal(s.window, 4);
  assert.ok(s.p95 < 100, "a 3-minute stream does not wreck the percentiles");
});

test("cgroupMemory reads limit and usage and ignores 'unlimited'", () => {
  const files = { "/sys/fs/cgroup/memory.max": 536870912, "/sys/fs/cgroup/memory.current": 100 * 1024 * 1024 };
  const m = cgroupMemory((f) => files[f] ?? null);
  assert.equal(m.limitMb, 512);
  assert.equal(m.usedMb, 100);
  assert.equal(cgroupMemory(() => null), null);
});

test("processSnapshot and diskSnapshot return sane numbers", () => {
  const p = processSnapshot();
  assert.ok(p.rssMb > 0 && p.heapUsedMb > 0 && p.uptimeSec >= 0 && p.cpus >= 1);
  assert.match(p.node, /^v\d+/);
  const d = diskSnapshot(tmpdir());
  assert.ok(d.totalGb > 0 && d.usedPct >= 0 && d.usedPct <= 100);
  assert.equal(diskSnapshot(join(tmpdir(), "definitely-not-there-xyz")), null);
});

test("treeBytes sums files, respects the file limit, and the cache reuses the result", () => {
  const root = mkdtempSync(join(tmpdir(), "sys-"));
  try {
    mkdirSync(join(root, "a", "b"), { recursive: true });
    writeFileSync(join(root, "x.bin"), Buffer.alloc(1024 * 1024));
    writeFileSync(join(root, "a", "b", "y.bin"), Buffer.alloc(512 * 1024));
    const r = treeBytes(root);
    assert.equal(r.files, 2);
    assert.equal(r.mb, 1.5);
    assert.equal(r.truncated, false);
    assert.equal(treeBytes(root, { maxFiles: 1 }).truncated, true);
    let t = 0;
    const a = treeBytesCached(root, 60_000, () => t);
    writeFileSync(join(root, "z.bin"), Buffer.alloc(1024 * 1024));
    t += 1000;
    assert.equal(treeBytesCached(root, 60_000, () => t).mb, a.mb, "cached within the ttl");
    t += 120_000;
    assert.ok(treeBytesCached(root, 60_000, () => t).mb > a.mb, "refreshed after the ttl");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("backupStatus reads the host's status file and computes the age", () => {
  const root = mkdtempSync(join(tmpdir(), "bk-"));
  try {
    assert.deepEqual(backupStatus(root), { present: false });
    const at = "2026-10-10T10:00:00Z";
    writeFileSync(join(root, "backup-status.json"), JSON.stringify({ at, kind: "hourly", ok: true, offsite: false, hourly: 48, daily: 7, weekly: 4, bytes: 5 * 1024 * 1024 }));
    const s = backupStatus(root, Date.parse("2026-10-10T10:30:00Z"));
    assert.equal(s.present, true);
    assert.equal(s.ageMin, 30);
    assert.equal(s.sizeMb, 5);
    assert.equal(s.hourly, 48);
    writeFileSync(join(root, "backup-status.json"), "{not json");
    const bad = backupStatus(root);
    assert.equal(bad.ok, false);
    assert.equal(bad.unreadable, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("platformCounts counts from the ledger and survives missing tables", () => {
  const db = new DatabaseSync(":memory:");
  const now = new Date("2026-10-10T12:00:00Z");
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, created_at TEXT)");
  db.exec("CREATE TABLE payments (id INTEGER PRIMARY KEY, amount_usd REAL, created_at TEXT)");
  db.prepare("INSERT INTO users (created_at) VALUES (?)").run("2026-10-10T08:00:00Z");
  db.prepare("INSERT INTO users (created_at) VALUES (?)").run("2026-10-06T08:00:00Z");
  db.prepare("INSERT INTO users (created_at) VALUES (?)").run("2026-09-01T08:00:00Z");
  db.prepare("INSERT INTO payments (amount_usd, created_at) VALUES (?, ?)").run(4.99, "2026-10-10T09:00:00Z");
  const c = platformCounts(db, now);
  assert.equal(c.usersTotal, 3);
  assert.equal(c.users24h, 1);
  assert.equal(c.users7d, 2);
  assert.equal(c.payments24h, 1);
  assert.equal(c.revenue24hUsd, 4.99);
  assert.equal(c.solPending, null, "sol_orders table is absent here");
});

test("buildAlerts raises the right levels and sorts bad first", () => {
  assert.deepEqual(buildAlerts({}), []);
  const bad = buildAlerts({
    disk: { usedPct: 95, freeGb: 3 },
    process: { rssMb: 480, container: { limitMb: 512, usedMb: 480 } },
    backup: { present: true, ok: true, ageMin: 200, offsite: false },
    requests: { errorSample: 100, errorRateRecent: 0.06 },
    cspTotal: 2,
  });
  const codes = bad.map((a) => `${a.level}:${a.code}`);
  assert.ok(codes.includes("bad:disk.high"));
  assert.ok(codes.includes("bad:mem.high"));
  assert.ok(codes.includes("bad:backup.stale"));
  assert.ok(codes.includes("info:backup.localOnly"));
  assert.ok(codes.includes("bad:http.errors"));
  assert.ok(codes.includes("info:csp.reports"));
  assert.equal(bad[0].level, "bad");
  assert.equal(bad[bad.length - 1].level, "info");
  const warn = buildAlerts({ disk: { usedPct: 88, freeGb: 9 }, backup: { present: true, ok: true, ageMin: 100, offsite: true }, requests: { errorSample: 100, errorRateRecent: 0.03 } });
  assert.deepEqual(warn.map((a) => `${a.level}:${a.code}`).sort(), ["warn:backup.stale", "warn:disk.high", "warn:http.errors"]);
  assert.equal(buildAlerts({ requests: { errorSample: 5, errorRateRecent: 1 } }).length, 0, "too few samples to judge");
  assert.equal(buildAlerts({ requests: { errorSample: 57, errorRateRecent: 1 / 57 } }).length, 0, "a single 5xx is not an alert");
  assert.equal(buildAlerts({ backup: { present: false } })[0].code, "backup.unknown");
  assert.equal(buildAlerts({ backup: { present: true, ok: false, at: "x" } })[0].code, "backup.failed");
});
