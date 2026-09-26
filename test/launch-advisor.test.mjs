import test from "node:test";
import assert from "node:assert/strict";
import { createMockPng } from "../src/mock-image.mjs";
import { buildDeployKit } from "../src/deploy-kit.mjs";
import { buildLaunchAdvisor } from "../src/launch-advisor.mjs";
import uk from "../server/ui/locales/uk.js";
import en from "../server/ui/locales/en.js";

test("launch advisor is offline, cites ranges, and does not ask for a seed", () => {
  const ukText = buildLaunchAdvisor({ chain: "solana", locale: "uk" });
  assert.equal(ukText.offline, true);
  assert.equal(ukText.exchangePrices, false);
  assert.match(ukText.text, /Classic/);
  assert.match(ukText.text, /Arweave/);
  assert.match(ukText.text, /Irys/);
  assert.match(ukText.text, /НЕПЕРЕВІРЕНО/);
  assert.equal(ukText.text.includes("UNVERIFIED"), false);
  assert.match(ukText.text, /шахрайства з утечею коштів/);
  assert.equal(/\brug\b/i.test(ukText.text.replace(/\([^)]*\)/g, " ")), false);
  assert.equal(ukText.sections[1].checks.length, 6);
  assert.equal(ukText.sections[0].links[0].href.includes("nftevening.com"), true);
  assert.equal(ukText.sections[0].links.some((item) => item.href === item.label), false);
  assert.match(ukText.text, /64%/);
  assert.match(ukText.text, /5,63 млрд USD/);
  assert.match(ukText.text, /ProgramAllowList/);
  assert.match(ukText.text, /Creator Hub/);
  assert.equal(/seed/i.test(ukText.text), false);
  assert.equal(/seed/i.test(ukText.holderTemplate), false);
  assert.equal(ukText.text.includes("binance"), false);
  assert.equal(ukText.sources.drops2024.includes("nftevening.com"), true);

  const evm = buildLaunchAdvisor({ chain: "evm", locale: "en" });
  assert.match(evm.text, /ERC-2981/);
  assert.match(evm.text, /OpenSea/);
  assert.match(evm.text, /UNVERIFIED/);
  assert.equal(/[А-Яа-яІіЇїЄєҐґ]/.test(evm.text), false);
  assert.equal(/seed/i.test(evm.text), false);
  const btc = buildLaunchAdvisor({ chain: "bitcoin", locale: "uk" });
  assert.match(btc.text, /Ordinals/);
  assert.equal(btc.text.includes("ProgramAllowList"), false);
});

test("deploy kit includes the advisor and can omit the holder statement", () => {
  const item = {
    edition: 1,
    buffer: createMockPng({ seed: 3, width: 16, height: 16 }),
    ext: "png",
    recipe: { edition: 1, traits: { bg: "a" } },
  };
  const kit = buildDeployKit({
    items: [item],
    preset: { name: "Advisor" },
    opts: { chain: "solana", symbol: "ADV" },
    locale: "uk",
    env: {},
  });
  assert.match(kit.files["ADVISOR.txt"], /Classic/);
  assert.match(kit.files["HOLDER-LICENCE.txt"], /Заява для власників/);
  assert.equal(/seed/i.test(kit.files["ADVISOR.txt"]), false);
  assert.equal(kit.files["DEPLOY.txt"].includes("deploy now"), false);

  const custom = buildDeployKit({
    items: [item],
    opts: {
      chain: "solana",
      includeHolderLicence: true,
      holderLicence: "Holders may display the image.",
    },
    locale: "en",
    env: {},
  });
  assert.match(custom.files["HOLDER-LICENCE.txt"], /Holders may display/);

  const omitted = buildDeployKit({
    items: [item],
    opts: { chain: "evm", includeHolderLicence: false },
    locale: "en",
    env: {},
  });
  assert.equal(omitted.files["HOLDER-LICENCE.txt"], undefined);
  assert.match(omitted.files["ADVISOR.txt"], /Arweave/);
});

test("export help quotes the button label of the active locale", () => {
  assert.match(uk["export.hint.tip"], /«Перевірити чекліст»/);
  assert.equal(uk["export.hint.tip"].includes("Run checklist"), false);
  assert.equal(uk["export.checklist.run"], "Перевірити чекліст");
  assert.match(uk["help.aiMark"], /не стверджує/);
  assert.equal(/провайдером за AI Act/.test(uk["help.aiMark"]), false);
  assert.match(en["export.hint.tip"], /«Run checklist»/);
  assert.equal(en["export.checklist.run"], "Run checklist");
  assert.match(en["help.aiMark"], /does not say whether Series Lab is a provider/);
});
