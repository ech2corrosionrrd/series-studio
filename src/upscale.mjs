/**
 * Optional 2× upscale via sharp. Never crashes if sharp is missing.
 */

/**
 * @returns {Promise<import('sharp')|null>}
 */
export async function loadSharp() {
  try {
    const mod = await import("sharp");
    return mod.default || mod;
  } catch {
    try {
      const { createRequire } = await import("node:module");
      const require = createRequire(import.meta.url);
      return require("sharp");
    } catch {
      return null;
    }
  }
}

/**
 * Upscale an image buffer 2× (nearest-friendly: lanczos3).
 * @param {Buffer} buf
 * @returns {Promise<{ ok: true, buffer: Buffer, width: number, height: number } | { ok: false, reason: string }>}
 */
export async function upscale2x(buf) {
  const sharp = await loadSharp();
  if (!sharp) return { ok: false, reason: "sharp_not_installed" };
  try {
    const img = sharp(buf);
    const meta = await img.metadata();
    const w = meta.width || 0;
    const h = meta.height || 0;
    if (!w || !h) return { ok: false, reason: "invalid_image" };
    const out = await img
      .resize(w * 2, h * 2, { kernel: "lanczos3" })
      .png()
      .toBuffer();
    return { ok: true, buffer: out, width: w * 2, height: h * 2 };
  } catch (e) {
    return { ok: false, reason: String(e.message || e) };
  }
}
