#!/usr/bin/env node
/**
 * Contract check: compares two deployments of the same HTTP API.
 *
 * WHY: external clients (Passport `/gremlin/*`, the Telegram Mini-App `/api/v1/tma/*`, sign-in
 * `/auth/*`) must not notice when the service moves to another host or a new build. This tool
 * sends the same requests to both and reports where status codes or JSON shapes differ.
 *
 * WHEN: manual, optional. Not part of `npm test` or CI. Use it before switching traffic to a new
 * host, or after changing the partner routes, with the old and new base URLs.
 *
 * SAFETY: only GET requests. Nothing is written, generated or paid for. No private key is used:
 * `--gremlin-key` / `--tma-key` are partner API keys, `--wallet` is a public address.
 *
 * HOW:
 *   node scripts/contract-check.mjs --old https://old.example --new https://lab.w3ir.io  *     [--gremlin-key $GREMLIN_API_KEY] [--tma-key $TMA_API_KEY] [--wallet <addr>]
 *   npm run contract-check -- --old <url> --new <url>
 *
 * Output: one line per request, ✔ match / ✖ difference. Exit code 0 = all match, 1 = differences,
 * 2 = missing arguments. Requests that need a key are skipped when the key is not passed.
 *
 * Expected differences: `/legal` and `/legal/en` now answer 302 to the Terms/Privacy pages on the
 * public site, so an old host that still serves its own legal text will show a difference there.
 * See docs/STANDALONE.md.
 */
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
if (!args.old || !args.new) {
  console.error("usage: contract-check.mjs --old <old base url> --new <series lab base url> [--gremlin-key K] [--tma-key K] [--wallet W]");
  process.exit(2);
}

const wallet = args.wallet || "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV";
const day = new Date().toISOString().slice(0, 10);
const checks = [
  { path: "/health" },
  { path: "/auth/welcome-offer" },
  { path: `/auth/nonce?address=${wallet}`, shapeOnly: true },
  { path: "/auth/nonce?address=nope" },
  { path: "/legal", html: true },
  { path: "/legal/en", html: true },
  { path: "/robots.txt", text: true },
  { path: "/c/definitely-not-a-collection" },
  { path: `/gremlin/activity?wallet=${wallet}&date=${day}` },
  { path: `/gremlin/activity?wallet=${wallet}&date=${day}`, headers: args["gremlin-key"] ? { "X-Gremlin-Key": args["gremlin-key"] } : null },
  { path: `/gremlin/activity?wallet=${wallet}&date=2026-02-30`, headers: args["gremlin-key"] ? { "X-Gremlin-Key": args["gremlin-key"] } : null },
  { path: `/gremlin/holder?wallet=${wallet}`, headers: args["gremlin-key"] ? { "X-Gremlin-Key": args["gremlin-key"] } : null, shapeOnly: true },
  { path: "/api/v1/tma/contract", headers: args["tma-key"] ? { "X-TMA-Key": args["tma-key"] } : null },
  { path: "/api/v1/b2b/status" },
].filter((c) => c.headers !== null);

const shape = (v) => {
  if (Array.isArray(v)) return v.length ? [shape(v[0])] : [];
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, shape(v[k])]));
  return typeof v;
};

async function get(base, c) {
  const res = await fetch(new URL(c.path, base), { headers: c.headers || {}, redirect: "manual" });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}

let failed = 0;
for (const c of checks) {
  const [a, b] = await Promise.all([get(args.old, c), get(args.new, c)]);
  const problems = [];
  if (a.status !== b.status) problems.push(`status ${a.status} ≠ ${b.status}`);
  if (a.json || b.json) {
    const same = c.shapeOnly || a.status >= 400
      ? JSON.stringify(shape(a.json)) === JSON.stringify(shape(b.json))
      : JSON.stringify(a.json) === JSON.stringify(b.json);
    if (!same) problems.push(`body differs\n    old: ${JSON.stringify(a.json).slice(0, 300)}\n    new: ${JSON.stringify(b.json).slice(0, 300)}`);
  } else if (c.text && a.text !== b.text) {
    problems.push("text differs");
  } else if (c.html && a.status === 200 && !b.text.includes("<main")) {
    problems.push("new HTML has no <main>");
  }
  const label = `${c.headers ? "🔑 " : ""}${c.path}`;
  if (problems.length) {
    failed += 1;
    console.log(`✖ ${label}\n  ${problems.join("\n  ")}`);
  } else {
    console.log(`✔ ${label} (${a.status})`);
  }
}
console.log(failed ? `\n${failed} difference(s)` : "\nAll checked contracts match.");
process.exit(failed ? 1 : 0);
