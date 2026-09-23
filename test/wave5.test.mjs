import test from "node:test";
import assert from "node:assert/strict";
import { mergeEditions } from "../src/index.mjs";

test("mergeEditions unions by edition, sorted", () => {
  const a = [
    { edition: 2, url: "/a/2.png" },
    { edition: 1, url: "/a/1.png" },
  ];
  const b = [
    { edition: 3, url: "/b/3.png" },
    { edition: 1, url: "/b/1.png" },
  ];
  const rows = mergeEditions(a, b);
  assert.deepEqual(
    rows.map((r) => r.edition),
    [1, 2, 3]
  );
  assert.equal(rows[0].a.url, "/a/1.png");
  assert.equal(rows[0].b.url, "/b/1.png");
  assert.equal(rows[1].a.url, "/a/2.png");
  assert.equal(rows[1].b, null);
  assert.equal(rows[2].a, null);
  assert.equal(rows[2].b.url, "/b/3.png");
});

test("mergeEditions handles empty / null / string editions", () => {
  assert.deepEqual(mergeEditions(null, undefined), []);
  assert.deepEqual(mergeEditions([], []), []);
  const rows = mergeEditions([{ edition: "5", url: "/a/5.png" }], [{ edition: 5, url: "/b/5.png" }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].edition, 5);
  assert.ok(rows[0].a);
  assert.ok(rows[0].b);
});

test("mergeEditions skips invalid editions", () => {
  const rows = mergeEditions(
    [{ edition: null, url: "/x" }, { edition: "nope", url: "/y" }, { edition: 1, url: "/a/1.png" }],
    [{ url: "/z" }]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].edition, 1);
});
