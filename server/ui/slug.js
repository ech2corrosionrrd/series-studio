/**
 * Series ids from names. A preset id becomes a file name (presets/<id>.json, out/<id>.json), so it is Latin letters, digits, dot, dash
 * and underscore. Ukrainian names are transliterated (the 2010 national system, simplified: no apostrophe or soft sign) instead of
 * turning into an empty slug. Pure functions, no DOM: the unit test imports this file directly.
 */
const UK_TO_LATIN = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie", ж: "zh", з: "z", и: "y", і: "i", ї: "i", й: "i", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ю: "iu", я: "ia",
  // Russian letters a Ukrainian keyboard can still produce
  ы: "y", э: "e", ё: "io", ъ: "",
  ь: "", "'": "", "’": "", ʼ: "",
};

/** The same rule as PRESET_ID_PATTERN in src/validate.mjs (the server refuses an id that does not match). */
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Cyrillic letters to Latin; everything else is left as it is. */
export function transliterate(text) {
  let out = "";
  for (const ch of String(text ?? "")) {
    const low = ch.toLowerCase();
    out += Object.hasOwn(UK_TO_LATIN, low) ? UK_TO_LATIN[low] : ch;
  }
  return out;
}

/** "Мої герої" -> "moi-heroi"; "My Heroes!" -> "my-heroes"; nothing usable -> "". */
export function slugifyId(name) {
  return transliterate(String(name ?? "").trim())
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}
