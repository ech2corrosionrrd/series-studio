# Series Lab — Журнал змін (Changelog)

Усі суттєві зміни в проєкті **Series Lab** (`series-lab`) документуються в цьому файлі.

Формат базується на [Keep a Changelog](https://keepachangelog.com/uk/1.0.0/),
і проєкт дотримується семантичного версіонування [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Безпека та виправлення
- `npm test`: `node --test` (автопошук `*.test.mjs`); `node --test test` падав на Node 22+ з `MODULE_NOT_FOUND`.
- API захищено від CSRF і DNS rebinding (`server/guard.mjs`): перевірка `Host`, same-origin `Origin`, POST лише з `Content-Type: application/json`; інакше `403`.
- Нова змінна `SERIES_ALLOWED_HOSTS` — додаткові імена хостів (через кому) для доступу до Studio.
- `input/` прибрано з `files` у `package.json` — користувацькі зображення не потрапляють у npm-пакет.

## [1.3.1] — 2026-09-23

### Виправлення та безпека
- `npm test` на Windows: `node --test test` (без shell-glob `test/*.test.mjs`).
- Додано MIT `LICENSE` (Copyright (c) 2026 W3IR).
- Ключі: прибрано хардкод `C:\\Промт\\.env`; порядок — `SERIES_KEYS_FILE` → локальний `.env` → опційний `SERIES_DEFAULT_KEYS_FILE`.
- UI/API більше не віддають повний шлях до файлу ключів (лише `keysConfigured` / `keysFileName` basename).
- Help/i18n: формулювання про ключі вказують на локальний `.env` / `SERIES_KEYS_FILE`.
- Тести `parseEnv` / `loadKeys` (коментар з українським апострофом не ковтає наступний рядок).

## [1.3.0] — 2026-09-23

### 🚀 Хвиля 22: Direct Fast Engine Connectors
- **Швидкісні хмарні конектори (`src/connectors.mjs`, `src/engines.mjs`)**:
  - **Fal.ai**: інтеграція надшвидких моделей Flux Schnell (txt2img за ~$0.003) та Flux Dev (img2img/edit за ~$0.025) через `FAL_KEY` / `FAL_API_KEY`.
  - **Replicate Schnell**: економічна генерація на моделі `black-forest-labs/flux-schnell` ($0.005/img).
  - **Runware AI**: прямий високошвидкісний клієнт генерації через `RUNWARE_API_KEY`.
- **Локальні рушії з нульовими витратами ($0.00)**:
  - **ComfyUI**: прямий конектор до локального сервера (`http://127.0.0.1:8188`, `COMFYUI_URL`) з підтримкою txt2img та img2img (автоматичне завантаження вхідного референсу через `/upload/image`, побудова графа KSampler, черга `/prompt`, моніторинг `/history`, скачування результату з `/view`).
  - **Automatic1111 / SD-WebUI**: прямий конектор до локального WebUI (`http://127.0.0.1:7860`, `A1111_URL`) через ендпоінти `/sdapi/v1/txt2img` та `/sdapi/v1/img2img`.
- **Діагностика підключень та CLI**:
  - Нова CLI-команда `series engines` для виведення інтерактивної таблиці доступних рушіїв, статусів авторизації та собівартості.
  - Ендпоінти `GET /api/engines/status` та `POST /api/engines/test` для перевірки пінгу та працездатності генераторів.
  - Картка тестування підключень та вимірювання швидкості у вкладці «Ресурси» Студії.
  - Оновлено випадаючі списки вибору рушіїв в Огляді, Основі, Конструкторі та Генерації.

### 🛡️ Стабільність, діагностика та офлайн-робота
- **Автономний Mock-рушій (`src/mock-image.mjs`, `mock`)**:
  - Чистий Node.js PNG-генератор без зовнішніх бібліотек, що дозволяє тестувати повний конвеєр (генерація, відбір, provenance, ZIP) повністю офлайн без API-ключів та без GPU ($0.00).
- **Системний лікар `series doctor` (`src/doctor.mjs`)**:
  - Автоматична діагностика версії Node (>=20), цілісності пресетів, валідності паків рис, базових картинок, модуля Sharp та статусу рушіїв.
  - Додано API `GET /api/doctor` для системного аудиту Студії.
- **Окремий пакетний апскейлер `series upscale`**:
  - Можливість апскейлити готову папку зображень у 2× без необхідності формувати фінальний ZIP бандл.
- **Шаблон ComfyUI Workflow**:
  - Додано готовий файл `templates/comfyui-workflow.json` та ендпоінт `GET /api/comfyui/workflow` для імпорту в ComfyUI за 1 клік (drag-and-drop).

---

## [1.2.0] — 2026-09-23

### 🔔 Хвиля 20: Batch Generation Notifications & Webhooks
- **Диспетчер сповіщень (`src/notifications.mjs`)**:
  - `formatBatchSummary`: детальне форматування звіту про завершення рендеру (кількість успішних/відхилених, час, статистика AI Critic, Provenance hash).
  - `sendTelegramNotification`: пряма відправка сповіщень у Telegram-чат/канал через Telegram Bot API.
  - `dispatchBatchNotification`: автоматична відправка за наявності `TELEGRAM_BOT_TOKEN` та `TELEGRAM_CHAT_ID`.
- **Інтеграція в Batch Render**:
  - Автоматична відправка сповіщення при завершенні пакетного рендеру на сервері.
  - CLI: прапорець `--notify` для команди `series render` та команда `series notify [msg]`.
- **Web Audio & Browser Alerts**:
  - Відтворення приємного звукового сигналу (Web Audio API двотоновий chime) та системного Web Notification у браузері при завершенні черги рендерингу.
  - Додано змінні `PINATA_JWT`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` до вкладки Ресурси.

### ⚡ Хвиля 21: UI Matrix Preview & Trait Heatmap
- **Живий попередній перегляд мультидвижкової матриці (Live Matrix Preview)**:
  - Вкладка Конструктор містить панель швидкого перемикання між рушіями (**Flux.1**, **SDXL**, **Midjourney v6**, **Kontext**, **OpenAI**).
  - Ендпоінт `POST /api/matrix/preview` повертає миттєве форматування промпту під специфіку обраного генератора.
- **Матриця взаємозв'язку та синергії рис (Trait Synergy Matrix)**:
  - Ендпоінт `GET /api/traits/matrix?file=...` розраховує частотність перетину пар характеристик.
  - Інтерактивна картка на вкладці Рецепти показує найбільш часті поєднання рис у колекції для швидкого виявлення перекосів або аномалій.

---

## [1.1.0] — 2026-09-23

### 🔐 Хвиля 18: NFT Provenance Hash & Verifiable Metadata
- **Детерміноване хешування (`src/provenance.mjs`)**:
  - `calculateImageSha256`: прямий розрахунок SHA-256 для файлів або буферів.
  - `calculateCollectionProvenance`: сортування за номером видання, послідовна конкатенація SHA-256 та обчислення єдиного `provenanceHash` колекції.
  - `verifyProvenance`: автоматична верифікація цілісності директорії або мапи буферів.
- **Інтеграція в експорт бандлів (`src/export-bundle.mjs`)**:
  - Автоматичне пакування `provenance.json` у ZIP-архів.
  - Запис `provenanceHash` у `collection.json`, `thirdweb.json` та повернення через `/api/export/bundle`.
- **CLI & UI**:
  - CLI: `series provenance <dir> [--out provenance.json] [--verify]`.
  - API: `GET /api/export/provenance?set=...`.
  - UI: кнопка «🔐 Provenance Hash» та віджет показу хешу.

### 📦 Хвиля 19: LoRA & AI Training Dataset Exporter («Серія як датасет»)
- **Генератор підписів (`src/dataset.mjs`)**:
  - `buildDatasetCaptions`: підтримка тригерних слів (`triggerWord`), формату Danbooru-tags (SDXL/Kohya) та зв'язної прози (Flux.1).
  - `exportDatasetZip`: автоматичне формування пар `[edition].png` + `[edition].txt`, створення `dataset-info.json` з порадами з навчання.
- **CLI & UI**:
  - CLI: `series dataset <archive.json> --images <dir> --trigger "my_token" [-o dataset.zip]`.
  - API: `POST /api/export/dataset`.
  - UI: кнопка «📦 LoRA Training Dataset» з інтерактивним запитом тригерного слова.

---

## [1.0.0] — 2026-09-23

### 🚀 Реліз виробничої версії (Усі 17 хвиль Roadmap завершено)

#### Хвиля 17: Мультидвижкова матриця промптів та теги LoRA / моделей
- **Двигун трансформації матриці (`src/matrix.mjs`)**:
  - Адаптація стилістики промптів під специфіку кожного рушія: **Flux** (природний описовий синтаксис + тригерні токени), **SDXL** (форматування `<lora:name:weight>` + ключові слова якості), **Midjourney** (параметричні прапорці `--v 6.1 --stylize --ar`), **Kontext** (фіксація референсу) та **OpenAI** (фільтрація під чисту прозу).
  - `buildEnginePromptMatrix(recipe, preset, engineTargets)`: одночасна генерація промптів для кросплатформенного рендерингу.
  - `exportEngineMatrixCsv(recipes, preset, engineTargets)`: пакетний експорт матриці промптів у CSV.
- **Інтеграція в CLI та пресети**:
  - Підтримка опційних конфігурацій `engineMatrix` у пресетах.

#### Хвиля 16: Showcase колекції та Rarity Scorecard
- **Детермінована математика рідкості (`src/scorecard.mjs`)**:
  - Частота трейтів, бали рідкості ($1/F$), сумарний бал кожного екземпляра та рейтинг колекції (#1 до #N).
  - Розподіл за процентильними тієрами: **Mythic** (топ 2%), **Legendary** (топ 10%), **Epic** (топ 25%), **Rare** (топ 50%) та **Common** (нижні 50%).
- **Автономний візуальний HTML Showcase**:
  - `generateShowcaseHtml(archive, preset, opts)`: автономний інтерактивний HTML-застосунок без зовнішніх залежностей із темною темою glassmorphism, живим пошуком, фільтрами тієрів, матрицею DNA та картками рідкості.
  - Studio UI: завантаження та відкриття в один клік через `/api/export/showcase.html`.
  - Headless CLI: `series showcase <archive.json> [-o showcase.html]`.

#### Хвиля 15: Конвеєр динамічних медіа (Відео / Анімації / 3D-асети)
- **Виявлення мультиформатних ресурсів (`src/export-bundle.mjs`)**:
  - Автоматичне виявлення супутніх файлів відео (`.mp4`, `.webm`, `.mov`), анімацій (`.gif`), 3D-моделей (`.glb`, `.gltf`) та інтерактивного HTML (`.html`) поруч зі статичними обкладинками.
  - Автоматичне пакування до папки `images/` у ZIP-бандлі.
- **Узгодження метаданих для лаунчпадів (`src/launchpads.mjs`)**:
  - Заповнення поля `animation_url` для стандартів ERC-721, Metaplex та Bitcoin Ordinals.
  - Динамічне визначення категорії Metaplex `properties.category` як `"video"`, `"vr"`, `"html"` або `"image"`.
  - Заповнення масиву `properties.files` статичною обкладинкою та динамічними файлами з точними MIME-типами.
  - `exportManifestCsv` з підтримкою колонки `animation_url`.
  - Поле `#x-anim-prefix` у Studio UI та прапорець `--anim-prefix` у CLI.

#### Хвиля 14: Release & Deployment Hub
- **Генератори конфігурацій деплою (`src/deploy.mjs`)**:
  - Генератор конфігурації для Metaplex Sugar CLI (`buildSugarConfig`).
  - Генератор конфігурації деплою контрактів Thirdweb / EVM Drop (`buildThirdwebConfig`).
  - Покроковий локалізований посібник із запуску (`buildReleaseGuide`).
- **Вкладка Release Hub у Studio UI**:
  - Прямі посилання на OpenSea Studio, Magic Eden Launchpad, LaunchMyNFT та тестові мережі.
  - Гарантія нульового доступу до приватних ключів (чистий non-custodial дизайн).
  - CLI: `series release-config <archive.json> [options]`.

#### Хвиля 13: Профілі експорту під лаунчпади
- **Стандартизовані профілі експорту (`src/launchpads.mjs`)**:
  - `opensea`: метадані ERC-721 для OpenSea Studio з CSV-маніфестом.
  - `magiceden`: формат Magic Eden Solana/EVM Drop із масивом роялті авторів та `seller_fee_basis_points`.
  - `launchmynft`: формат LaunchMyNFT з індексацією токенів від 0.
  - `ordinalsbot`: формат маніфесту інскрипцій Bitcoin Ordinals.
- **Двигун гуртових CSV-маніфестів**:
  - `exportManifestCsv`: гуртовий експорт маніфестів CSV, сумісний із провідними маркетплейсами.
  - CLI: `series manifest <archive.json> [options]`.

#### Хвиля 12: Диспетчер децентралізованого сховища IPFS / Arweave
- **Інтеграція зі сховищами (`src/storage.mjs`)**:
  - Завантаження папок у Pinata IPFS (`uploadToPinata`) з non-custodial клієнтською архітектурою.
  - Детермінований генератор CIDv0 (`calculateDeterministicCid`) для локальної офлайн-симуляції.
  - Studio UI: завантаження в IPFS в один клік із вкладки Експорт з живим відображенням прогресу.
  - CLI: `series pin <set-dir> [options]`.

#### Хвиля 11: AI Auto-Triage & розумний критик
- **Двигун оцінки якості (`src/critic.mjs`)**:
  - Швидкі офлайн-евристики (безкоштовно) для перевірки сигнатур PNG magic bytes, розмірів, пошкодження файлів та збігів із блоклістом промптів.
  - Мультимодальний AI-оцінювач (GPT-4o / Claude 3.5 Sonnet) для виставлення балів анатомії, узгодженості стилю та відповідності промпту (1–10).
  - Структурований вердикт Keep / Redo / Review з поясненням причин.
  - Панель Triage у галереї Studio з можливістю автоматичного застосування позначок keep/redo.
  - CLI: `series triage <set-dir> [options]`.

#### Хвиля 10: Headless CLI конвеєр пакетного рендерингу
- **Команда CLI (`bin/series.mjs render`)**:
  - Автономний виробничий рендеринг із терміналу без необхідності запускати браузер.
  - Режим симуляції (`--dry-run`), розрахунок вартості, перевірка промптів через лінтер та оптимізація сили референсу.

#### Хвиля 9: Розширення метаданих та експорт Bitcoin Ordinals
- **Розширення атрибутів**:
  - Підтримка типів відображення OpenSea `display_type` (`number`, `boost_number`, `boost_percentage`, `date`, `max_value`).
  - Генерація маніфестів інскрипцій Bitcoin Ordinals (`buildOrdinalsMeta`).

#### Хвиля 8: Пул паралелізму та живий SSE-стрімінг
- **Продуктивність (`src/pool.mjs`)**:
  - Детермінований пул паралельних завдань (`mapConcurrent`) зі збереженням порядку черги.
  - Потокова передача мініатюр та прогресу через Server-Sent Events (SSE) під час генерації.

#### Хвиля 7: Vision Assist
- **Зворотний інжиніринг промптів (`src/vision.mjs`)**:
  - AI-аналіз базового зображення: визначення архетипу, кадрування, освітлення, настрою, палітри та пропозицій трейтів.
  - Автономний евристичний фолбек за відсутності API-ключів.

#### Хвиля 6: Керування базовими картинками та бібліотека трейтів
- **Лінійні бази**:
  - Підтримка файлів `base-<line>.*` для окремих архетипів ліній.
- **Менеджер бібліотеки паків трейтів**:
  - Імпорт та експорт багаторазових паків трейтів (`libraries/traits/*.json`).
  - Оновлення та перегенерація відхилених результатів (Redo).

#### Хвилі 1–5: Базова основа Studio
- **Series Lab Studio**:
  - Чиста детермінована ESM-архітектура на Node.js без важких фронтенд-фреймворків.
  - 100% відтворювана генерація DNA на основі seed (`FNV-1a` + PRNG).
  - Повна двомовна локалізація (UK/EN) в усіх вкладках інтерфейсу, документації та CLI.
  - Вбудований лінтер промптів (блокліст захищених брендів і франшиз).
  - Матриця валідації конфліктів трейтів та звіт розрахунку рідкості (очікувана vs фактична).
  - Галерея відбору з переглядом, позначками keep/redo/favorite та порівнянням наборів.
  - Експорт готових до мінту ZIP-архівів із 2x апскейлом (`sharp`).

---

### 🛡 Принцип безпеки Non-Custodial
- Series Lab генерує всі метадані, асети, маніфести та конфігурації деплою локально на вашому комп'ютері.
- **Жодні приватні ключі або мнемонічні сид-фрази ніколи не запитуються, не обробляються і не зберігаються сервером.**
- Виконання транзакцій деплою делегується безпосередньо офіційним порталам лаунчпадів або локальним CLI-інструментам (Metaplex Sugar, Thirdweb CLI, OpenSea Studio).
