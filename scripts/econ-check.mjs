import { PACKAGES, creditCost, localGpuCreditCost } from "../src/platform/billing.mjs";
import { ENGINES } from "../src/engines.mjs";

const packs = Object.entries(PACKAGES).map(([id, p]) => ({ id, ...p, per: p.usd / p.credits }));
const cheap = Math.min(...packs.map((p) => p.per));
console.log("packs $/cr", packs.map((p) => `${p.id}:${p.per.toFixed(4)}`).join(" | "), "cheapest", cheap.toFixed(4));

const pay = 0;
const fxIn = 0.02;
const resFx = 0.02; // crypto → USD for API / VPS / SaaS
const inFees = pay + fxIn;

const hosting = 8;
const saas = 10;
const fixed = hosting + saas;

console.log("\n--- cloud engines (ref) vs cheapest pack ---");
for (const id of ["fal", "kontext", "runware", "stability", "pollinations", "openai", "schnell"]) {
  const e = ENGINES[id];
  if (!e) continue;
  const cr = creditCost(id, { reference: true, costUsd: e.costUsd });
  const rev = cr * cheap;
  const api = e.costUsd;
  const gross = rev > 0 ? (1 - api / rev) * 100 : 0;
  console.log(`${id}\tcr=${cr}\tapi=${api}\trev=${rev.toFixed(4)}\tgross=${gross.toFixed(1)}%`);
}
const lg = localGpuCreditCost();
console.log(`localGPU\tcr=${lg}\tapi=0\trev=${(lg * cheap).toFixed(4)}\tgross≈100% before fees`);

const mix = [
  { name: "flux", share: 0.7, crPer: 2, api: 0.025 },
  { name: "openai", share: 0.15, crPer: 6, api: 0.07 },
  { name: "local", share: 0.15, crPer: 1, api: 0 },
];
const apiPerCr = mix.reduce((s, m) => s + m.share * (m.api / m.crPer), 0);
console.log("\nblended api $/cr", apiPerCr.toFixed(5));
console.log(`fees: payment ${pay * 100}% + FX in ${fxIn * 100}% + resource offramp ${resFx * 100}% on (API+fixed)`);

console.log(`\n--- monthly (FIXED=${fixed} = hosting ${hosting} + saas ${saas}) ---`);
for (const nPacks of [5, 10, 20, 40]) {
  const rev = nPacks * 29.99;
  const cr = nPacks * 1000;
  let api = 0;
  for (const m of mix) api += (cr * m.share) / m.crPer * m.api;
  const f = rev * inFees;
  const rfx = (api + fixed) * resFx;
  const profit = rev - api - f - fixed - rfx;
  console.log(
    `${nPacks}xPro rev=${rev.toFixed(0)} api=${api.toFixed(2)} inFees=${f.toFixed(2)} rfx=${rfx.toFixed(2)} fixed=${fixed} net=${profit.toFixed(2)} netMargin=${((100 * profit) / rev).toFixed(1)}%`,
  );
}

const start = PACKAGES.start;
const apiStart = start.credits * apiPerCr;
const contrib = start.usd - apiStart * (1 + resFx) - start.usd * inFees;
const fixedEff = fixed * (1 + resFx);
console.log("\nStart pack contribution", contrib.toFixed(3), "BE packs/mo", Math.ceil(fixedEff / contrib));

const rev20 = 20 * 29.99;
let api20 = 0;
for (const m of mix) api20 += (20 * 1000 * m.share) / m.crPer * m.api;
const net20 = rev20 - api20 - rev20 * inFees - fixed - (api20 + fixed) * resFx;
console.log("\nAt 20xPro/mo net margin", ((100 * net20) / rev20).toFixed(1) + "%", "profit", net20.toFixed(2));
