/**
 * Системна інформація для адмін-панелі (вкладка «Система», `GET /api/admin/system`).
 *
 * Лише читання й усе в пам'яті процесу: метрики запитів живуть до перезапуску, диск і розміри
 * каталогів беруться з файлової системи, статус бекапів приходить файлом `backup-status.json`,
 * який пише хостовий `backup.sh` у каталог даних. Секретів тут немає: прапорці віддаються
 * булевими значеннями.
 */
import os from "node:os";
import { existsSync, readFileSync, readdirSync, statSync, statfsSync } from "node:fs";
import { join } from "node:path";

// ---------- запити ----------

/** Стискає шлях до групи маршруту, щоб метрики не розпухали від id, слагів і статики. */
export function normalizeRoute(pathname) {
  const p = String(pathname || "/").split("?")[0];
  if (p.startsWith("/out/")) return "/out/*";
  if (p.startsWith("/input/")) return "/input/*";
  if (p.startsWith("/studio/docs/")) return "/studio/docs/*";
  if (p.startsWith("/studio/")) return p === "/studio/" ? "/studio/" : "/studio/*";
  if (p.startsWith("/c/")) return "/c/:slug";
  return (
    p
      .split("/")
      .map((seg) => (/^\d+$/.test(seg) || /^[0-9a-f]{8,}$/i.test(seg) ? ":id" : seg))
      .join("/")
      .slice(0, 80) || "/"
  );
}

export function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return 0;
  const i = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1));
  return sortedAsc[i];
}

const classOf = (status) => (status >= 200 && status < 300 ? "2xx" : status >= 300 && status < 400 ? "3xx" : status >= 400 && status < 500 ? "4xx" : status >= 500 ? "5xx" : "other");

export function createRequestMetrics({ max = 2000, now = () => Date.now() } = {}) {
  const ring = [];
  const errors = [];
  const byClass = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0, other: 0 };
  let total = 0;
  const startedAt = now();
  return {
    record({ method = "GET", pathname = "/", status = 0, ms = 0, stream = false } = {}) {
      const route = normalizeRoute(pathname);
      const at = now();
      if (stream) {
        // SSE триває хвилини: рахуємо в загальних лічильниках, але не в часі відповіді
        total += 1;
        byClass[classOf(status)] += 1;
        return;
      }
      ring.push({ route, status, ms, at });
      if (ring.length > max) ring.shift();
      total += 1;
      byClass[classOf(status)] += 1;
      if (status >= 500) {
        errors.push({ route, method: String(method), status, at });
        if (errors.length > 20) errors.shift();
      }
    },
    snapshot() {
      const t = now();
      const sorted = ring.map((r) => r.ms).sort((a, b) => a - b);
      const groups = new Map();
      for (const r of ring) {
        const g = groups.get(r.route) || { route: r.route, count: 0, errors: 0, ms: [] };
        g.count += 1;
        if (r.status >= 500) g.errors += 1;
        g.ms.push(r.ms);
        groups.set(r.route, g);
      }
      const rows = [...groups.values()].map((g) => {
        const s = g.ms.sort((a, b) => a - b);
        return { route: g.route, count: g.count, errors: g.errors, p50: Math.round(percentile(s, 50)), p95: Math.round(percentile(s, 95)), max: Math.round(s[s.length - 1] || 0) };
      });
      const last200 = ring.slice(-200);
      const err200 = last200.filter((r) => r.status >= 500).length;
      const recent5 = ring.filter((r) => r.at >= t - 5 * 60_000).length;
      return {
        since: new Date(startedAt).toISOString(),
        total,
        byClass: { ...byClass },
        window: ring.length,
        p50: Math.round(percentile(sorted, 50)),
        p95: Math.round(percentile(sorted, 95)),
        rps5m: Math.round((recent5 / 300) * 100) / 100,
        errorRateRecent: last200.length ? Math.round((err200 / last200.length) * 1000) / 1000 : 0,
        errorSample: last200.length,
        slowest: rows.filter((r) => r.count >= 3).sort((a, b) => b.p95 - a.p95).slice(0, 8),
        busiest: rows.sort((a, b) => b.count - a.count).slice(0, 8),
        recentErrors: errors.slice(-8).reverse().map((e) => ({ ...e, at: new Date(e.at).toISOString() })),
      };
    },
  };
}

// ---------- процес, пам'ять, диск ----------

const MB = 1024 * 1024;
const round1 = (n) => Math.round(n * 10) / 10;

function readNumber(file) {
  try {
    const v = readFileSync(file, "utf8").trim();
    if (!v || v === "max") return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 && n < 2 ** 50 ? n : null;
  } catch {
    return null;
  }
}

/** Ліміт і поточне використання пам'яті контейнера (cgroup v2, потім v1); null поза контейнером. */
export function cgroupMemory(read = readNumber) {
  const limit = read("/sys/fs/cgroup/memory.max") ?? read("/sys/fs/cgroup/memory/memory.limit_in_bytes");
  if (!limit) return null;
  const used = read("/sys/fs/cgroup/memory.current") ?? read("/sys/fs/cgroup/memory/memory.usage_in_bytes");
  return { limitMb: round1(limit / MB), usedMb: used ? round1(used / MB) : null };
}

export function processSnapshot(startedAtMs = Date.now() - process.uptime() * 1000) {
  const m = process.memoryUsage();
  return {
    pid: process.pid,
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    startedAt: new Date(startedAtMs).toISOString(),
    uptimeSec: Math.round(process.uptime()),
    rssMb: round1(m.rss / MB),
    heapUsedMb: round1(m.heapUsed / MB),
    heapTotalMb: round1(m.heapTotal / MB),
    externalMb: round1(m.external / MB),
    loadavg: os.loadavg().map((x) => Math.round(x * 100) / 100),
    cpus: os.cpus().length,
    hostFreeMemMb: Math.round(os.freemem() / MB),
    hostTotalMemMb: Math.round(os.totalmem() / MB),
    container: cgroupMemory(),
  };
}

export function diskSnapshot(dir) {
  try {
    const s = statfsSync(dir);
    const total = Number(s.blocks) * Number(s.bsize);
    const free = Number(s.bavail) * Number(s.bsize);
    const used = Math.max(0, total - free);
    return { path: dir, totalGb: round1(total / 1024 ** 3), freeGb: round1(free / 1024 ** 3), usedPct: total ? Math.round((used / total) * 1000) / 10 : 0 };
  } catch {
    return null;
  }
}

/** Розмір дерева каталогів з обмеженням за кількістю файлів і часом, щоб не вішати сервер. */
export function treeBytes(dir, { maxFiles = 30000, maxMs = 1500, now = () => Date.now() } = {}) {
  const t0 = now();
  let bytes = 0;
  let files = 0;
  let truncated = false;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (files >= maxFiles || now() - t0 > maxMs) {
        truncated = true;
        stack.length = 0;
        break;
      }
      const p = join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        try {
          bytes += statSync(p).size;
          files += 1;
        } catch {
          /* файл зник */
        }
      }
    }
  }
  return { mb: round1(bytes / MB), files, truncated };
}

const treeCache = new Map();
/** `treeBytes` із кешем (за замовчуванням 5 хв): сторінка адмінки оновлюється частіше, ніж росте диск. */
export function treeBytesCached(dir, ttlMs = 5 * 60_000, now = () => Date.now()) {
  const hit = treeCache.get(dir);
  if (hit && now() - hit.at < ttlMs) return hit.value;
  const value = treeBytes(dir);
  treeCache.set(dir, { at: now(), value });
  return value;
}

export function fileMb(file) {
  try {
    return round1(statSync(file).size / MB);
  } catch {
    return null;
  }
}

// ---------- бекапи ----------

/** Читає `backup-status.json`, який пише хостовий `backup.sh`; `present: false`, якщо файлу немає. */
export function backupStatus(dataDir, nowMs = Date.now()) {
  const file = join(dataDir, "backup-status.json");
  if (!existsSync(file)) return { present: false };
  try {
    const j = JSON.parse(readFileSync(file, "utf8"));
    const at = Date.parse(j.at);
    return {
      present: true,
      ok: j.ok !== false,
      kind: String(j.kind || ""),
      at: Number.isFinite(at) ? new Date(at).toISOString() : null,
      ageMin: Number.isFinite(at) ? Math.max(0, Math.round((nowMs - at) / 60000)) : null,
      offsite: Boolean(j.offsite),
      hourly: Number(j.hourly) || 0,
      daily: Number(j.daily) || 0,
      weekly: Number(j.weekly) || 0,
      sizeMb: Number.isFinite(Number(j.bytes)) ? round1(Number(j.bytes) / MB) : null,
    };
  } catch {
    return { present: true, ok: false, kind: "", at: null, ageMin: null, offsite: false, hourly: 0, daily: 0, weekly: 0, sizeMb: null, unreadable: true };
  }
}

// ---------- лічильники платформи ----------

export function platformCounts(db, now = new Date()) {
  const iso = (ms) => new Date(now.getTime() - ms).toISOString();
  const one = (sql, ...args) => {
    try {
      return db.prepare(sql).get(...args);
    } catch {
      return null;
    }
  };
  const n = (row, key = "n") => (row ? Number(row[key]) || 0 : null);
  const pay = one("SELECT COUNT(*) AS n, COALESCE(SUM(amount_usd), 0) AS usd FROM payments WHERE created_at >= ?", iso(86_400_000));
  return {
    usersTotal: n(one("SELECT COUNT(*) AS n FROM users")),
    users24h: n(one("SELECT COUNT(*) AS n FROM users WHERE created_at >= ?", iso(86_400_000))),
    users7d: n(one("SELECT COUNT(*) AS n FROM users WHERE created_at >= ?", iso(7 * 86_400_000))),
    payments24h: n(pay),
    revenue24hUsd: pay ? Math.round(Number(pay.usd) * 100) / 100 : null,
    solPending: n(one("SELECT COUNT(*) AS n FROM sol_orders WHERE status = 'pending'")),
    solPaid24h: n(one("SELECT COUNT(*) AS n FROM sol_orders WHERE status = 'paid' AND paid_at >= ?", iso(86_400_000))),
  };
}

// ---------- тривоги ----------

/** Чисті правила: повертають `{ level: bad|warn|info, code, params }`, переклад робить інтерфейс. */
export function buildAlerts({ disk = null, process: proc = null, backup = null, requests = null, cspTotal = 0 } = {}) {
  const out = [];
  const add = (level, code, params = {}) => out.push({ level, code, params });
  if (disk) {
    if (disk.usedPct >= 93) add("bad", "disk.high", { pct: disk.usedPct, freeGb: disk.freeGb });
    else if (disk.usedPct >= 85) add("warn", "disk.high", { pct: disk.usedPct, freeGb: disk.freeGb });
  }
  if (proc) {
    const c = proc.container;
    const pct = c?.limitMb ? ((c.usedMb ?? proc.rssMb) / c.limitMb) * 100 : null;
    if (pct != null) {
      const p = Math.round(pct);
      if (pct >= 90) add("bad", "mem.high", { pct: p });
      else if (pct >= 75) add("warn", "mem.high", { pct: p });
    }
  }
  if (backup) {
    if (!backup.present) add("warn", "backup.unknown");
    else if (!backup.ok) add("bad", "backup.failed", { at: backup.at });
    else {
      if (backup.ageMin != null && backup.ageMin > 180) add("bad", "backup.stale", { min: backup.ageMin });
      else if (backup.ageMin != null && backup.ageMin > 90) add("warn", "backup.stale", { min: backup.ageMin });
      if (!backup.offsite) add("info", "backup.localOnly");
    }
  }
  if (requests && requests.errorSample >= 20) {
    // одна випадкова 5xx не тривога: потрібно щонайменше 3 помилки у вибірці
    const count = Math.round(requests.errorRateRecent * requests.errorSample);
    const pct = Math.round(requests.errorRateRecent * 1000) / 10;
    if (count >= 3 && requests.errorRateRecent >= 0.05) add("bad", "http.errors", { pct });
    else if (count >= 3 && requests.errorRateRecent >= 0.01) add("warn", "http.errors", { pct });
  }
  if (cspTotal > 0) add("info", "csp.reports", { count: cspTotal });
  const order = { bad: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}
