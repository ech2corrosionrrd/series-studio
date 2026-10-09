import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { AI_SOURCE_TYPE, aiDisclosureDoc, markPngAsAi, readAiMark } from "../src/ai-mark.mjs";

const makePng = () => sharp({ create: { width: 16, height: 16, channels: 3, background: "#c33" } }).png().toBuffer();

test("marks a PNG without touching pixels, and reads the mark back", async () => {
  const src = await makePng();
  assert.equal(readAiMark(src).marked, false);
  const { buffer, marked } = markPngAsAi(src);
  assert.equal(marked, true);
  assert.notDeepEqual(buffer, src);
  const back = readAiMark(buffer);
  assert.equal(back.marked, true);
  assert.equal(back.digitalSourceType, AI_SOURCE_TYPE);
  assert.equal(back.creatorTool, "Series Lab");
  const a = await sharp(src).raw().toBuffer();
  const b = await sharp(buffer).raw().toBuffer();
  assert.ok(a.equals(b), "pixels are identical");
  assert.match(String((await sharp(buffer).metadata()).xmp?.toString("utf8") || ""), /trainedAlgorithmicMedia/);
});

test("marking is idempotent", async () => {
  const once = markPngAsAi(await makePng()).buffer;
  const twice = markPngAsAi(once).buffer;
  assert.ok(once.equals(twice));
});

test("non-PNG and broken input come back unchanged", () => {
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const r = markPngAsAi(jpg);
  assert.equal(r.marked, false);
  assert.equal(r.reason, "not_png");
  assert.ok(r.buffer.equals(jpg));
  assert.equal(markPngAsAi(Buffer.from("nope")).marked, false);
  assert.equal(markPngAsAi(null).marked, false);
});

test("the creator tool is XML-escaped", async () => {
  const { buffer } = markPngAsAi(await makePng(), { tool: 'A<b>&"' });
  assert.equal(readAiMark(buffer).creatorTool, "A&lt;b&gt;&amp;&quot;");
});

test("disclosure doc has the expected shape", () => {
  const d = aiDisclosureDoc({ marked: 2, skipped: 1, files: ["1.png"] });
  assert.equal(d.schema, "series-ai-disclosure/v1");
  assert.equal(d.markedImages, 2);
  assert.equal(d.digitalSourceType, AI_SOURCE_TYPE);
});

// ---- експорт ZIP ----
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { buildBundleZip } from "../src/export-bundle.mjs";
import { createMockPng } from "../src/mock-image.mjs";
import { checkProvenance } from "../src/provenance-verifier.mjs";

async function exportZip(opts) {
  const root = mkdtempSync(join(tmpdir(), "ai-zip-"));
  try {
    const setDir = join(root, "set");
    mkdirSync(setDir, { recursive: true });
    writeFileSync(join(setDir, "1.png"), createMockPng({ seed: 21, title: "a" }));
    writeFileSync(join(setDir, "2.png"), createMockPng({ seed: 22, title: "b" }));
    const result = await buildBundleZip({
      archive: { presetId: "ai", recipes: [{ edition: 1, dna: "d1", traits: { b: "x" } }, { edition: 2, dna: "d2", traits: { b: "y" } }] },
      preset: { id: "ai", name: "AI" },
      setDir,
      set: "set",
      marks: {},
      bundlesDir: join(root, "bundles"),
      opts: { format: "erc721", locale: "en", ...opts },
    });
    return await JSZip.loadAsync(readFileSync(join(root, "bundles", result.file)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("an export ZIP marks every PNG, lists them in ai-disclosure.json and hashes the marked bytes", async () => {
  const zip = await exportZip({});
  const img = await zip.file("images/1.png").async("nodebuffer");
  assert.equal(readAiMark(img).marked, true);
  const doc = JSON.parse(await zip.file("ai-disclosure.json").async("string"));
  assert.equal(doc.markedImages, 2);
  assert.deepEqual(doc.files.sort(), ["1.png", "2.png"]);
  const prov = JSON.parse(await zip.file("provenance.json").async("string"));
  const record = prov.records.find((r) => r.edition === 1);
  const { createHash } = await import("node:crypto");
  assert.equal(record.sha256 || record.hash, createHash("sha256").update(img).digest("hex"));
  assert.match(await zip.file("README.txt").async("string"), /ai-disclosure\.json/);
  assert.ok(checkProvenance);
});

test("aiMark: false leaves the PNGs as they were and writes no disclosure", async () => {
  const zip = await exportZip({ aiMark: false });
  const img = await zip.file("images/1.png").async("nodebuffer");
  assert.equal(readAiMark(img).marked, false);
  assert.equal(zip.file("ai-disclosure.json"), null);
});
