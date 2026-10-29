// credits: moved out of server/index.mjs without a change in behaviour (docs/QUALITY-REVIEW.md, step 2 of the split plan).
// `handleCreditRoutes` answers true when it handled the request, otherwise the caller carries on with its own routes.
// What lives inside the studio process (the current project's folders, the wallet, the stage charges) arrives in `ctx`.
import { checkSolOrders, createSolOrder, listSolOrders, prepareSolPayment } from "../../src/platform/solpay.mjs";
import { claim as claimHolderBonus, eligibility as holderEligibility } from "../../src/platform/holders.mjs";
import { getBalance, listTransactions } from "../../src/platform/billing.mjs";
import { isAdmin, notifyOperator } from "../../src/platform/ops.mjs";
import { rateLimit } from "../../src/platform/ratelimit.mjs";
import { readBody, send as sendResponse } from "../http.mjs";

export async function handleCreditRoutes(ctx) {
  const { req, res, url, pathname, PUBLIC_MODE, currentWallet } = ctx;
  const send = (...a) => {
    sendResponse(...a);
    return true;
  };

  if (pathname === "/api/credits/history" && req.method === "GET") {
    if (!PUBLIC_MODE) return send(res, 200, { transactions: [] });
    return send(res, 200, { transactions: listTransactions(currentWallet(), 50) });
  }

  // Direct USDC-on-Solana top-up: order → user sends the exact amount → we find it on-chain.
  if (pathname === "/api/credits/sol/order" && req.method === "POST") {
    if (!PUBLIC_MODE) return send(res, 404, { error: "public mode only" });
    rateLimit(req, "credits_sol_order", 20);
    const body = await readBody(req);
    try {
      const wallet = currentWallet();
      return send(res, 200, { order: createSolOrder(wallet, String(body.package || ""), { admin: isAdmin(wallet) }) });
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  }

  // Build unsigned USDC transfer for Phantom confirm (payer signs in the browser).
  if (pathname === "/api/credits/sol/prepare" && req.method === "POST") {
    if (!PUBLIC_MODE) return send(res, 404, { error: "public mode only" });
    rateLimit(req, "credits_sol_prepare", 20);
    const body = await readBody(req);
    try {
      const wallet = currentWallet();
      const prepared = await prepareSolPayment(wallet, String(body.package || ""), String(body.payer || ""), {
        admin: isAdmin(wallet),
      });
      return send(res, 200, prepared);
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  }

  if (pathname === "/api/credits/sol/check" && req.method === "POST") {
    if (!PUBLIC_MODE) return send(res, 404, { error: "public mode only" });
    rateLimit(req, "credits_sol_check", Number.parseInt(process.env.SOLANA_PAY_CHECK_RATE_LIMIT || "", 10) || 20);
    const wallet = currentWallet();
    const r = await checkSolOrders({ wallet, notify: notifyOperator });
    return send(res, 200, {
      credited: r.credited.reduce((n, c) => n + c.credits, 0),
      balance: getBalance(wallet),
      orders: listSolOrders(wallet),
      error: r.error || null,
    });
  }

  if (pathname === "/api/holder" && req.method === "GET") {
    if (!PUBLIC_MODE) return send(res, 404, { error: "public mode only" });
    return send(res, 200, await holderEligibility(currentWallet()));
  }

  if (pathname === "/api/holder/claim" && req.method === "POST") {
    if (!PUBLIC_MODE) return send(res, 404, { error: "public mode only" });
    return send(res, 200, await claimHolderBonus(currentWallet()));
  }

  return false;
}
