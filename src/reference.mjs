/**
 * «Сила референсу» — наскільки кадр тримається базової картинки.
 * Порт C:\Промт\services\image_reference.py (та сама шкала, ті самі смуги).
 *
 * Наша шкала: 0.1 … 0.95, вище = ближче до базової картинки, нижче = більше
 * волі трейтам. У провайдерів шкали ЗВОРОТНІ й різні, тож переклад — окремо
 * для кожного двигуна (прокинути число «як є» дало б протилежний результат).
 *
 * | Двигун    | Параметр                  | Як перекладаємо                         |
 * |-----------|---------------------------|-----------------------------------------|
 * | stability | `strength` (денойз)       | зворотно в смугу 0.62–0.85 (як у W3IR)  |
 * | openai    | немає (gpt-image-2 не приймає input_fidelity) | словами в промпті (kontextGuidance) |
 * | kontext   | числового параметра немає | словами в промпті (kontextGuidance)     |
 * | pollinations | те саме (model=kontext)    | той самий kontextGuidance                     |
 */

export const DEFAULT_STRENGTH = 0.45;
export const MIN_STRENGTH = 0.1;
export const MAX_STRENGTH = 0.95;

// Смуга денойзу Stability SD3 i2i — з живого прогону W3IR 22.08.2026.
export const STABILITY_DENOISE_RANGE = [0.62, 0.85];

export function clampStrength(value) {
  const num = Number(value ?? DEFAULT_STRENGTH);
  const s = Number.isFinite(num) ? num : DEFAULT_STRENGTH;
  return Math.max(MIN_STRENGTH, Math.min(MAX_STRENGTH, s));
}

function mapToRange(strength, [low, high]) {
  const ratio = (clampStrength(strength) - MIN_STRENGTH) / (MAX_STRENGTH - MIN_STRENGTH);
  return Math.round((high - ratio * (high - low)) * 1000) / 1000;
}

export function strengthForStability(strength) {
  return mapToRange(strength, STABILITY_DENOISE_RANGE);
}

/** Kontext і gpt-image-2 не мають повзунка сили — кажемо словами, наскільки триматися оригіналу. */
export function kontextGuidance(strength) {
  const s = clampStrength(strength);
  if (s >= 0.75) return "Change ONLY the items listed below; everything else must stay pixel-close to the original.";
  if (s >= 0.5) return "Stay very close to the original image; change the items listed below.";
  if (s >= 0.3) return "Keep the same character and style, but let the listed changes reshape the look freely.";
  return "Use the original only as loose inspiration for the character and style; reinterpret the portrait with the listed changes.";
}

/** Тека результатів: окремо на кожен двигун і силу, щоб можна було порівнювати. */
export function imagesDirName(engine, strength) {
  return `${engine}-s${clampStrength(strength).toFixed(2)}`;
}

/**
 * Resolve the best matching base image for a given recipe.
 * Prefers line-specific base (e.g. base-cyborg.png for line="cyborg")
 * and falls back to primary base image or the first available base.
 * @param {object} recipe - { line: string }
 * @param {Array<{ file: string, line?: string|null, primary?: boolean }>} basesList
 * @returns {{ file: string, line?: string|null, primary?: boolean }|null}
 */
export function resolveBaseImageForRecipe(recipe, basesList = []) {
  if (!Array.isArray(basesList) || !basesList.length) return null;
  const line = recipe?.line;
  if (line) {
    const match = basesList.find((b) => b.line && String(b.line).toLowerCase() === String(line).toLowerCase());
    if (match) return match;
  }
  const primary = basesList.find((b) => b.primary);
  if (primary) return primary;
  return basesList[0] || null;
}

/**
 * Filter edition numbers marked as "redo".
 * @param {Record<string, string>} marks - { "1": "keep", "2": "redo" }
 * @returns {number[]}
 */
export function filterRedoEditions(marks = {}) {
  if (!marks || typeof marks !== "object") return [];
  const editions = [];
  for (const [key, val] of Object.entries(marks)) {
    if (val === "redo") {
      const n = Number(key);
      if (Number.isInteger(n) && n > 0) editions.push(n);
    }
  }
  return editions.sort((a, b) => a - b);
}

/**
 * Filter archive recipes that are marked as "redo".
 * @param {Array<{ edition: number }>} recipes
 * @param {Record<string, string>} marks
 * @returns {Array<{ edition: number }>}
 */
export function filterRedoRecipes(recipes = [], marks = {}) {
  if (!Array.isArray(recipes)) return [];
  const redoSet = new Set(filterRedoEditions(marks));
  return recipes.filter((r) => redoSet.has(r.edition));
}

