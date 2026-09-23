/**
 * Prompt lint + brand / franchise / celebrity blocklist (maintainable, case-insensitive).
 * Soft safety gate before paid generate — not a full content filter.
 */

/** Major brands, franchises, celebrity patterns — keep short & editable. */
export const DEFAULT_BLOCKLIST = [
  // Big tech / consumer brands
  "apple",
  "iphone",
  "ipad",
  "macbook",
  "airpods",
  "google",
  "android",
  "samsung",
  "microsoft",
  "windows",
  "xbox",
  "playstation",
  "nintendo",
  "sony",
  "nike",
  "adidas",
  "gucci",
  "louis vuitton",
  "chanel",
  "supreme",
  "coca[- ]?cola",
  "pepsi",
  "mcdonald'?s",
  "starbucks",
  "disney",
  "marvel",
  "dc comics",
  "warner Bros",
  "pixar",
  "pokemon",
  "pokémon",
  "hello kitty",
  "sanrio",
  "lego",
  "barbie",
  "transformers",
  "star wars",
  "star trek",
  "harry potter",
  "hogwarts",
  "lord of the rings",
  "ghibli",
  "studio ghibli",
  "anime girl from",
  // Platforms / social logos often pasted into prompts
  "instagram logo",
  "tiktok logo",
  "youtube logo",
  "twitter logo",
  "x\\.com logo",
  // Celebrity / IP shorthand (patterns)
  "taylor swift",
  "elon musk",
  "donald trump",
  "kim kardashian",
  "beyonc[eé]",
  "rihanna",
  "kanye",
  "oprah",
  "tom cruise",
  "brad pitt",
  "angelina jolie",
  "leonardo dicaprio",
  "scarlett johansson",
  "ryan reynolds",
  "zendaya",
  "drake\\b",
  "justin bieber",
  "ariana grande",
  "selena gomez",
  "cristiano ronaldo",
  "lionel messi",
  "mickey mouse",
  "minnie mouse",
  "donald duck",
  "spongebob",
  "batman",
  "superman",
  "spiderman",
  "spider-man",
  "iron man",
  "captain america",
  "wonder woman",
  "darth vader",
  "yoda\\b",
  "pikachu",
  "mario\\b",
  "luigi\\b",
  "sonic the hedgehog",
  "hello kitty",
];

function compile(patterns) {
  return patterns
    .map((p) => String(p || "").trim())
    .filter(Boolean)
    .map((p) => {
      try {
        return { raw: p, re: new RegExp(`(?:^|[^a-z0-9])(?:${p})(?:[^a-z0-9]|$)`, "i") };
      } catch {
        return { raw: p, re: null };
      }
    })
    .filter((x) => x.re);
}

const DEFAULT_COMPILED = compile(DEFAULT_BLOCKLIST);

/**
 * @param {string} text
 * @param {string[]} [extra] — additional patterns (regex source fragments)
 * @returns {{ ok: boolean, hits: string[] }}
 */
export function lintPrompt(text, extra = []) {
  const src = String(text ?? "");
  if (!src.trim()) return { ok: true, hits: [] };
  const compiled = extra?.length
    ? [...DEFAULT_COMPILED, ...compile(extra)]
    : DEFAULT_COMPILED;
  const hits = [];
  const seen = new Set();
  for (const { raw, re } of compiled) {
    if (re.test(src)) {
      const key = raw.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        hits.push(raw);
      }
    }
  }
  return { ok: hits.length === 0, hits };
}

/**
 * Lint many prompts; returns union of hits + per-item detail.
 * @param {string[]} texts
 */
export function lintPrompts(texts) {
  const allHits = [];
  const seen = new Set();
  const items = [];
  for (const text of texts || []) {
    const r = lintPrompt(text);
    items.push(r);
    for (const h of r.hits) {
      const k = h.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        allHits.push(h);
      }
    }
  }
  return { ok: allHits.length === 0, hits: allHits, items };
}
