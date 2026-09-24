# Документація Series Lab

Стан: **v1.4.0** ([CHANGELOG](../CHANGELOG.md)) — 22 хвилі функцій, захист API, страховка оплачених рендерів (версії, кошик, межа витрат), нова довідка й дизайн інтерфейсу.
Запуск: `start-lab.bat` або `npm start` → http://127.0.0.1:5344/studio/

---

## З чого почати

| Хто ви | Читайте |
|---|---|
| **Новачок** | [GUIDE.md](./GUIDE.md) — посібник простими словами (те саме, що вкладка «❓ Довідка») |
| **Користувач майстерні** | [STAGES.md](./STAGES.md) → [STUDIO-UI.md](./STUDIO-UI.md) → [EXPORT.md](./EXPORT.md) |
| **Розробник** | [API.md](./API.md) · [PRESET.md](./PRESET.md) · [TRAITS.md](./TRAITS.md) · [../CHANGELOG.md](../CHANGELOG.md) |

## Усі документи

| Документ | Про що |
|---|---|
| [../README.md](../README.md) | Огляд продукту, запуск, змінні `.env`, CLI, структура |
| [GUIDE.md](./GUIDE.md) | Посібник для початківців: путівник 1 → 7, швидкий старт за $0, страховка, словник, FAQ |
| [STAGES.md](./STAGES.md) | Етапи майстерні: що робиться на кожному, оптимальний і широкий шлях |
| [STUDIO-UI.md](./STUDIO-UI.md) | Інтерфейс по вкладках, підказки, довідка, локалізація, безпека |
| [API.md](./API.md) | Усі HTTP-маршрути `/api/*` (зокрема версії, кошик, витрати) |
| [EXPORT.md](./EXPORT.md) | ZIP до мінту, CSV-маніфест, IPFS, Showcase, конфіги деплою |
| [BASE.md](./BASE.md) | Базові картинки, ролі в `input/`, Vision Assist |
| [TRAITS.md](./TRAITS.md) | Паки рис, знімок у пресеті, редактор опцій, конфлікти |
| [PRESET.md](./PRESET.md) | Формат пресету `series-preset/v0`, `styleLock`, матриця двигунів |
| [VISION.md](./VISION.md) | Vision Assist: авторозбір базової картинки |
| [MIGRATION.md](./MIGRATION.md) | **План переходу Промт → Series Lab**: що живе на Промт, розрив, фази, користувачі й гроші, рішення власника |
| [DEPLOY-PLATFORM.md](./DEPLOY-PLATFORM.md) | Запуск платформи на проді замість Промт: змінні, паралельний запуск, перемикання, відкат, архів |
| [DEPLOY.md](./DEPLOY.md) | Публічний сайт studio.w3ir.io на Cloudflare Pages: структура, оновлення, перевірка |
| [ROADMAP.md](./ROADMAP.md) | План і статус хвиль розвитку |
| [SYNTHESIS.md](./SYNTHESIS.md) · [FROM-PROMT.md](./FROM-PROMT.md) | Що взято з проєктів-донорів (Промт, gremlin-nft) |
| [BRAND.md](./BRAND.md) · [BOUNDARIES.md](./BOUNDARIES.md) | Бренд і межі продукту |
| [CONTEXT.md](./CONTEXT.md) · [IDEAS.md](./IDEAS.md) · [PLAN.md](./PLAN.md) · [LAB.md](./LAB.md) | Історичні нотатки планування |

---

## Принципи

1. **Lab → Studio → Release.** Lab рахує рецепти детерміновано (seed) і безкоштовно; Studio малює й відбирає; Release готує файли. Мінт і продаж — поза майстернею.
2. **Гроші — лише за явною дією.** Платний виклик можливий тільки після безкоштовної оцінки; денна межа `SERIES_SPEND_CAP_USD`; журнал `out/render-log.jsonl`; автостоп при збоях рушія.
3. **Нічого оплаченого не губиться.** Перегенерація зберігає версії; видалення йде в кошик `out/trash/`.
4. **Лише локально.** Сервер на `127.0.0.1`, захист від CSRF / DNS rebinding, ключі не йдуть у браузер, сид-фрази не запитуються.
5. **Термінологія:** «базова картинка(и) серії»; `primary` = головна базова.

## Перевірка

```bash
npm test               # 155 тестів у 28 наборах
npm run validate:demo
npm run build:demo
npm run diff-seed:demo
```
