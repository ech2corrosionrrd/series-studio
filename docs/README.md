# Документація Series Lab

Стан: **v1.11.0** ([CHANGELOG](../CHANGELOG.md)) — проєкти (активи, кошик, перенесення наборів, воронка), сторінка `/legal` без стороннього коду; раніше (v1.10.0): позначка «створено ШІ» й підпис C2PA, CSP, власні бібліотеки замість CDN, гібридні шари, вкладка адмінки «Система»; раніше (v1.9.0, v1.8.0): хост lab.w3ir.io у публічному режимі (вхід гаманцем, оплата USDC), бекапи й моніторинг; раніше (v1.7.0): Arweave (Irys), шлях випуску upload → guards → verify (Core і v3), підказки й мережа за вибором; раніше (v1.6.1) запити #1–#9: перевірений архів, Core Candy Machine, маркет, порадник, огляд якості ([PRODUCT.md](./PRODUCT.md), [RECOMMENDATIONS.md](./RECOMMENDATIONS.md), [QUALITY-REVIEW.md](./QUALITY-REVIEW.md)). Ядро майстерні (хвилі 1–25) закрито раніше.

Запуск: `start-lab.bat` або `npm start` → http://127.0.0.1:5344/studio/ (у `public` — спочатку `/login`).

---

## З чого почати

| Хто ви | Читайте |
|---|---|
| **Новачок** | вкладка «❓ Довідка» або http://127.0.0.1:5344/studio/docs/ (посібник, етапи, вкладки, основа, риси, експорт, короткий пресет; англійською `/studio/docs/en/`). Друкована версія посібника — [GUIDE.md](./GUIDE.md) |
| **Користувач майстерні** | [STAGES.md](./STAGES.md) → [STUDIO-UI.md](./STUDIO-UI.md) → [EXPORT.md](./EXPORT.md) → [RELEASE.md](./RELEASE.md) |
| **Розробник** | [API.md](./API.md) · [PRESET.md](./PRESET.md) · [TRAITS.md](./TRAITS.md) · [../CHANGELOG.md](../CHANGELOG.md) |
| **Хостинг процесу** | [HOSTING.md](./HOSTING.md) — чекліст переносу майстерні (не лендінг) · [DEPLOY-PLATFORM.md](./DEPLOY-PLATFORM.md) · [STANDALONE.md](./STANDALONE.md) |
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
| [RELEASE.md](./RELEASE.md) | Шлях випуску: `release.json` → `series upload` → `series hidden` → deploy → `series guards` → `series verify` → `series mint` → `series reveal --keypair`; шари — `series compose` |
| [BASE.md](./BASE.md) | Базові картинки, Vision Assist |
| [C2PA.md](./C2PA.md) | Маркування ШІ (C2PA, ст. 50 AI Act): варіанти, план, рішення власника |
| [ENGINES.md](./ENGINES.md) | Вибір рушія, сили референсу й бази: що показали живі тести |
| [TRAITS.md](./TRAITS.md) | Паки рис, редактор опцій |
| [PRESET.md](./PRESET.md) | Формат пресету |
| [VISION.md](./VISION.md) | Vision Assist |
| [STANDALONE.md](./STANDALONE.md) | Series Lab як окремий самодостатній продукт |
| [DEPLOY-PLATFORM.md](./DEPLOY-PLATFORM.md) | VPS / staging / cutover |
| [DEPLOY.md](./DEPLOY.md) | Сайт studio.w3ir.io (Cloudflare Pages): статичний лендінг, посібник і сторінки для автора, без API майстерні |
| [HOSTING.md](./HOSTING.md) | Перенос процесу майстерні на хост: що задати, що лишається на ПК, що сайт Pages не чіпати |
| [LEGAL-DRAFT.md](./LEGAL-DRAFT.md) · [LEGAL-DRAFT.en.md](./LEGAL-DRAFT.en.md) | **Чернетка** Умов користування, Політики конфіденційності й Політики повернення (uk / en) для юриста; з переліком питань і технічних прогалин. Не опубліковано, не юридична порада |
| [INTERVIEWS.md](./INTERVIEWS.md) | Інтерв'ю з авторами колекцій: кого шукати, питання, як читати сигнал оплати |
| [ROADMAP.md](./ROADMAP.md) | Хвилі 1–25 ✅ · стабілізація ▶️ · рефакторинг/власний домен ⏸ |
| [BRAND.md](./BRAND.md) · [BOUNDARIES.md](./BOUNDARIES.md) | Бренд і межі |
| [DESIGN-AUDIT.md](./DESIGN-AUDIT.md) | Аудит дизайну інтерфейсу |
| [IDEAS.md](./IDEAS.md) · [PLAN.md](./PLAN.md) · [LAB.md](./LAB.md) | Історичні нотатки |

---

## Правила репозиторію

[../CLAUDE.md](../CLAUDE.md) — **документація оновлюється до коміту**, перевірки перед комітом, мова й підказки, ключі. Автоперевірка: `npm run docs:check`, хук `.githooks/pre-commit`.

---

## Принципи

1. **Lab → Studio → Release.** Lab рахує рецепти детерміновано (seed); Studio малює й відбирає; Release готує ZIP і посилає на лаунчпад. Мінт — зовні.
2. **Гроші — лише за явною дією.** Оцінка безкоштовна; денна межа; журнал; автостоп; DNA-блок перед пакетом.
3. **Нічого оплаченого не губиться.** Версії рендерів; кошик.
4. **Розміщення розробки — `127.0.0.1`.** Повний вхід/кредити/адмін і тут. Для зовнішніх тестувальників — тунель Cloudflare (`npm run lab:tunnel`). Той самий процес на хості — [HOSTING.md](./HOSTING.md); https://studio.w3ir.io лишається статичним сайтом.
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

Репозиторій: `series-studio` · перевірка: локальний `npm run ci` (`scripts/ci.mjs`, хук `pre-push`), GitHub CI вимкнено · `health.yml` (staging), `deploy-site.yml` (Pages лендінг).
