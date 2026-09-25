/**
 * Supply waves: a later batch gets its own seed and edition numbers after
 * the ones already built. Earlier recipes stay put.
 *
 * A preset with no `waves` is a single implicit wave (preset.seed + preset.size).
 * `quotasOf` matches the split used by the recipe builder.
 */

export function lineIdsOf(preset) {
  if (preset.lines && typeof preset.lines === "object" && Object.keys(preset.lines).length > 0) {
    return Object.keys(preset.lines);
  }
  return ["default"];
}

/** Quotas per line. Explicit quotas must sum to size; otherwise an equal split. */
export function quotasOf(preset, lineIds = lineIdsOf(preset)) {
  const size = preset.size;
  const explicit = lineIds.map((id) => preset.lines?.[id]?.quota);
  if (explicit.every((q) => typeof q === "number" && q >= 0)) {
    const sum = explicit.reduce((a, b) => a + b, 0);
    if (sum !== size) throw new Error(`line quotas sum to ${sum}, size is ${size}`);
    return Object.fromEntries(lineIds.map((id, i) => [id, explicit[i]]));
  }
  const n = lineIds.length || 1;
  const base = Math.floor(size / n);
  let rem = size - base * n;
  const quotas = {};
  for (const id of lineIds) {
    quotas[id] = base + (rem > 0 ? 1 : 0);
    if (rem > 0) rem--;
  }
  return quotas;
}

function splitCount(lineIds, count) {
  const n = lineIds.length || 1;
  const base = Math.floor(count / n);
  let rem = count - base * n;
  const lines = {};
  for (const id of lineIds) {
    lines[id] = base + (rem > 0 ? 1 : 0);
    if (rem > 0) rem--;
  }
  return lines;
}

/**
 * Explicit waves, or null when the preset is still a single implicit wave.
 * @returns {Array<{ n: number, name: string, seed: string, lines: Record<string, number>, size: number }>|null}
 */
export function supplyWaves(preset) {
  const raw = preset.waves;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const lineIds = lineIdsOf(preset);
  const seeds = new Set();
  const waves = raw.map((w, i) => {
    const n = i + 1;
    const seed = String(w?.seed || "").trim();
    if (!seed) throw new Error(`wave ${n}: seed required`);
    if (seeds.has(seed)) throw new Error(`wave ${n}: seed "${seed}" is already used`);
    seeds.add(seed);
    const lines = {};
    let size = 0;
    for (const id of lineIds) {
      const c = w.lines?.[id] ?? 0;
      if (!Number.isInteger(c) || c < 0) {
        throw new Error(`wave ${n}: line "${id}" count must be an integer ≥ 0`);
      }
      lines[id] = c;
      size += c;
    }
    if (size === 0) throw new Error(`wave ${n}: empty`);
    return { n, name: String(w.name || n), seed, lines, size };
  });
  const total = waves.reduce((s, w) => s + w.size, 0);
  if (total !== preset.size) throw new Error(`waves sum to ${total}, size is ${preset.size}`);
  for (const id of lineIds) {
    const sum = waves.reduce((s, w) => s + w.lines[id], 0);
    const quota = preset.lines?.[id]?.quota;
    if (typeof quota === "number" && quota !== sum) {
      throw new Error(`line "${id}": waves sum to ${sum}, quota is ${quota}`);
    }
  }
  return waves;
}

/** Rows for the studio list. Implicit single wave when `waves` is empty. */
export function describeSupply(preset) {
  const explicit = supplyWaves(preset);
  if (!explicit) {
    return [{ n: 1, name: "1", seed: String(preset.seed || ""), size: preset.size, from: 1, to: preset.size, implicit: true }];
  }
  let cursor = 0;
  return explicit.map((w) => {
    const from = cursor + 1;
    cursor += w.size;
    return { n: w.n, name: w.name, seed: w.seed, size: w.size, from, to: cursor, implicit: false };
  });
}

/**
 * Append a wave. The first call freezes the current series as wave 1
 * (same seed and the same line quotas), then adds the new batch after it.
 */
export function appendSupplyWave(preset, { size, seed, name } = {}) {
  const add = Number(size);
  if (!Number.isInteger(add) || add < 1) throw new Error("wave size must be a positive integer");
  const waveSeed = String(seed || "").trim();
  if (!waveSeed) throw new Error("wave seed required");

  const lineIds = lineIdsOf(preset);
  const existing = supplyWaves(preset);
  const waves = existing
    ? existing.map((w) => ({ name: w.name, seed: w.seed, lines: { ...w.lines } }))
    : [{ name: "1", seed: String(preset.seed || "").trim(), lines: quotasOf(preset, lineIds) }];

  if (!waves[0].seed) throw new Error("preset seed required before adding a wave");
  if (waves.some((w) => w.seed === waveSeed)) {
    throw new Error(`seed "${waveSeed}" is already used by another wave`);
  }

  waves.push({
    name: String(name || waves.length + 1),
    seed: waveSeed,
    lines: splitCount(lineIds, add),
  });

  const totals = {};
  for (const id of lineIds) totals[id] = waves.reduce((s, w) => s + (w.lines[id] || 0), 0);
  const newSize = Object.values(totals).reduce((a, b) => a + b, 0);
  const lines = {};
  for (const id of lineIds) lines[id] = { ...(preset.lines?.[id] || {}), quota: totals[id] };
  return { ...preset, waves, size: newSize, lines };
}
