import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { DOC_PAGES } from "../scripts/site-pages.mjs";
import { renderPublicPage, studioDocsResponse } from "../scripts/site-html.mjs";

const root = join(import.meta.dirname, "..");
const SLUGS = ["guide", ...DOC_PAGES.map((p) => p.slug)];
const COMMANDS = [
  /preset/,
  /layers|Скласти шари|Compose layers/,
  /allowlist/,
  /series upload|upload/,
  /series hidden|\bhidden\b/,
  /series guards|\bguards\b/,
  /mplx cm create/,
  /series verify|\bverify\b/,
  /series mint/,
  /series reveal/,
];

function get(port, path) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

function startServer(env) {
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (c) => { log += c; });
  child.stderr.on("data", (c) => { log += c; });
  let stop = false;
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stop = true;
      reject(new Error(`server did not listen\n${log}`));
    }, 15000);
    const tick = () => {
      if (stop) return;
      get(env.PORT, "/studio/docs/guide/").then((res) => {
        if (stop) return;
        if (res.status === 200) {
          stop = true;
          clearTimeout(timer);
          resolve();
        } else setTimeout(tick, 80);
      }).catch(() => { if (!stop) setTimeout(tick, 80); });
    };
    tick();
  });
  return { child, ready, log: () => log };
}

test("local studio docs are the creator pages, in both languages, without the public host", () => {
  const pages = [];
  for (const lang of ["uk", "en"]) {
    const prefix = lang === "en" ? "/studio/docs/en" : "/studio/docs";
    const hub = studioDocsResponse(`${prefix}/`);
    assert.equal(hub.status, 200);
    assert.match(hub.body, /<html lang="(uk|en)">/);
    assert.doesNotMatch(hub.body, /w3ir\.io/);
    assert.match(hub.body, new RegExp(`href="${prefix}/guide/"`));
    for (const slug of SLUGS) {
      const hit = studioDocsResponse(`${prefix}/${slug}/`);
      assert.equal(hit.status, 200, slug);
      assert.match(hit.body, /<link rel="stylesheet" href="\/studio\/docs\/site\.css">/);
      assert.doesNotMatch(hit.body, /w3ir\.io/);
      assert.match(hit.body, /href="\/studio\/"/);
      pages.push(hit.body);
      const pub = renderPublicPage(lang, slug);
      assert.match(pub, /w3ir\.io/);
      assert.doesNotMatch(hit.body, /w3ir\.io/);
    }
  }
  const all = pages.join("\n");
  for (const re of COMMANDS) assert.match(all, re);
  const banned = [/POST \/api/, /GET \/api/, /pinata/i, /\bmother\b/i, /Хвилі 1/, /waves 1–25/i, /docs\/API\.md/, /docs\/ROADMAP\.md/];
  for (const re of banned) assert.doesNotMatch(all, re);

  assert.equal(studioDocsResponse("/studio/docs").status, 302);
  assert.equal(studioDocsResponse("/studio/docs").location, "/studio/docs/");
  assert.equal(studioDocsResponse("/studio/docs/guide").location, "/studio/docs/guide/");
  assert.equal(studioDocsResponse("/studio/docs/site.css").type.startsWith("text/css"), true);
  assert.equal(studioDocsResponse("/studio/docs/api/").status, 404);
  assert.equal(studioDocsResponse("/studio/docs/en/roadmap/").status, 404);
  assert.equal(studioDocsResponse("/api/health"), null);

  const app = readFileSync(join(root, "server/ui/app.js"), "utf8");
  assert.match(app, /\/studio\/docs\/\$\{getLocale\(\) === "en" \? "en\/" : ""\}/);
  for (const slug of SLUGS) assert.match(app, new RegExp(`"${slug}"`));
  assert.doesNotMatch(app, /docs\/API\.md|docs\/ROADMAP\.md|docs\/GUIDE\.md|docs\/STAGES\.md|README\.md/);

  const uk = readFileSync(join(root, "server/ui/locales/uk.js"), "utf8");
  const en = readFileSync(join(root, "server/ui/locales/en.js"), "utf8");
  assert.match(uk, /series mint/);
  assert.match(uk, /series reveal/);
  assert.match(uk, /mplx cm create/);
  assert.match(en, /series mint/);
  assert.match(en, /allowlist/);
  assert.doesNotMatch(uk, /help\.doc\.(api|roadmap|readme|studioUi)/);
  assert.doesNotMatch(en, /help\.doc\.(api|roadmap|readme|studioUi)/);
});

test("the running studio serves creator docs on loopback without a deploy", async () => {
  const dir = mkdtempSync(join(tmpdir(), "series-docs-"));
  const port = 18000 + Math.floor(Math.random() * 2000);
  const baseEnv = {
    HOST: "127.0.0.1",
    PORT: String(port),
    SERIES_DATA_DIR: dir,
    SERIES_KEYS_FILE: join(dir, "no-keys.env"),
    USERS_DB_PATH: join(dir, "users.db"),
    AUTH_SESSION_SECRET: "docs-test",
    HOLDER_SYNC_INTERVAL_SECONDS: "0",
    FULFILLMENT_RECONCILE_INTERVAL_SECONDS: "0",
    OFFLINE: "1",
  };
  const servers = [];
  try {
    for (const mode of ["local", "public"]) {
      const srv = startServer({ ...baseEnv, PORT: String(port + (mode === "public" ? 1 : 0)), SERIES_MODE: mode });
      servers.push(srv);
      await srv.ready;
      const p = Number(baseEnv.PORT) + (mode === "public" ? 1 : 0);
      const guide = await get(p, "/studio/docs/guide/");
      assert.equal(guide.status, 200, mode);
      assert.match(guide.text, /series mint/);
      assert.match(guide.text, /series reveal/);
      assert.doesNotMatch(guide.text, /w3ir\.io/);
      const en = await get(p, "/studio/docs/en/export/");
      assert.equal(en.status, 200, mode);
      assert.match(en.text, /Core Candy Machine/);
      assert.match(en.text, /allowlist/);
      assert.match(en.text, /series reveal/);
      assert.match(en.text, /html lang="en"/);
      const css = await get(p, "/studio/docs/site.css");
      assert.equal(css.status, 200);
      assert.match(css.headers["content-type"], /text\/css/);
      if (mode === "public") {
        const shell = await get(p, "/studio/");
        assert.equal(shell.status, 302);
        assert.match(shell.headers.location || "", /\/login/);
      }
    }
  } finally {
    for (const srv of servers) srv.child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
