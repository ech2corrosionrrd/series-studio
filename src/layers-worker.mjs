/**
 * Worker thread for the bulk "Compose layers" (BETA-REVIEW round 3, R12).
 * Stacking a thousand 1024 px frames takes minutes of pure CPU; run on the server's main thread it froze every other
 * request, /health included. Here it runs on its own thread, reports each frame and can be stopped between frames
 * through a shared flag. The result is exactly what `composeArchive` / `overlaySet` return when called directly.
 */
import { parentPort, workerData } from "node:worker_threads";
import { composeArchive, overlaySet } from "./layers.mjs";

const { kind, args, stopFlag } = workerData;
const flag = new Int32Array(stopFlag);
const asBuffer = (v) => (v == null ? v : Buffer.from(v.buffer ? v : new Uint8Array(v)));

try {
  const run = kind === "overlay" ? overlaySet : composeArchive;
  const report = run({
    ...args,
    basePng: asBuffer(args.basePng),
    alignRef: asBuffer(args.alignRef),
    onFrame: (p) => parentPort.postMessage({ type: "progress", ...p }),
    shouldStop: () => Atomics.load(flag, 0) === 1,
  });
  parentPort.postMessage({ type: "done", report });
} catch (e) {
  parentPort.postMessage({ type: "error", message: String(e?.message || e), status: e?.status });
}
