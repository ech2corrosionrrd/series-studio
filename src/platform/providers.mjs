/**
 * External provider status: key presence, optional live probe, Stability balance.
 * Port of Промт `services/provider_status.py` (Lab engines + RPC).
 *
 * Direct balance via API key: Stability only. Others → dashboard URL (postpaid).
 */
const TIMEOUT_MS = 12_000;
const STABILITY_BALANCE_URL = "https://api.stability.ai/v1/user/balance";
const STABILITY_USD_PER_CREDIT = 0.01;
const BASE_RPC_DEFAULT = "https://mainnet.base.org";
const SOLANA_RPC_DEFAULT = "https://api.mainnet-beta.solana.com";

export const FLOAT_RECOMMENDED_USD = {
  OpenAI: 30,
  Anthropic: 5,
  "Stability AI": 20,
  Replicate: 10,
  "Fal.ai": 10,
  Runware: 10,
  Pinata: 0,
};

/** Registry: name, env, dashboard url, purpose (uk/en resolved in UI via purpose key). */
export const PROVIDERS = [
  { id: "openai", name: "OpenAI", env: "OPENAI_API_KEY", url: "https://platform.openai.com/usage", purpose: "prov.purpose.openai" },
  { id: "anthropic", name: "Anthropic", env: "ANTHROPIC_API_KEY", url: "https://console.anthropic.com/settings/billing", purpose: "prov.purpose.anthropic" },
  { id: "stability", name: "Stability AI", env: "STABILITY_API_KEY", url: "https://platform.stability.ai/account/credits", purpose: "prov.purpose.stability" },
  { id: "replicate", name: "Replicate", env: "REPLICATE_API_TOKEN", url: "https://replicate.com/account/billing", purpose: "prov.purpose.replicate" },
  { id: "fal", name: "Fal.ai", env: "FAL_KEY", url: "https://fal.ai/dashboard/usage", purpose: "prov.purpose.fal", envAlt: "FAL_API_KEY" },
  { id: "runware", name: "Runware", env: "RUNWARE_API_KEY", url: "https://my.runware.ai/", purpose: "prov.purpose.runware" },
  { id: "pinata", name: "Pinata", env: "PINATA_JWT", url: "https://app.pinata.cloud", purpose: "prov.purpose.pinata" },
  { id: "base", name: "Base RPC", env: "BASE_RPC_URL", url: "https://www.base.org", purpose: "prov.purpose.base_rpc", defaultConfigured: true },
  { id: "solana", name: "Solana RPC", env: "SOLANA_RPC_URL", url: "https://solana.com", purpose: "prov.purpose.solana_rpc", defaultConfigured: true },
];

function envVal(name) {
  return String(process.env[name] || "").trim();
}

function providerConfigured(p) {
  if (envVal(p.env)) return true;
  if (p.envAlt && envVal(p.envAlt)) return true;
  return !!p.defaultConfigured;
}

function providerKey(p) {
  return envVal(p.env) || (p.envAlt ? envVal(p.envAlt) : "");
}

export function providerLinks() {
  return PROVIDERS.map((p) => ({
    id: p.id,
    name: p.name,
    env: p.env,
    configured: providerConfigured(p),
    url: p.url,
    purpose: p.purpose,
    balance_via_api: p.id === "stability",
  }));
}

async function httpOk(url, headers, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return res.ok;
  } catch {
    return null;
  }
}

async function rpcOk(url, method, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return null;
  }
}

export async function stabilityBalance(fetchImpl = fetch) {
  const key = envVal("STABILITY_API_KEY");
  if (!key) return null;
  try {
    const res = await fetchImpl(STABILITY_BALANCE_URL, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const n = Number(data?.credits);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function stabilityHardAlert() {
  const n = Number.parseFloat(process.env.STABILITY_LOW_BALANCE || "100");
  return Number.isFinite(n) ? n : 100;
}

/** Recommended float vs live balance (Stability only has live $). */
export async function providerFloatStatus(fetchImpl = fetch) {
  const out = [];
  for (const [name, rec] of Object.entries(FLOAT_RECOMMENDED_USD)) {
    let balanceUsd = null;
    let status = "unknown";
    let note = "postpaid";
    let credits = null;
    if (name === "Stability AI") {
      credits = await stabilityBalance(fetchImpl);
      if (credits == null) {
        note = "unavailable";
      } else {
        balanceUsd = Math.round(credits * STABILITY_USD_PER_CREDIT * 100) / 100;
        const hard = stabilityHardAlert();
        if (credits < hard) status = "critical";
        else if (balanceUsd < rec) status = "low";
        else status = "ok";
        note = "stability";
      }
    } else if (name === "Pinata") {
      status = "ok";
      note = "free_tier";
    }
    out.push({
      name,
      recommended_usd: rec,
      balance_usd: balanceUsd,
      balance_credits: credits,
      status,
      note,
      hard_alert_credits: name === "Stability AI" ? stabilityHardAlert() : null,
    });
  }
  return out;
}

/** Full health probe (call on button). */
export async function keyHealth(fetchImpl = fetch) {
  const openai = envVal("OPENAI_API_KEY");
  const anthropic = envVal("ANTHROPIC_API_KEY");
  const replicate = envVal("REPLICATE_API_TOKEN");
  const pinata = envVal("PINATA_JWT");
  const stability = envVal("STABILITY_API_KEY");
  const fal = envVal("FAL_KEY") || envVal("FAL_API_KEY");
  const runware = envVal("RUNWARE_API_KEY");
  const baseRpc = envVal("BASE_RPC_URL") || BASE_RPC_DEFAULT;
  const solanaRpc = envVal("SOLANA_RPC_URL") || SOLANA_RPC_DEFAULT;

  const results = [];
  for (const p of PROVIDERS) {
    const row = {
      id: p.id,
      name: p.name,
      env: p.env,
      configured: providerConfigured(p),
      checked: false,
      valid: null,
      balance: null,
      balance_usd: null,
      url: p.url,
      purpose: p.purpose,
    };
    if (p.id === "openai" && openai) {
      row.checked = true;
      row.valid = await httpOk("https://api.openai.com/v1/models", { Authorization: `Bearer ${openai}` }, fetchImpl);
    } else if (p.id === "anthropic" && anthropic) {
      row.checked = true;
      row.valid = await httpOk(
        "https://api.anthropic.com/v1/models",
        { "x-api-key": anthropic, "anthropic-version": "2023-06-01" },
        fetchImpl,
      );
    } else if (p.id === "stability" && stability) {
      row.checked = true;
      row.balance = await stabilityBalance(fetchImpl);
      row.balance_usd = row.balance != null ? Math.round(row.balance * STABILITY_USD_PER_CREDIT * 100) / 100 : null;
      row.valid = row.balance != null;
    } else if (p.id === "replicate" && replicate) {
      row.checked = true;
      row.valid = await httpOk("https://api.replicate.com/v1/account", { Authorization: `Token ${replicate}` }, fetchImpl);
    } else if (p.id === "fal" && fal) {
      row.checked = true;
      // Fal has no cheap auth ping; treat key presence as configured, optional models list.
      row.valid = await httpOk("https://api.fal.ai/v1/models", { Authorization: `Key ${fal}` }, fetchImpl);
      if (row.valid === false || row.valid === null) row.valid = true; // fail-soft: key present
    } else if (p.id === "runware" && runware) {
      row.checked = true;
      row.valid = true; // no public balance ping
    } else if (p.id === "pinata" && pinata) {
      row.checked = true;
      row.valid = await httpOk("https://api.pinata.cloud/data/testAuthentication", { Authorization: `Bearer ${pinata}` }, fetchImpl);
    } else if (p.id === "base") {
      row.checked = true;
      row.valid = await rpcOk(baseRpc, "eth_chainId", fetchImpl);
    } else if (p.id === "solana") {
      row.checked = true;
      row.valid = await rpcOk(solanaRpc, "getHealth", fetchImpl);
    }
    results.push(row);
  }
  return results;
}

/** Snapshot for /api/resources without network (links + float placeholders). */
export function providersSnapshot() {
  return {
    providers: providerLinks(),
    float_note: "Live balance via API: Stability only. Others — open the dashboard link.",
    stability_usd_per_credit: STABILITY_USD_PER_CREDIT,
    stability_low_balance: stabilityHardAlert(),
  };
}
