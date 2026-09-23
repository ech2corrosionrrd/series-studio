import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapConcurrent } from "../src/index.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe("Wave 8: mapConcurrent concurrency pool", () => {
  it("preserves exact result order despite varying completion times", async () => {
    const items = [50, 10, 30, 20, 5];
    const results = await mapConcurrent(items, 3, async (ms, idx) => {
      await sleep(ms);
      return { idx, ms };
    });

    assert.equal(results.length, 5);
    for (let i = 0; i < items.length; i++) {
      assert.equal(results[i].idx, i);
      assert.equal(results[i].ms, items[i]);
    }
  });

  it("respects concurrency limits", async () => {
    let active = 0;
    let maxActive = 0;
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const limit = 2;

    await mapConcurrent(items, limit, async (item) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await sleep(15);
      active--;
      return item * 2;
    });

    assert.ok(maxActive <= limit, `maxActive (${maxActive}) exceeded limit (${limit})`);
    assert.equal(maxActive, limit);
  });

  it("invokes onProgress callback for each completed item", async () => {
    const items = ["a", "b", "c", "d"];
    const progressCalls = [];

    const results = await mapConcurrent(
      items,
      2,
      async (it) => {
        await sleep(10);
        return it.toUpperCase();
      },
      (p) => {
        progressCalls.push({ ...p });
      }
    );

    assert.deepEqual(results, ["A", "B", "C", "D"]);
    assert.equal(progressCalls.length, 4);
    assert.equal(progressCalls[progressCalls.length - 1].completed, 4);
    assert.equal(progressCalls[progressCalls.length - 1].total, 4);
  });

  it("handles errors gracefully inside individual tasks", async () => {
    const items = [1, 2, 3];
    const results = await mapConcurrent(items, 2, async (n, idx) => {
      if (n === 2) throw new Error("boom");
      return { ok: true, n };
    });

    assert.equal(results[0].ok, true);
    assert.equal(results[1].ok, false);
    assert.ok(results[1].error.includes("boom"));
    assert.equal(results[2].ok, true);
  });

  it("handles empty arrays and single concurrency", async () => {
    const empty = await mapConcurrent([], 2, async () => 1);
    assert.deepEqual(empty, []);

    const single = await mapConcurrent([10, 20], 1, async (n) => n + 1);
    assert.deepEqual(single, [11, 21]);
  });
});
