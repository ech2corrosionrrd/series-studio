// Operator routes: admin system view, resources (plan, balances, alerts, notes), economy report, spend, engine status.
// Moved out of server/index.mjs without a change in behaviour (docs/QUALITY-REVIEW.md, step 2 of the split plan).
// `handleAdminRoutes` answers true when it handled the request, otherwise the caller carries on with its own routes.
// Everything that lives inside the studio process (public-mode flag, body reader, payload builders) arrives in `ctx`.
import { testEngineConnection } from "../../src/connectors.mjs";
import { economyReport } from "../../src/platform/margin.mjs";
import { decisionRule } from "../../src/platform/decision.mjs";
import { providerFloatStatus } from "../../src/platform/providers.mjs";
import { resourceCatalog, setAlertThreshold, setResourceNote } from "../../src/platform/resource-catalog.mjs";
import { setManualBalance } from "../../src/platform/resources.mjs";
import { funnel } from "../../src/platform/stats.mjs";
import { engineStatsToday, recentEngineErrors, spendByEngineToday, spendCap, spentToday } from "../../src/spend.mjs";

export async function handleAdminRoutes(ctx) {
  const { req, res, url, pathname, PUBLIC_MODE, send, readBody, rejectSecrets, isAdminNow, systemPayload, renderLog, resourcesPayload, resourcesPayloadLive } = ctx;

  if (pathname === "/api/admin/system" && req.method === "GET") {
    if (PUBLIC_MODE && !isAdminNow()) return send(res, 403, { error: "admin only" });
    return send(res, 200, systemPayload());
  }

  // Recommended balance per API provider (load, demand trend, credits already sold) + manual balances.
  if (pathname === "/api/admin/resources/plan" && req.method === "GET") {
    const probe = url.searchParams.get("probe") === "1" || url.searchParams.get("probe") === "true";
    const live = {};
    if (probe) {
      const float = await providerFloatStatus();
      const st = float.find((f) => f.name === "Stability AI");
      if (st && st.balance_usd != null) live.stability = st.balance_usd;
    }
    return send(res, 200, resourceCatalog({ live }));
  }

  if (pathname === "/api/admin/resources/balance" && req.method === "POST") {
    const body = await readBody(req);
    if (rejectSecrets(res, body)) return true;
    try {
      return send(res, 200, { ok: true, ...setManualBalance(body.provider, body.balance_usd, { note: body.note }) });
    } catch (e) {
      return send(res, e.status || 400, { error: String(e.message || e) });
    }
  }

  if (pathname === "/api/admin/resources/alert" && req.method === "POST") {
    const body = await readBody(req);
    if (rejectSecrets(res, body)) return true;
    try {
      return send(res, 200, { ok: true, ...setAlertThreshold(body.provider, body.below_usd) });
    } catch (e) {
      return send(res, e.status || 400, { error: String(e.message || e) });
    }
  }

  if (pathname === "/api/admin/resources/note" && req.method === "POST") {
    const body = await readBody(req);
    if (rejectSecrets(res, body)) return true;
    try {
      return send(res, 200, { ok: true, ...setResourceNote(body.provider, body.note) });
    } catch (e) {
      return send(res, e.status || 400, { error: String(e.message || e) });
    }
  }

  if (pathname === "/api/admin/economy" && req.method === "GET") {
    if (PUBLIC_MODE && !isAdminNow()) return send(res, 403, { error: "admin only" });
    const raw = String(url.searchParams.get("days") || "all").toLowerCase();
    const days = raw === "7" || raw === "7d" ? 7 : raw === "30" || raw === "30d" ? 30 : null;
    const report = economyReport(days);
    report.funnel_30d = funnel(30);
    report.funnel_30d_external = funnel(30, { scope: "external" });
    report.funnel_total_external = funnel(36500, { scope: "external" });
    report.decision_rule = decisionRule();
    return send(res, 200, report);
  }

  if (pathname === "/api/spend" && req.method === "GET") {
    return send(res, 200, {
      capUsd: spendCap(process.env.SERIES_SPEND_CAP_USD),
      spentTodayUsd: spentToday(renderLog()),
      byEngine: spendByEngineToday(renderLog()),
      engines: engineStatsToday(renderLog()),
      errors: recentEngineErrors(renderLog()),
    });
  }

  if (pathname === "/api/engines/status" && req.method === "GET") {
    const list = ["fal", "comfyui", "a1111", "replicate", "openai", "stability"];
    const statuses = await Promise.all(
      list.map((eng) => testEngineConnection(eng, process.env, globalThis.fetch)),
    );
    return send(res, 200, { ok: true, engines: statuses });
  }

  if (pathname === "/api/resources" && req.method === "GET") {
    const probe = url.searchParams.get("probe") === "1" || url.searchParams.get("probe") === "true";
    if (probe) return send(res, 200, await resourcesPayloadLive());
    return send(res, 200, resourcesPayload());
  }

  return false;
}
