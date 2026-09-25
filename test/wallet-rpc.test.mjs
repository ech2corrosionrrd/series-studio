import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSolanaRpcUrl, SOLANA_RPC_DEFAULT } from "../src/platform/wallet.mjs";
import { vaultConfigured, vaultRpcUrl } from "../src/platform/vault.mjs";

test("resolveSolanaRpcUrl prefers pay URL, then SOLANA_RPC_URL, then Alchemy", () => {
  assert.equal(
    resolveSolanaRpcUrl({ SOLANA_PAY_RPC_URL: "https://pay.example", SOLANA_RPC_URL: "https://rpc.example" }, { pay: true }),
    "https://pay.example",
  );
  assert.equal(
    resolveSolanaRpcUrl({ SOLANA_RPC_URL: "https://rpc.example", ALCHEMY_API_KEY: "k" }),
    "https://rpc.example",
  );
  assert.equal(
    resolveSolanaRpcUrl({ ALCHEMY_API_KEY: "alch_test" }),
    "https://solana-mainnet.g.alchemy.com/v2/alch_test",
  );
  assert.equal(resolveSolanaRpcUrl({}), SOLANA_RPC_DEFAULT);
});

test("solanaRpcHeaders sets Origin for Alchemy", async () => {
  const { solanaRpcHeaders } = await import("../src/platform/wallet.mjs");
  const h = solanaRpcHeaders("https://solana-mainnet.g.alchemy.com/v2/x", { GENESIS_RPC_ORIGIN: "https://lab.example" });
  assert.equal(h.Origin, "https://lab.example");
  assert.equal(solanaRpcHeaders("https://solana-mainnet.g.alchemy.com/v2/x", {}).Origin, "https://mint.w3ir.io");
  assert.ok(!solanaRpcHeaders("https://api.mainnet-beta.solana.com").Origin);
});
