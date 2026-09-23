/**
 * Lightweight async concurrency pool.
 * Maps an array with at most `limit` concurrent promises,
 * preserving the exact original array order of results.
 * Zero dependencies.
 */

/**
 * @template T, R
 * @param {T[]} items - input items array
 * @param {number} limit - maximum concurrent workers (e.g. 1..4)
 * @param {(item: T, index: number) => Promise<R>} asyncFn - worker function
 * @param {(progress: { item: T, result: R, index: number, completed: number, total: number }) => void} [onProgress] - progress callback
 * @returns {Promise<R[]>}
 */
export async function mapConcurrent(items, limit, asyncFn, onProgress) {
  if (!Array.isArray(items)) return [];
  const total = items.length;
  if (total === 0) return [];

  const maxWorkers = Math.max(1, Math.min(Number(limit) || 2, total));
  const results = new Array(total);
  let currentIndex = 0;
  let completedCount = 0;

  async function worker() {
    while (currentIndex < total) {
      const idx = currentIndex++;
      const item = items[idx];
      let result;
      try {
        result = await asyncFn(item, idx);
      } catch (err) {
        result = { ok: false, error: String(err.message || err), index: idx };
      }
      results[idx] = result;
      completedCount++;
      if (typeof onProgress === "function") {
        try {
          onProgress({
            item,
            result,
            index: idx,
            completed: completedCount,
            total,
          });
        } catch {
          /* ignore progress callback errors */
        }
      }
    }
  }

  const workers = Array.from({ length: maxWorkers }, () => worker());
  await Promise.all(workers);
  return results;
}
