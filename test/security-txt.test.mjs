// RFC 9116 (BETA-REVIEW B19): a public channel for vulnerability reports.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startStudio } from "./helpers/studio-server.mjs";

let studio;
before(async () => { studio = await startStudio(); });
after(() => studio?.stop());

test("/.well-known/security.txt is public, names a contact and a future expiry", async () => {
  const r = await studio.call("GET", "/.well-known/security.txt", { auth: false });
  assert.equal(r.status, 200);
  assert.match(r.headers["content-type"], /^text\/plain/);
  assert.match(r.text, /^Contact: mailto:\S+@\S+$/m);
  const expires = /^Expires: (\S+)$/m.exec(r.text)?.[1];
  assert.ok(Date.parse(expires) > Date.now() + 200 * 86_400_000, `expiry ${expires} is far enough ahead`);
});

test("HEAD answers too, for monitors", async () => {
  const r = await studio.call("HEAD", "/.well-known/security.txt", { auth: false });
  assert.equal(r.status, 200);
});
