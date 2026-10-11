import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";

const parity = JSON.parse(readFileSync(new URL("./fixtures/compat-snapshot.json", import.meta.url), "utf8"));
const sigs = JSON.parse(readFileSync(new URL("./fixtures/platform-signatures.json", import.meta.url), "utf8"));

const dir = mkdtempSync(join(tmpdir(), "series-platform-"));
process.env.SERIES_DATA_DIR = dir;
process.env.AUTH_SESSION_SECRET = "parity-secret";
delete process.env.MODERATION_API_ENABLED;
delete process.env.ENGINE_CREDIT_COSTS;

const { openDb, closeAll, nowIso } = await import("../src/platform/db.mjs");
const wallet = await import("../src/platform/wallet.mjs");
const session = await import("../src/platform/session.mjs");
const billing = await import("../src/platform/billing.mjs");
const safety = await import("../src/platform/safety.mjs");
const stats = await import("../src/platform/stats.mjs");
const partners = await import("../src/platform/partners.mjs");
const site = await import("../src/platform/site.mjs");
const vault = await import("../src/platform/vault.mjs");

const EVM = "0xabc0000000000000000000000000000000000001";
const SOL = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV";
const okBalance = async () => ({ ok: true, message: "" });
const emptyBalance = async () => ({ ok: false, message: "empty" });

after(() => {
  closeAll();
  rmSync(dir, { recursive: true, force: true });
});

describe("compatibility snapshot (reference outputs)", () => {
  test("session tokens are byte-identical", () => {
    for (const v of parity.tokens) {
      assert.equal(session.issueSessionToken(v.addr, { secret: "parity-secret", now: v.now }), v.token);
      assert.equal(session.verifySessionToken(v.token, { secret: "parity-secret", now: v.now + 10 }), wallet.normalizeAddr(v.addr));
    }
  });

  test("SIWE message text", () => {
    assert.equal(
      wallet.buildSiweMessage("0xAbC0000000000000000000000000000000000001", "n0nce", { domain: "ai.w3ir.io", uri: "https://ai.w3ir.io", chainId: 8453, issuedAt: "2026-09-24T00:00:00Z" }),
      parity.siwe,
    );
  });

  test("referral codes", () => {
    for (const [w, code] of Object.entries(parity.referral)) assert.equal(billing.referralCodeFor(w), code);
  });

  test("Gremlin prompts and TMA prompts", () => {
    for (const g of parity.gremlin) assert.equal(partners.buildGremlinPrompt(partners.validateTraits(g.traits)), g.prompt);
    for (const t of parity.tma) assert.equal(partners.enhanceTmaPrompt(t.prompt, t.style), t.full);
  });

  test("content safety verdicts (incl. Cyrillic word boundaries)", () => {
    for (const s of parity.safety) {
      const r = safety.checkPromptSafetySync(s.text);
      assert.equal(r.ok, s.ok, s.text);
      assert.equal(r.category, s.category, s.text);
    }
  });

  test("slugify, legal HTML, credit table", () => {
    for (const [input, out] of Object.entries(parity.slugify)) assert.equal(site.slugify(input), out);
    for (const lang of ["uk", "en"]) {
      const html = site.renderLegalHtml(lang);
      assert.ok(html.includes(`<html lang="${lang}"`), lang);
      assert.ok(html.includes("Series Lab") && html.includes("/fonts/onest-"), lang);
      assert.doesNotMatch(html, /https:\/\/(cdn\.tailwindcss\.com|fonts\.(googleapis|gstatic)\.com)/, lang);
    }
    const family = { "OpenAI gpt-image-1": "openai", "Stability AI (Core / SD3)": "stability", "Flux.1 (Replicate)": "schnell" };
    for (const [key, credits] of Object.entries(parity.credit_cost)) {
      const [engine, final, ref] = key.split("|");
      assert.equal(billing.creditCost(family[engine], { final: final === "True", reference: ref === "True" }), credits, key);
    }
  });
});

describe("wallet signatures", () => {
  test("EVM personal_sign and Solana ed25519 from Python signers", () => {
    assert.equal(wallet.verifyEvmSignature(sigs.addr, sigs.msg, sigs.sig), true);
    assert.equal(wallet.verifyEvmSignature(sigs.addr, `${sigs.msg}x`, sigs.sig), false);
    assert.equal(wallet.verifyEvmSignature(sigs.addr, sigs.msg, "0x1234"), false);
    assert.equal(wallet.verifySolanaSignature(sigs.sol, sigs.smsg, sigs.ssig), true);
    assert.equal(wallet.verifySolanaSignature(sigs.sol, `${sigs.smsg}x`, sigs.ssig), false);
    assert.equal(wallet.isSolanaWallet(SOL), true);
    assert.equal(wallet.isSolanaWallet(EVM), false);
  });

  test("nonce store is one-time and expires", () => {
    const store = new session.NonceStore(10);
    store.issue("n1", EVM, "m", 0);
    assert.deepEqual(store.consume("n1", 1), { address: EVM, message: "m" });
    assert.equal(store.consume("n1", 1), null);
    store.issue("n2", EVM, "m", 0);
    assert.equal(store.consume("n2", 11), null);
  });
});

describe("billing ledger", () => {
  test("welcome grant: first sign-in with non-empty wallet, idempotent; empty wallet gets it later", async () => {
    const db = openDb();
    const a = "0x1000000000000000000000000000000000000001";
    const r1 = await billing.completeWalletSignIn(a, { balanceCheck: okBalance });
    assert.deepEqual(r1, { welcomed: true, balance: 20, denied: false });
    const r2 = await billing.completeWalletSignIn(a, { balanceCheck: okBalance });
    assert.equal(r2.welcomed, false);
    assert.equal(billing.getBalance(a), 20);

    const b = "0x2000000000000000000000000000000000000002";
    const d1 = await billing.completeWalletSignIn(b, { balanceCheck: emptyBalance });
    assert.equal(d1.balance, 0);
    assert.ok(db.prepare("SELECT 1 FROM funnel_events WHERE wallet_address = ? AND event = 'welcome_denied'").get(b));
    const d2 = await billing.completeWalletSignIn(b, { balanceCheck: okBalance });
    assert.deepEqual([d2.welcomed, d2.balance], [true, 20]);
  });

  test("debit needs verification and balance; refund restores; notes match Passport quests", () => {
    const a = "0x1000000000000000000000000000000000000001";
    assert.equal(billing.deductCredits(a, 6, { engine: "kontext" }), true);
    assert.equal(billing.getBalance(a), 14);
    assert.equal(billing.deductCredits(a, 100, { engine: "kontext" }), false);
    assert.equal(billing.refundCredits(a, 6, { engine: "kontext" }), 20);
    const unverified = "0x3000000000000000000000000000000000000003";
    billing.grantCredits(unverified, 50);
    assert.equal(billing.deductCredits(unverified, 1), false, "grant alone does not allow spending");
    const act = stats.walletActivity(a);
    assert.equal(act.generated, 0, "one debit minus one failure refund");
  });

  test("payments are credited exactly once and reward the referrer once", () => {
    const referrer = "0x4000000000000000000000000000000000000004";
    const invitee = "0x5000000000000000000000000000000000000005";
    billing.grantCredits(referrer, 1);
    assert.equal(billing.recordReferral(invitee, referrer), true);
    assert.equal(billing.recordReferral(invitee, invitee), false);
    assert.equal(billing.recordPayment("tx-1", invitee, 100, 4.99), true);
    assert.equal(billing.recordPayment("tx-1", invitee, 100, 4.99), false);
    assert.equal(billing.getBalance(invitee), 100);
    assert.equal(billing.getBalance(referrer), 51);
    assert.equal(billing.recordPayment("tx-2", invitee, 100, 4.99), true);
    assert.equal(billing.getBalance(referrer), 51, "bonus only for the first payment");
  });

  test("credit cost margin floor and overrides", () => {
    assert.equal(billing.creditCost("kontext", { reference: true, costUsd: 0.04 }), 3, "Kontext Pro keeps a 3-credit minimum");
    assert.equal(billing.creditCost("openai", { reference: true, costUsd: 0.07 }), 6);
    assert.equal(billing.creditCost("kontext", { reference: false, costUsd: 0.04 }), 3, "engine minimum lifts 2 → 3");
    assert.equal(billing.creditCost("pollinations", { reference: true, costUsd: 0.02 }), 2, "cheaper Flux engines stay at 2");
    assert.equal(billing.creditCost("fal", { reference: false, costUsd: 0.025 }), 2, "margin floor lifts 1 → 2");
    assert.equal(billing.creditCost("mock"), 0);
    assert.equal(billing.creditCost("comfyui"), 1, "local GPU support fee");
    assert.equal(billing.creditCost("a1111"), 1);
    process.env.LOCAL_GPU_CREDIT_COST = "2";
    assert.equal(billing.creditCost("comfyui"), 2);
    delete process.env.LOCAL_GPU_CREDIT_COST;
    process.env.ENGINE_CREDIT_COSTS = '{"mock":3,"kontext":2}';
    assert.equal(billing.creditCost("mock"), 3);
    assert.equal(billing.creditCost("kontext", { reference: true, costUsd: 0.04 }), 2, "an explicit override beats the engine minimum");
    delete process.env.ENGINE_CREDIT_COSTS;
  });

  test("rate limit applies to welcome-only wallets, not to paying or granted ones", () => {
    process.env.GENERATION_RATE_LIMIT_PER_MINUTE = "2";
    process.env.FREEMIUM_DAILY_LIMIT = "1";
    const a = "0x1000000000000000000000000000000000000001";
    billing.deductCredits(a, 1);
    billing.deductCredits(a, 1);
    assert.equal(billing.checkGenerationRate(a), false, "welcome-only wallet hits the per-minute cap");
    assert.equal(billing.generationRateLimit(a), 2);
    assert.equal(billing.checkGenerationRate("0x5000000000000000000000000000000000000005"), true, "payer has no cap");
    assert.equal(billing.generationRateLimit("0x5000000000000000000000000000000000000005"), null);
    const granted = "0x6000000000000000000000000000000000000006";
    billing.grantCredits(granted, 20);
    assert.equal(billing.generationRateLimit(granted), null, "a manual grant lifts the per-minute cap");
    assert.equal(billing.checkGenerationRate(granted), true);
    assert.equal(billing.freemiumCheck, undefined, "the daily freemium cap is not a product control");
    delete process.env.FREEMIUM_DAILY_LIMIT;
    delete process.env.GENERATION_RATE_LIMIT_PER_MINUTE;
  });

  test("a daily counter does not block a welcome wallet under the per-minute rate", async () => {
    process.env.FREEMIUM_DAILY_LIMIT = "1";
    process.env.GENERATION_RATE_LIMIT_PER_MINUTE = "10";
    const w = "0x7000000000000000000000000000000000000007";
    const signed = await billing.completeWalletSignIn(w, { balanceCheck: okBalance });
    assert.equal(signed.balance, 20);
    const db = openDb();
    db.prepare("INSERT INTO freemium_usage (wallet_address, day, count) VALUES (?, ?, 99)").run(
      wallet.normalizeAddr(w),
      new Date().toISOString().slice(0, 10),
    );
    assert.equal(billing.generationRateLimit(w), 10);
    assert.equal(billing.checkGenerationRate(w), true);
    assert.equal(billing.deductCredits(w, 1), true);
    assert.equal(billing.getBalance(w), 19);
    delete process.env.FREEMIUM_DAILY_LIMIT;
    delete process.env.GENERATION_RATE_LIMIT_PER_MINUTE;
  });

  test("funnel counts external wallets", () => {
    const f = stats.funnel(30, { scope: "external" });
    assert.ok(f.new_verified >= 2);
    assert.ok(f.paying_wallets >= 1);
    assert.ok(f.first_debit_wallets >= 1);
  });

  test("timestamps use Python isoformat shape", () => {
    assert.match(nowIso(new Date("2026-09-24T10:11:12.345Z")), /^2026-09-24T10:11:12\.345000\+00:00$/);
  });
});

describe("partners", () => {
  test("Gremlin validation", () => {
    assert.throws(() => partners.validateTraits({ body: "void" }), /invalid trait: eyes/);
    assert.throws(() => partners.validateSeed(1.5), /invalid seed/);
    assert.throws(() => partners.validateSeed(2_000_000), /invalid seed/);
    assert.equal(partners.validateSeed(42), 42);
  });

  test("TMA: engines, styles, body, reference image", () => {
    assert.equal(partners.resolveTmaEngine("FLUX"), "Flux.1 (Replicate)");
    assert.equal(partners.resolveTmaEngine("gpt-image-1"), "OpenAI gpt-image-1");
    assert.throws(() => partners.resolveTmaEngine("dalle"), /Unknown engine/);
    assert.throws(() => partners.resolveTmaStyle("vaporwave"), /Unknown style/);
    assert.throws(() => partners.parseTmaBody({ prompt: "" }), /prompt/);
    assert.deepEqual(partners.parseTmaBody({ prompt: "x" }).count, 4);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]).toString("base64");
    assert.equal(partners.decodeReferenceImage(`data:image/png;base64,${jpeg}`, 0.5).mime, "image/jpeg");
    assert.throws(() => partners.decodeReferenceImage("data:image/png;base64,", 0.5), /Empty/);
    assert.throws(() => partners.decodeReferenceImage("@@@", 0.5), /Invalid/);
  });

  test("launchpad inspection and zip-slip guard", async () => {
    const zip = new JSZip();
    zip.file("config.json", JSON.stringify({ number: 3, symbol: "GRM" }));
    zip.file("manifest.json", JSON.stringify({ name: "Gremlins" }));
    zip.file("assets/0.png", "x");
    const report = await partners.inspectBundleZip(await zip.generateAsync({ type: "nodebuffer" }));
    assert.equal(report.valid, true);
    assert.equal(report.sugar_ready, true);
    assert.equal(report.items_count, 3);
    assert.equal(report.collection_name, "Gremlins");
    const bad = new JSZip();
    bad.file("../evil.txt", "x");
    assert.equal((await partners.inspectBundleZip(await bad.generateAsync({ type: "nodebuffer" }))).valid, false);
    assert.equal((await partners.inspectBundleZip(Buffer.from("nope"))).valid, false);
  });

  test("B2B keys: staging key outside production, quota is atomic", () => {
    const key = partners.generateB2bKey("Test", 1);
    assert.equal(partners.verifyB2bKey(key).client_name, "Test");
    assert.equal(partners.recordB2bUsage(key, 1), true);
    assert.equal(partners.recordB2bUsage(key, 1), false);
    assert.equal(partners.verifyB2bKey(key), null);
    assert.ok(partners.verifyB2bKey(partners.STAGING_KEY));
  });
});

describe("public site", () => {
  test("publish → load → render; images only from the manifest whitelist", () => {
    const slug = site.publishCollection("My Cool Collection!", [{ name: "a.png", bytes: Buffer.from("png") }, { name: "b.txt", bytes: Buffer.from("x") }], { wallet: EVM });
    assert.equal(slug, "my-cool-collection");
    assert.equal(site.publishCollection("My Cool Collection!", [{ name: "a.png", bytes: Buffer.from("png") }]), "my-cool-collection-2");
    const m = site.loadCollection(slug);
    assert.deepEqual(m.images, ["1.png"]);
    assert.equal(m.ref_code, parity.referral[EVM]);
    assert.ok(site.collectionImagePath(slug, "1.png"));
    assert.equal(site.collectionImagePath(slug, "../manifest.json"), null);
    assert.match(site.renderCollectionHtml(slug), /My Cool Collection!/);
    // The server CSP blocks third-party code and styles: the public page must not depend on any (it was unstyled once).
    assert.doesNotMatch(site.renderCollectionHtml(slug), /cdn\.tailwindcss|googleapis|gstatic|<script/);
    assert.match(site.renderCollectionHtml(slug), /<style>[\s\S]*\.grid\{/);
    assert.ok(site.listCollections(50).some((c) => c.slug === "my-cool-collection"));
  });

  test("collections from the previous platform are neither served nor listed (only Series Lab images)", () => {
    const dir = join(site.publicDir(), "old-platform-set");
    mkdirSync(join(dir, "img"), { recursive: true });
    writeFileSync(join(dir, "img", "1.png"), "png");
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ slug: "old-platform-set", title: "Old Platform Set", images: ["1.png"], created_at: "2026-06-24T18:23:06.092094+00:00" }));
    assert.equal(site.loadCollection("old-platform-set"), null);
    assert.equal(site.renderCollectionHtml("old-platform-set"), null);
    assert.equal(site.collectionImagePath("old-platform-set", "1.png"), null);
    assert.ok(!site.listCollections(50).some((c) => c.slug === "old-platform-set"));
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ slug: "old-platform-set", title: "No Date", images: ["1.png"] }));
    assert.equal(site.loadCollection("old-platform-set"), null, "no created_at means not provably made in Series Lab");
  });
});

describe("vault", () => {
  test("catalog validation refuses protocol addresses and duplicates", () => {
    const file = join(dir, "vault_catalog.json");
    writeFileSync(file, JSON.stringify([{ index: 0, mint: SOL }]));
    assert.equal(vault.resolveMint(vault.loadCatalog(file), 0), SOL);
    writeFileSync(file, JSON.stringify([{ index: 0, mint: "6YRxC2pwqttw11zy4v2cGgV3DztpPX7zSHrFFcA4nmqC" }]));
    assert.throws(() => vault.loadCatalog(file), /protocol address/);
    writeFileSync(file, JSON.stringify([{ index: 0, mint: SOL }, { index: 0, mint: SOL }]));
    assert.throws(() => vault.loadCatalog(file), /duplicate/);
    assert.throws(() => vault.resolveMint([], 3), /not in the vault/);
  });
});
