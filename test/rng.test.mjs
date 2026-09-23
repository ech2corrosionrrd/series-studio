import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hashSeed, makeRng } from "../src/rng.mjs";

describe("rng", () => {
  it("hashSeed is stable FNV-1a", () => {
    assert.equal(hashSeed("series-lab-demo-v1"), hashSeed("series-lab-demo-v1"));
    assert.notEqual(hashSeed("a"), hashSeed("b"));
    assert.equal(typeof hashSeed("x"), "number");
    assert.ok(hashSeed("x") >= 0);
  });

  it("makeRng is deterministic", () => {
    const a = makeRng("seed-A");
    const b = makeRng("seed-A");
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    assert.deepEqual(seqA, seqB);
  });

  it("weighted and shuffle are deterministic", () => {
    const opts = [
      { value: "x", weight: 1 },
      { value: "y", weight: 2 },
      { value: "z", weight: 3 },
    ];
    const picksA = [];
    const picksB = [];
    const ra = makeRng(42);
    const rb = makeRng(42);
    for (let i = 0; i < 50; i++) {
      picksA.push(ra.weighted(opts).value);
      picksB.push(rb.weighted(opts).value);
    }
    assert.deepEqual(picksA, picksB);

    const sa = makeRng("shuffle").shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    const sb = makeRng("shuffle").shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(sa, sb);
    assert.deepEqual([...sa].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
