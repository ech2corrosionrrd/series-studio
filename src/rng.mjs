/**
 * Deterministic RNG: same seed → same rolls.
 * FNV-1a 32-bit hash + mulberry32 PRNG with weighted pick and Fisher–Yates shuffle.
 */

export function hashSeed(text) {
  let h = 0x811c9dc5; // FNV-1a 32-bit offset basis
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function makeRng(seed) {
  let a = typeof seed === "number" ? seed >>> 0 : hashSeed(String(seed));
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0; // mulberry32
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    weighted(options) {
      if (!options?.length) throw new Error("weighted: empty options");
      const total = options.reduce((s, o) => s + (o.weight ?? 0), 0);
      if (total <= 0) throw new Error("weighted: total weight must be > 0");
      let r = next() * total;
      for (const o of options) {
        r -= o.weight ?? 0;
        if (r < 0) return o;
      }
      return options[options.length - 1];
    },
    shuffle(list) {
      const out = list.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}
