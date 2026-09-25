/**
 * Direct USDC-on-Solana top-ups (no payment processor, so no regional blocks).
 *
 * Flow: the signed-in user picks a pack → we create an ORDER with a unique amount
 * (pack price + a few micro-USDC, e.g. 4.990137) → the user sends exactly that
 * amount to SOLANA_PAY_RECIPIENT from any Solana wallet → we find the transfer in
 * the recipient's USDC token account and credit the order's owner, once.
 *
 * - The amount is the order id: a manual transfer from Phantom carries no memo,
 *   and a payer may use a different wallet than the one signed in with.
 * - Detection reads the token-transfer INSTRUCTION, not balance deltas, so a
 *   transfer from the recipient's own wallet to itself (a self-test) still counts.
 * - No private key is involved anywhere: only the recipient's PUBLIC address.
 */
import { randomBytes, randomInt } from "node:crypto";
import { PACKAGES, recordPayment } from "./billing.mjs";
import { nowIso, openDb, tx } from "./db.mjs";
import { isSolanaWallet, resolveSolanaRpcUrl, solanaRpcHeaders } from "./wallet.mjs";

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDC_DECIMALS = 6;
const UNIT = 10 ** USDC_DECIMALS;
const MAX_SUFFIX = 9999; // < $0.01 on top of the price
const MAX_PENDING_PER_WALLET = 5;
const TX_CACHE_MAX = 500;
const GRACE_MS = 60_000; // a transfer may be stamped slightly before the order

const envInt = (env, key, def) => {
  const n = Number.parseInt(env[key] || "", 10);
  return Number.isFinite(n) && n > 0 ? n : def;
};

export const solPayRecipient = (env = process.env) => String(env.SOLANA_PAY_RECIPIENT || "").trim();
export const solPayEnabled = (env = process.env) => isSolanaWallet(solPayRecipient(env));
export const solPayMint = (env = process.env) => String(env.SOLANA_PAY_USDC_MINT || "").trim() || USDC_MINT;
const rpcUrl = (env) => resolveSolanaRpcUrl(env, { pay: true });
const commitment = (env) => String(env.SOLANA_PAY_COMMITMENT || "").trim() || "confirmed";
const orderDays = (env) => envInt(env, "SOLANA_PAY_ORDER_DAYS", 7);

/** Admin-only $0.10 pack (SOLANA_PAY_TEST_PACK=1) for end-to-end tests with a tiny real transfer. */
export const TEST_PACK = { id: "test", label: "Тест", usd: 0.1, credits: 2 };
const testPackOn = (env, admin) => admin === true && String(env.SOLANA_PAY_TEST_PACK || "") === "1";

/** Public, non-secret settings for the UI (`admin` unlocks the test pack). */
export function solPayInfo(env = process.env, { admin = false } = {}) {
  if (!solPayEnabled(env)) return { enabled: false };
  const info = { enabled: true, recipient: solPayRecipient(env), mint: solPayMint(env), decimals: USDC_DECIMALS };
  return testPackOn(env, admin) ? { ...info, testPack: TEST_PACK } : info;
}

export const formatUsdc = (micro) => (Number(micro) / UNIT).toFixed(USDC_DECIMALS);

/** Solana Pay transfer-request URL (wallets that register the `solana:` scheme can open it). */
export function solanaPayUri({ recipient, amountMicro, mint, label = "Series Lab", message = "" }) {
  const q = new URLSearchParams({ amount: formatUsdc(amountMicro), "spl-token": mint, label });
  if (message) q.set("message", message);
  return `solana:${recipient}?${q.toString()}`;
}

async function rpc(url, method, params, timeoutMs = 20_000, env = process.env) {
  const res = await fetch(url, {
    method: "POST",
    headers: solanaRpcHeaders(url, env),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Solana RPC HTTP ${res.status}`);
  return res.json();
}

async function call(fetchImpl, env, method, params) {
  const data = await (fetchImpl
    ? fetchImpl(rpcUrl(env), method, params)
    : rpc(rpcUrl(env), method, params, 20_000, env));
  if (data?.error) throw new Error(`Solana RPC ${method}: ${data.error.message || JSON.stringify(data.error)}`);
  return data?.result;
}

const orderView = (o, env = process.env) => {
  const recipient = solPayRecipient(env);
  const mint = solPayMint(env);
  return {
    id: o.id,
    package: o.package,
    credits: o.credits,
    usd: o.price_usd,
    status: o.status,
    amount: formatUsdc(o.amount_micro),
    amount_micro: o.amount_micro,
    recipient,
    mint,
    created_at: String(o.created_at).slice(0, 19),
    uri: solanaPayUri({ recipient, amountMicro: o.amount_micro, mint, message: `Series Lab ${o.package}` }),
  };
};

/**
 * Creates (or returns the still-pending) order for wallet + pack.
 * Throws on unknown pack / disabled feature / too many open orders.
 */
export function createSolOrder(wallet, packageId, { db = openDb(), env = process.env, now = new Date(), admin = false } = {}) {
  if (!solPayEnabled(env)) throw new Error("Пряма оплата USDC не налаштована (SOLANA_PAY_RECIPIENT).");
  const pkg = packageId === TEST_PACK.id && testPackOn(env, admin) ? TEST_PACK : PACKAGES[packageId];
  if (!pkg) throw new Error("Невідомий пакет.");
  const cutoff = nowIso(new Date(now.getTime() - orderDays(env) * 86_400_000));
  return tx(db, () => {
    const existing = db.prepare("SELECT * FROM sol_orders WHERE wallet_address = ? AND package = ? AND status = 'pending' AND created_at >= ? ORDER BY created_at DESC LIMIT 1").get(wallet, packageId, cutoff);
    if (existing) return orderView(existing, env);
    const open = db.prepare("SELECT COUNT(*) AS n FROM sol_orders WHERE wallet_address = ? AND status = 'pending' AND created_at >= ?").get(wallet, cutoff).n;
    if (Number(open) >= MAX_PENDING_PER_WALLET) throw new Error("Забагато незавершених замовлень — дочекайтесь зарахування або спробуйте пізніше.");
    const base = Math.round(pkg.usd * UNIT);
    const used = new Set(db.prepare("SELECT amount_micro FROM sol_orders WHERE status = 'pending' AND created_at >= ? AND amount_micro BETWEEN ? AND ?").all(cutoff, base + 1, base + MAX_SUFFIX).map((r) => r.amount_micro));
    let suffix = 0;
    for (let i = 0; i < 50 && !suffix; i += 1) {
      const s = randomInt(1, MAX_SUFFIX + 1);
      if (!used.has(base + s)) suffix = s;
    }
    if (!suffix) throw new Error("Немає вільної суми для замовлення — спробуйте за хвилину.");
    const order = {
      id: randomBytes(6).toString("hex"),
      wallet_address: wallet,
      package: packageId,
      credits: pkg.credits,
      price_usd: pkg.usd,
      amount_micro: base + suffix,
      status: "pending",
      created_at: nowIso(now),
    };
    db.prepare("INSERT INTO sol_orders (id, wallet_address, package, credits, price_usd, amount_micro, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)")
      .run(order.id, order.wallet_address, order.package, order.credits, order.price_usd, order.amount_micro, order.created_at);
    return orderView(order, env);
  });
}

export function listSolOrders(wallet, { db = openDb(), env = process.env, limit = 5 } = {}) {
  return db.prepare("SELECT * FROM sol_orders WHERE wallet_address = ? ORDER BY created_at DESC LIMIT ?").all(wallet, limit).map((o) => orderView(o, env));
}

/** USDC transfers into `accounts` (a Set of token-account addresses) found in one parsed transaction. */
export function extractUsdcTransfers(txResult, accounts, mint = USDC_MINT) {
  if (!txResult || txResult.meta?.err) return [];
  const all = [
    ...(txResult.transaction?.message?.instructions || []),
    ...(txResult.meta?.innerInstructions || []).flatMap((i) => i.instructions || []),
  ];
  const out = [];
  for (const ins of all) {
    const type = ins?.parsed?.type;
    if (ins?.program !== "spl-token" || (type !== "transfer" && type !== "transferChecked")) continue;
    const info = ins.parsed.info || {};
    if (!accounts.has(info.destination)) continue;
    if (type === "transferChecked" && info.mint !== mint) continue;
    const raw = info.tokenAmount?.amount ?? info.amount;
    if (raw === undefined) continue;
    out.push({ amountMicro: BigInt(raw), source: info.source, destination: info.destination });
  }
  return out;
}

const parsedCache = new Map(); // signature → { blockTimeMs, transfers }
const accountsCache = { key: "", at: 0, list: [] };

async function recipientTokenAccounts(fetchImpl, env) {
  const recipient = solPayRecipient(env);
  const mint = solPayMint(env);
  const key = `${recipient}:${mint}`;
  if (accountsCache.key === key && accountsCache.list.length && Date.now() - accountsCache.at < 600_000) return accountsCache.list;
  const res = await call(fetchImpl, env, "getTokenAccountsByOwner", [recipient, { mint }, { encoding: "jsonParsed", commitment: commitment(env) }]);
  const list = (res?.value || []).map((v) => v.pubkey).filter(Boolean);
  Object.assign(accountsCache, { key, at: Date.now(), list });
  return list;
}

/**
 * Looks for new USDC transfers to the recipient and credits matching pending orders.
 * `wallet` limits the orders (user-triggered check); no RPC is made without pending orders.
 * → { checked, credited: [{ id, credits, signature }], error? }. Never throws.
 */
export async function checkSolOrders({ wallet, db = openDb(), env = process.env, fetchImpl, notify, now = new Date() } = {}) {
  const result = { checked: 0, credited: [] };
  if (!solPayEnabled(env)) return result;
  try {
    const cutoff = nowIso(new Date(now.getTime() - orderDays(env) * 86_400_000));
    const pending = wallet
      ? db.prepare("SELECT * FROM sol_orders WHERE status = 'pending' AND wallet_address = ? AND created_at >= ?").all(wallet, cutoff)
      : db.prepare("SELECT * FROM sol_orders WHERE status = 'pending' AND created_at >= ?").all(cutoff);
    if (!pending.length) return result;
    const mint = solPayMint(env);
    const accounts = await recipientTokenAccounts(fetchImpl, env);
    if (!accounts.length) return { ...result, error: "У гаманця-отримувача ще немає USDC-рахунку — він з'явиться після першого переказу." };
    const set = new Set(accounts);
    const oldest = Math.min(...pending.map((o) => Date.parse(o.created_at))) - GRACE_MS;
    for (const account of accounts) {
      const sigs = await call(fetchImpl, env, "getSignaturesForAddress", [account, { limit: 40, commitment: commitment(env) }]);
      for (const s of sigs || []) {
        if (s.err || (s.blockTime && s.blockTime * 1000 < oldest)) continue;
        let parsed = parsedCache.get(s.signature);
        if (!parsed) {
          const t = await call(fetchImpl, env, "getTransaction", [s.signature, { encoding: "jsonParsed", commitment: commitment(env), maxSupportedTransactionVersion: 0 }]);
          if (!t) continue; // not indexed yet — try on the next poll
          parsed = { blockTimeMs: (t.blockTime || s.blockTime || 0) * 1000, transfers: extractUsdcTransfers(t, set, mint) };
          if (parsedCache.size >= TX_CACHE_MAX) parsedCache.delete(parsedCache.keys().next().value);
          parsedCache.set(s.signature, parsed);
        }
        result.checked += 1;
        for (const tr of parsed.transfers) {
          const order = pending.find((o) => BigInt(o.amount_micro) === tr.amountMicro && parsed.blockTimeMs >= Date.parse(o.created_at) - GRACE_MS);
          if (!order || order.status !== "pending") continue;
          if (settleOrder(order, s.signature, { db, notify })) {
            order.status = "paid";
            result.credited.push({ id: order.id, credits: order.credits, signature: s.signature });
          }
          break; // one order per signature
        }
      }
    }
    return result;
  } catch (e) {
    return { ...result, error: String(e.message || e) };
  }
}

/** Credits the order exactly once (payments.tx_id is the guard). */
function settleOrder(order, signature, { db, notify }) {
  const txId = `sol:${signature}`;
  const credited = recordPayment(txId, order.wallet_address, order.credits, order.price_usd, { db, notify });
  if (!credited) {
    // Already processed: only mark the order if that payment was for this very wallet/pack.
    const row = db.prepare("SELECT wallet_address, credits FROM payments WHERE tx_id = ?").get(txId);
    if (!row || row.wallet_address !== order.wallet_address || row.credits !== order.credits) return false;
  }
  db.prepare("UPDATE sol_orders SET status = 'paid', signature = ?, paid_at = ? WHERE id = ? AND status = 'pending'").run(signature, nowIso(), order.id);
  return credited;
}

/**
 * Build an unsigned USDC transfer for the user's Phantom to confirm.
 * `payer` = Solana pubkey that will sign and pay fees (may differ from Lab login wallet).
 * Returns base64 wire transaction (legacy Message).
 */
export async function buildUsdcPaymentTransaction(order, payer, { env = process.env, fetchImpl } = {}) {
  if (!order || order.status !== "pending") throw new Error("Немає відкритого замовлення для оплати.");
  if (!isSolanaWallet(payer)) throw new Error("Для підтвердження в гаманці потрібна Solana-адреса (Phantom).");

  const { Connection, PublicKey, Transaction } = await import("@solana/web3.js");
  const {
    getAssociatedTokenAddressSync,
    createAssociatedTokenAccountInstruction,
    createTransferCheckedInstruction,
    getAccount,
    TokenAccountNotFoundError,
    TokenInvalidAccountOwnerError,
  } = await import("@solana/spl-token");

  const mint = new PublicKey(solPayMint(env));
  const recipient = new PublicKey(solPayRecipient(env));
  const from = new PublicKey(payer);
  const fromAta = getAssociatedTokenAddressSync(mint, from);
  const toAta = getAssociatedTokenAddressSync(mint, recipient);

  const connection = new Connection(rpcUrl(env), {
    commitment: commitment(env),
    httpHeaders: solanaRpcHeaders(rpcUrl(env), env),
  });

  // Prefer native Connection RPC (uses Alchemy Origin via httpHeaders).
  let sourceAcc;
  try {
    sourceAcc = await getAccount(connection, fromAta);
  } catch (e) {
    if (e instanceof TokenAccountNotFoundError || e instanceof TokenInvalidAccountOwnerError) {
      throw new Error("У цьому Solana-гаманці немає USDC. Поповніть USDC або оберіть інший гаманець.");
    }
    throw e;
  }
  if (sourceAcc.amount < BigInt(order.amount_micro)) {
    throw new Error(
      `Недостатньо USDC: потрібно ${formatUsdc(order.amount_micro)}, на рахунку ${formatUsdc(Number(sourceAcc.amount))}.`,
    );
  }

  const ix = [];
  try {
    await getAccount(connection, toAta);
  } catch (e) {
    if (e instanceof TokenAccountNotFoundError || e instanceof TokenInvalidAccountOwnerError) {
      ix.push(createAssociatedTokenAccountInstruction(from, toAta, recipient, mint));
    } else {
      throw e;
    }
  }
  ix.push(
    createTransferCheckedInstruction(
      fromAta,
      mint,
      toAta,
      from,
      BigInt(order.amount_micro),
      USDC_DECIMALS,
    ),
  );

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(commitment(env));
  const tx = new Transaction({
    feePayer: from,
    blockhash,
    lastValidBlockHeight,
  }).add(...ix);

  const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return {
    transaction: Buffer.from(serialized).toString("base64"),
    payer,
    mint: solPayMint(env),
    amount_micro: order.amount_micro,
    lastValidBlockHeight,
  };
}

/** Create/reuse order + unsigned tx for in-wallet confirm (Phantom). */
export async function prepareSolPayment(wallet, packageId, payer, { db = openDb(), env = process.env, admin = false } = {}) {
  const order = createSolOrder(wallet, packageId, { db, env, admin });
  const payment = await buildUsdcPaymentTransaction(order, payer, { env });
  return { order, ...payment };
}
