# Запозичення та синтез: Промт → Series Lab

Джерело **концептів** (ідеї, не дані): NFT Prompt Builder / Промт. Series Lab — окремий самодостатній продукт зі своїми даними, `.env` і бекапами ([STANDALONE.md](./STANDALONE.md)); Промт не змінюється й не читається.  
Мета: інтегрувати передові можливості генерації промптів, контролю якості та експорту в **автономне, детерміноване, безпечне (non-custodial)** середовище Series Lab. Вхід гаманцем і кредити реалізовано в Lab як власну платформу; Streamlit і мінт з головної кнопки — ні.

---

## 1. Карта відповідності модулів

| Модуль у Промт | Реалізація в Series Lab | Опис та статус |
|----------------|-------------------------|----------------|
| `keys_loader`, `.env` | `src/keys.mjs` | Завантаження ключів API з локального `.env` без передачі значень у браузер |
| `collection_templates/*`, `templates.py` | `templates/*.json`, `libraries/traits/*.json` | Бібліотека матеріально різних паків (PFP, маскоти, fine-art, abstract) |
| `style_bible`, `options.py` | `src/recipes.mjs` (`styleLock`) | Фіксація кута, світла, настрою, кадрування та фраз `extraKeep` |
| `prompt_lint`, `content_safety` | `src/lint.mjs` | Лінтинг промптів та блокування брендів/франшиз перед генерацією |
| `rarity_report`, `batch.py` | `src/rarity.mjs`, `src/scorecard.mjs` | Очікуваний vs фактичний % випадання, розрахунок балів рідкості та рангів |
| `trait_rules` | `src/rules.mjs` | Валідація та запобігання конфліктним парам трейтів |
| `image_qa` | `src/imageqa.mjs`, `src/critic.mjs` | Базова тех-перевірка файлів (magic bytes) + AI Auto-Triage & Critic (1-10) |
| `export_bundle`, `zip_readme` | `src/export-bundle.mjs` | Mint-ready ZIP для ERC-721, Metaplex, Ordinals з маніфестами та конфігами |
| `image_upscale` | `src/upscale.mjs` | Опційний 2x апскейл через нативний `sharp` |
| `nft_quality_checklist` | `src/checklist.mjs` | Автоматичний чекліст готовності колекції до релізу |
| `project_service` | `workspace/current.json` | Автоматичне збереження та відновлення стану сесії |
| `trait_options_editor` | Studio UI (Tab 3) | Інтерактивний редактор ваг та промптів для знімка пресету |
| `vision_prompt_extractor` | `src/vision.mjs` | 🤖 Vision Assist: вилучення стилю та трейтів з базової картинки через AI Vision |
| `concurrency_pool` | `src/pool.mjs` | Багатопотоковий рендер з контролем кількості потоків та SSE-стрімом |
| `ordinals_inscriptions` | `src/launchpads.mjs` | Генерація Bitcoin Ordinals маніфестів та метаданих |
| `headless_cli` | `bin/series.mjs` | Повний набір команд CLI для автоматизації (`render`, `triage`, `pin`, `showcase`) |
| `ipfs_uploader` | `src/storage.mjs` | 1-клік завантаження в Pinata IPFS з детермінованим розрахунком CID |
| `launchpad_profiles` | `src/launchpads.mjs` | Профілі OpenSea, Magic Eden, LaunchMyNFT, Ordinals + bulk CSV manifest |
| `deploy_configs` | `src/deploy.mjs` | Автоматична генерація `sugar.json` (Solana) та `thirdweb.json` (EVM) |
| `dynamic_media` | `src/export-bundle.mjs` | Підтримка відео, анімацій та 3D моделей з полем `animation_url` |
| `rarity_scorecard` | `src/scorecard.mjs` | Автономний інтерактивний HTML візуальний пруф & Scorecard з тієрами |
| `prompt_matrix` | `src/matrix.mjs` | Мультидвижкова матриця адаптації під Flux, SDXL, Midjourney v6, OpenAI |

---

## 2. Чому свідомо не в ядрі Lab (або вже інакше)

- **Streamlit UI** — замінений Studio + `/login`.
- **Вхід поштою** — не плануємо; лише гаманець.
- **Ончейн-мінт / клейм зсередини Lab** — ZIP + портал лаунчпада; ключі не custodial.
- **Кредити** — **перенесено** в `src/platform/*` (`SERIES_MODE=public`), схема як у Промт, але **окремий леджер** `data/users.db` і **самодостатній** `.env` Lab (адреса оплат, API, Telegram — лише в цьому проєкті; `SERIES_PLATFORM_ENV` ігнорується). **Оплату Helio з Lab прибрано** (25.09.2026): поповнення — USDC переказом напряму на гаманець оператора (`src/platform/solpay.mjs`, `/api/credits/sol/*`), без посередника й регіональних блокувань. У UI — кнопка «＋ Купити» в шапці та вікно поповнення: пакет → точна сума й адреса → автозарахування.
- **Адмін → Економіка** — `src/platform/margin.mjs` + `GET /api/admin/economy`: пакети, COGS, накладні (`HOSTING_MONTHLY_USD` / `SAAS_MONTHLY_USD`), FX вхід, `RESOURCE_FX_PCT` (crypto→USD на ресурси), Local GPU support fee. Деталі: [ECONOMY.md](./ECONOMY.md).
- **`SERIES_MODE=local`** — лише теки репо без акаунтів; не може слухати поза loopback.

Див. також: [ROADMAP.md](./ROADMAP.md) · [STAGES.md](./STAGES.md) · [API.md](./API.md) · [ECONOMY.md](./ECONOMY.md)
