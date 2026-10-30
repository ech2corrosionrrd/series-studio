/**
 * Runs a bulk compose in a worker thread (see layers-worker.mjs). `stop()` ends it between frames: what was composed stays
 * on disk and the report says `stopped: true`.
 * @param {"compose"|"overlay"} kind
 * @param {object} args  the arguments of composeArchive / overlaySet (plain data: Buffers are copied into the worker)
 * @param {{ onProgress?: (p: { done: number, total: number }) => void }} [opts]
 * @returns {{ promise: Promise<object>, stop: () => void }}
 */
import { Worker } from "node:worker_threads";

export function startLayersJob(kind, args, { onProgress } = {}) {
  const stopFlag = new SharedArrayBuffer(4);
  const flag = new Int32Array(stopFlag);
  const worker = new Worker(new URL("./layers-worker.mjs", import.meta.url), { workerData: { kind, args, stopFlag } });
  const promise = new Promise((resolve, reject) => {
    worker.on("message", (m) => {
      if (m.type === "progress") onProgress?.({ done: m.done, total: m.total });
      else if (m.type === "done") resolve(m.report);
      else if (m.type === "error") reject(Object.assign(new Error(m.message), { status: m.status }));
    });
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code !== 0) reject(new Error(`the compose worker stopped unexpectedly (exit ${code})`));
    });
  });
  return { promise, stop: () => Atomics.store(flag, 0, 1) };
}
