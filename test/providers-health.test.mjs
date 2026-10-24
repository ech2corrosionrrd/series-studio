import test from "node:test";
import assert from "node:assert/strict";
import { keyHealth, providerFloatStatus, providerLinks, stabilityBalance } from "../src/platform/providers.mjs";

const KEYS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "STABILITY_API_KEY", "REPLICATE_API_TOKEN", "FAL_KEY", "FAL_API_KEY", "RUNWARE_API_KEY", "IRYS_PRIVATE_KEY", "STABILITY_LOW_BALANCE"];

/** Run with only the given provider keys set; restores the environment afterwards. */
async function withEnv(vars, fn) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, vars);
  try { return await fn(); } finally {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}
const ok = (body = {}) => ({ ok: true, status: 200, json: async () => body });
const bad = () => ({ ok: false, status: 401, json: async () => ({}) });

test("providerLinks: a key in the environment marks a provider configured", async () => {
  await withEnv({}, () => assert.equal(providerLinks().find((p) => p.id === "openai").configured, false));
  await withEnv({ OPENAI_API_KEY: "k" }, () => assert.equal(providerLinks().find((p) => p.id === "openai").configured, true));
  await withEnv({}, () => assert.ok(providerLinks().find((p) => p.id === "solana").configured, "Solana RPC has a default"));
});

test("stabilityBalance: no key, good answer, HTTP error, bad number, network error", async () => {
  await withEnv({}, async () => assert.equal(await stabilityBalance(async () => ok({ credits: 5 })), null));
  await withEnv({ STABILITY_API_KEY: "k" }, async () => {
    assert.equal(await stabilityBalance(async () => ok({ credits: 42.5 })), 42.5);
    assert.equal(await stabilityBalance(async () => bad()), null);
    assert.equal(await stabilityBalance(async () => ok({ credits: "abc" })), null);
    assert.equal(await stabilityBalance(async () => { throw new Error("offline"); }), null);
  });
});

test("providerFloatStatus: Stability thresholds critical / low / ok, unavailable without a balance", async () => {
  const stability = async (credits) => withEnv({ STABILITY_API_KEY: "k", STABILITY_LOW_BALANCE: "100" }, async () =>
    (await providerFloatStatus(async () => ok({ credits }))).find((r) => r.name === "Stability AI"));
  assert.equal((await stability(10)).status, "critical");
  assert.equal((await stability(300)).status, "low");
  const rich = await stability(100000);
  assert.deepEqual([rich.status, rich.note], ["ok", "stability"]);
  assert.ok(rich.balance_usd > 0);
  await withEnv({}, async () => {
    const rows = await providerFloatStatus(async () => bad());
    const s = rows.find((r) => r.name === "Stability AI");
    assert.deepEqual([s.status, s.note, s.balance_usd], ["unknown", "unavailable", null]);
    assert.equal(rows.find((r) => r.name === "Irys").status, "ok");
  });
});

test("keyHealth: probes each configured provider with its own auth header", async () => {
  await withEnv({ OPENAI_API_KEY: "o", ANTHROPIC_API_KEY: "a", STABILITY_API_KEY: "s", REPLICATE_API_TOKEN: "r", FAL_KEY: "f", RUNWARE_API_KEY: "w", IRYS_PRIVATE_KEY: "i" }, async () => {
    const seen = {};
    const fetchImpl = async (url, init) => {
      seen[new URL(url).host] = init.headers;
      return url.includes("stability") ? ok({ credits: 200 }) : url.includes("fal.ai") ? bad() : ok();
    };
    const rows = Object.fromEntries((await keyHealth(fetchImpl)).map((r) => [r.id, r]));
    assert.equal(seen["api.openai.com"].Authorization, "Bearer o");
    assert.equal(seen["api.anthropic.com"]["x-api-key"], "a");
    assert.equal(seen["api.replicate.com"].Authorization, "Token r");
    for (const id of ["openai", "anthropic", "replicate", "runware", "irys"]) assert.deepEqual([rows[id].checked, rows[id].valid], [true, true], id);
    assert.deepEqual([rows.stability.valid, rows.stability.balance], [true, 200]);
    assert.ok(rows.stability.balance_usd > 0);
    assert.equal(rows.fal.valid, true, "fal fails soft when the key is present");
    assert.ok(rows.base.checked && rows.solana.checked, "RPCs are always probed");
  });
});

test("keyHealth: a rejected key and a dead network are reported, not thrown", async () => {
  await withEnv({ OPENAI_API_KEY: "o" }, async () => {
    const rows = await keyHealth(async () => bad());
    assert.equal(rows.find((r) => r.id === "openai").valid, false);
    const down = await keyHealth(async () => { throw new Error("offline"); });
    assert.equal(down.find((r) => r.id === "openai").valid, null);
    assert.equal(down.find((r) => r.id === "anthropic").checked, false);
  });
});
