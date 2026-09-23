/**
 * Pure Node.js PNG generator for offline mock testing and zero-dependency fallbacks.
 * Uses built-in node:zlib and node:buffer without any external libraries.
 */
import { deflateSync, crc32 as zlibCrc32 } from "node:zlib";

function crc32(buf) {
  // Built-in crc32 available in modern Node.js, with fallback
  if (typeof zlibCrc32 === "function") return zlibCrc32(buf);
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/**
 * Creates a deterministic 256x256 or 512x512 PNG avatar card
 * with vibrant gradient colors based on seed/prompt.
 */
export function createMockPng({
  width = 512,
  height = 512,
  seed = 42,
  title = "Series Lab Mock",
  subtitle = "",
} = {}) {
  // Color palette derived from seed
  const numSeed = typeof seed === "number" ? seed : Math.abs(String(seed).split("").reduce((a, c) => (a << 5) - a + c.charCodeAt(0), 0));
  const r1 = (numSeed * 37) % 200 + 40;
  const g1 = (numSeed * 67) % 200 + 40;
  const b1 = (numSeed * 97) % 200 + 40;

  const r2 = (numSeed * 131) % 180 + 30;
  const g2 = (numSeed * 163) % 180 + 30;
  const b2 = (numSeed * 199) % 180 + 30;

  // Raw RGBA pixel buffer: (width * 4 + 1) * height (filter byte per scanline)
  const rowSize = 1 + width * 4;
  const raw = Buffer.alloc(rowSize * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    raw[rowOffset] = 0; // Filter: None
    const fy = y / height;

    for (let x = 0; x < width; x++) {
      const fx = x / width;
      const pxOffset = rowOffset + 1 + x * 4;

      // Gradient background
      let r = Math.round(r1 * (1 - fy) + r2 * fy);
      let g = Math.round(g1 * (1 - fx) + g2 * fx);
      let b = Math.round(b1 * (fx * fy) + b2 * (1 - fx * fy));

      // Draw stylized centered portrait silhouette / frame
      const cx = (x - width / 2) / (width / 2);
      const cy = (y - height / 2) / (height / 2);
      const dist = Math.sqrt(cx * cx + cy * cy);

      // Inner card
      if (dist < 0.65) {
        // Inner character icon area
        const headDist = Math.sqrt(cx * cx + (cy + 0.15) * (cy + 0.15));
        if (headDist < 0.25) {
          r = Math.min(255, r + 70);
          g = Math.min(255, g + 70);
          b = Math.min(255, b + 70);
        } else if (cy > -0.05 && dist < 0.55) {
          r = Math.min(255, r + 45);
          g = Math.min(255, g + 45);
          b = Math.min(255, b + 45);
        }
      }

      // Border frame
      if (x < 8 || x >= width - 8 || y < 8 || y >= height - 8) {
        r = 255;
        g = 255;
        b = 255;
      }

      raw[pxOffset] = r;
      raw[pxOffset + 1] = g;
      raw[pxOffset + 2] = b;
      raw[pxOffset + 3] = 255; // Alpha
    }
  }

  // PNG Signature
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // Bit depth: 8
  ihdr[9] = 6; // Color type: RGBA (6)
  ihdr[10] = 0; // Compression: Deflate
  ihdr[11] = 0; // Filter: Standard
  ihdr[12] = 0; // Interlace: None
  const ihdrChunk = makeChunk("IHDR", ihdr);

  // IDAT (compressed image data)
  const compressed = deflateSync(raw, { level: 6 });
  const idatChunk = makeChunk("IDAT", compressed);

  // IEND
  const iendChunk = makeChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}
