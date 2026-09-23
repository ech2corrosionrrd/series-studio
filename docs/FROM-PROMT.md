# Запозичення та синтез: Промт → Series Lab

Джерело концептів: `C:\Промт` (NFT Prompt Builder / ai.w3ir.io).  
Мета: інтегрувати передові можливості генерації промптів, контролю якості та експорту в **автономне, детерміноване, безпечне (non-custodial)** середовище без перевантаження сторонніми SaaS-фреймворками (Streamlit, обов'язковий SIWE, білінг).

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

## 2. Чому свідомо не перенесено до ядра Lab

- **SaaS Billing & Credits**: кредити, інвойси та оплата належать зовнішньому хмарному шару.
- **SIWE / Web3 Auth як обов'язковий бар'єр**: локальна майстерня працює повністю офлайн/локально без необхідності підключення гаманця на старті.
- **Custodial Private Key Management**: приватні ключі ніколи не запитуються; деплой делегується офіційним інструментам розробників (Sugar CLI, Thirdweb).

Див. також: [ROADMAP.md](./ROADMAP.md) · [STAGES.md](./STAGES.md) · [API.md](./API.md)
