import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAll, openDb } from "../src/platform/db.mjs";
import { completeWalletSignIn, deductCredits, recordPayment } from "../src/platform/billing.mjs";
import {
  quoteStage,
  stageLedgerReport,
  creditsForUsd,
  LIST_USD_PER_CREDIT,
} from "../src/platform/stage-pricing.mjs";
import { economyReport } from "../src/platform/margin.mjs";

const env = {
  STAGE_USD_PER_CREDIT: "0.03",
  VISION_CREDIT_COST: "1",
};

test("credits are ceil((cost + margin) / rate) and defaults stay small", () => {
  assert.equal(creditsForUsd(0.03, env), 1);
  assert.equal(creditsForUsd(0.06, env), 2);
  assert.equal(creditsForUsd(0, env), 0);
  const archive = quoteStage("archive", { zip: true }, env);
  assert.equal(archive.costUsd, 0);
  assert.equal(archive.marginUsd, 0.03);
  assert.equal(archive.credits, 1);
  assert.match(archive.formula, /ceil/);
  const storage = quoteStage("archive", { zip: false, storage: true }, env);
  assert.equal(storage.costUsd, 0.05);
  assert.equal(storage.marginUsd, 0.01);
  assert.equal(storage.credits, 2);
  assert.match(storage.note, /Arweave/);
  // legacy option and env names still work
  const legacy = quoteStage("archive", { zip: false, ipfs: true }, { ...env, STAGE_IPFS_COST_USD: "0.2", STAGE_IPFS_MARGIN_USD: "0.04" });
  assert.equal(legacy.costUsd, 0.2);
  assert.equal(legacy.marginUsd, 0.04);
  // new names win over the legacy ones
  const both = quoteStage("archive", { zip: false, storage: true }, { ...env, STAGE_IPFS_COST_USD: "0.2", STAGE_STORAGE_COST_USD: "0.07" });
  assert.equal(both.costUsd, 0.07);
  const deploy = quoteStage("deploy_kit", {}, env);
  assert.equal(deploy.credits, 2);
  const market = quoteStage("marketplace_kit", {}, env);
  assert.equal(market.credits, 2);
  const free = quoteStage("curation", { provider: "heuristic" }, env);
  assert.equal(free.credits, 0);
  assert.equal(LIST_USD_PER_CREDIT, 0.03);
});

test("owner env overrides the archive margin", () => {
  const q = quoteStage("archive", { zip: true }, {
    ...env,
    STAGE_ARCHIVE_COST_USD: "0.10",
    STAGE_ARCHIVE_MARGIN_USD: "0.02",
  });
  assert.equal(q.costUsd, 0.1);
  assert.equal(q.marginUsd, 0.02);
  assert.equal(q.credits, 4);
});

test("ledger report splits generation cost from stage fees", async () => {
  const dir = mkdtempSync(join(tmpdir(), "series-stage-price-"));
  process.env.USERS_DB_PATH = join(dir, "users.db");
  process.env.SERIES_DATA_DIR = dir;
  process.env.WELCOME_REQUIRE_BALANCE = "0";
  process.env.AUTH_SESSION_SECRET = "stage-price-test";
  closeAll();
  const db = openDb(join(dir, "users.db"));
  const wallet = "0x2222222222222222222222222222222222222222";
  await completeWalletSignIn(wallet, { db, balanceCheck: async () => ({ ok: true }) });
  recordPayment("tx-stage-1", wallet, 100, 3, { db });
  assert.equal(deductCredits(wallet, 2, { engine: "kontext", note: "image generation", db }), true);
  assert.equal(deductCredits(wallet, 1, { engine: "stage:archive", note: "archive export", db }), true);
  assert.equal(deductCredits(wallet, 2, { engine: "stage:deploy_kit", note: "deploy kit", db }), true);
  const report = stageLedgerReport(db, null, {
    apiUsd: (engine) => (engine === "kontext" ? 0.003 : 0),
    avgUsdPerCredit: 0.03,
    env,
  });
  const by = Object.fromEntries(report.stages.map((s) => [s.stage, s]));
  assert.equal(by.generation.ops, 1);
  assert.equal(by.generation.credits_spent, 2);
  assert.equal(by.generation.cost_usd, 0.003);
  assert.equal(by.archive.credits_spent, 1);
  assert.equal(by.archive.cost_usd, 0);
  assert.ok(by.archive.revenue_usd > 0);
  assert.equal(by.deploy_kit.credits_spent, 2);
  assert.equal(by.marketplace_kit.ops, 0);
  const full = economyReport(null, db);
  assert.ok(Array.isArray(full.stages.stages));
  assert.equal(full.stages.stages.length, 5);
  assert.ok(Array.isArray(full.stage_prices));
  closeAll();
});
