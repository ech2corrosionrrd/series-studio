# Series Lab

**Series Lab** від [W3IR](https://w3ir.io) — майстерня для генеративних NFT-серій і LoRA-датасетів: **Lab → Studio → Release**.

- **Версія**: `1.5.0` — ядро майстерні закрито (хвилі 1–25): шлях випуску, вхід гаманцем, адмін, підказки ([CHANGELOG](CHANGELOG.md) · [ROADMAP](docs/ROADMAP.md))
- **Папка на диску**: `series-studio` · npm-пакет `series-lab` · ліцензія MIT
- **Розміщення розробки**: `127.0.0.1`. Ключі API не потрапляють у браузер; приватні ключі гаманців і сид-фрази майстерня не запитує й не зберігає.

> **Новачок?** Почніть з [посібника](docs/GUIDE.md) або вкладки **❓ Довідка**. Вхід — лише гаманець (MetaMask / Coinbase / Phantom); сторінка `/login`.

Сервер розробки стоїть на `127.0.0.1` — це лише адреса процесу. Вхід, кредити, дані по гаманцю й адмін — повний продукт (`SERIES_MODE=public` за замовчуванням). `SERIES_MODE=local` — теки репозиторію без акаунтів, лише loopback. Хостинг / Ф4 — [docs/HOSTING.md](docs/HOSTING.md), лише за окремою командою власника.

---

## Що вміє

**пресет + seed** → унікальні детерміновані рецепти (DNA + промпти) → **базова картинка серії** (+ Vision Assist) → рендер у кілька потоків з живим прогресом → **відбір** (keep/redo, AI Triage, версії) → **експорт** (архів випуску → портал лаунчпада; ERC-721 / Metaplex / Ordinals ZIP, CSV, IPFS, Provenance, Showcase, LoRA, Sugar / Thirdweb).

**Страховка для грошей і файлів** (працює автоматично):

| Механізм | Що робить |
|---|---|
| Версії рендерів | Перегенерація не затирає оплачену картинку — попередня йде в `out/<набір>/versions/<N>/`, у Відборі її можна повернути. |
| Кошик | Видалення й заміна файлів переносять їх у `out/trash/`; відновлення — **Адмін → Ресурси**. |
| Денна межа витрат | `SERIES_SPEND_CAP_USD` блокує запуск понад межу ще до виклику платного API. |
| Журнал витрат | Кожен платний виклик → `out/render-log.jsonl`. |
| Автостоп batch | Після 5 помилок рушія поспіль решта черги не запускається. |
| DNA / оцінка | Пакетна генерація блокується при збіжній DNA; «Згенерувати» — лише після безкоштовної оцінки. |
| Захист API | Сервер відхиляє запити з інших сайтів (CSRF) і чужі `Host` (DNS rebinding). |

---

## Швидкий запуск

Вимоги: **Node ≥ 22.13**.

```bash
npm install
npm test
npm start       # http://127.0.0.1:5344/studio/  (або /login у public)
# Windows: start-lab.bat / stop-lab.bat · без браузера: npm run lab:serve
```

**Спробувати без ключів:** двигун **mock** на «5 · Генерація». `SERIES_MODE=local` — без входу, лише для тек репо.

### Ключі та налаштування

Скопіюйте `.env.example` у `.env` і перезапустіть.

| Змінна | Призначення |
|---|---|
| `SERIES_MODE` | `public` (типово) — вхід гаманцем; `local` — без акаунтів, лише loopback |
| `AUTH_SESSION_SECRET`, `ADMIN_WALLETS` | Сесія й адміни (оператор уже в коді) |
| `FAL_KEY`, `REPLICATE_API_TOKEN`, `OPENAI_API_KEY`, `STABILITY_API_KEY`, `RUNWARE_API_KEY`, `POLLINATIONS_API_KEY` | Хмарні рушії |
| `COMFYUI_URL`, `A1111_URL` | Локальні рушії ($0) |
| `ANTHROPIC_API_KEY` | Vision Assist / AI Triage через Claude (опційно) |
| `PINATA_JWT` | Завантаження в IPFS |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Сповіщення про завершення batch |
| `SERIES_SPEND_CAP_USD` | Денна межа витрат, $ |
| `SERIES_MAX_CONSECUTIVE_FAILURES` | Автостоп batch (5) |
| `SERIES_TRASH_DAYS` | Кошик (30; 0 = не чистити) |
| `PORT`, `HOST`, `SERIES_ALLOWED_HOSTS` | Адреса сервера / Host allowlist |

---

## Етапи майстерні

| # | Вкладка | Що робите |
|---|---|---|
| 1 | **Огляд** | Назва, ID, кількість, seed → «Почати серію» / «Спін-оф» / «Зберегти пресет». |
| 2 | **Основа** | Головна базова картинка; 🤖 Vision Assist. |
| 3 | **Конструктор** | Пак рис, опції, keep / suffix, Style lock, Matrix Preview. |
| 4 | **Рецепти** | «Зібрати тексти», хвилі, diff архівів, правка номера, рідкість. |
| 5 | **Генерація** | «12 пілотів — порахувати» → оцінка → генерація. |
| 6 | **Відбір** | ✓ / ↻, порівняння, Triage, схожі кадри, версії. |
| 7 | **Експорт** | Архів випуску → портал; інші ZIP / CSV / IPFS / Showcase / Hub. |
| — | **Адмін** | Ресурси (ключі, кошик), статистика, помилки — лише адмін-гаманець. |
| — | **Довідка** | Путівник, швидкий старт, словник, FAQ. |

На опціях — підказки при наведенні. Інтерфейс uk / en.

---

## CLI (`bin/series.mjs`)

```bash
node bin/series.mjs doctor
node bin/series.mjs engines
node bin/series.mjs validate presets/demo-series.json
node bin/series.mjs build presets/demo-series.json -o out/demo-archive.json
node bin/series.mjs diff-seed presets/demo-series.json
node bin/series.mjs render presets/demo-series.json --engine mock --limit 5
node bin/series.mjs triage out/mock-s0.45 --provider heuristic --apply
node bin/series.mjs provenance out/fal-s0.45 -o out/provenance.json
node bin/series.mjs dataset out/demo-archive.json --images out/fal-s0.45 --trigger my_hero -o out/dataset.zip
node bin/series.mjs upscale out/fal-s0.45
node bin/series.mjs pin out/fal-s0.45 --name my-series
node bin/series.mjs manifest out/demo-archive.json --profile opensea
node bin/series.mjs showcase out/demo-archive.json -o out/showcase.html
node bin/series.mjs release-config out/demo-archive.json --profile magiceden -o out/sugar.json
```

---

## Структура

| Шлях | Призначення |
|---|---|
| `presets/` | Пресети серій |
| `libraries/traits/` | Паки рис |
| `templates/` | Шаблони пресетів і ComfyUI |
| `input/` | Базові картинки |
| `out/` | Архіви, набори, `versions/`, `trash/`, `render-log.jsonl`, бандли |
| `data/` | Леджер / дані користувачів (gitignored; public mode) |
| `workspace/` | Автозбереження UI |
| `src/` | Ядро + `platform/` (вхід, кредити) |
| `server/` | HTTP, `/login`, Studio UI, guard |
| `deploy/series-lab/` | Staging / бекап (за командою хостингу) |
| `.github/workflows/` | `test.yml`, `health.yml`, `deploy-site.yml` |
| `bin/series.mjs` | CLI |

---

## Документація

- [docs/GUIDE.md](docs/GUIDE.md) — початківцям
- [docs/README.md](docs/README.md) — індекс
- [docs/ROADMAP.md](docs/ROADMAP.md) · [CHANGELOG.md](CHANGELOG.md)
- [docs/HOSTING.md](docs/HOSTING.md) — після ядра; деплой лише за командою
- [docs/DEPLOY.md](docs/DEPLOY.md) — https://studio.w3ir.io
- [docs/MIGRATION.md](docs/MIGRATION.md) · [docs/DEPLOY-PLATFORM.md](docs/DEPLOY-PLATFORM.md) — Ф3–Ф5

Термінологія: **базова картинка(и) серії**; `primary` = головна базова. Ончейн-мінт — зовні через лаунчпад.

## Ліцензія

MIT © 2026 W3IR
