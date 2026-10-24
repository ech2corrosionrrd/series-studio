# Series Lab · HTTP API

Джерело істини: `server/index.mjs`. На ПК сервер: `127.0.0.1:5344`. Той самий процес на хості слухає `HOST`/`PORT` і вимагає `SERIES_ALLOWED_HOSTS` ([HOSTING.md](./HOSTING.md)). UI: `/studio/`.  
Статика майстерні: `/input/…`, `/out/…`. Ключі з `.env` **не** повертаються клієнту. Публічний сайт studio.w3ir.io цих маршрутів не має.

Усі JSON-відповіді — `application/json`, якщо не зазначено інакше.

## Health / resources

| Method | Path | Опис |
|--------|------|------|
| GET | `/api/health` | ok, product, port, base status, keysFile path, engines |
| GET | `/api/admin/resources/plan` | Рекомендований баланс по провайдерах (лише адмін). `?probe=1` додатково читає баланс Stability з API. Відповідь: `providers[]` (`id`, `name`, `spend_7d_usd`, `spend_30d_usd`, `spend_30d_external_usd`, `trend`, `projected_per_day_usd`, `exposure_usd`, `reserve_usd`, `recommended_usd`, `balance_usd`, `balance_source` api/manual, `balance_stale`, `runway_days`, `top_up_usd`, `status` ok/low/critical/unknown/off), `totals`, `settings`, `outstanding_credits` |
| POST | `/api/admin/resources/balance` | Поточний баланс провайдера без API балансу (лише адмін). Тіло `{ provider, balance_usd, note? }`; `balance_usd: null` стирає запис. Невідомий провайдер чи від'ємне число — 400 |
| POST | `/api/admin/resources/alert` | Поріг сповіщення про баланс провайдера (лише адмін). Тіло `{ provider, below_usd }`; `below_usd: null` вимикає сповіщення (навіть типове для Replicate, 5 $). Невідомий провайдер чи від'ємне число: 400 |
| POST | `/api/admin/resources/note` | Нотатка про сервіс у Адмін → Ресурси (квота, план, зауваження; до 300 символів). Тіло `{ provider, note }`, порожня нотатка стирає запис. Працює для платних API й для сервісів без балансу (Alchemy, RPC, Irys, Telegram, локальний GPU) |
| GET | `/api/resources` | наявність ключів (presence only) |

## Presets / templates / trait packs

| Method | Path | Опис |
|--------|------|------|
| GET | `/api/presets` | список пресетів |
| GET | `/api/preset?file=` | повний пресет |
| POST | `/api/validate` | body `{ file }` або `{ preset }` |
| POST | `/api/preset/save` | записати `presets/<id>.json`; новий проєкт понад безкоштовні: `402` з `code: "project_charge"` і `cost`, повтор із `confirmCharge: true` списує кредити один раз; збереження під id іншого наявного проєкту (не відкритого й не того, що передано в `editing`) дає `409` з `code: "project_exists"`, повтор із `overwrite: true` замінює його, а попередня версія йде в кошик; з `baseRev` (ревізія з `GET /api/preset`) змінений відтоді файл дає `409` з `code: "project_stale"` (повтор із `overwrite: true` замінює, стара версія йде в кошик), у відповіді нова `rev` |
| POST | `/api/projects/open` | зробити проєкт активним: `{ file }`; далі база, шари, набори кадрів і архів усіх маршрутів це активного проєкту (у публічному режимі) |
| POST | `/api/projects/move-set` | перенести набір кадрів в інший проєкт: `{ dir, to, from? }` (`from` типово активний); папка набору разом з позначками переходить власнику, без копій і оплати; 404 немає проєкту/набору, 409 у цілі вже є набір з такою назвою, 400 у локальному режимі |
| POST | `/api/projects/delete` | видалити проєкт: `{ file, confirm: true }`; пресет, архів рецептів і власні база, шари й набори кадрів ідуть у кошик проєктів, слот звільняється; активним стає наступний; без `confirm` це 400 |
| POST | `/api/projects/purge` | видалити проєкт із кошика остаточно: `{ id, confirm: true }` (без `confirm` 400, невідомий `id` 404); `GET /api/projects` у `deleted[]` віддає `daysLeft` (скільки днів до автоочищення, `null` коли `SERIES_TRASH_DAYS=0`) і `trashDays` |
| POST | `/api/projects/restore` | відновити видалений проєкт з кошика: `{ id: <id запису кошика>, confirmCharge? }`; для ліміту це новий проєкт (понад безкоштовні `402 project_charge`) |
| GET | `/api/projects` | проєкти гаманця й квота (`free`, `used`, `extraCredits`, `needsCharge`, `exempt`) |
| GET | `/api/templates` | список шаблонів |
| GET | `/api/templates/:id` | шаблон як пресет |
| GET | `/api/trait-packs` | список паків (`libraries/traits/`) |
| GET | `/api/trait-packs/:id` | повний пак + summary |
| POST | `/api/trait-packs/save` | зберегти/створити пак у `libraries/traits/<id>.json` |
| POST | `/api/trait-packs/export-from-preset` | експортувати трейти пресету в окремий пак |

## Recipes / archive / rarity / lint

| Method | Path | Опис |
|--------|------|------|
| POST | `/api/build` | зібрати архів → `out/<id>.json` |
| POST | `/api/diff-seed` | перевірка стабільності DNA |
| GET | `/api/recipes?file=` | рецепти архіву (+ мета для таблиці) |
| POST | `/api/recipe` | редагувати рецепт (`file`, `index`, `traits`/`note`/`reset`); conflicts → 400 |
| GET | `/api/rarity?file=` | rarity report (очікуваний vs факт) |
| POST | `/api/lint` | `{ text }` або `{ texts: [] }` — lint/blocklist |
| GET | `/api/archive/list` | `out/*.json` |
| GET | `/api/archive/latest` | найновіший архів |
| GET | `/api/archive/file?file=` | download JSON |

## Base images / Vision Assist

| Method | Path | Опис |
|--------|------|------|
| GET | `/api/base/status` | чи є головна базова |
| GET | `/api/base/list` | файли в `input/` + wish |
| POST | `/api/base/upload` | base64 → role primary/line/style/extra |
| POST | `/api/base/primary` | призначити файл головною базою |
| POST | `/api/base/delete` | видалити файл з `input/` |
| GET | `/api/base/wish` | поточний wish |
| POST | `/api/base/wish` | зберегти wish.json |
| POST | `/api/base/generate` | wish → зображення (lint + txt2img/edit); опційно makePrimary |
| POST | `/api/base/analyze` | AI Vision аналіз базової картинки (styleLock + traits) |

## Generate

| Method | Path | Опис |
|--------|------|------|
| POST | `/api/estimate` | безкоштовна оцінка: mode, editions, cost, lint |
| POST | `/api/generate` | live generate: batch з архіву або single prompt; SSE стрім + паралелізм (`concurrency`), `mode: "redo"`. Якщо відбір порожній, відповідь — JSON `count: 0` і SSE не відкривається. Закриття з’єднання (кнопка «Зупинити») скасовує решту кадрів; уже записані файли лишаються. |

Режими відбору (`mode` / `selection`): `pilot` · `only` · `first` · `missing` · `redo`.  
`force: true` — перезаписати наявні файли в сеті. Потрібна головна базова. Lint блокує 400.

## Review (sets / marks / triage)

| Method | Path | Опис |
|--------|------|------|
| GET | `/api/sets` | список наборів у `out/` |
| GET | `/api/set?dir=` | зображення набору + marks + light QA + `shelved` (кадри, прибрані з набору) |
| POST | `/api/set/delete` | `{ dir, edition }` — кадр видаляється назавжди (кошика для кадрів немає) |
| POST | `/api/set/drop` | `{ dir, edition }` — прибрати кадр із набору, файл лишається у `versions/` |
| GET | `/api/marks?dir=` | keep/redo marks |
| POST | `/api/marks` | оновити marks (`dir` + `edition`/`mark` або `marks`) |
| POST | `/api/qa/triage` | AI Auto-Triage & Smart Critic (`dir`, `mode`, `provider`, `autoApplyMarks`) |

## Export / checklist / workspace / storage

| Method | Path | Опис |
|--------|------|------|
| GET | `/api/export/csv?file=` | CSV промптів |
| GET | `/api/export/txt?file=` | TXT промптів |
| GET | `/api/admin/system` | стан системи для вкладки адмінки «Система» (лише адмін у публічному режимі, інакше 403). Відповідь: `app` (версія, ревізія образу з файлу `REVISION`, режим, Node, булеві прапорці: платформа, оплата USDC, Telegram, режим CSP, денна межа витрат), `process` (час роботи, пам'ять процесу й ліміт контейнера, навантаження), `disk` (вільне місце каталогу даних), `data` (розмір `users.db` і WAL, кількість гаманців, розмір дерева даних із кешем 5 хв), `backup` (з файлу `backup-status.json`), `platform` (користувачі, оплати, замовлення USDC за 24 год; `null` поза платформою), `requests` (лічильники й часи відповідей з моменту запуску, найповільніші й найчастіші маршрути, останні 5xx), `csp` (звіти порушень), `alerts` (тривоги `{level, code, params}`). Секретів немає |
| POST | `/api/csp-report` | приймач звітів про порушення Content-Security-Policy від браузера (без авторизації, тіло до 8 КБ, відповідь 204; у журнал потрапляє перше входження кожного порушення) |
| POST | `/api/export/bundle` | mint-ready ZIP → `out/bundles/` (ERC-721, Metaplex, Ordinals; опційно `imageUriPrefix`; опційно `aiMark` (типово `true`; `false` вимикає позначку «створено ШІ» в метаданих PNG і файл `ai-disclosure.json`); опційно `authorship`: `{ baseOrigin: hand\|photo\|ai_curated\|ai_raw, handEdited, handLayers, note }` — заява про людський внесок, пишеться в `authorship.json` і README) |
| POST | `/api/export/preview-meta` | генерація попереднього перегляду метаданих `1.json` |
| GET | `/api/checklist` | `?archive=&set=` — NFT readiness items |
| GET | `/api/workspace` | прочитати `workspace/current.json` |
| POST | `/api/workspace` | зберегти / `clear` workspace |
| GET | `/api/storage/status` | статус ключа Arweave (Irys) |
| POST | `/api/storage/pin` | завантаження папки набору в Arweave (Irys) серверним `IRYS_PRIVATE_KEY`; списує кредити етапу «архів»; перед оплатою рахує ціну (ліміт `IRYS_MAX_PRICE_SOL`, типово 0.05 SOL) і поповнює Irys за потреби; віддає `arweaveUri` (`ar://<id>/`). Для випуску в мережу є CLI `series upload` (ключ на ПК) — [RELEASE.md](./RELEASE.md) |
| GET | `/api/launchpads` | список профілів лаунчпадів (OpenSea, Magic Eden Drop (Solana), LaunchMyNFT, Ordinals) |
| GET | `/api/export/manifest.csv` | експорт CSV маніфесту для гуртового імпорту (`?archive=&profile=&zeroIndexed=`) |
| GET | `/api/export/showcase.html` | завантаження автономного HTML візуального пруфу та оцінки рідкості |
| GET | `/api/release/portals` | отримання посилань на лаунчпади та покрокових порад (`?profile=&archive=`) |
| GET | `/api/release/config` | конфіг деплою: типово `cm-config.json` (Core Candy Machine); `sugar.json` лише якщо `?legacy=1`; для EVM — `thirdweb.json` |
| POST | `/api/preflight` | перевірка архіву перед ZIP: помилки блокують, попередження ні |
| POST | `/api/deploy-kit` | ZIP набору деплою. `chain` типово `solana` (Core). `solana-legacy` або `legacy: true` — застарілий Sugar. Поля `holderModel` (як `licence` вище) і `holderCap` обирають чернетку для `HOLDER-LICENCE.txt`; власний текст `holderLicence` має перевагу. Поле `rehearsal` (`devnet` типово, `skip`) лише змінює інструкцію в наборі: при `skip` вона має один розділ для основної мережі, нічого не блокується. Поле `allowlist` (текст, один адрес Solana на рядок) пише `allowlist.json` з merkle root; невалідна адреса — 400. Тіло з приватним ключем — 400 `secrets` |
| GET | `/api/layers/status` | Що лежить у теці шарів гаманця (`layers/`): `{ exists, files, bytes, keys: [{ key, count }], coverage, limits }`. З `?preset=<файл пресету>` (для Конструктора, ще до збирання рецептів) або `?archive=<файл>` додає `coverage` `{ expected, present, missing[≤40], missingCount }`: скільки значень рис серії мають PNG (значення `None` файлу не потребує). |
| POST | `/api/layers/upload` | ZIP із шарами в тілі, `Content-Type: application/zip` (єдиний маршрут, де JSON не обов'язковий). Структура `<риса>/<значення>.png` (до 3 рівнів, обгортка `layers/` знімається). `?clear=1` — спершу замінити все (старі файли йдуть у кошик), `?archive=<файл>` або `?preset=<файл пресету>` — повернути покриття. Перевірки: небезпечні шляхи (`..`, абсолютні, зарезервовані імена) відхиляють весь ZIP, лише справжні PNG (підпис і IHDR, до 8192 px і 40 Мпікс), до 40 МБ ZIP, 1500 файлів, 8 МБ файл, 120 МБ за раз, 200 МБ у теці. Усе або нічого: невдалий ZIP нічого не лишає. Відповідь `{ files, bytes, keys, skipped[], cleared, status }`; помилки з `code: "layers_<причина>"`. |
| POST | `/api/layers/clear` | Переносить усі шари гаманця в кошик (`out/trash`, відновлення в «Ресурсах»): `{ removed, trashId }`. |
| POST | `/api/compose` | Складає PNG-шари архіву в `out/layers`. Тіло: `archive` (або `file`), необов’язково `layers` (тека всередині проєкту; типово тека шарів гаманця, куди кладе `/api/layers/upload`), `base` (ім’я файлу в `input/`), `limit`. Промпти не змінюються. Кредити не списуються. Немає рис, теки шарів чи базової картинки — 400. **Гібрид:** `over` (назва набору в `out/`) замість бази накладає шари поверх кадрів цього набору й пише новий набір `out/<набір>-layers`; необов'язково `only` (масив ключів рис, які фарбувати). Фарбуються лише риси, для яких є файл шару. Відповідь: `mode: "overlay"`, `count`, `painted`, `unpainted`, `missingFrames` (до 20), `missingFramesCount`, `dir`, `set`. Немає набору — 404. **Перегляд одного кадру:** `preview` (номер видання) складає лише це видання в пам'яті (з `over` чи з базою) і повертає `mode: "preview"`, `edition`, `layers`, `skipped`, `sha256`, `png` (data URL). Нічого не пишеться на диск, кредити не списуються; кадр побайтово збігається з тим, що дасть повне складання. Немає видання чи кадру в наборі — 404, некоректний номер — 400 |
| GET | `/api/launch-advisor?chain=&locale=` | офлайн-порадник. Creator Hub лише для `solana`. Біржових цін немає. Необов'язково `licence` (`statement` типово, `personal`, `commercial`, `commercial_cap`, `cc0`), `name`, `creator`, `cap`: тоді `holderTemplate` — чернетка ліцензії власника цієї моделі; `licenceModels` — перелік моделей |
| POST | `/api/marketplace-kit` | ZIP набору маркетплейсу. Solana: Magic Eden і Tensor. EVM: OpenSea. Bitcoin: Ordinals, без Magic Eden |

## Versions / trash / spend (захист оплачених рендерів)

| Method | Path | Опис |
|--------|------|------|
| GET | `/api/versions?dir=&edition=` | історія версій картинки: `out/<set>/versions/<N>/` |
| POST | `/api/versions/current` | `{ dir, edition, v }` — зробити версію поточною (`<N>.png`) |
| POST | `/api/versions/drop` | `{ dir, edition, v }` — непоточну версію видаляє назавжди |
| POST | `/api/set/delete` | `{ dir, edition }` — поточний кадр, його версії й нотатку створення видаляє назавжди; позначку keep/redo знімає |
| POST | `/api/set/drop` | `{ dir, edition }` — прибрати поточний кадр із набору, не знищуючи файл: `<N>.png` стає `versions/<N>/v<k>.png`, `current` = null. Повернути — `POST /api/versions/current` |
| GET | `/api/trash` | записи кошика `out/trash/<id>/` (новіші першими) |
| POST | `/api/trash/restore` | `{ id }` — повернути файли на місце (відмова, якщо ціль уже існує) |
| POST | `/api/account/delete-data` | «Мої дані» (лише публічний режим, потрібен вхід). Тіло `{ "confirm": "DELETE" }` (точне слово, інакше 400 `code: "confirm"`). Видаляє теку гаманця (вхідні, пресети, зображення, шари, кошик, робочу копію), рядки `funnel_events`, `referral_codes`, `wallet_nonces`, `freemium_usage` і замінює гаманець на `"erased"` та прибирає назву серії в `render-log.jsonl`. **Лишає** облік грошей: `users` (баланс), `payments`, `transactions`, `sol_orders`, `referrals`, `holder_grants`. Відповідь `{ ok, filesRemoved, rows, logLines }`. |
| POST | `/api/trash/purge` | `{ id }` — видалити запис назавжди |
| GET | `/api/spend` | `{ capUsd, spentTodayUsd, byEngine }` з `out/render-log.jsonl` (local) або `data/render-log.jsonl` (public) |

Перегенерація (`force`) і `series render` більше не перезаписують `<N>.png`: попередня картинка переходить у `versions/`.
Видалення базових картинок, паків трейтів, перезапис пілотів, primary і кадрів Відбору — через кошик. Кадр, прибраний із набору (`/api/set/drop`), у кошик не їде: файл лишається у `versions/`, тож галерея, експорт і завантаження його не бачать, доки його не зроблять поточним. `GET /api/set` віддає такі кадри в `shelved`. Набір лишається в `GET /api/sets`, навіть якщо поточних картинок уже немає (`marks.json` або `versions/`).
Платні виклики пишуться в `out/render-log.jsonl` (local) або `data/render-log.jsonl` (public); `SERIES_SPEND_CAP_USD` блокує запуск понад денну межу (400, `code: "spend_cap"`).
Batch зупиняється після `SERIES_MAX_CONSECUTIVE_FAILURES` (5) помилок поспіль (`stopped` у відповіді).

## Credits / Local GPU / Admin economy (`SERIES_MODE=public`)

Платформа: `server/platform.mjs` + `src/platform/*`. Деталі економіки: [ECONOMY.md](./ECONOMY.md).

| Method | Path | Опис |
|--------|------|------|
| GET | `/api/me` | акаунт сесії: `wallet`, `balance`, `admin`, `packages`, `referral`, `localGpu`, `creditCosts`, `solPay` (`enabled`, `recipient`, `mint`; `testPack` лише адміну з `SOLANA_PAY_TEST_PACK=1`) |
| GET | `/api/credits/history` | останні операції кредитів (сесія) |
| POST | `/api/credits/sol/order` | `{package}` → замовлення оплати USDC (Solana): точна сума з унікальними мікро-центами, адреса, `solana:` URI |
| POST | `/api/credits/sol/check` | знайти переказ у блокчейні й зарахувати кредити → `{credited, balance, orders, error}` (ліміт `SOLANA_PAY_CHECK_RATE_LIMIT`, типово 20/хв) |
| GET | `/api/holder` | право на бонус холдера Genesis (Solana-гаманець) |
| POST | `/api/holder/claim` | отримати разовий бонус холдера |
| GET | `/api/local-gpu` | політика Local GPU (доступність loopback / `SERIES_LOCAL_GPU`) |
| GET | `/api/engines` | рушії + `creditCosts` (кредити за кадр) |
| GET | `/api/admin/economy?days=` | `7` \| `30` \| `all` — маржа, накладні, сценарії (адмін); у `net` є `net_profit_external_usd` і `revenue_usd_external`: чистий прибуток лише за платежами зовнішніх платників; воронка: `funnel_30d` (усі), `funnel_30d_external`, `funnel_total_external` з полями `welcome_granted_wallets`, `welcome_denied_wallets`, `welcome_denied_lost_wallets`, `pay_started_wallets`, `paying_wallets`, `conversion_started_to_paid_pct`, `repeat_paying_wallets`, `project_gate_wallets`, `project_paid_wallets`, `conversion_project_gate_to_paid_pct`; `decision_rule`: правило рішення (`status` active/met/failed, цілі, зовнішні платники й повторні від `DECISION_START`, дні) |
| POST | `/api/notifications/test` | тест Telegram (адмін) |

## Додаткові маршрути

| Method | Path | Опис |
|--------|------|------|
| POST | `/api/credits/sol/prepare` | public: готує переказ USDC (`package`, `payer`); ліміт 20/хв |
| POST | `/api/publish` | public: публікує набір як сторінку колекції (`dir`, `title`, `onlyKeep`) |
| POST | `/api/simulate` | сухий прогін пресету (`file` або `preset`) без витрат |
| POST | `/api/archive/diff` | різниця двох архівів (`a`, `b`) |
| POST | `/api/preset/spinoff` | спін-оф пресету (`file`, `suffix`) |
| POST | `/api/set/compress` | стиснути кадри понад `maxBytes` (типово 1 МБ; `dryRun` лише перелічує); оригінал лишається версією кадру; потрібен `sharp` |
| GET | `/api/quality?dir=` | звіт якості набору: не-PNG, замалі файли, точні копії, схожість до базової; `weakest` — найгірші кадри, `problemEditions` — усі проблемні |
| GET | `/api/similarity?dir=` | схожість картинок набору з основною базовою (гістограми країв, `method: hog-aligned-1`; ключ `warn` нижче 0,73) |
| GET | `/api/waves?file=` | хвилі тиражу пресету |
| POST | `/api/waves/append` | додати хвилю в кінець (`file`, `size`, `seed`, `name`) |
| POST | `/api/gallery/dupes` | пошук дублів у наборі (`dir`, `maxDistance`) |
| GET | `/api/stages/quotes` | ціни етапів за раз (`count`, `engine`, `provider`) |
| GET | `/api/stages/quote` | ціна одного етапу (`stage`, `engine`, `count`, `storage`, `zip`; `storage=1` — із завантаженням в Arweave, старий `ipfs=1` теж діє) |
| GET | `/api/export/provenance?set=` | відбиток колекції (SHA-256); у відповіді `duplicates` — групи видань з однаковою картинкою, `check` — результат перевірки набору (`valid`, `errors`, `warnings`) |
| POST | `/api/export/dataset` | LoRA-датасет (`archive`, `set`) |
| POST | `/api/matrix/preview` | промпт під рушій (`recipe`, `engine`, `preset`) |
| GET | `/api/traits/matrix?archive=` | співвиникнення рис |
| GET | `/api/engines/status` | стан підключень рушіїв |
| POST | `/api/engines/test` | перевірка одного рушія (`engine`) |
| GET | `/api/comfyui/workflow` | шаблон воркфлоу ComfyUI |
| GET | `/api/doctor` | діагностика системи |

## Статика

| Path | Опис |
|------|------|
| `/studio/…` | UI (`server/ui/`) |
| `/studio/docs/…` | сторінки для автора на цьому ПК (uk; англійською `/studio/docs/en/…`): посібник, етапи, вкладки, основа, риси, експорт, короткий пресет. Ті самі тексти, що `scripts/build-site.mjs`. Не `/api` |
| `/input/…` | базові картинки |
| `/out/…` | архіви, сети, bundles |
| `/` | редірект/UI |

## CLI (не HTTP)

`bin/series.mjs`:
- `validate <preset.json>`
- `build <preset.json> [-o archive.json]`
- `diff-seed <preset.json>`
- `showcase <archive.json> [options]` — генерація автономного HTML Showcase & Rarity Scorecard
- `manifest <archive.json> [options]` — генерація стандартизованого CSV маніфесту
- `release-config <archive.json> [options]` — експорт конфіга деплою (`cm-config.json`; `--legacy` пише Sugar; EVM лишається `thirdweb.json`)
- `render <preset.json> [options]` — автономний пакетний рендер
- `triage <set-dir> [options]` — автоматичний аудит та оцінка якості зображень
- `pin <set-dir> [options]` — завантаження зображень в Arweave (Irys)

Див.: [STUDIO-UI.md](./STUDIO-UI.md) · [EXPORT.md](./EXPORT.md) · [STAGES.md](./STAGES.md) · [ECONOMY.md](./ECONOMY.md)
