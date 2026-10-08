/**
 * Презентація до захисту диплома Series Lab (14 слайдів).
 * Запуск: node diploma/build_pptx.mjs
 */
import path from "path";
import { fileURLToPath } from "url";
import pptxgen from "pptxgenjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIG = path.join(HERE, "figures");
const OUT = path.join(HERE, "Dyplom_Series_Lab_Zahyst.pptx");

const THEME = {
  headFontFace: "Calibri",
  bodyFontFace: "Calibri",
  colors: {
    dk1: "1A1B1E",
    lt1: "FFFFFF",
    dk2: "343A40",
    accent1: "5C7CFA",
    accent2: "7950F2",
  },
};

async function main() {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE";
  pres.author = "Титаренко Володимир";
  pres.title = "Series Lab — захист диплома";
  pres.subject = "Розробка веб-сайту зі створення NFT-зображень для блокчейну";
  const C = THEME.colors;

  const titleSlide = (title, subtitle) => {
    const s = pres.addSlide();
    s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 13.3, h: 7.5, fill: { color: C.dk1 } });
    s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 0.18, h: 7.5, fill: { color: C.accent1 } });
    s.addText(title, {
      x: 0.7, y: 2.2, w: 11.8, h: 1.4,
      fontSize: 32, bold: true, color: C.lt1, fontFace: THEME.headFontFace, margin: 0, isTextBox: true,
    });
    if (subtitle) {
      s.addText(subtitle, {
        x: 0.7, y: 3.7, w: 11.8, h: 1.2,
        fontSize: 16, color: "CED4DA", fontFace: THEME.bodyFontFace, margin: 0, isTextBox: true,
      });
    }
    return s;
  };

  const contentSlide = (title) => {
    const s = pres.addSlide();
    s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 13.3, h: 7.5, fill: { color: C.lt1 } });
    s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 13.3, h: 0.9, fill: { color: C.dk1 } });
    s.addText(title, {
      x: 0.5, y: 0.22, w: 12.3, h: 0.5,
      fontSize: 22, bold: true, color: C.lt1, fontFace: THEME.headFontFace, margin: 0, isTextBox: true,
    });
    return s;
  };

  titleSlide(
    "Розробка веб-сайту зі створення\nNFT-зображень для блокчейну",
    "Титаренко Володимир · група 441 · спец. 124 «Системний аналіз»\nКерівник: ст. викл. Яресько Д. І. · ХАІ, каф. 404\nSeries Lab v1.8.0 · lab.w3ir.io"
  );

  {
    const s = contentSlide("Актуальність і проблема");
    s.addText([
      { text: "Шлях автора розбитий на окремі інструменти", options: { bullet: true, breakLine: true } },
      { text: "Помилка після завантаження в постійне сховище невиправна", options: { bullet: true, breakLine: true } },
      { text: "Сторонні сервіси часто просять приватний ключ", options: { bullet: true, breakLine: true } },
      { text: "Потрібна єдина система без ключів на сервері", options: { bullet: true } },
    ], { x: 0.5, y: 1.2, w: 6.2, h: 4.5, fontSize: 16, color: C.dk2, fontFace: THEME.bodyFontFace, paraSpaceAfter: 10, isTextBox: true });
    s.addImage({ path: path.join(FIG, "rys-1-2.png"), x: 7.0, y: 1.3, w: 5.7, h: 5.0 });
  }

  {
    const s = contentSlide("Мета і дерево цілей");
    s.addText("Мета: від базової картинки до перевіреного архіву й випуску в Solana без передачі ключів на сервер.", {
      x: 0.5, y: 1.15, w: 12.3, h: 0.7, fontSize: 15, color: C.dk2, fontFace: THEME.bodyFontFace, isTextBox: true, margin: 0,
    });
    s.addImage({ path: path.join(FIG, "rys-1-3.png"), x: 1.5, y: 2.0, w: 10.3, h: 4.8 });
  }

  {
    const s = contentSlide("Аналоги та ефект «до / після»");
    s.addTable([
      [
        { text: "Параметр", options: { bold: true, color: "FFFFFF", fill: { color: C.dk1 } } },
        { text: "До", options: { bold: true, color: "FFFFFF", fill: { color: C.dk1 } } },
        { text: "Після (Series Lab)", options: { bold: true, color: "FFFFFF", fill: { color: C.dk1 } } },
      ],
      ["Інструменти", "4–6 розрізнених", "1 майстерня + CLI"],
      ["Відтворюваність", "зазвичай немає", "зерно + diff-seed"],
      ["Перевірка архіву", "ручна", "preflight блокує помилки"],
      ["Ключі", "ризик веб-форм", "лише локальний CLI"],
      ["Витрати API", "після факту", "ціна → резерв → refund"],
    ], {
      x: 0.5, y: 1.3, w: 12.3, colW: [3.0, 4.5, 4.8],
      border: [{ pt: 0.5, color: "DEE2E6" }],
      fontFace: THEME.bodyFontFace, fontSize: 13, color: C.dk2,
      align: "left", valign: "middle",
    });
  }

  {
    const s = contentSlide("Вимоги → модуль → тест");
    s.addText([
      { text: "ФВ-2 / НВ-1 → rng/build → diff-seed", options: { bullet: true, breakLine: true } },
      { text: "ФВ-8 → preflight → тести + сценарій 2", options: { bullet: true, breakLine: true } },
      { text: "ФВ-10 / НВ-2 → secrets + CLI → сценарії 3, 5", options: { bullet: true, breakLine: true } },
      { text: "ФВ-11 / НВ-4 → solpay/billing → одноразове зарахування", options: { bullet: true, breakLine: true } },
      { text: "ФВ-14 / НВ-8 → locales + docs:check / audit:i18n", options: { bullet: true } },
    ], { x: 0.5, y: 1.3, w: 12.3, h: 5.0, fontSize: 18, color: C.dk2, fontFace: THEME.bodyFontFace, paraSpaceAfter: 12, isTextBox: true });
  }

  {
    const s = contentSlide("Архітектура та взаємодія з користувачем");
    s.addImage({ path: path.join(FIG, "rys-2-1.png"), x: 0.3, y: 1.2, w: 6.3, h: 5.5 });
    s.addImage({ path: path.join(FIG, "rys-2-3.png"), x: 6.8, y: 1.2, w: 6.1, h: 5.5 });
  }

  {
    const s = contentSlide("Майстерня: етапи роботи (скріни)");
    s.addImage({ path: path.join(FIG, "rys-3-3.png"), x: 0.25, y: 1.15, w: 4.2, h: 5.7 });
    s.addImage({ path: path.join(FIG, "rys-3-4.png"), x: 4.55, y: 1.15, w: 4.2, h: 5.7 });
    s.addImage({ path: path.join(FIG, "rys-3-5.png"), x: 8.85, y: 1.15, w: 4.2, h: 5.7 });
  }

  {
    const s = contentSlide("Ворота перевірки та набір деплою");
    s.addText([
      { text: "Помилки preflight блокують ZIP (HTTP 422)", options: { bullet: true, breakLine: true } },
      { text: "Попередження лише інформують", options: { bullet: true, breakLine: true } },
      { text: "Деплой готує кроки; ключ у браузер не вводиться", options: { bullet: true } },
    ], { x: 0.5, y: 1.2, w: 5.5, h: 3.5, fontSize: 16, color: C.dk2, fontFace: THEME.bodyFontFace, paraSpaceAfter: 10, isTextBox: true });
    s.addImage({ path: path.join(FIG, "rys-3-6.png"), x: 6.2, y: 1.2, w: 6.6, h: 5.5 });
  }

  {
    const s = contentSlide("Шлях випуску на Solana");
    s.addText("release-init → upload → hidden → guards → verify → mint → reveal", {
      x: 0.5, y: 1.2, w: 12.3, h: 0.5, fontSize: 16, bold: true, color: C.accent2, fontFace: THEME.bodyFontFace, isTextBox: true, margin: 0,
    });
    s.addImage({ path: path.join(FIG, "dod-b4.png"), x: 2.2, y: 1.9, w: 8.9, h: 4.8 });
  }

  {
    const s = contentSlide("Вхід гаманцем і оплата USDC");
    s.addImage({ path: path.join(FIG, "rys-3-2.png"), x: 0.3, y: 1.15, w: 6.3, h: 5.6 });
    s.addImage({ path: path.join(FIG, "rys-3-7.png"), x: 6.8, y: 1.3, w: 6.1, h: 5.2 });
  }

  {
    const s = contentSlide("Якість: 402 тести, CI, Docker");
    s.addImage({ path: path.join(FIG, "rys-4-1.png"), x: 0.3, y: 1.3, w: 6.3, h: 5.2 });
    s.addImage({ path: path.join(FIG, "rys-4-2.png"), x: 6.8, y: 1.3, w: 6.1, h: 5.2 });
  }

  {
    const s = contentSlide("Економіка");
    s.addImage({ path: path.join(FIG, "rys-5-1.png"), x: 0.2, y: 1.2, w: 6.4, h: 5.5 });
    s.addImage({ path: path.join(FIG, "rys-5-2.png"), x: 6.7, y: 1.4, w: 6.3, h: 5.0 });
  }

  {
    const s = contentSlide("Апробація");
    s.addText([
      { text: "Публічна бета: https://lab.w3ir.io", options: { bullet: true, breakLine: true } },
      { text: "Документація: https://studio.w3ir.io", options: { bullet: true, breakLine: true } },
      { text: "Протокол А1–А7 і сценарії 1–6 — пройдено 05.10.2026", options: { bullet: true, breakLine: true } },
      { text: "Акт про дослідну експлуатацію — файл 17", options: { bullet: true } },
    ], { x: 0.5, y: 1.4, w: 12.3, h: 4.5, fontSize: 18, color: C.dk2, fontFace: THEME.bodyFontFace, paraSpaceAfter: 12, isTextBox: true });
  }

  titleSlide(
    "Висновки",
    "Створено Series Lab v1.8.0: майстерня, 24 CLI, 94 API, 402 тести.\nКлючі не на сервері · USDC напряму · preflight · відтворюваність.\nДякую за увагу!"
  );

  await pres.writeFile({ fileName: OUT });
  console.log("OK:", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
