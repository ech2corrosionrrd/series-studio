// decodePngRgba reads every colour type and bit depth, not only 8-bit RGB/RGBA: engines and tools save palette
// PNGs (colour type 3), which used to fail with "unsupported png". Files are built by hand, no model, no network.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { crc32, deflateSync } from "node:zlib";
import { decodePngRgba } from "../src/dupes.mjs";
import { encodeRgbaPng } from "../src/png-fit.mjs";

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type, data = Buffer.alloc(0)) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

/** A PNG from ready scanline bytes (filter byte included by the caller via `filters`, default 0). */
function png({ width, height, depth, color, rows, plte, trns, interlace = 0, filters }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth;
  ihdr[9] = color;
  ihdr[12] = interlace;
  const lines = rows.map((r, i) => Buffer.concat([Buffer.from([filters?.[i] ?? 0]), Buffer.from(r)]));
  return Buffer.concat([
    SIG,
    chunk("IHDR", ihdr),
    ...(plte ? [chunk("PLTE", Buffer.from(plte))] : []),
    ...(trns ? [chunk("tRNS", Buffer.from(trns))] : []),
    chunk("IDAT", deflateSync(Buffer.concat(lines))),
    chunk("IEND"),
  ]);
}

const px = (d, i) => [...d.rgba.subarray(i * 4, i * 4 + 4)];
const PAL = [255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30];

describe("decodePngRgba: palette (colour type 3)", () => {
  it("8-bit indexes with tRNS alpha", () => {
    const d = decodePngRgba(png({ width: 2, height: 2, depth: 8, color: 3, rows: [[0, 1], [2, 3]], plte: PAL, trns: [255, 128] }));
    assert.deepEqual([d.width, d.height], [2, 2]);
    assert.deepEqual([px(d, 0), px(d, 1), px(d, 2), px(d, 3)], [[255, 0, 0, 255], [0, 255, 0, 128], [0, 0, 255, 255], [10, 20, 30, 255]]);
  });

  it("4-bit, 2-bit and 1-bit packing with padding bits at the end of a row", () => {
    // 4-bit, width 3: indexes 0,1,2 -> 0x01 0x20
    const d4 = decodePngRgba(png({ width: 3, height: 1, depth: 4, color: 3, rows: [[0x01, 0x20]], plte: PAL }));
    assert.deepEqual([px(d4, 0), px(d4, 1), px(d4, 2)], [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]]);
    // 2-bit, width 5: 0,1,2,3,0 -> 0b00011011 0b00000000
    const d2 = decodePngRgba(png({ width: 5, height: 1, depth: 2, color: 3, rows: [[0b00011011, 0b00000000]], plte: PAL }));
    assert.deepEqual(px(d2, 3), [10, 20, 30, 255]);
    assert.deepEqual(px(d2, 4), [255, 0, 0, 255]);
    // 1-bit, width 9: 1,0,1,0,1,0,1,0,1
    const d1 = decodePngRgba(png({ width: 9, height: 1, depth: 1, color: 3, rows: [[0b10101010, 0b10000000]], plte: PAL }));
    assert.deepEqual([0, 1, 8].map((i) => px(d1, i)[1]), [255, 0, 255]);
  });

  it("applies the scanline filters (Sub and Up) to the packed bytes", () => {
    // row 0 Sub: indexes 0,1; row 1 Up: raw 1,1 plus the row above gives 1,2
    const d = decodePngRgba(png({ width: 2, height: 2, depth: 8, color: 3, rows: [[0, 1], [1, 1]], filters: [1, 2], plte: PAL }));
    assert.deepEqual([0, 1, 2, 3].map((i) => px(d, i)[0] + "," + px(d, i)[1] + "," + px(d, i)[2]), ["255,0,0", "0,255,0", "0,255,0", "0,0,255"]);
  });

  it("refuses a palette PNG without a palette and an index outside it", () => {
    assert.throws(() => decodePngRgba(png({ width: 1, height: 1, depth: 8, color: 3, rows: [[0]] })), /no palette/);
    assert.throws(() => decodePngRgba(png({ width: 1, height: 1, depth: 8, color: 3, rows: [[9]], plte: PAL })), /palette index/);
  });
});

describe("decodePngRgba: the other colour types and depths", () => {
  it("grayscale 8-bit, 4-bit and 1-bit, with a colour key", () => {
    const g8 = decodePngRgba(png({ width: 2, height: 1, depth: 8, color: 0, rows: [[0, 200]] }));
    assert.deepEqual([px(g8, 0), px(g8, 1)], [[0, 0, 0, 255], [200, 200, 200, 255]]);
    const g4 = decodePngRgba(png({ width: 2, height: 1, depth: 4, color: 0, rows: [[0x0f]] }));
    assert.deepEqual([px(g4, 0)[0], px(g4, 1)[0]], [0, 255]);
    const g1 = decodePngRgba(png({ width: 2, height: 1, depth: 1, color: 0, rows: [[0b01000000]] }));
    assert.deepEqual([px(g1, 0)[0], px(g1, 1)[0]], [0, 255]);
    const keyed = decodePngRgba(png({ width: 2, height: 1, depth: 8, color: 0, rows: [[7, 9]], trns: [0, 7] }));
    assert.deepEqual([px(keyed, 0)[3], px(keyed, 1)[3]], [0, 255]);
  });

  it("gray+alpha and 16-bit RGB (high byte kept)", () => {
    const ga = decodePngRgba(png({ width: 1, height: 1, depth: 8, color: 4, rows: [[100, 50]] }));
    assert.deepEqual(px(ga, 0), [100, 100, 100, 50]);
    const rgb16 = decodePngRgba(png({ width: 1, height: 1, depth: 16, color: 2, rows: [[0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc]] }));
    assert.deepEqual(px(rgb16, 0), [0x12, 0x56, 0x9a, 255]);
  });

  it("RGB with a colour key makes that colour transparent", () => {
    const d = decodePngRgba(png({ width: 2, height: 1, depth: 8, color: 2, rows: [[1, 2, 3, 4, 5, 6]], trns: [0, 1, 0, 2, 0, 3] }));
    assert.deepEqual([px(d, 0)[3], px(d, 1)[3]], [0, 255]);
  });

  it("8-bit RGBA from our own encoder is unchanged", () => {
    const rgba = Buffer.from([1, 2, 3, 4, 250, 251, 252, 253]);
    const d = decodePngRgba(encodeRgbaPng(2, 1, rgba));
    assert.equal(Buffer.compare(d.rgba, rgba), 0);
  });

  it("still refuses interlaced files, impossible depth/colour pairs and non-PNG data", () => {
    assert.throws(() => decodePngRgba(png({ width: 1, height: 1, depth: 8, color: 0, rows: [[0]], interlace: 1 })), /interlaced/);
    assert.throws(() => decodePngRgba(png({ width: 1, height: 1, depth: 4, color: 2, rows: [[0, 0]] })), /unsupported png/);
    assert.throws(() => decodePngRgba(Buffer.from("not a png at all")), /not a png/);
  });
});
