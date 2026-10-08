import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHolderLicence, HOLDER_MODELS } from "../src/holder-licence.mjs";
import { buildLaunchAdvisor } from "../src/launch-advisor.mjs";
import { buildDeployKit } from "../src/deploy-kit.mjs";
import { createMockPng } from "../src/mock-image.mjs";

const MODELS = HOLDER_MODELS.filter((m) => m !== "statement");

test("every model builds a numbered draft in both languages, always marked as not legal advice", () => {
  for (const model of MODELS) {
    for (const locale of ["uk", "en"]) {
      const text = buildHolderLicence({ model, locale, name: "Lions", creator: "0xABC" });
      assert.match(text, locale === "uk" ? /не юридичний висновок/ : /not legal advice/, `${model} ${locale}`);
      assert.match(text, /Lions/);
      assert.match(text, /0xABC/);
      const nums = text.split("\n").filter((l) => /^\d+\. /.test(l)).map((l) => parseInt(l, 10));
      assert.deepEqual(nums, nums.map((_, i) => i + 1), `${model} ${locale}: clauses are numbered 1..n`);
    }
  }
});

test("the models differ where it matters", () => {
  const t = (model) => buildHolderLicence({ model, locale: "en", cap: "50000" });
  assert.match(t("personal"), /Commercial use is not permitted/);
  assert.doesNotMatch(t("personal"), /derivative works/);
  assert.match(t("commercial"), /derivative works/);
  assert.match(t("commercial_cap"), /USD 50000 per year/);
  assert.match(t("cc0"), /waives their economic copyright/);
  assert.doesNotMatch(t("cc0"), /5\. Transfer/);
  assert.match(t("commercial"), /5\. Transfer/);
});

test("blanks stay as blanks, nothing is invented", () => {
  const text = buildHolderLicence({ model: "commercial_cap", locale: "en" });
  assert.match(text, /USD __________ per year/);
  assert.match(text, /Governing law: __________/);
  assert.match(text, /“__________”/);
});

test("the AI clause points to authorship.json and gives no guarantee of copyright", () => {
  const text = buildHolderLicence({ model: "commercial", locale: "en" });
  assert.match(text, /authorship\.json/);
  assert.match(text, /does not guarantee/);
});

test("statement and unknown models return null so the short statement stays", () => {
  assert.equal(buildHolderLicence({ model: "statement" }), null);
  assert.equal(buildHolderLicence({ model: "nonsense" }), null);
});

test("the launch advisor puts the chosen draft in holderTemplate and lists the models", () => {
  const short = buildLaunchAdvisor({ chain: "solana", locale: "en" });
  assert.match(short.holderTemplate, /Holder statement/);
  const full = buildLaunchAdvisor({ chain: "solana", locale: "en", licence: "personal", name: "Lions" });
  assert.match(full.holderTemplate, /Holder licence for the images of “Lions”/);
  assert.deepEqual(full.licenceModels, HOLDER_MODELS);
});

test("the deploy kit writes HOLDER-LICENCE.txt from the chosen model, custom text still wins", () => {
  const png = createMockPng({ seed: 3, width: 32, height: 32 });
  const mk = (opts) => buildDeployKit({
    archive: { presetId: "kit", size: 1 },
    preset: { id: "kit", name: "Lions" },
    items: [{ edition: 1, buffer: png, ext: "png", recipe: { edition: 1, traits: { bg: "a" } } }],
    opts: { chain: "solana", symbol: "KIT", creatorAddress: "Creator11111111111111111111111111111111", ...opts },
    locale: "en",
    env: {},
  });
  const kit = mk({ holderModel: "commercial" });
  assert.match(kit.files["HOLDER-LICENCE.txt"], /derivative works/);
  assert.match(kit.files["HOLDER-LICENCE.txt"], /Creator11111111111111111111111111111111/);
  assert.equal(mk({ holderModel: "commercial", holderLicence: "my own text" }).files["HOLDER-LICENCE.txt"].trim(), "my own text");
  assert.match(mk({}).files["HOLDER-LICENCE.txt"], /Holder statement/);
  assert.equal(mk({ includeHolderLicence: false }).files["HOLDER-LICENCE.txt"], undefined);
});
