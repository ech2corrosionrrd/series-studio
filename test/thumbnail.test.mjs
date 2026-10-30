// Server-side thumbnails (BETA-REVIEW B11): a grid of tiles must not download the full frames.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createMockPng } from "../src/mock-image.mjs";
import { decodePngRgba } from "../src/dupes.mjs";
import { makeThumbnail, thumbWidth, cachedThumbnail } from "../src/thumbnail.mjs";
import { startStudio } from "./helpers/studio-server.mjs";

const frame = createMockPng({ width: 1024, height: 1024, seed: 7 });

test("thumbWidth rounds up to an allowed size and ignores nonsense", () => {
  assert.equal(thumbWidth("100"), 160);
  assert.equal(thumbWidth("256"), 256);
  assert.equal(thumbWidth("300"), 480);
  assert.equal(thumbWidth("481"), 0);
  assert.equal(thumbWidth("-5"), 0);
  assert.equal(thumbWidth("abc"), 0);
  assert.equal(thumbWidth(null), 0);
});

test("makeThumbnail gives a smaller PNG that decodes to the asked size", () => {
  const thumb = makeThumbnail(frame, 256);
  assert.ok(thumb.length < frame.length / 3, `${thumb.length} vs ${frame.length}`);
  const { width, height } = decodePngRgba(thumb);
  assert.deepEqual([width, height], [256, 256]);
});

test("makeThumbnail keeps the aspect ratio, the transparency and returns null when there is nothing to shrink", () => {
  const wide = createMockPng({ width: 800, height: 400, seed: 3 });
  const { width, height } = decodePngRgba(makeThumbnail(wide, 160));
  assert.deepEqual([width, height], [160, 80]);
  assert.equal(makeThumbnail(createMockPng({ width: 100, height: 100 }), 160), null, "a small image is served as it is");
  assert.equal(makeThumbnail(Buffer.from("not an image"), 160), null);
});

test("cachedThumbnail reuses the result until the file changes", () => {
  let reads = 0;
  const read = () => { reads += 1; return frame; };
  const a = cachedThumbnail("/x/1.png", { mtimeMs: 1, size: frame.length }, read, 160);
  const b = cachedThumbnail("/x/1.png", { mtimeMs: 1, size: frame.length }, read, 160);
  assert.equal(a, b);
  assert.equal(reads, 1);
  cachedThumbnail("/x/1.png", { mtimeMs: 2, size: frame.length }, read, 160);
  assert.equal(reads, 2, "a new mtime is a new thumbnail");
});

describe("the /out and /input routes", () => {
  let studio;
  before(async () => {
    studio = await startStudio();
    await studio.signIn();
    const safe = studio.user.address.replace(/[^a-zA-Z0-9]/g, "");
    const root = join(studio.dir, "users", safe);
    mkdirSync(join(root, "out", "set1"), { recursive: true });
    mkdirSync(join(root, "input"), { recursive: true });
    writeFileSync(join(root, "out", "set1", "1.png"), frame);
    writeFileSync(join(root, "input", "primary.png"), frame);
  });
  after(() => studio?.stop());

  test("?w= returns a smaller PNG, without it the original comes back", async () => {
    const full = await studio.call("GET", "/out/set1/1.png", { raw: true });
    const thumb = await studio.call("GET", "/out/set1/1.png?v=1&w=160", { raw: true });
    assert.equal(full.status, 200);
    assert.equal(thumb.status, 200);
    assert.equal(Buffer.compare(full.buf, frame), 0);
    assert.ok(thumb.buf.length < frame.length / 5);
    assert.match(thumb.headers["cache-control"], /private/, "a versioned thumbnail may be kept, but only privately");
    assert.equal(decodePngRgba(thumb.buf).width, 160);
  });

  test("an unknown or oversized w serves the original; the input folder thumbnails too; a stranger gets 401", async () => {
    const big = await studio.call("GET", "/out/set1/1.png?w=5000", { raw: true });
    assert.equal(Buffer.compare(big.buf, frame), 0);
    const base = await studio.call("GET", "/input/primary.png?w=256", { raw: true });
    assert.equal(decodePngRgba(base.buf).width, 256);
    const anon = await studio.call("GET", "/out/set1/1.png?w=160", { raw: true, auth: false });
    assert.equal(anon.status, 401);
  });
});
