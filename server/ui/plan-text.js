/**
 * The plan that "Estimate (free)" shows, written in the author's language from the structured answer of /api/estimate
 * (BETA-REVIEW round 2, R6: the server text was English only, and it could not follow a language switch).
 * `t` is the locale lookup; `data` is the JSON of the estimate.
 */
const MODES = new Set(["pilot", "missing", "first", "only"]);

export function formatPlan(data, t) {
  if (!data || typeof data !== "object" || data.editions == null) return data?.text || "";
  const lines = [];
  if (data.file) lines.push(t("render.plan.archive", { file: data.file }));
  lines.push(t("render.plan.engine", { engine: data.engine, strength: data.strength }));
  lines.push(t("render.plan.set", { set: data.set }));
  const mode = MODES.has(data.mode) ? t(`render.plan.mode.${data.mode}`) : String(data.mode || "");
  lines.push(`${t("render.plan.mode", { mode })}${data.force ? ` · ${t("render.plan.force")}` : ""}`);
  const list = data.count ? ` → #${data.editions.slice(0, 24).join(", #")}${data.count > 24 ? "…" : ""}` : "";
  lines.push(t("render.plan.toGenerate", { n: data.count, list }));
  lines.push(t("render.plan.skip", { n: (data.skippedExisting || []).length }));
  if (data.creditsNeeded != null) {
    const unit = data.count ? data.creditsNeeded / data.count : 0;
    lines.push(t("render.plan.credits", { needed: data.creditsNeeded, unit, balance: data.creditsBalance }));
  } else {
    lines.push(t("render.plan.usd", { cost: data.costUsd, unit: data.unitCostUsd }));
    lines.push(`${t("render.plan.spent", { spent: data.spentTodayUsd })}${data.capUsd != null ? t("render.plan.cap", { cap: data.capUsd }) : t("render.plan.noCap")}`);
  }
  if (data.capError) lines.push("", data.creditsNeeded != null ? t("render.plan.capPublic") : `⛔ ${data.capError}`);
  lines.push("", t("render.plan.footer"));
  if (data.lint && data.lint.ok === false) lines.push("", t("render.plan.lint", { hits: (data.lint.hits || []).join(", ") }));
  return lines.join("\n");
}
