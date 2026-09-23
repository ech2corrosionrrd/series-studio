/**
 * Review / gallery helpers (Wave 5 — compare two image sets).
 */

/**
 * Merge two image lists by edition number.
 * Editions that exist in either set appear once; missing side is null.
 *
 * @param {Array<{edition?: number|string|null}>|null|undefined} a Primary set images
 * @param {Array<{edition?: number|string|null}>|null|undefined} b Compare set images
 * @returns {Array<{edition: number, a: object|null, b: object|null}>}
 */
export function mergeEditions(a, b) {
  const map = new Map();
  const ingest = (list, side) => {
    if (!Array.isArray(list)) return;
    for (const img of list) {
      if (img == null || img.edition == null || img.edition === "") continue;
      const ed = Number(img.edition);
      if (!Number.isFinite(ed)) continue;
      let row = map.get(ed);
      if (!row) {
        row = { edition: ed, a: null, b: null };
        map.set(ed, row);
      }
      row[side] = img;
    }
  };
  ingest(a, "a");
  ingest(b, "b");
  return [...map.values()].sort((x, y) => x.edition - y.edition);
}
