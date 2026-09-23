import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWriteFileSync, writeJsonAtomic } from "../src/fs-safe.mjs";
import { addVersion, dropVersion, listVersions, readMeta, setCurrent, versionCounts } from "../src/versions.mjs";
import { listTrash, pruneTrash, purgeTrash, restoreTrash, trashFiles } from "../src/trash.mjs";
import { appendRenderLog, capError, spendByEngineToday, spendCap, spentToday } from "../src/spend.mjs";
import { failureBreaker, mapConcurrent } from "../src/pool.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "series-safety-"));

describe("fs-safe", () => {
  test("atomic write replaces file and leaves no temp files", () => {
    const d = tmp();
    const f = join(d, "sub", "a.json");
    writeJsonAtomic(f, { a: 1 });
    writeJsonAtomic(f, { a: 2 });
    assert.deepEqual(JSON.parse(readFileSync(f, "utf8")), { a: 2 });
    atomicWriteFileSync(join(d, "b.bin"), Buffer.from([1, 2, 3]));
    assert.deepEqual([...readFileSync(join(d, "b.bin"))], [1, 2, 3]);
    assert.equal(readdirSync(join(d, "sub")).filter((n) => n.endsWith(".tmp")).length, 0);
    rmSync(d, { recursive: true, force: true });
  });
});

describe("versions", () => {
  test("re-render keeps previous image; legacy file becomes v1", () => {
    const set = tmp();
    writeFileSync(join(set, "7.png"), "legacy");
    assert.equal(readMeta(set, 7).current, 1);

    const v2 = addVersion(set, 7, Buffer.from("second"), { engine: "kontext", seed: 42 });
    assert.equal(v2, 2);
    assert.equal(readFileSync(join(set, "7.png"), "utf8"), "second");
    assert.equal(readFileSync(join(set, "versions", "7", "v1.png"), "utf8"), "legacy");

    addVersion(set, 7, Buffer.from("third"));
    const list = listVersions(set, "kontext-s0.45", 7);
    assert.equal(list.current, 3);
    assert.deepEqual(list.versions.map((x) => x.v), [1, 2, 3]);
    assert.ok(list.versions.every((x) => x.exists));
    assert.equal(list.versions[2].url, "/out/kontext-s0.45/7.png");
    assert.equal(list.versions[0].url, "/out/kontext-s0.45/versions/7/v1.png");
    assert.deepEqual(versionCounts(set), { 7: 3 });
    rmSync(set, { recursive: true, force: true });
  });

  test("setCurrent swaps files; dropVersion refuses current", () => {
    const set = tmp();
    addVersion(set, 1, Buffer.from("A"));
    addVersion(set, 1, Buffer.from("B"));
    setCurrent(set, 1, 1);
    assert.equal(readFileSync(join(set, "1.png"), "utf8"), "A");
    assert.equal(readFileSync(join(set, "versions", "1", "v2.png"), "utf8"), "B");
    assert.throws(() => dropVersion(set, 1, 1), /current/);
    const file = dropVersion(set, 1, 2);
    assert.equal(readFileSync(file, "utf8"), "B");
    rmSync(file); // the server moves it to trash
    assert.deepEqual(readMeta(set, 1).versions.map((x) => x.v), [1]);
    assert.throws(() => setCurrent(set, 1, 9), /no version/);

    // restoring the dropped file (e.g. from trash) re-adopts it
    writeFileSync(file, "B");
    assert.deepEqual(readMeta(set, 1).versions.map((x) => x.v), [1, 2]);
    setCurrent(set, 1, 2);
    assert.equal(readFileSync(join(set, "1.png"), "utf8"), "B");
    assert.throws(() => readMeta(set, "../x"), /bad edition/);
    rmSync(set, { recursive: true, force: true });
  });
});

describe("trash", () => {
  test("move → list → restore round-trip", () => {
    const root = tmp();
    const trashDir = join(root, "out", "trash");
    mkdirSync(join(root, "input"));
    writeFileSync(join(root, "input", "primary.png"), "img");
    const item = trashFiles({ root, trashDir }, [join(root, "input", "primary.png")], "test");
    assert.ok(item);
    assert.equal(existsSync(join(root, "input", "primary.png")), false);
    assert.deepEqual(item.files.map((f) => f.from), ["input/primary.png"]);
    assert.equal(listTrash(trashDir).length, 1);

    restoreTrash({ root, trashDir }, item.id);
    assert.equal(readFileSync(join(root, "input", "primary.png"), "utf8"), "img");
    assert.equal(listTrash(trashDir).length, 0);
    rmSync(root, { recursive: true, force: true });
  });

  test("restore refuses to overwrite; purge/prune remove items; outside paths rejected", () => {
    const root = tmp();
    const trashDir = join(root, "trash");
    writeFileSync(join(root, "a.png"), "old");
    const item = trashFiles({ root, trashDir }, [join(root, "a.png")], "", new Date("2026-01-01T00:00:00Z"));
    writeFileSync(join(root, "a.png"), "new");
    assert.throws(() => restoreTrash({ root, trashDir }, item.id), /already exists/);
    assert.equal(readFileSync(join(root, "a.png"), "utf8"), "new");

    assert.deepEqual(pruneTrash(trashDir, 30, new Date("2026-03-01T00:00:00Z")), [item.id]);
    writeFileSync(join(root, "b.png"), "b");
    const it2 = trashFiles({ root, trashDir }, [join(root, "b.png")]);
    purgeTrash(trashDir, it2.id);
    assert.equal(listTrash(trashDir).length, 0);

    assert.throws(() => purgeTrash(trashDir, "../../etc"), /bad trash id/);
    const other = tmp();
    writeFileSync(join(other, "x.png"), "x");
    assert.throws(() => trashFiles({ root, trashDir }, [join(other, "x.png")]), /outside project/);
    assert.equal(trashFiles({ root, trashDir }, [join(root, "missing.png")]), null);
    rmSync(root, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  });
});

describe("spend", () => {
  test("spendCap parsing", () => {
    assert.equal(spendCap(""), null);
    assert.equal(spendCap("off"), null);
    assert.equal(spendCap("0"), null);
    assert.equal(spendCap("12.5"), 12.5);
    assert.throws(() => spendCap("abc"), /expected a number/);
  });

  test("render log sums only today's successful calls", () => {
    const d = tmp();
    const f = join(d, "render-log.jsonl");
    const now = new Date(2026, 8, 23, 15, 0, 0);
    appendRenderLog(f, { engine: "kontext", ok: true, costUsd: 0.04 }, now);
    appendRenderLog(f, { engine: "kontext", ok: true, costUsd: 0.04 }, now);
    appendRenderLog(f, { engine: "flux", ok: false, costUsd: 0, error: "x" }, now);
    appendRenderLog(f, { engine: "flux", ok: true, costUsd: 1 }, new Date(2026, 8, 22, 12, 0, 0));
    writeFileSync(f, readFileSync(f, "utf8") + "{torn line\n");
    assert.equal(spentToday(f, now), 0.08);
    assert.deepEqual(spendByEngineToday(f, now), { kontext: 0.08 });
    assert.equal(spentToday(join(d, "missing.jsonl"), now), 0);
    rmSync(d, { recursive: true, force: true });
  });

  test("capError", () => {
    assert.equal(capError({ cap: null, spent: 100, planned: 100 }), null);
    assert.equal(capError({ cap: 5, spent: 1, planned: 4 }), null);
    assert.match(capError({ cap: 5, spent: 1, planned: 4.5 }), /Daily spend cap \$5\.00/);
    assert.match(capError({ cap: 5, spent: 0, planned: null }), /Cannot estimate/);
    assert.equal(capError({ cap: 5, spent: 50, planned: 0 }), null, "free runs are never blocked");
  });
});

describe("failureBreaker + mapConcurrent", () => {
  test("stops the batch after N consecutive failures", async () => {
    const breaker = failureBreaker({ maxConsecutive: 3 });
    let calls = 0;
    const results = await mapConcurrent(
      Array.from({ length: 10 }, (_, i) => i),
      1,
      async () => {
        calls++;
        breaker.record(false);
        return { ok: false };
      },
      undefined,
      { signal: breaker.signal },
    );
    assert.equal(calls, 3);
    assert.equal(results.filter((r) => r.skipped).length, 7);
    assert.match(breaker.reason, /3 consecutive failures/);
  });

  test("a success resets the streak", () => {
    const b = failureBreaker({ maxConsecutive: 2 });
    b.record(false);
    b.record(true);
    b.record(false);
    assert.equal(b.reason, null);
    b.record(false);
    assert.ok(b.reason);
  });
});
