# Series Lab

**Series Lab** від [W3IR](https://w3ir.io) — детермінована локальна майстерня для генеративних NFT-серій та LoRA-датасетів: **Lab → Studio → Release**.

- **Версія**: `1.3.0` (Production Release — Усі 22 хвилі Roadmap реалізовано + Пакет стабілізації)
- **Хост продукту**: [studio.w3ir.io](https://studio.w3ir.io)  
- **Папка на диску**: `series-studio` / npm-пакет `series-lab`
- **Гарантія безпеки**: 100% Non-Custodial. Жодні приватні ключі або сид-фрази не передаються і не зберігаються на сервері.

---

**Series Lab** — автономна локальна майстерня повного циклу:
**пресет + seed** → унікальні детерміновані DNA/промпти → **базова картинка серії + Vision Assist** → багатопотоковий рендер з живим SSE-стрімом → **AI Auto-Triage & відбір** → **хешування Provenance SHA-256** → **експорт метаданих** (ERC-721 / Metaplex / Ordinals), IPFS-пінінг, LoRA-датасети для навчання AI, мультидвижкова матриця (Flux/SDXL/Midjourney), автономний HTML Showcase & Rarity Scorecard та конфігурації для деплою (Sugar / Thirdweb).

- **Запуск**: `start-lab.bat` або `npm start` → http://127.0.0.1:5344/studio/
- **Діагностика середовища**: `node bin/series.mjs doctor`
- **Термінологія продукту**: **базова картинка(и) серії** (роль `primary` = головна базова). Не «мати» / mother.
- **Повна документація**: [`docs/README.md`](docs/README.md) · [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## Архітектура та організація файлів

| Директорія | Призначення |
| :--- | :--- |
| `presets/` | Готові конфігурації серій (назва, seed, розмір, підключений пак рис, правила). |
| `libraries/traits/` | Каталоги рис та атрибутів (`pfp-core`, `brand-mascot`, `fine-art`, `abstract-series`). |
| `templates/` | Загальні шаблони конфігурацій та готовий `comfyui-workflow.json` для 1-клік імпорту. |
| `input/` | Базові референсні зображення серії (`primary.png`, `candidate-*.png`). |
| `out/` | Згенеровані зображення, архіви рецептів (`recipes.json`), mint-ready ZIP та звіти. |
| `workspace/` | Автозбереження робочого стану поточної сесії Studio UI. |
| `src/` | Ядро системи: математика RNG, валідація, рушії генерації, експортні бандлери. |
| `server/` | Локальний HTTP-сервер, REST API та інтерфейс користувача (UK/EN локалізація). |
| `bin/series.mjs` | Повноцінний автономний CLI-інструмент для терміналу та CI/CD. |

---

## Швидкий запуск

Вимоги: **Node ≥ 20**.

```bash
cd series-lab   # або series-studio
npm install
npm test        # 130 unit-тестів у 23 сьютах (100% pass)
npm start       # відкриває Studio UI: http://127.0.0.1:5344/studio/
# Windows shortcut: start-lab.bat
# Запуск без відкриття браузера: npm run lab:serve
```

Ключі API: завантажуються з локального `.env` (див. `.env.example`), `SERIES_KEYS_FILE` або `C:\Промт\.env`. Значення ключів **ніколи** не передаються в браузер.
Також доступний **автономний Mock-рушій** (`mock`, $0.00), який працює без інтернету та без будь-яких ключів.

---

## Studio Stages (Вкладки майстерні)

1. **1 · Огляд (Overview)** — назва, id, розмір серії, seed, базовий двигун, факти готовності.
2. **2 · Основа (Base)** — завантаження базових картинок, генерація за побажанням, 🤖 **Vision Assist** (авторозбір стилю).
3. **3 · Конструктор (Constructor)** — шаблони, бібліотека паків рис, редактор опцій трейтів, `styleLock`, живий попередній перегляд Prompt Matrix.
4. **4 · Рецепти (Recipes)** — збирання архіву, таблиця DNA, перевірка конфліктів, звіт рідкості, **Trait Synergy Matrix**.
5. **5 · Генерація (Generate)** — калькулятор вартості, лінтинг промптів, багатопотоковий рендер з живим SSE-прогресом, підтримка Fal.ai, ComfyUI, Automatic1111 та Replicate.
6. **6 · Відбір (Review)** — галерея, порівняння двох сетів, 🤖 **AI Auto-Triage & Critic** (оцінка 1-10, дефекти, keep/redo), швидкий перезапуск відхилених.
7. **7 · Експорт (Export)** — mint-ready ZIP з динамічним медіа, **NFT Provenance Hash SHA-256**, **LoRA Training Dataset Exporter**, **IPFS Pinata Dispatcher**, **Standalone HTML Showcase**, **Release & Deployment Hub** (`sugar.json` / `thirdweb.json`).
8. **💰 Ресурси (Resources)** — моніторинг ключів та **⚡ Діагностика і тестування зв'язку з рушіями** у реальному часі.
9. **❓ Довідка (Help)** — покроковий гайд та словник термінів.

---

## Headless CLI Інструменти (`bin/series.mjs`)

Series Lab містить повний набір CLI команд для автоматизації та CI/CD конвеєрів:

```bash
# Системна діагностика та перевірка здоров'я проєкту
node bin/series.mjs doctor

# Огляд доступних генеративних рушіїв та цін
node bin/series.mjs engines

# Валідація схеми та семантики пресету
node bin/series.mjs validate presets/demo-series.json

# Детерміноване збирання архіву рецептів
node bin/series.mjs build presets/demo-series.json -o out/demo-archive.json

# Перевірка стабільності seed (ідентичність DNA)
node bin/series.mjs diff-seed presets/demo-series.json

# Автономний пакетний рендер без браузера (з лінтингом та розрахунком ціни)
node bin/series.mjs render presets/demo-series.json --engine fal --concurrency 2

# Автоматичний аналіз якості та виставлення keep/redo оцінок (AI Critic)
node bin/series.mjs triage out/fal-s0.45 --provider heuristic --apply

# Розрахунок та верифікація криптографічного ланцюга Provenance Hash SHA-256
node bin/series.mjs provenance out/fal-s0.45 -o out/provenance.json
node bin/series.mjs provenance out/fal-s0.45 --verify

# Експорт колекції як LoRA датасету для навчання власних AI моделей
node bin/series.mjs dataset out/demo-archive.json --images out/fal-s0.45 --trigger "my_hero" -o out/dataset.zip

# Пакетне масштабування (upscale 2x) зображень
node bin/series.mjs upscale out/fal-s0.45 --out out/fal-s0.45-upscaled

# Завантаження набору зображень у Pinata IPFS
node bin/series.mjs pin out/fal-s0.45 --name my-series

# Генерація універсального CSV маніфесту для OpenSea / Launchpad
node bin/series.mjs manifest out/demo-archive.json --profile opensea --image-prefix ipfs://Qm.../

# Генерація автономного візуального HTML Showcase & Rarity Scorecard
node bin/series.mjs showcase out/demo-archive.json -o out/showcase.html

# Експорт конфігурацій деплою (Metaplex Sugar або Thirdweb EVM)
node bin/series.mjs release-config out/demo-archive.json --profile magiceden -o out/sugar.json
```

---

## 22 Хвилі Розвитку (Повний перелік реалізованого)

- **Хвилі 1–5**: Core Studio UI, пресети, recipes, render estimation, review gallery, styleLock, lint, rarity, conflict rules, QA, порівняння сетів, редактор опцій.
- **Хвиля 6**: Regenerate Redo, Line-Specific Bases (`base-<line>.*`), Trait Pack Library Manager (`libraries/traits/`).
- **Хвиля 7**: Vision Assist (`src/vision.mjs`, GPT-4o / Claude Vision + heuristic fallback).
- **Хвиля 8**: Concurrency Pool (`src/pool.mjs`), SSE live stream з прогресом та превʼю.
- **Хвиля 9**: Bitcoin Ordinals Manifests & OpenSea `display_type` (`number`, `boost`, `date`).
- **Хвиля 10**: Headless CLI Batch Render Pipeline (`series render`).
- **Хвиля 11**: AI Auto-Triage & Smart Critic (`src/critic.mjs`, `/api/qa/triage`, `series triage`).
- **Хвиля 12**: IPFS / Arweave Storage Dispatcher (`src/storage.mjs`, Pinata direct upload, deterministic CID).
- **Хвиля 13**: Launchpad Presets & Multi-Standard Export Profiles (`src/launchpads.mjs`, `manifest.csv`).
- **Хвиля 14**: Release & Deployment Hub (`src/deploy.mjs`, `sugar.json`, `thirdweb.json`, release guide).
- **Хвиля 15**: Dynamic Media Pipeline (відео, анімації, 3D assets з `animation_url` та MIME-типами).
- **Хвиля 16**: Collection Showcase & Trait Rarity Scorecard (автономний інтерактивний HTML з Mythic/Legendary/Epic/Rare/Common тієрами).
- **Хвиля 17**: Multi-Engine Prompt Matrix & LoRA / Model Tags (Flux, SDXL, Midjourney, OpenAI, Kontext).
- **Хвиля 18**: NFT Provenance Hash & Verifiable Metadata (ланцюг SHA-256 картинок, `provenance.json`, deploy verification).
- **Хвиля 19**: LoRA & AI Training Dataset Exporter («Серія як датасет», пари `.png` + `.txt`, тригер-слова, Kohya/Flux).
- **Хвиля 20**: Batch Generation Notifications & Webhooks (Telegram-бот, звукові/системні сповіщення).
- **Хвиля 21**: UI Matrix Preview & Trait Heatmap (попередній перегляд рушіїв на льоту, теплова карта рідкості).
- **Хвиля 22**: Direct Fast Engine Connectors (Fal.ai, Replicate Schnell, Runware, ComfyUI, Automatic1111).
- **Пакет стабілізації**: автономний `mock` PNG генератор без залежностей, системний лікар `series doctor`, пакетний апскейлер `series upscale`, готовий `templates/comfyui-workflow.json`.

Детальніше: [`docs/ROADMAP.md`](docs/ROADMAP.md) · [`docs/API.md`](docs/API.md) · [`CHANGELOG.md`](CHANGELOG.md).

---

## Ліцензія

MIT
