/**
 * Draft licence for the holder of an item: what the holder may do with the image.
 * A starting text for a lawyer, not legal advice. Series Lab does not sign it.
 * Models:
 *   statement       short fill-in-the-blanks statement (the default, see launch-advisor.mjs)
 *   personal        personal, non-commercial use only
 *   commercial      the holder may also use their own item commercially
 *   commercial_cap  commercial use up to a yearly revenue cap, above it by written consent
 *   cc0             the creator waives rights as far as the law allows
 */

export const HOLDER_MODELS = ["statement", "personal", "commercial", "commercial_cap", "cc0"];

const BLANK = "__________";

const T = {
  uk: {
    title: (name) => `Ліцензія власника на зображення колекції «${name}»`,
    draft: [
      "ЧЕРНЕТКА для юриста. Це не юридичний висновок і не готовий договір.",
      "Заповніть пропуски (__________) і дайте прочитати юристу вашої юрисдикції до публікації.",
      "Series Lab цей текст не підписує, не є стороною ліцензії й не вирішує, чи вона чинна.",
    ],
    defs: [
      "1. Терміни",
      "«Автор» — особа, що випустила колекцію: {creator}.",
      "«Предмет» — окремий токен колекції, а «Зображення» — картинка (і пов'язані з нею метадані), яку цей токен позначає.",
      "«Власник» — гаманець, що тримає токен предмета в цей момент.",
    ],
    owns: [
      "2. Що отримує власник",
      "Власник володіє токеном. Токен сам по собі не передає авторських прав на Зображення: Власник отримує лише права, прямо названі нижче.",
      "Ліцензія прив'язана до токена й діє, поки Власник тримає токен.",
    ],
    rights: {
      personal: [
        "3. Права власника",
        "Власник може показувати Зображення свого предмета, використовувати як аватар і друкувати для особистих потреб.",
        "Комерційне використання не дозволено.",
      ],
      commercial: [
        "3. Права власника",
        "Власник може використовувати Зображення свого предмета для особистих потреб і комерційно: створювати похідні роботи, друкувати на товарах, використовувати в проєктах.",
        "Власник не може подавати себе як Автора й не може використовувати назву колекції та логотипи так, ніби його проєкт схвалено Автором.",
      ],
      commercial_cap: [
        "3. Права власника",
        "Власник може використовувати Зображення свого предмета для особистих потреб і комерційно, поки валовий дохід від такого використання одного предмета не перевищує {cap} доларів США на рік.",
        "Понад цю суму потрібна письмова згода Автора.",
        "Власник не може подавати себе як Автора й не може використовувати назву колекції та логотипи так, ніби його проєкт схвалено Автором.",
      ],
      cc0: [
        "3. Відмова від прав",
        "Автор відмовляється від своїх майнових авторських прав на Зображення в найбільшій мірі, що дозволяє закон (за зразком CC0 1.0). Будь-хто, не лише Власник, може використовувати Зображення для будь-яких цілей.",
        "Токен лишається доказом володіння саме цим предметом. Відмова не поширюється на права третіх осіб, тож перевірте її з юристом.",
      ],
    },
    limits: [
      "4. Обмеження",
      "Не можна використовувати Зображення для незаконних цілей, ворожнечі, шахрайства чи обману щодо походження предмета.",
      "Додаткові обмеження: {limits}.",
    ],
    transfer: [
      "5. Передача",
      "Права за цією ліцензією переходять разом із токеном до нового Власника. Попередній Власник втрачає право на нове використання. Законно створені до передачі роботи можуть лишатися.",
    ],
    ai: [
      "6. Походження зображень і позначка ШІ",
      "Зображення створено з використанням моделі ШІ в Series Lab. Людський внесок (вибір, відбір, правки) описано в файлі authorship.json набору. Автор не гарантує, що частини, створені моделлю, захищені авторським правом у вашій країні.",
      "Позначка синтетичного виводу (де її вимагає закон): {aimark}.",
    ],
    disclaimer: [
      "7. Без гарантій",
      "Предмет і Зображення надаються «як є». Автор не обіцяє ціну, ліквідність чи прибуток і не дає інвестиційних порад.",
    ],
    law: [
      "8. Право й спори",
      "Застосовне право: {law}.",
    ],
    end: "Дата: __________    Автор: __________",
  },
  en: {
    title: (name) => `Holder licence for the images of “${name}”`,
    draft: [
      "DRAFT for a lawyer. This is not legal advice and not a finished contract.",
      "Fill in the blanks (__________) and have a lawyer in your jurisdiction read it before you publish it.",
      "Series Lab does not sign this text, is not a party to the licence, and does not decide whether it is valid.",
    ],
    defs: [
      "1. Terms",
      "“Creator” means the person who released the collection: {creator}.",
      "“Item” means a single token of the collection, and “Image” means the picture (and its metadata) that the token points to.",
      "“Holder” means the wallet that holds the token of the Item at the time.",
    ],
    owns: [
      "2. What the Holder gets",
      "The Holder owns the token. The token alone does not transfer copyright in the Image: the Holder receives only the rights named below.",
      "The licence is tied to the token and lasts while the Holder holds it.",
    ],
    rights: {
      personal: [
        "3. Holder's rights",
        "The Holder may display the Image of their Item, use it as an avatar, and print it for personal use.",
        "Commercial use is not permitted.",
      ],
      commercial: [
        "3. Holder's rights",
        "The Holder may use the Image of their Item for personal purposes and commercially: make derivative works, print it on goods, and use it in projects.",
        "The Holder may not present themselves as the Creator and may not use the collection name or logos as if their project were endorsed by the Creator.",
      ],
      commercial_cap: [
        "3. Holder's rights",
        "The Holder may use the Image of their Item for personal purposes and commercially while the gross revenue from that use of one Item does not exceed USD {cap} per year.",
        "Above that amount the Creator's written consent is required.",
        "The Holder may not present themselves as the Creator and may not use the collection name or logos as if their project were endorsed by the Creator.",
      ],
      cc0: [
        "3. Waiver of rights",
        "The Creator waives their economic copyright in the Image to the fullest extent the law allows (modelled on CC0 1.0). Anyone, not only the Holder, may use the Image for any purpose.",
        "The token remains proof of owning this particular Item. The waiver does not cover third-party rights, so check it with a lawyer.",
      ],
    },
    limits: [
      "4. Limits",
      "The Image may not be used for unlawful purposes, hate, fraud, or to mislead anyone about where the Item comes from.",
      "Further limits: {limits}.",
    ],
    transfer: [
      "5. Transfer",
      "Rights under this licence pass with the token to the new Holder. The earlier Holder loses the right to new use. Works lawfully made before the transfer may stay.",
    ],
    ai: [
      "6. Origin of the images and the AI mark",
      "The Images were made with an AI model in Series Lab. The human contribution (choices, selection, edits) is described in the set's authorship.json file. The Creator does not guarantee that the parts made by the model are protected by copyright in your country.",
      "Synthetic-output mark (where the law requires one): {aimark}.",
    ],
    disclaimer: [
      "7. No warranties",
      "The Item and the Image are provided “as is”. The Creator does not promise price, liquidity or profit and gives no investment advice.",
    ],
    law: [
      "8. Law and disputes",
      "Governing law: {law}.",
    ],
    end: "Date: __________    Creator: __________",
  },
};

function fill(line, vars) {
  return line.replace(/\{(\w+)\}/g, (_, k) => vars[k] || BLANK);
}

/**
 * @param {{ model?: string, locale?: string, name?: string, creator?: string, cap?: number|string }} args
 * @returns {string|null} null for the "statement" model (the caller keeps its own short text)
 */
export function buildHolderLicence({ model = "personal", locale = "uk", name = "", creator = "", cap = "" } = {}) {
  if (!HOLDER_MODELS.includes(model) || model === "statement") return null;
  const loc = String(locale || "").toLowerCase().startsWith("uk") ? "uk" : "en";
  const L = T[loc];
  const vars = {
    creator: String(creator || "").trim(),
    cap: String(cap || "").trim(),
    limits: "",
    aimark: "",
    law: "",
  };
  const blocks = [
    [L.title(String(name || "").trim() || BLANK), "=".repeat(24)],
    L.draft,
    L.defs,
    L.owns,
    L.rights[model],
    ...(model === "cc0" ? [] : [L.limits, L.transfer]),
    L.ai,
    L.disclaimer,
    L.law,
    [L.end],
  ];
  let n = 0;
  return blocks
    .map((b) => b.map((l, i) => fill(i === 0 && /^\d+\. /.test(l) ? l.replace(/^\d+\./, `${++n}.`) : l, vars)).join("\n"))
    .join("\n\n");
}
