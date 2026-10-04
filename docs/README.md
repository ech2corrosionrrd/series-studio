# Документація Series Lab

Стан: **v1.7.0** ([CHANGELOG](../CHANGELOG.md)) — Arweave (Irys), шлях випуску upload → guards → verify (Core і v3), підказки й мережа за вибором; раніше (v1.6.1) запити #1–#9: перевірений архів, Core Candy Machine, маркет, порадник, огляд якості ([PRODUCT.md](./PRODUCT.md), [RECOMMENDATIONS.md](./RECOMMENDATIONS.md), [QUALITY-REVIEW.md](./QUALITY-REVIEW.md)). Ядро майстерні (хвилі 1–25) закрито раніше.

Запуск: `start-lab.bat` або `npm start` → http://127.0.0.1:5344/studio/ (у `public` — спочатку `/login`).

---

## З чого почати

| Хто ви | Читайте |
|---|---|
| **Новачок** | [GUIDE.md](./GUIDE.md) — посібник простими словами (те саме, що вкладка «❓ Довідка») |
| **Користувач майстерні** | [STAGES.md](./STAGES.md) → [STUDIO-UI.md](./STUDIO-UI.md) → [EXPORT.md](./EXPORT.md) → [RELEASE.md](./RELEASE.md) |
| **Розробник** | [API.md](./API.md) · [PRESET.md](./PRESET.md) · [TRAITS.md](./TRAITS.md) · [../CHANGELOG.md](../CHANGELOG.md) |
| **Після ядра / хостинг** | [HOSTING.md](./HOSTING.md) — лише за командою власника · [DEPLOY-PLATFORM.md](./DEPLOY-PLATFORM.md) · [STANDALONE.md](./STANDALONE.md) |
| **Оператор / економіка** | [ECONOMY.md](./ECONOMY.md) — пакети, COGS, накладні, RESOURCE_FX, Admin → Економіка |

## Усі документи

| Документ | Про що |
|---|---|
| [PRODUCT.md](./PRODUCT.md) | Бачення: місія, аудиторія, етапи, економіка етапу, поза продуктом, аудит прогалин |
| [RECOMMENDATIONS.md](./RECOMMENDATIONS.md) | План за дослідженням колекцій. Поле «Зараз у коді» — поточна поведінка; статус кожного R — у картці |
| [QUALITY-REVIEW.md](./QUALITY-REVIEW.md) | Огляд якості зібраного результату #1–#9 |
| [../README.md](../README.md) | Огляд продукту, запуск, змінні `.env`, CLI, структура |
| [GUIDE.md](./GUIDE.md) | Посібник для початківців |
| [ECONOMY.md](./ECONOMY.md) | Кредити, юніт-маржа, хостинг/SaaS, crypto→USD, Admin → Економіка |
| [STAGES.md](./STAGES.md) | Етапи майстерні |
| [STUDIO-UI.md](./STUDIO-UI.md) | Інтерфейс, підказки, довідка, локалізація, безпека |
| [API.md](./API.md) | HTTP-маршрути `/api/*` |
| [EXPORT.md](./EXPORT.md) | ZIP, маніфест, Arweave, Showcase, конфіги; поля Експорту залежать від профілю |
| [RELEASE.md](./RELEASE.md) | Шлях випуску: `release.json` → `series upload` → deploy → `series guards` → `series verify` |
| [BASE.md](./BASE.md) | Базові картинки, Vision Assist |
| [TRAITS.md](./TRAITS.md) | Паки рис, редактор опцій |
| [PRESET.md](./PRESET.md) | Формат пресету |
| [VISION.md](./VISION.md) | Vision Assist |
| [STANDALONE.md](./STANDALONE.md) | Series Lab як окремий самодостатній продукт |
| [DEPLOY-PLATFORM.md](./DEPLOY-PLATFORM.md) | VPS / staging / cutover |
| [DEPLOY.md](./DEPLOY.md) | Сайт studio.w3ir.io (Cloudflare Pages): лендінг, посібник і сторінки для автора |
| [HOSTING.md](./HOSTING.md) | **Після ядра:** що є і що робити за командою (не автодеплой) |
| [ROADMAP.md](./ROADMAP.md) | Хвилі 1–25 ✅ · стабілізація ▶️ · рефакторинг/власний домен ⏸ |
| [SYNTHESIS.md](./SYNTHESIS.md) · [FROM-PROMT.md](./FROM-PROMT.md) | Донори |
| [BRAND.md](./BRAND.md) · [BOUNDARIES.md](./BOUNDARIES.md) | Бренд і межі |
| [DESIGN-AUDIT.md](./DESIGN-AUDIT.md) | Аудит дизайну інтерфейсу |
| [CONTEXT.md](./CONTEXT.md) · [IDEAS.md](./IDEAS.md) · [PLAN.md](./PLAN.md) · [LAB.md](./LAB.md) | Історичні нотатки |

---

## Правила репозиторію

[../CLAUDE.md](../CLAUDE.md) — **документація оновлюється до коміту**, перевірки перед комітом, мова й підказки, ключі. Автоперевірка: `npm run docs:check`, хук `.githooks/pre-commit`.

---

## Принципи

1. **Lab → Studio → Release.** Lab рахує рецепти детерміновано (seed); Studio малює й відбирає; Release готує ZIP і посилає на лаунчпад. Мінт — зовні.
2. **Гроші — лише за явною дією.** Оцінка безкоштовна; денна межа; журнал; автостоп; DNA-блок перед пакетом.
3. **Нічого оплаченого не губиться.** Версії рендерів; кошик.
4. **Розміщення розробки — `127.0.0.1`.** Повний вхід/кредити/адмін і тут. Для зовнішніх тестувальників — тунель Cloudflare (`npm run lab:tunnel`); хостинг — [HOSTING.md](./HOSTING.md) за командою.
5. **Термінологія:** «базова картинка(и) серії»; `primary` = головна базова.
6. **Вхід** — лише гаманець. Email як логін не плануємо.

## Перевірка

```bash
npm test
npm run validate:demo
npm run build:demo
npm run diff-seed:demo
```

## GitHub

Репозиторій: `series-studio` · CI: `test.yml` (push/PR), `health.yml` (staging), `deploy-site.yml` (Pages лендінг).
