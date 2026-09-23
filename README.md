# Series Lab

**Series Lab** by [W3IR](https://w3ir.io) — local deterministic workshop for NFT series: **Lab → Studio → Release**.

- **Version**: `1.0.0` (Production Release — All 17 Roadmap Waves Completed)
- **Host (future product UI)**: [studio.w3ir.io](https://studio.w3ir.io)  
- **Folder on disk**: `series-studio` / package `series-lab`
- **Security Guarantee**: 100% Non-Custodial. Zero private keys or seeds handled on the server.

---

## Українською (коротко)

**Series Lab** — автономна локальна майстерня W3IR: пресет + seed → унікальні детерміновані DNA/промпти → базова картинка серії + Vision Assist → багатопотоковий рендер з живим SSE-стрімом → AI Auto-Triage & відбір → експорт метаданих (ERC-721 / Metaplex / Ordinals), IPFS-пінінг, мультидвижкова матриця (Flux/SDXL/Midjourney), автономний HTML Showcase & Rarity Scorecard та конфігурації для деплою (Sugar / Thirdweb).

Запуск: `start-lab.bat` або `npm start` → http://127.0.0.1:5344/studio/

Термін продукту: **базова картинка(и) серії** (роль `primary` = головна базова). Не «мати» / mother.

Документація (UK-first): [`docs/README.md`](docs/README.md).

---

## Що вміє Series Lab (v1.0.0 Architecture)

| Шар | Можливості | Статус |
|-----|------------|--------|
| **1. Lab Core** | Детермінований RNG (FNV-1a), валідація схем пресетів та архівів, лінтинг промптів, правила конфліктів, розрахунок рідкості. | ✅ v1.0.0 |
| **2. Base & Vision Assist** | Головна базова картинка, лінійні бази (`base-<line>.*`), AI Vision зворотний аналіз референсу (GPT-4o/Claude) для вилучення стилю та трейтів. | ✅ v1.0.0 |
| **3. Constructor & Matrix** | Бібліотека паків трейтів (`libraries/traits/`), вбудований редактор опцій, `styleLock`, мультидвижкова матриця промптів (Flux LoRA, SDXL, Midjourney v6). | ✅ v1.0.0 |
| **4. Recipes & Rarity** | Генерація архіву рецептів, захист від дублікатів DNA, звіт рідкості, розрахунок Scorecard (#1..N ранги та Mythic/Legendary/Epic/Rare/Common тієри). | ✅ v1.0.0 |
| **5. Batch Render & SSE** | Багатопотоковий рендер з контролем паралельності (1x/2x/3x), черга завдань, живий SSE-стрімінг прогресу та превʼю. | ✅ v1.0.0 |
| **6. Gallery & AI Triage** | Порівняння наборів (side-by-side), мітки keep/redo, швидке перегенерування відхилених, AI Auto-Triage & Critic (евристичний + Vision). | ✅ v1.0.0 |
| **7. Multi-Standard Export** | Mint-ready ZIP (ERC-721, Metaplex, Ordinals), 2x upscale (`sharp`), bulk CSV manifest, динамічні медіа (`animation_url`, video/3D), автономний HTML Showcase, деплой-конфіги (`sugar.json`, `thirdweb.json`), IPFS Pinata dispatcher. | ✅ v1.0.0 |

---

## Швидкий запуск

Вимоги: **Node ≥ 20**.

```bash
cd series-lab   # або series-studio
npm install
npm test        # 106 unit-тестів у 23 сьютах (100% pass)
npm start       # відкриває Studio UI: http://127.0.0.1:5344/studio/
# Windows shortcut: start-lab.bat
# Запуск без відкриття браузера: npm run lab:serve
```

Ключі API: за замовчуванням завантажуються з `C:\Промт\.env` (або `SERIES_KEYS_FILE`). Значення ключів **ніколи** не передаються в браузер.

---

## Studio Stages (Вкладки майстерні)

1. **1 · Огляд (Overview)** — назва, id, розмір серії, seed, базовий двигун, факти готовності.
2. **2 · Основа (Base)** — завантаження базових картинок, генерація за побажанням, 🤖 **Vision Assist** (авторозбір стилю).
3. **3 · Конструктор (Constructor)** — шаблони, бібліотека паків рис, редактор опцій трейтів, `styleLock`, матриця LoRA.
4. **4 · Рецепти (Recipes)** — збирання архіву, таблиця DNA, перевірка конфліктів, звіт рідкості, diff-seed.
5. **5 · Генерація (Generate)** — калькулятор вартості, лінтинг промптів, багатопотоковий рендер з живим SSE-прогресом.
6. **6 · Відбір (Review)** — галерея, порівняння двох сетів, 🤖 **AI Auto-Triage & Critic** (оцінка 1-10, дефекти, keep/redo), швидкий перезапуск відхилених.
7. **7 · Експорт (Export)** — промпти (CSV/TXT), гуртовий CSV маніфест, mint-ready ZIP з динамічним медіа (`animation_url`), **IPFS Pinata Dispatcher**, **Standalone HTML Showcase & Rarity Scorecard**, **Release & Deployment Hub** (`sugar.json` / `thirdweb.json`).
8. **💰 Ресурси (Resources)** — моніторинг доступності API ключів.
9. **❓ Довідка (Help)** — покроковий гайд та словник термінів.

---

## Headless CLI Інструменти (`bin/series.mjs`)

Series Lab містить повний набір CLI команд для автоматизації та CI/CD конвеєрів:

```bash
# Валідація схеми та семантики пресету
node bin/series.mjs validate presets/demo-series.json

# Детерміноване збирання архіву рецептів
node bin/series.mjs build presets/demo-series.json -o out/demo-archive.json

# Перевірка стабільності seed (ідентичність DNA)
node bin/series.mjs diff-seed presets/demo-series.json

# Автономний пакетний рендер без браузера (з лінтингом та розрахунком ціни)
node bin/series.mjs render presets/demo-series.json --engine kontext --concurrency 2

# Автоматичний аналіз якості та виставлення keep/redo оцінок (AI Critic)
node bin/series.mjs triage out/kontext-s0.45 --provider heuristic --apply

# Завантаження набору зображень у Pinata IPFS
node bin/series.mjs pin out/kontext-s0.45 --name my-series

# Генерація універсального CSV маніфесту для OpenSea / Launchpad
node bin/series.mjs manifest out/demo-archive.json --profile opensea --image-prefix ipfs://Qm.../

# Генерація автономного візуального HTML Showcase & Rarity Scorecard
node bin/series.mjs showcase out/demo-archive.json -o out/showcase.html

# Експорт конфігурацій деплою (Metaplex Sugar або Thirdweb EVM)
node bin/series.mjs release-config out/demo-archive.json --profile magiceden -o out/sugar.json
```

---

## Програмний API (Library Usage)

```js
import {
  buildRecipes,
  buildPrompt,
  dna,
  duplicates,
  hashSeed,
  makeRng,
  validatePreset,
  validateArchive,
  calculateRarityScores,
  generateShowcaseHtml,
  formatEnginePrompt,
  buildEnginePromptMatrix,
  formatForLaunchpad,
  exportManifestCsv,
  buildBundleZip,
  uploadToPinata,
  triageBatch,
} from "series-lab";
```

---

## 17 Хвиль Розвитку (Повний перелік)

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

Детальніше: [`docs/ROADMAP.md`](docs/ROADMAP.md) · [`docs/API.md`](docs/API.md) · [`CHANGELOG.md`](CHANGELOG.md).

---

## Ліцензія

MIT
