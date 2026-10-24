/**
 * Which Claude model the vision features (Vision Assist and the AI critic) call.
 * ANTHROPIC_MODEL overrides the default, so a retired model is a one-line .env change instead of a release.
 */
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5";

export const anthropicModel = (env = process.env) => String(env?.ANTHROPIC_MODEL || "").trim() || DEFAULT_ANTHROPIC_MODEL;
