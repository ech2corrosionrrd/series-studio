/**
 * Content safety before any paid generation. Port of Промт `services/content_safety.py`.
 *
 * Deliberately narrow: blocks sexualisation of minors and sexual violence only.
 * CSAM needs BOTH a minor marker AND a sexual marker (the word "child" alone is
 * fine), plus a few unambiguous phrases. Bilingual (uk + en).
 *
 * JS pitfall: `\b` is ASCII-only even with the `u` flag, so Cyrillic words would
 * never match. Word edges here are Unicode-aware lookarounds instead.
 */
const L = "(?<![\\p{L}\\p{N}_])";
const R = "(?![\\p{L}\\p{N}_])";
const word = (alts) => new RegExp(`${L}(?:${alts})${R}`, "iu");

const MINOR = word(
  "child|children|childlike|kid|kiddo|toddler|infant|baby|preteen|pre-teen|tween|teen|teenage|teenager|adolescent|minor|underage|juvenile|schoolgirl|schoolboy|loli|lolicon|shota" +
    "|дитин[\\p{L}]*|дитя[\\p{L}]*|дітей|малюк[\\p{L}]*|немовл[\\p{L}]*|підліт[\\p{L}]*|неповнолітн[\\p{L}]*|малолітн[\\p{L}]*|школярк[\\p{L}]*|школяр[\\p{L}]*",
);
const SEXUAL = word(
  "nude|naked|nsfw|porn[\\p{L}]*|pornographic|sex|sexual|sexy|erotic[\\p{L}]*|explicit|hentai|fellatio|genital[\\p{L}]*|nipple[\\p{L}]*|undress[\\p{L}]*|lingerie|seductive|aroused" +
    "|оголен[\\p{L}]*|голий|гола|голе|порно[\\p{L}]*|секс[\\p{L}]*|еротич[\\p{L}]*|еротик[\\p{L}]*|інтимн[\\p{L}]*|статев[\\p{L}]*|збуджен[\\p{L}]*",
);
const EXPLICIT_CSAM = word(
  "child\\s*porn[\\p{L}]*|child\\s*sex[\\p{L}]*|cp\\s*porn|pedophil[\\p{L}]*|paedophil[\\p{L}]*|underage\\s*(?:sex|porn|nude)|csam|child\\s*abuse" +
    "|дитяч[\\p{L}]*\\s*порно[\\p{L}]*|педофіл[\\p{L}]*|розбещення\\s*неповнолітн[\\p{L}]*",
);
const SEXUAL_VIOLENCE = word(
  "rape|raping|gang\\s*rape|non-?consensual|forced\\s*sex|sexual\\s*assault" +
    "|зґвалтув[\\p{L}]*|згвалтув[\\p{L}]*|зґвалт[\\p{L}]*|сексуальн[\\p{L}]*\\s*насил[\\p{L}]*|насильн[\\p{L}]*\\s*статев[\\p{L}]*",
);

export const safetyEnabled = () => process.env.CONTENT_SAFETY_ENABLED !== "0";
export const moderationEnabled = () => process.env.MODERATION_API_ENABLED === "1";

const MESSAGES = {
  "error.blocked_prompt.csam": {
    uk: "Промпт відхилено: контент із сексуалізацією неповнолітніх заборонено.",
    en: "Prompt rejected: sexual content involving minors is prohibited.",
  },
  "error.blocked_prompt.violence": {
    uk: "Промпт відхилено: сексуальне насильство заборонено.",
    en: "Prompt rejected: sexual violence is prohibited.",
  },
  "error.blocked_prompt": { uk: "Промпт відхилено модерацією контенту.", en: "Prompt rejected by content moderation." },
};

export function safetyMessage(result, lang = "uk") {
  const block = MESSAGES[result.code] || MESSAGES["error.blocked_prompt"];
  return block[lang] || block.uk;
}

/** Regex tier only (sync). → { ok, code, category } */
export function checkPromptSafetySync(text) {
  if (!safetyEnabled()) return { ok: true, code: "", category: "" };
  const body = String(text || "").trim();
  if (!body) return { ok: true, code: "", category: "" };
  if (EXPLICIT_CSAM.test(body) || (MINOR.test(body) && SEXUAL.test(body))) {
    return { ok: false, code: "error.blocked_prompt.csam", category: "csam" };
  }
  if (SEXUAL_VIOLENCE.test(body)) return { ok: false, code: "error.blocked_prompt.violence", category: "sexual_violence" };
  return { ok: true, code: "", category: "" };
}

/** Regex tier + opt-in OpenAI Moderation (fail-open, blocks only sexual/minors). */
export async function checkPromptSafety(text, { fetchImpl = fetch } = {}) {
  const first = checkPromptSafetySync(text);
  if (!first.ok || !moderationEnabled() || !String(text || "").trim()) return first;
  const key = process.env.OPENAI_API_KEY;
  if (!key) return first;
  try {
    const res = await fetchImpl("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "omni-moderation-latest", input: text }),
      signal: AbortSignal.timeout(Number(process.env.MODERATION_API_TIMEOUT || 3) * 1000),
    });
    if (!res.ok) return first;
    const cats = (await res.json()).results?.[0]?.categories || {};
    if (cats["sexual/minors"]) return { ok: false, code: "error.blocked_prompt.csam", category: "csam_moderation" };
  } catch { /* fail-open */ }
  return first;
}
