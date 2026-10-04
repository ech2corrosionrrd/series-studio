# Series Lab — план розвитку

Продукт: **Series Lab** (by W3IR) · майстерня `Lab → Studio → Release`  
**Цикл ядра (хвилі 1–25) завершено 25.09.2026 → v1.5.0; шлях випуску й Arweave — v1.7.0 (04.10.2026), виправлення за зауваженнями — v1.7.1.** Запити #1–#9 (зведення в [CHANGELOG.md](../CHANGELOG.md) від 26.09.2026) додали перевірений архів, набір деплою (типово Core Candy Machine; Sugar — застарілий), набір маркетплейсу (Magic Eden лише для Solana), офлайн-порадник запуску і огляд якості. Хостинг, власний домен і великий розріз файлів сервера — за командою власника.

Хвиля 12 нижче називає диспетчер сховища. Кнопка завантаження ходить в Arweave через Irys (Pinata/IPFS прибрано з коду). Хвиля 14 описує перший хаб випуску; поточний типовий конфіг Solana — `cm-config.json`, не Sugar.

Папка на диску може лишатись `series-studio`; основний лендінг та робочий домен: [studio.w3ir.io](https://studio.w3ir.io) · staging: [next.w3ir.io](https://next.w3ir.io) (може відставати від `main`). **У разі високого попиту на сервіс (масштабування), для нього буде виділено окреме доменне ім'я та повністю ізольований хостинг.**

Джерела ідей: `C:\Промт` + `C:\Gremlins\gremlin-nft`  
**Не** є форком GFAM; lore / treasury / мінт з головної — поза scope Lab.

## Принципи

1. **Етапи з власністю полів** — Огляд = ідентичність; Основа = базова картинка(и); Конструктор = промпт+трейти; без дублів форм.
2. **Оптимально / широко** — на кожному етапі короткий шлях + advanced.
3. **З Промт** — промпт, якість, шаблони, експорт; плюс перенесена платформа (вхід гаманцем, кредити). **Не** Streamlit і **не** мінт з головної кнопки.
4. **З health/gremlin** — UX майстерні (рецепти/генерація/відбір); **не** gnft-логін, Legendary boost, AI-critic як обовʼязковий гейт.
5. DNA/рецепти — **детерміновані** (seed); LLM не є «мозком» серії.
6. Термін продукту: **базова картинка(и) серії** (primary = головна базова). Ніколи «мати» / mother у UX.

## Фази

| Фаза | Статус | Зміст |
|------|--------|--------|
| **Lab core** | ✅ | rng · traits · recipes · validate CLI · schemas · demo preset |
| **Studio UI** | ✅ | вкладки 1–7 + Адмін/Довідка · i18n uk/en · ключі з локального `.env` |
| **Health-патерн 4–6** | ✅ | рецепти-таблиця+редактор · estimate→generate · keep/redo |
| **Промт bridge · хвиля 1** | ✅ | паки/шаблони · styleLock · lint · rarity · trait rules · light QA |
| **Промт bridge · хвиля 2** | ✅ | mint-ready ZIP · upscale · NFT checklist · workspace autosave |
| **Промт bridge · хвиля 3** | ✅ | редактор опцій рис у Конструкторі (знімок серії) |
| **Промт bridge · хвиля 4** | ✅ | матеріально різні паки (pfp / mascot / fine-art / abstract) |
| **Health UX · хвиля 5** | ✅ | порівняння двох наборів у Відборі (side-by-side) |
| **Студійний UX · хвиля 6** | ✅ | Regenerate Redo · line-specific base · Trait pack library manager |
| **Vision Assist · хвиля 7** | ✅ | Image-to-Preset / vision-розбір базової картинки (styleLock + traits) |
| **Генерація · хвиля 8** | ✅ | Background batch queue · SSE прогрес · паралелізм генерацій |
| **Релізні метадані · хвиля 9** | ✅ | Bitcoin Ordinals manifest · OpenSea display_type (boost, number, date) |
| **Headless CLI · хвиля 10** | ✅ | Headless batch render pipeline (`series render`) · dry-run · cost estimation |
| **AI Auto-Triage · хвиля 11** | ✅ | AI Auto-Triage & Smart Critic (`/api/qa/triage`, `series triage`) · score & badges |
| **Storage Dispatcher · хвиля 12** | ✅ | Завантаження в Arweave через Irys (`series pin`, `imageUriPrefix` = `ar://<id>/`). Pinata прибрано |
| **Launchpad Presets · хвиля 13** | ✅ | Launchpad Presets & Multi-Standard Export (`formatForLaunchpad`, `manifest.csv`, `series manifest`) |
| **Release & Deploy Hub · хвиля 14** | ✅ | Хаб випуску. Поточний типовий Solana-конфіг — Core `cm-config.json`; Sugar лише як застарілий (`sugar/`) |
| **Dynamic Media · хвиля 15** | ✅ | Dynamic Media Pipeline (`animation_url`, video/audio/3D support, `properties.category`, files) |
| **Showcase & Scorecard · хвиля 16** | ✅ | Collection Showcase & Trait Rarity Scorecard (`calculateRarityScores`, standalone HTML visual proof) |
| **Prompt Matrix · хвиля 17** | ✅ | Multi-Engine Prompt Matrix & LoRA / Model Tags (`src/matrix.mjs`, Flux, Midjourney, SDXL) |
| **Provenance Hash · хвиля 18** | ✅ | NFT Provenance Hash & Verifiable Metadata (ланцюг SHA-256 картинок, `provenance.json`, deploy verification) |
| **LoRA Dataset Exporter · хвиля 19** | ✅ | LoRA & AI Training Dataset Exporter («Серія як датасет», пари `.png` + `.txt`, тригер-слова, Kohya/Flux) |
| **Notifications & Webhooks · хвиля 20** | ✅ | Batch Generation Notifications & Webhooks (Telegram-бот, звукові/системні сповіщення) |
| **UI Matrix & Trait Synergy · хвиля 21** | ✅ | UI Matrix Preview & Trait Heatmap (попередній перегляд рушіїв на льоту, теплова карта рідкості) |
| **Fast Engine Connectors · хвиля 22** | ✅ | Direct Fast Engine Connectors (Fal.ai, Replicate Schnell, Runware, локальний ComfyUI та Automatic1111) |
| **Безпека й страховка · хвиля 23** | ✅ | захист API (CSRF / DNS rebinding) · версії рендерів · кошик · журнал і денна межа витрат · автостоп batch · атомарний запис JSON |
| **Довідка й дизайн · хвиля 24** | ✅ | підказки з локалей на кожній вкладці · довідка-путівник з пошуком (uk/en) · `docs/GUIDE.md` · mock у списках рушіїв · оновлений дизайн і мобільна верстка |
| **Шлях випуску · хвиля 25** | ✅ | «Почати серію» / спін-оф / 12 пілотів / тексти без кредитів · DNA-блок · diff архівів · overrides · архів випуску → портал · підказки hover · `/login` Series Lab · вхід лише гаманцем |
| **Шлях випуску · upload→guards→verify** | ✅ | `release.json`, `series upload` (відновлюване, з `cache.json`), `series guards`, `series verify` — [RELEASE.md](./RELEASE.md) |
| **Release Lab-side** | ✅ | ZIP + чекліст + Release Hub (посилання на лаунчпад). Ончейн-клейм — зовні, не в Lab |
| **Реліз v1.7.1** | ✅ 04.10.2026 | Виправлення за зауваженнями: `series guards` для Core, Arweave замість IPFS в оплаті й документації, перевірка версії Node — [CHANGELOG.md](../CHANGELOG.md) |
| **Реліз v1.7.0** | ✅ 04.10.2026 | Arweave (Irys), шлях випуску upload → guards → verify (Core і v3), підказки й мережа за вибором — [CHANGELOG.md](../CHANGELOG.md) |
| **Стабілізація на живих даних** | ▶️ зараз | `series verify` на справжній Core-машині, пробне відновлення `series upload` на mainnet, проходження шляху користувачем; **без** великого рефакторингу (див. «Поточні рішення») |
| **Рефакторинг коду** | ⏸ відкладено | після стабілізації шляху / перед власним доменом — не зараз |
| **Хостинг студії / власний домен** | ⏸ | Окреме рішення власника: [HOSTING.md](./HOSTING.md), [STANDALONE.md](./STANDALONE.md). Зелений деплой Pages — це лише лендінг [studio.w3ir.io](https://studio.w3ir.io); чи staging [next.w3ir.io](https://next.w3ir.io) уже на v1.7.0, не підтверджено (потрібен вхід гаманцем) |

Деталі запозичень з Промт — [FROM-PROMT.md](./FROM-PROMT.md). Етапи — [STAGES.md](./STAGES.md). API — [API.md](./API.md). Наступний план реалізації (сила референсу, Core Candy Machine, маркетплейси, перевірка архіву) — [RECOMMENDATIONS.md](./RECOMMENDATIONS.md). Хвилі нижче він не скасовує.

## Хвиля 1 (реалізовано)

1. Паки рис у `libraries/traits/` (pfp-core, brand-mascot, fine-art, abstract-series).
2. **styleLock** у пресеті (ракурс / світло / настрій / фіксатори) — Конструктор.
3. **Prompt lint + blocklist** марок перед `/api/generate` і `/api/base/generate`.
4. **Rarity report** після build на Рецептах (очікуваний % vs факт).
5. **Trait rules** (несумісні пари) при Apply / редакторі рецепту.
6. **Light image QA** у Відборі (файл існує, мін. розмір, magic bytes) — без Claude.

## Хвиля 2 (реалізовано)

1. **Mint-ready ZIP** — `POST /api/export/bundle` → `out/bundles/*.zip` (ERC-721 / Metaplex), імена `N.png` / `N.json`.
2. **Upscale 2×** — опційно через `sharp` (optionalDependency); без sharp ZIP все одно збирається.
3. **NFT checklist** — `GET /api/checklist` + картка в UI Експорт.
4. **Workspace autosave** — `workspace/current.json` (gitignored), restore на boot.

## Хвиля 3 (реалізовано)

1. **Редактор опцій рис** у Конструкторі — картка «Оптимально · опції рис».
2. Редагує **знімок** `preset.traits.items[].options` (`value` / `weight` / `prompt`): Add · Remove · Duplicate.
3. Вибір ключа з чернетки (або кнопка «Опції» в чеклисті пака).
4. Persist через наявний **Save prompt+traits** (`/api/preset/save`); без окремого «wide library authoring».
5. Валідація: `weight > 0`, унікальний `value`, порожній `prompt` — попередження в UI.
6. Pure helpers: `normalizeOptions` / `validateOptions` / `duplicateOption` · `test/wave3.test.mjs`.

## Хвиля 4 (реалізовано)

1. **Паки матеріально різні** — `libraries/traits/`: pfp-core (portrait baseline), brand-mascot (flat vector), fine-art (painterly), abstract-series (shape/motif).
2. Унікальні `items` + prompts під тип колекції; ~6–10 ключів, ~5–9 опцій.
3. `defaults.changeKeys/extraKeys` + `rules.conflicts` (2–3 пари) на кожному паку.
4. Шаблони `templates/` синхронізовані зі словниками паків (changeKeys / items / conflicts).
5. Smoke: `test/wave4.test.mjs` — key sets різняться; conflict refs валідні; mini-build рецептів.

## Хвиля 5 (реалізовано)

1. **Порівняти з** (`#v-dir2`) на Відборі — опційний другий набір поруч (як gremlin-ref).
2. Side-by-side tiles для edition, що є в будь-якому наборі; відсутня сторона — placeholder.
3. ✓/↻ лишаються лише для **основного** набору (`#v-dir`); підказка в hint.
4. Якщо наборів < 2 — селект порівняння приховано.
5. Pure helper `mergeEditions(a,b)` · `src/gallery.mjs` · `test/wave5.test.mjs`.

## Хвиля 6 (Studio Workshop UX & Fast Iterations)

1. **Regenerate Redo** — масове швидке перегенерування відхилених (`marks[edition] === 'redo'`) номерів з вибором seed / strength.
2. **Line-Specific Base Images** — підтримка окремих базових референсів під кожну лінію (`base-<line>.*` або `primary.*`) під час рендеру.
3. **Trait Pack Library Manager** — створення нових паків, експорт поточних рис серії в `libraries/traits/<id>.json`, збереження та видалення паків через UI/API.

## Хвиля 7 (Vision Assist & AI Preset Extractor)

1. **Vision Image-to-Preset (`POST /api/base/analyze`)** — аналіз базового референсу через OpenAI GPT-4o / Claude Vision з вилученням структури `styleLock` (ракурс, світло, настрій, кадрування) та стартових рис для Конструктора.

## Хвиля 8 (Batch Queue, Concurrency & Stream)

1. **Progress Streaming (SSE/Polling)** — стрімінг прогресу рендеру зображень у реальному часі.
2. **Паралельність генерацій** — пул конкурентних запитів (2–3 паралельні виклики) для пришвидшення роботи.

## Хвиля 9 (Bitcoin Ordinals & Metadata Extensions)

1. **Bitcoin Ordinals Export** — генерація маніфестів інскрипцій (`id`, `name`, `image`, `properties.edition`, `properties.collection`, `properties.files`) та ZIP-архівів для біткоін-ордіналів.
2. **OpenSea Display Types** — підтримка числових та статистичних атрибутів (`display_type`: `number`, `boost_number`, `boost_percentage`, `date`, `max_value`) для ігрових і статистичних характеристик.

## Хвиля 10 (Headless CLI Batch Render Pipeline)

1. **CLI Render Pipeline (`series render <preset.json>`)** — повноцінний автономний рендер-конвеєр для CI/CD або фонових воркеров з підтримкою прапорів `-e/--engine`, `-s/--strength`, `-o/--out`, `-c/--concurrency`, `--limit`, `--dry-run`.
2. **Cost Estimation & Prompt Linting** — попередній розрахунок орієнтовної вартості генерації та лінтинг промптів перед початком рендеру.

## Хвиля 11 (AI Auto-Triage & Smart Critic)

1. **AI Auto-Triage (`POST /api/qa/triage`, `series triage`)** — автоматичний аналіз якості та відповідності згенерованих картинок (евристичний + GPT-4o / Claude Vision).
2. **Score & Badges** — виставлення оцінок (1–10), тегів виявлених дефектів (`distorted_face`, `bad_anatomy`, `missing_trait`, `blurry`), підказок та 1-клік авто-застосування `keep`/`redo`.

## Хвиля 12 (IPFS / Arweave Storage Dispatcher)

1. **Storage URI Prefix (`imageUriPrefix`)** — підтримка префіксів децентралізованого зберігання (`ipfs://<CID>/`, `ar://<txId>/`, `https://...`) у всіх форматах метаданих (ERC-721, Metaplex, Ordinals) та ZIP-архівах.
2. **Pinata IPFS Integration & Live Preview (`POST /api/storage/pin`, `series pin`)** — пряме 1-клік завантаження наборів у Pinata IPFS з автоматичною підстановкою CID та інтерактивним прев'ю `1.json`.

## Хвиля 13 (Launchpad Presets & Multi-Standard Export Profiles)

1. **Launchpad Profiles (`LAUNCHPAD_PROFILES`, `formatForLaunchpad`)** — готові нативні профілі для провідних лаунчпадів:
   - **OpenSea Studio**: стандартний ERC-721 + `display_type` атрибути + CSV маніфест для гуртового імпорту.
   - **Magic Eden Drop (Solana)**: метадані Metaplex, масив роялті (`creators: [{ address, share }]`) і `seller_fee_basis_points`. EVM цей профіль не обіцяє.
   - **LaunchMyNFT**: Metaplex-сумісний формат з підтримкою 0-based індексації (`0.png`, `0.json`).
   - **Bitcoin Ordinals / Inscriptions**: маніфести інскрипцій з `collection` та `edition` прив'язкою.
2. **Bulk CSV Manifest (`exportManifestCsv`, `GET /api/export/manifest.csv`, `series manifest`)** — генерація стандартизованого CSV маніфесту для прямого завантаження в OpenSea Studio / launchpad-портали та включення `manifest.csv` у корінь mint-ready ZIP.
3. **CLI Manifest Generator (`node bin/series.mjs manifest`)** — генерація CSV маніфестів безпосередньо з командного рядка з прапорами `--profile`, `--zero-index`, `--image-prefix`.

## Хвиля 15 (Dynamic Media Pipeline — Video / Animation / 3D)

1. **Dynamic Asset Auto-Discovery (`findEditionMedia`)** — підтримка додаткових медіафайлів (`.mp4`, `.webm`, `.mov`, `.gif`, `.glb`, `.gltf`, `.html`) поруч зі статичними обкладинками.
2. **Metadata & Manifest Integration** — генерація поля `animation_url`, коректне заповнення Metaplex `properties.category` (`"video"`, `"vr"`, `"html"`, `"image"`) та масиву `properties.files` з MIME-типами.
3. **ZIP Packaging** — автоматичне пакування відео та 3D файлів у папку `images/` у mint-ready ZIP.
4. **Studio & CLI Support** — поле префіксу анімацій `#x-anim-prefix` в UI та прапорець `--anim-prefix` у CLI.

## Хвиля 16 (Collection Showcase & Trait Rarity Scorecard)

1. **Deterministic Rarity Scoring (`calculateRarityScores`)** — розрахунок частотності трейтів, індивідуальних оцінок рідкості ($1/F$), сумарного балу токена та рейтингу (#1..N).
2. **Tier Classifications (`getRarityTier`, `RARITY_TIERS`)** — розбивка на рангові категорії: Mythic (Top 2%), Legendary (Top 10%), Epic (Top 25%), Rare (Top 50%), Common (Bottom 50%).
3. **Standalone HTML Visual Proof (`generateShowcaseHtml`)** — генерація повністю автономного інтерактивного HTML-файлу з темним дизайном, пошуком, фільтрами за рідкістю, матрицею DNA та картками токенів.
4. **API & CLI Export** — маршрут `GET /api/export/showcase.html` та CLI команда `series showcase <archive.json> [-o showcase.html]`.

## Хвиля 17 (Multi-Engine Prompt Matrix & LoRA / Model Tags)

1. **Engine Matrix Transformer (`src/matrix.mjs`)** — адаптація промптів під особливості синтаксису генераторів: Flux (LoRA тригери + natural language), SDXL (`<lora:name:weight>` + quality tags), Midjourney (параметричні прапорці `--v 6.1 --stylize`), Kontext та OpenAI.
2. **Batch Matrix Generator (`buildEnginePromptMatrix`, `exportEngineMatrixCsv`)** — побудова повної матриці промптів для колекції та експорт у CSV для мультиплатформенного рендеру.

## Хвиля 18 (NFT Provenance Hash & Verifiable Metadata)

1. **Deterministic Image Hashing (`src/provenance.mjs`)** — обчислення SHA-256 для кожного відібраного зображення серії зі збереженням точного порядку видання.
2. **Collection Provenance Hash** — обчислення фінального загального хешу колекції через конкатенацію хешів усіх токенів та вторинне хешування (`sha256(hash_1 + ... + hash_N)`).
3. **Пакетний експорт та деплой** — автоматичне включення `provenance.json` у бандл ZIP, оновлення `collection.json`, інтеграція в `release-guide.txt` та `thirdweb.json`.
4. **CLI & API** — команда `series provenance` для розрахунку та верифікації цілісності набору.

## Хвиля 19 (LoRA & AI Training Dataset Exporter)

1. **Dataset Engine (`src/dataset.mjs`)** — формування навчального набору пар `[edition].png` + `[edition].txt` із підтримкою тригерних слів (`triggerWord`).
2. **Стилі підписів** — підтримка тегів через кому (Danbooru/WD-style для SDXL) або природного опису (Natural Language для Flux).
3. **Гуртовий експорт** — пакування у навчальний архів ZIP та команда `series dataset`.

## Хвиля 20 (Batch Generation Notifications & Webhooks)

1. **Telegram Webhook Dispatcher** — відправка повідомлення з підсумком пакетного рендеру, статистикою AI Critic та превʼю топового токена.
2. **Web / Audio Alerts** — звуковий сигнал та сповіщення у браузері при завершенні черги генерації.

## Хвиля 21 (UI Matrix Preview & Trait Heatmap)

1. **Live Prompt Matrix Preview** — миттєве перемикання між синтаксисами двигунів (Flux/SDXL/Midjourney) на будь-якому обраному рецепті в Конструкторі.
2. **Trait Heatmap** — інтерактивна теплова карта перетину характеристик на вкладці Рецепти для виявлення статистичних аномалій.

## Хвиля 22 (Direct Fast Engine Connectors — реалізовано)

1. **Cloud Fast APIs (`src/connectors.mjs`, `src/engines.mjs`)**:
   - **Fal.ai**: надшвидкісні клієнти Flux Schnell (txt2img за ~$0.003) та Flux Dev (img2img/edit за ~$0.025) з прямим зверненням через `FAL_KEY`.
   - **Replicate Schnell**: економічна генерація на базі моделі `black-forest-labs/flux-schnell` ($0.005/img).
   - **Runware AI**: підтримка надшвидкої інференс-платформи Runware через `RUNWARE_API_KEY`.
2. **Local Zero-Cost GPU Connectors ($0.00)**:
   - **ComfyUI**: повноцінний рушій генерації через локальний сервер (`http://127.0.0.1:8188`, `COMFYUI_URL`) з підтримкою txt2img та img2img (автоматичне завантаження вхідного референсу через `/upload/image`, побудова графа KSampler, черга `/prompt`, моніторинг `/history`, скачування результату з `/view`).
   - **Automatic1111 / SD-WebUI**: прямий конектор до локального WebUI (`http://127.0.0.1:7860`, `A1111_URL`) через ендпоінти `/sdapi/v1/txt2img` та `/sdapi/v1/img2img`.
3. **Діагностика підключень та CLI**:
   - **CLI `series engines`**: інтерактивна таблиця всіх підтримуваних рушіїв (edit та txt2img) із перевіркою наявності ключів та розрахунком собівартості.
   - **API & UI тестування**: ендпоінти `GET /api/engines/status` та `POST /api/engines/test` з кнопкою перевірки всіх підключень та вимірюванням пінгу у вкладці «Ресурси».

## Хвиля 23 (Безпека й страховка — реалізовано)

- `server/guard.mjs`: `/api/*` приймає лише свій `Host` і same-origin `Origin`, POST — лише JSON (`SERIES_ALLOWED_HOSTS` для додаткових імен).
- `src/versions.mjs`: перегенерація в Studio і `series render` переносить попередню картинку в `out/<набір>/versions/<N>/`; у Відборі — вікно версій.
- `src/trash.mjs`: видалення / заміна файлів → `out/trash/`, відновлення в «Ресурсах», автоочищення `SERIES_TRASH_DAYS`.
- `src/spend.mjs`: журнал `out/render-log.jsonl`, денна межа `SERIES_SPEND_CAP_USD`, витрачене сьогодні в оцінці й «Ресурсах».
- `failureBreaker` у `src/pool.mjs`: автостоп після `SERIES_MAX_CONSECUTIVE_FAILURES` (5) помилок поспіль.
- `src/fs-safe.mjs`: атомарний запис JSON. Джерела ідей — gremlin-nft (versions, trash, spend, fs-safe) і Промт (provider_health).

## Хвиля 24 (Довідка, підказки, дизайн — реалізовано)

- Підказки на всіх вкладках генеруються з локалей (`data-i18n-list`) — жоден пункт більше не губиться між HTML і перекладом.
- Вкладка «❓ Довідка»: швидкий старт за $0, путівник по етапах (навіщо / що робити / що отримаєте / типові помилки), страховка, безкоштовний режим, словник, FAQ, CLI; пошук і зміст. Друкована версія — `docs/GUIDE.md`.
- Англійська локаль доповнена до повного набору ключів.
- Дизайн: токени, навігація-кроки, головні кнопки `primary`, видимий фокус, адаптивна верстка до 390 px.

## Хвилі поставки, візуальні двійники, відмови рушіїв

- **Хвилі** (`src/waves.mjs`): «Додати хвилю» на Рецептах дописує партію зі своїм seed і номерами після вже зібраних. Перша хвиля лишає ті самі DNA, що й серія до допису.
- **Схожі кадри** (`src/dupes.mjs`): у Відборі «Знайти схожі» рахує average-hash PNG у наборі й показує пари в межах відстані Геммінга.
- **Відмови за день** (`engineStatsToday`): на Ресурсах біля витрат — скільки викликів кожного рушія сьогодні вдалось і скільки відмовило.

## Хвиля 25 (Шлях випуску й вхід Series Lab — реалізовано)

1. **Огляд:** «Почати серію» (зберегти → основа), «Спін-оф» (нові id/seed, та сама формула).
2. **Генерація:** «12 пілотів — порахувати»; «Згенерувати» лише після оцінки; пакет блокується при збіжній DNA.
3. **Рецепти:** «Зібрати тексти» без кредитів; diff двох архівів; точкова правка в `preset.overrides`.
4. **Експорт:** архів випуску (чекліст → OpenSea ZIP keep-only) → кнопка «Далі · портал запуску».
5. Hover-підказки на всіх опціях (`locales/tips.mjs`).
6. `/login` у бренді Series Lab; вхід лише гаманцем (email не плануємо).
7. Публічні сторінки колекцій `/c/{slug}` — бренд Series Lab.

## Поточні рішення (оновлено 2026-10-04, v1.7.1)

| Рішення | Статус |
|---------|--------|
| **Ядро майстерні (хвилі 1–25)** | ✅ Закрито для поточного scope Lab |
| **Великий рефакторинг коду зараз — ні** | Зафіксовано. Спочатку стабілізувати й користуватись; дрібні правки лише якщо блокують роботу. |
| Коли рефакторинг доречний | Після кількох днів стабільного шляху **або** конкретний біль **або** перед хостингом. |
| Зараз замість рефакторингу | Комітити логічними шматками (коли попросить власник); ловити продуктові збої. |
| Вхід | Лише гаманець (MetaMask / Coinbase / Phantom). |
| Ончейн-клейм / мінт | Зовні через Release Hub. Lab не тримає ключі й не мінтить. |
| Хостинг / домени | [HOSTING.md](./HOSTING.md) — план на майбутнє, не черга поточних задач. Хостинг студії вирішується окремо; Pages деплоїть лише лендінг. |
| Vault (Drop #2) | Лишається **вимкненим**: без `VAULT_WALLET_ADDRESS` і каталогу він dormant. Не вмикати без окремого рішення. |
| Сховище | Arweave (Irys). Pinata прибрано. Завантаження релізу — `series upload --keypair` (ключ на ПК); серверна кнопка Arweave ховається, якщо на сервері немає `IRYS_PRIVATE_KEY`. |
| Версія Node | `>=22.13` (CI: 22 і 24). Перед `npm test` і `npm start` оболонка має бути на Node 22 або 24; старіший Node зупиняється з поясненням. |

## Відкладено (справді deferred)

- **AI critic** (Claude) як обов'язковий автоматичний гейт
- **Legendary boost** / gnft-специфіка
- **Ончейн-клейм / мінт зсередини Lab** (Magic Eden SDK тощо) — свідомо зовні
- **Великий рефакторинг** кодової бази (до стабілізації шляху — див. «Поточні рішення»)
- Публічний **GitHub**-репозиторій (якщо ще приватний)
- Хостинг / власний домен — [HOSTING.md](./HOSTING.md), [STANDALONE.md](./STANDALONE.md)

## Поза Lab core (свідомо)

Streamlit UI · вхід поштою · Legendary / GFAM lore · мінт з головної кнопки · LLM як «мозок» серії (ламе seed).

## Локальний запуск

`start-lab.bat` / `npm start` → http://127.0.0.1:5344/studio/  
Тести: `npm test`. CLI: `bin/series.mjs` validate / build / diff-seed.

## Документація

Індекс: [README.md](./README.md) (усі файли `docs/`).
