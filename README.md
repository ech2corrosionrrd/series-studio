# Series Lab

**Series Lab** від [W3IR](https://w3ir.io) — локальна майстерня для генеративних NFT-серій і LoRA-датасетів: **Lab → Studio → Release**.

- **Версія**: `1.4.0` — безпека API, страховка оплачених рендерів, нова довідка й дизайн ([CHANGELOG](CHANGELOG.md))
- **Папка на диску**: `series-studio` · npm-пакет `series-lab` · ліцензія MIT
- **Працює лише на вашому ПК** (`127.0.0.1`). Ключі API не потрапляють у браузер; приватні ключі гаманців і сид-фрази майстерня не запитує й не зберігає.

> **Новачок?** Почніть з [посібника для початківців](docs/GUIDE.md) або вкладки **❓ Довідка** в самій майстерні: там покроковий путівник, швидкий старт за $0, словник і FAQ.

---

## Що вміє

**пресет + seed** → унікальні детерміновані рецепти (DNA + промпти) → **базова картинка серії** (+ Vision Assist) → рендер у кілька потоків з живим прогресом → **відбір** (keep/redo, AI Triage, версії) → **експорт** (ERC-721 / Metaplex / Ordinals ZIP, CSV-маніфест, IPFS, Provenance SHA-256, HTML Showcase, LoRA-датасет, конфіги Sugar / Thirdweb).

**Страховка для грошей і файлів** (працює автоматично):

| Механізм | Що робить |
|---|---|
| Версії рендерів | Перегенерація не затирає оплачену картинку — попередня йде в `out/<набір>/versions/<N>/`, у Відборі її можна повернути. |
| Кошик | Видалення й заміна файлів переносять їх у `out/trash/`; відновлення — вкладка «Ресурси». |
| Денна межа витрат | `SERIES_SPEND_CAP_USD` блокує запуск понад межу ще до виклику платного API. |
| Журнал витрат | Кожен платний виклик → `out/render-log.jsonl`. |
| Автостоп batch | Після 5 помилок рушія поспіль решта черги не запускається. |
| Захист API | Сервер відхиляє запити з інших сайтів (CSRF) і чужі `Host` (DNS rebinding). |

---

## Швидкий запуск

Вимоги: **Node ≥ 20** (рекомендовано 22+).

```bash
npm install
npm test        # 155 тестів
npm start       # відкриває http://127.0.0.1:5344/studio/
# Windows: start-lab.bat / stop-lab.bat · без відкриття браузера: npm run lab:serve
```

**Спробувати без ключів і без оплати:** на вкладці «5 · Генерація» оберіть двигун **mock** — він малює демо-заглушки, і ви пройдете весь цикл 1 → 7 за $0. Справжні картинки безкоштовно — через локальні **ComfyUI** або **Automatic1111**.

### Ключі та налаштування

Скопіюйте `.env.example` у `.env` у корені проєкту (або вкажіть шлях у `SERIES_KEYS_FILE`) і перезапустіть майстерню.

| Змінна | Призначення |
|---|---|
| `FAL_KEY`, `REPLICATE_API_TOKEN`, `OPENAI_API_KEY`, `STABILITY_API_KEY`, `RUNWARE_API_KEY`, `POLLINATIONS_API_KEY` | Хмарні рушії генерації |
| `COMFYUI_URL`, `A1111_URL` | Локальні рушії ($0) |
| `ANTHROPIC_API_KEY` | Vision Assist / AI Triage через Claude (опційно) |
| `PINATA_JWT` | Завантаження в IPFS |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Сповіщення про завершення batch |
| `SERIES_SPEND_CAP_USD` | Денна межа витрат, $ (порожньо = без межі) |
| `SERIES_MAX_CONSECUTIVE_FAILURES` | Автостоп batch після N помилок поспіль (5) |
| `SERIES_TRASH_DAYS` | Скільки днів зберігати кошик (30; 0 = не чистити) |
| `PORT`, `HOST`, `SERIES_ALLOWED_HOSTS` | Адреса сервера й додаткові дозволені імена хостів |

---

## Етапи майстерні

| # | Вкладка | Що робите |
|---|---|---|
| 1 | **Огляд** | Назва, ID, кількість NFT, seed, двигун → «Зберегти пресет». |
| 2 | **Основа** | Головна базова картинка: завантажити або згенерувати; 🤖 Vision Assist. |
| 3 | **Конструктор** | Пак рис, опції (value / weight / prompt), keep / suffix, Style lock, Matrix Preview. |
| 4 | **Рецепти** | «Зібрати архів», таблиця DNA, редактор рецепта, звіт рідкості, матриця синергії. |
| 5 | **Генерація** | «Порахувати» (ціна + витрачене сьогодні) → пілот → уся серія. Версії, межа витрат, автостоп. |
| 6 | **Відбір** | ✓ / ↻, порівняння наборів, 🤖 Triage, версії `v·N` → «Зробити поточною». |
| 7 | **Експорт** | CSV / маніфест, mint-ready ZIP, IPFS, Provenance, Showcase, LoRA, Release Hub, чекліст. |
| — | **Ресурси** | Ключі, 💰 витрати сьогодні, 🗑️ кошик, ⚡ перевірка рушіїв. |
| — | **Довідка** | Путівник простими словами, швидкий старт, страховка, словник, FAQ, пошук. |

На кожній вкладці є фіолетова підказка «Що робити, крок за кроком» (вимикається перемикачем «Підказки»). Інтерфейс — українською та англійською.

---

## CLI (`bin/series.mjs`)

```bash
node bin/series.mjs doctor                                   # перевірка системи
node bin/series.mjs engines                                  # рушії та ціни
node bin/series.mjs validate presets/demo-series.json        # перевірка пресету
node bin/series.mjs build presets/demo-series.json -o out/demo-archive.json
node bin/series.mjs diff-seed presets/demo-series.json       # стабільність DNA
node bin/series.mjs render presets/demo-series.json --engine mock --limit 5   # з версіями, журналом і межею витрат
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
| `libraries/traits/` | Паки рис (`pfp-core`, `brand-mascot`, `fine-art`, `abstract-series`) |
| `templates/` | Шаблони пресетів і `comfyui-workflow.json` |
| `input/` | Базові картинки (`primary.*`, `candidate-*`, `base-<line>.*`) |
| `out/` | Архіви, набори картинок (`<двигун>-s<сила>/`, `versions/`), `trash/`, `render-log.jsonl`, бандли |
| `workspace/` | Автозбереження стану інтерфейсу |
| `src/` | Ядро: RNG, рецепти, валідація, рушії, експорт, `versions` / `trash` / `spend` / `fs-safe` |
| `server/` | Локальний HTTP-сервер (`guard.mjs` — захист API) та інтерфейс `server/ui/` (uk / en) |
| `bin/series.mjs` | CLI |

---

## Документація

- [docs/GUIDE.md](docs/GUIDE.md) — посібник для початківців
- [docs/README.md](docs/README.md) — індекс усієї документації
- [docs/STAGES.md](docs/STAGES.md) · [docs/STUDIO-UI.md](docs/STUDIO-UI.md) · [docs/API.md](docs/API.md) · [docs/EXPORT.md](docs/EXPORT.md)
- [docs/ROADMAP.md](docs/ROADMAP.md) · [CHANGELOG.md](CHANGELOG.md)

Термінологія: **базова картинка(и) серії**; роль `primary` = головна базова.

## Ліцензія

MIT © 2026 W3IR
