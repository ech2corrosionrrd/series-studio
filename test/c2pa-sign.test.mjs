import test from "node:test";
import assert from "node:assert/strict";
import { crc32 } from "node:zlib";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { createMockPng } from "../src/mock-image.mjs";
import { AI_SOURCE_TYPE, hasC2pa, markPngAsAi, readAiMark } from "../src/ai-mark.mjs";
import { C2PA_ALGS, listSetPngs, signSet, summarizeReader } from "../src/c2pa-sign.mjs";
import { buildBundleZip } from "../src/export-bundle.mjs";

/** Вставляє чанк caBX (як робить C2PA для PNG) перед першим IDAT. */
function withManifestChunk(png) {
  const type = Buffer.from("caBX", "latin1");
  const data = Buffer.from("fake-jumbf");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])) >>> 0);
  const chunk = Buffer.concat([len, type, data, crc]);
  const at = png.indexOf(Buffer.from("IDAT", "latin1")) - 4;
  return Buffer.concat([png.subarray(0, at), chunk, png.subarray(at)]);
}

/** Підроблена бібліотека: «підпис» = вставка caBX; читач віддає звіт у форматі c2pa-node. */
function fakeC2pa({ failOn = null, extraCodes = [] } = {}) {
  const calls = { signer: null, intents: [], titles: [] };
  return {
    calls,
    LocalSigner: { newSigner: (cert, key, alg, tsa) => { calls.signer = { cert: String(cert), key: String(key), alg, tsa }; return { alg }; } },
    Builder: {
      withJsonAsync: async (def) => {
        calls.titles.push(def.title);
        return {
          setIntent: (i) => calls.intents.push(i),
          sign: (signer, input, output) => {
            if (def.title === failOn) throw new Error("boom");
            writeFileSync(output.path, withManifestChunk(input.buffer));
          },
        };
      },
    },
    Reader: {
      fromAsset: async ({ path }) => ({
        json: () => ({
          active_manifest: "urn:x",
          manifests: { "urn:x": { signature_info: { alg: "Es256", common_name: "Tester", issuer: "Test CA" } } },
          validation_status: [{ code: "signingCredential.untrusted" }, ...extraCodes.map((code) => ({ code }))],
          path,
        }),
      }),
    },
  };
}

function makeSet(n = 3) {
  const root = mkdtempSync(join(tmpdir(), "c2pa-"));
  const set = join(root, "set");
  mkdirSync(join(set, "versions"), { recursive: true });
  for (let i = 1; i <= n; i++) writeFileSync(join(set, `${i}.png`), createMockPng({ seed: i, title: `t${i}` }));
  writeFileSync(join(set, "versions", "note.txt"), "keep me");
  writeFileSync(join(root, "cert.pem"), "CERT");
  writeFileSync(join(root, "key.pem"), "KEY");
  return { root, set };
}

test("signSet copies the set, signs every frame and writes a report", async () => {
  const { root, set } = makeSet();
  try {
    const c2pa = fakeC2pa();
    const out = join(root, "out");
    const r = await signSet({ setDir: set, outDir: out, certPath: join(root, "cert.pem"), keyPath: join(root, "key.pem"), version: "1.9.0", c2pa });
    assert.equal(r.signed, 3);
    assert.equal(r.failed, 0);
    assert.equal(r.trust, "untrusted");
    assert.equal(r.signer, "Tester");
    for (const f of ["1.png", "2.png", "3.png"]) assert.equal(hasC2pa(readFileSync(join(out, f))), true);
    assert.equal(hasC2pa(readFileSync(join(set, "1.png"))), false, "the source set is untouched");
    assert.equal(readFileSync(join(out, "versions", "note.txt"), "utf8"), "keep me");
    assert.equal(JSON.parse(readFileSync(join(out, "c2pa-report.json"), "utf8")).signed, 3);
    assert.deepEqual(c2pa.calls.intents, [{ create: AI_SOURCE_TYPE }, { create: AI_SOURCE_TYPE }, { create: AI_SOURCE_TYPE }]);
    assert.equal(c2pa.calls.signer.alg, "es256");
    assert.equal(c2pa.calls.signer.key, "KEY");
    assert.equal(readdirSync(out).some((f) => f.endsWith(".c2pa-tmp")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("signSet reports a failed frame, keeps going and cleans temp files", async () => {
  const { root, set } = makeSet();
  try {
    const out = join(root, "out");
    const r = await signSet({ setDir: set, outDir: out, certPath: join(root, "cert.pem"), keyPath: join(root, "key.pem"), c2pa: fakeC2pa({ failOn: "2.png" }) });
    assert.equal(r.signed, 2);
    assert.equal(r.failed, 1);
    assert.equal(r.errors[0].file, "2.png");
    assert.equal(hasC2pa(readFileSync(join(out, "2.png"))), false);
    assert.equal(existsSync(join(out, "2.png.c2pa-tmp")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a real validation problem (not just 'untrusted') counts as a failure", async () => {
  const { root, set } = makeSet(1);
  try {
    const r = await signSet({ setDir: set, outDir: join(root, "out"), certPath: join(root, "cert.pem"), keyPath: join(root, "key.pem"), c2pa: fakeC2pa({ extraCodes: ["assertion.dataHash.mismatch"] }) });
    assert.equal(r.signed, 0);
    assert.match(r.errors[0].error, /dataHash/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("signSet refuses bad input before touching anything", async () => {
  const { root, set } = makeSet(1);
  try {
    const base = { setDir: set, outDir: join(root, "out"), certPath: join(root, "cert.pem"), keyPath: join(root, "key.pem"), c2pa: fakeC2pa() };
    await assert.rejects(() => signSet({ ...base, alg: "md5" }), /Unknown algorithm/);
    await assert.rejects(() => signSet({ ...base, certPath: "" }), /--cert and --key/);
    await assert.rejects(() => signSet({ ...base, setDir: join(root, "nope") }), /not found/);
    await assert.rejects(() => signSet({ ...base, c2pa: null }), /not provided/);
    mkdirSync(join(root, "full"));
    writeFileSync(join(root, "full", "x"), "1");
    await assert.rejects(() => signSet({ ...base, outDir: join(root, "full") }), /not empty/);
    assert.equal(existsSync(join(root, "out")), false);
    const dry = await signSet({ ...base, dryRun: true, certPath: "" });
    assert.equal(dry.dryRun, true);
    assert.deepEqual(dry.files, ["1.png"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("helpers: frame listing order, algorithm list, reader summary", () => {
  const { root, set } = makeSet(0);
  try {
    for (const n of [10, 2, 1]) writeFileSync(join(set, `${n}.png`), "x");
    writeFileSync(join(set, "cover.png"), "x");
    assert.deepEqual(listSetPngs(set), ["1.png", "2.png", "10.png"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  assert.ok(C2PA_ALGS.includes("es256"));
  assert.deepEqual(summarizeReader({}).hasManifest, false);
  const s = summarizeReader({ active_manifest: "a", manifests: { a: { signature_info: { common_name: "N" } } }, validation_status: [{ code: "signingCredential.untrusted" }] });
  assert.equal(s.hasManifest, true);
  assert.equal(s.untrusted, true);
  assert.deepEqual(s.problems, []);
});

test("an export keeps C2PA-signed frames byte for byte and counts them in the disclosure", async () => {
  const root = mkdtempSync(join(tmpdir(), "c2pa-zip-"));
  try {
    const setDir = join(root, "set");
    mkdirSync(setDir, { recursive: true });
    const signed = withManifestChunk(createMockPng({ seed: 31, title: "a" }));
    writeFileSync(join(setDir, "1.png"), signed);
    writeFileSync(join(setDir, "2.png"), createMockPng({ seed: 32, title: "b" }));
    const result = await buildBundleZip({
      archive: { presetId: "c", recipes: [{ edition: 1, dna: "d1", traits: { b: "x" } }, { edition: 2, dna: "d2", traits: { b: "y" } }] },
      preset: { id: "c", name: "C" },
      setDir,
      set: "set",
      marks: {},
      bundlesDir: join(root, "bundles"),
      opts: { format: "erc721", locale: "en" },
    });
    const zip = await JSZip.loadAsync(readFileSync(join(root, "bundles", result.file)));
    const one = await zip.file("images/1.png").async("nodebuffer");
    const two = await zip.file("images/2.png").async("nodebuffer");
    assert.ok(one.equals(signed), "signed frame is untouched");
    assert.equal(readAiMark(one).marked, false);
    assert.equal(readAiMark(two).marked, true);
    const doc = JSON.parse(await zip.file("ai-disclosure.json").async("string"));
    assert.equal(doc.markedImages, 1);
    assert.equal(doc.c2paSignedImages, 1);
    assert.deepEqual(doc.c2paSignedFiles, ["1.png"]);
    assert.equal(markPngAsAi(signed).signed, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
