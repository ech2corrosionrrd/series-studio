// ZIP із /out/ віддається вкладенням, і другий файл у тому самому сеансі теж.
// fetch + Blob у вкладці свідомо не використовується: архів великої серії не вміщається в пам'ять.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startStudio } from "./helpers/studio-server.mjs";

describe("ZIP download headers", () => {
  let studio;
  let bundles;

  before(async () => {
    studio = await startStudio();
    await studio.signIn();
    await studio.call("GET", "/api/me");
    const safe = studio.user.address.replace(/[^a-zA-Z0-9]/g, "");
    bundles = join(studio.dir, "users", safe, "out", "bundles");
    mkdirSync(bundles, { recursive: true });
  });

  after(async () => {
    await studio?.stop();
  });

  it("serves two zip files in a row as attachments", async () => {
    writeFileSync(join(bundles, "a.zip"), "PK0304aaa");
    writeFileSync(join(bundles, "b.zip"), "PK0304bbb");
    const a = await studio.call("GET", "/out/bundles/a.zip", { raw: true });
    const b = await studio.call("GET", "/out/bundles/b.zip", { raw: true });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(a.headers["content-type"], "application/zip");
    assert.equal(b.headers["content-type"], "application/zip");
    assert.equal(a.headers["content-disposition"], 'attachment; filename="a.zip"');
    assert.equal(b.headers["content-disposition"], 'attachment; filename="b.zip"');
    assert.equal(a.buf.toString("utf8"), "PK0304aaa");
    assert.equal(b.buf.toString("utf8"), "PK0304bbb");
  });

  it("leaves a png without an attachment header", async () => {
    writeFileSync(join(bundles, "c.png"), "not-a-real-png");
    const r = await studio.call("GET", "/out/bundles/c.png", { raw: true });
    assert.equal(r.status, 200);
    assert.match(String(r.headers["content-type"]), /^image\/png/);
    assert.equal(r.headers["content-disposition"], undefined);
  });

  it("keeps a percent-encoded name inside one attachment header", async () => {
    // `new URL` leaves %22 in the path, so the file on disk is the encoded name.
    // The header must stay a single parameter: no extra header, no raw quote.
    writeFileSync(join(bundles, "bad%22name.zip"), "PK0304q");
    const r = await studio.call("GET", "/out/bundles/bad%22name.zip", { raw: true });
    assert.equal(r.status, 200);
    assert.equal(r.headers["content-disposition"], 'attachment; filename="bad%22name.zip"');
    assert.equal(r.headers["x-injected"], undefined);
    assert.equal(r.buf.toString("utf8"), "PK0304q");
  });

  it("still requires a session", async () => {
    const r = await studio.call("GET", "/out/bundles/a.zip", { raw: true, auth: false });
    assert.equal(r.status, 401);
  });
});
