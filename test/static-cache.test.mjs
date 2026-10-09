import test from "node:test";
import assert from "node:assert/strict";
import { etagFor, etagMatches, staticResponse } from "../src/static-cache.mjs";

test("the ETag depends on the content only", () => {
  assert.equal(etagFor(Buffer.from("a")), etagFor(Buffer.from("a")));
  assert.notEqual(etagFor(Buffer.from("a")), etagFor(Buffer.from("b")));
  assert.match(etagFor(Buffer.from("a")), /^"[0-9a-f]{24}"$/);
});

test("If-None-Match: exact, weak, list and wildcard forms", () => {
  const tag = etagFor(Buffer.from("x"));
  assert.equal(etagMatches(tag, tag), true);
  assert.equal(etagMatches(`W/${tag}`, tag), true);
  assert.equal(etagMatches(`"other", ${tag}`, tag), true);
  assert.equal(etagMatches("*", tag), true);
  assert.equal(etagMatches('"other"', tag), false);
  assert.equal(etagMatches("", tag), false);
  assert.equal(etagMatches(undefined, tag), false);
});

test("staticResponse revalidates instead of caching blindly, and answers 304 on a match", () => {
  const body = Buffer.from("console.log(1)");
  const first = staticResponse(body, {});
  assert.equal(first.status, 200);
  assert.equal(first.headers["Cache-Control"], "private, no-cache", "private: Cloudflare must not cache it");
  const again = staticResponse(body, { "if-none-match": first.headers.ETag });
  assert.equal(again.status, 304);
  const changed = staticResponse(Buffer.from("console.log(2)"), { "if-none-match": first.headers.ETag });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.headers.ETag, first.headers.ETag);
});
