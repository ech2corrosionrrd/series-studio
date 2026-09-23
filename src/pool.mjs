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
 * @param {{ signal?: AbortSignal }} [opts] - once aborted, remaining items are not started
 *   and get `{ ok: false, skipped: true, error: "aborted: <reason>" }`
 * @returns {Promise<R[]>}
 */
export async function mapConcurrent(items, limit, asyncFn, onProgress, opts = {}) {
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
      if (opts.signal?.aborted) {
        result = { ok: false, skipped: true, error: `aborted: ${opts.signal.reason?.message || opts.signal.reason || "stopped"}` };
      } else {
        try {
          result = await asyncFn(item, idx);
        } catch (err) {
          result = { ok: false, error: String(err.message || err), index: idx };
        }
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

/**
 * Stops a batch when the engine starts failing en masse (provider outage,
 * revoked key, exhausted balance) instead of burning through the whole queue.
 * Idea from Промт services/provider_health.py.
 *
 * @param {{ maxConsecutive?: number }} [opts]
 * @returns {{ signal: AbortSignal, record: (ok: boolean) => void, readonly reason: string|null }}
 */
export function failureBreaker({ maxConsecutive = 5 } = {}) {
  const controller = new AbortController();
  let streak = 0;
  return {
    signal: controller.signal,
    record(ok) {
      streak = ok ? 0 : streak + 1;
      if (!controller.signal.aborted && maxConsecutive > 0 && streak >= maxConsecutive) {
        controller.abort(new Error(`${streak} consecutive failures — engine looks down, batch stopped`));
      }
    },
    get reason() {
      return controller.signal.aborted ? controller.signal.reason.message : null;
    },
  };
}
