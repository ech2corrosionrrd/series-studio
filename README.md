# Series Lab

**Series Lab** від [W3IR](https://w3ir.io) — майстерня для генеративних NFT-серій і LoRA-датасетів: **Lab → Studio → Release**.

- **Версія**: `1.9.0` (далі в `[Unreleased]`: позначка «створено ШІ» й підпис C2PA, CSP у режимі звітів і заголовки безпеки, власні бібліотеки замість CDN, гібридні шари «ШІ + ручні», вкладка адмінки «Система»; докладно в [CHANGELOG](CHANGELOG.md)) — пакет перевірки й панелі якості, провенанс, стиснення; з 1.8.0: публічний хост lab.w3ir.io (вхід гаманцем, оплата USDC, бекапи); з 1.7.0: Arweave (Irys), шлях випуску `upload → guards → verify`, підказки за вибором; з 1.6.1: зведення запитів #1–#9: перевірений архів, Core Candy Machine, маркет без Magic Eden для EVM і Ordinals, порадник запуску ([CHANGELOG](CHANGELOG.md) · [бачення](docs/PRODUCT.md))
- **Папка на диску**: `series-studio` · npm-пакет `series-lab` · ліцензія MIT
- **Розміщення розробки**: `127.0.0.1`. Ключі API не потрапляють у браузер; приватні ключі гаманців і сид-фрази майстерня не запитує й не зберігає.

> **Новачок?** Почніть з [посібника](docs/GUIDE.md) або вкладки **❓ Довідка**. З тієї ж вкладки відкриваються сторінки для автора на цьому ПК: http://127.0.0.1:5344/studio/docs/ (англійською `/studio/docs/en/`) — етапи, вкладки, основа, риси, експорт і короткий пресет. Окремий сайт для цього не потрібен. Вхід — лише гаманець (MetaMask / Coinbase / Phantom); сторінка `/login`.

Сервер розробки стоїть на `127.0.0.1` — це адреса процесу на ПК, не окремий продукт. Вхід, кредити, дані по гаманцю й адмін — повний режим (`SERIES_MODE=public` за замовчуванням). `SERIES_MODE=local` — теки репозиторію без акаунтів, лише loopback. Той самий сервер на хості — [docs/HOSTING.md](docs/HOSTING.md): що задати, що лишається на ПК (keypair, `series mint`, `series reveal`), і що https://studio.w3ir.io лишається статичним сайтом. Живий виклад цим репозиторієм не робиться.

---

## Що вміє

**пресет + seed** → унікальні детерміновані рецепти (DNA + промпти) → **базова картинка серії** (+ Vision Assist) → рендер у кілька потоків з живим прогресом або складання шарів PNG (на базу чи гібридно поверх кадрів ШІ) → **відбір** (keep/redo, AI Triage, версії) → **експорт** (перевірений архів, ERC-721 / Metaplex / Ordinals ZIP, CSV, Arweave через Irys, хеш походження, позначка «створено ШІ» в метаданих, вітрина, датасет LoRA) → **набір деплою** (типово Core Candy Machine; Sugar — застарілий; EVM: Thirdweb; Ordinals: інструкція) → на цьому ПК `release-init`, `upload`, `hidden`, `guards`, `mplx cm create`, `verify`, `series mint --keypair`, `series reveal --keypair` → **набір маркетплейсу** (продаж: Solana — Magic Eden і Tensor; EVM — OpenSea; Bitcoin — Ordinals). Майстерня ключ не бере. Розкриття EVM лишається в кабінеті Thirdweb.

**Страховка для грошей і файлів** (працює автоматично):

| Механізм | Що робить |
|---|---|
| Версії рендерів | Перегенерація не затирає оплачену картинку — попередня йде в `out/<набір>/versions/<N>/`, у Відборі її можна повернути. |
| Кошик | Видалення й заміна файлів переносять їх у `out/trash/`. Кадр із Відбору відновлюється на цій вкладці; решта — **Адмін → Ресурси**. |
| Денна межа витрат (локальний режим) | `SERIES_SPEND_CAP_USD` блокує запуск понад межу ще до виклику платного API. На публічному хості вимкнена. |
| Журнал витрат | Кожен платний виклик: `out/render-log.jsonl` у `SERIES_MODE=local`; у public — `data/render-log.jsonl` (спільний журнал сервера). |
| Автостоп batch | Після 5 помилок рушія поспіль решта черги не запускається. |
| DNA / оцінка | Пакетна генерація блокується при збіжній DNA; «Згенерувати» — лише після безкоштовної оцінки. |
| Захист API | Сервер відхиляє запити з інших сайтів (CSRF) і чужі `Host` (DNS rebinding). |
| Заголовки безпеки й CSP | Кожна відповідь має `nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, а по HTTPS `Strict-Transport-Security`. `Content-Security-Policy` типово лише в режимі звітів (`SERIES_CSP`, [docs/HOSTING.md](docs/HOSTING.md)). Код сторінок оплати й входу не береться зі сторонніх CDN. |
| Позначка «створено ШІ» | Експорт записує її в метадані PNG (`ai-disclosure.json` у ZIP); необов'язковий підпис C2PA робить `series c2pa` на вашому ПК ([docs/C2PA.md](docs/C2PA.md)). |

---

## Швидкий запуск

Вимоги: **Node ≥ 22.13**.

```bash
npm install
npm test
npm start       # http://127.0.0.1:5344/studio/  (або /login у public)
# Windows: start-lab.bat / stop-lab.bat · без браузера: npm run lab:serve
# зовнішнє тестування з ПК через тунель Cloudflare: npm run lab:tunnel (docs/HOSTING.md)
# власний бекап (леджер + дані гаманців) у backups/: npm run backup
```

**Спробувати без ключів:** двигун **mock** на «5 · Генерація». `SERIES_MODE=local` — без входу, лише для тек репо.

### Ключі та налаштування

Скопіюйте `.env.example` у `.env` і перезапустіть.

| Змінна | Призначення |
|---|---|
| `SERIES_MODE` | `public` (типово) — вхід гаманцем; `local` — без акаунтів, лише loopback |
| `AUTH_SESSION_SECRET`, `ADMIN_WALLETS`, `TEAM_WALLETS` | Сесія, адміни й командні гаманці. Якщо `ADMIN_WALLETS` / `TEAM_WALLETS` не задані — лишаються типові адреси; заданий список їх замінює |
| `FAL_KEY`, `REPLICATE_API_TOKEN`, `OPENAI_API_KEY`, `STABILITY_API_KEY`, `RUNWARE_API_KEY`, `POLLINATIONS_API_KEY` | Хмарні рушії |
| `COMFYUI_URL`, `A1111_URL`, `LOCAL_GPU_CREDIT_COST` | Local GPU на ПК; у public — плата підтримки Lab (кр/кадр) |
| `ANTHROPIC_API_KEY` | Vision Assist / AI Triage через Claude (опційно) |
| `IRYS_MAX_PRICE_SOL` | Ліміт ціни серверного завантаження в Arweave, SOL (0.05); вище — відмова до оплати, нестача на Irys поповнюється з гаманця |
| `IRYS_PRIVATE_KEY` | Серверна кнопка Arweave в Експорті (окремий гаманець з малим балансом). Для випуску краще `series upload --keypair` — ключ лишається на ПК |
| `SERIES_TELEGRAM_BOT_TOKEN`, `SERIES_TELEGRAM_CHAT_ID` | Сповіщення від імені Series Lab |
| `SOLANA_PAY_RECIPIENT` (+ `SOLANA_RPC_URL`) | Поповнення кредитів: USDC у Solana переказом напряму, без посередника; публічна адреса-отримувач, ключ не потрібен |
| `HOSTING_MONTHLY_USD`, `SAAS_MONTHLY_USD`, `PAYMENT_FEE_PCT`, `FX_FEE_PCT`, `RESOURCE_FX_PCT` | Адмін → Економіка (накладні + комісії; див. [docs/ECONOMY.md](docs/ECONOMY.md)) |
| `STAGE_*`, `DEPLOY_*`, `MARKETPLACE_IMAGE_SIZES`, `PREFLIGHT_MAX_IMAGE_BYTES` | Ціна етапів, оцінка деплою, розміри майданчиків, стеля файлу — [docs/PRODUCT.md](docs/PRODUCT.md) |
| `SERIES_DATA_DIR`, `AUTH_COOKIE_INSECURE` | Каталог даних; прапорець для входу по http (лише тест) |
| `COMFYUI_ENABLED`, `A1111_ENABLED`, `MOCK_ENABLED` | Увімкнути локальні рушії й mock |
| `WELCOME_CREDITS`, `EARLY_WELCOME_LIMIT`, `GENERATION_RATE_LIMIT_PER_MINUTE` | Разові вітальні кредити (типово 20) і ліміт перших. Денної безкоштовної стелі немає. Гаманець без оплати і без гранту — до 10 генерацій на хвилину; оплата або грант цю стелю знімає |
| `CONTENT_SAFETY_ENABLED`, `MODERATION_API_ENABLED` | Фільтр вмісту й зовнішня модерація |
| `SOLANA_PAY_USDC_MINT`, `SOLANA_PAY_COMMITMENT` | Mint USDC і рівень підтвердження (типово mainnet; міняти лише для тесту) |
| `TUNNEL_HOST`, `TUNNEL_NAME`, `TUNNEL_PORT`, `TUNNEL_WELCOME_REQUIRE_BALANCE` | Зовнішнє тестування через тунель (`npm run lab:tunnel`, [docs/HOSTING.md](docs/HOSTING.md)) |
| `HOLDER_SYNC_INTERVAL_SECONDS`, `SUGAR_PROJECT_PATH` | Синхронізація власників і шлях до проєкту Sugar |
| `SERIES_CSP` | Content-Security-Policy: `report` (типово: лише звіти порушень у журнал), `enforce` (блокує), `off`; див. docs/HOSTING.md |
| `SERIES_SPEND_CAP_USD` | Денна межа витрат, $ (або `off`); на публічному хості типово `off` |
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
| 6 | **Відбір** | ✓ / ↻, порівняння, Triage, схожі кадри, версії. «Видалити» → кошик, «Прибрати з набору» лишає файл. |
| 7 | **Експорт** | Архів випуску → портал; інші ZIP / CSV / Arweave / вітрина / хаб. Спершу «Перевірити чекліст», потім «Зібрати ZIP». |
| — | **Деплой** | «Зібрати набір деплою». Типово Solana (Core Candy Machine, спочатку devnet). Sugar — пункт «застарілий». |
| — | **Маркет** | «Зібрати набір маркетплейсу». Solana: Magic Eden і Tensor. EVM: OpenSea. Bitcoin: Ordinals. |
| — | **Адмін** | **Система** (тривоги, пам'ять, диск, бекапи, запити), Ресурси, **Економіка**, статистика, помилки — лише адмін-гаманець. |
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
node bin/series.mjs repair-png out/pollinations-s0.45 --dry-run
node bin/series.mjs c2pa out/fal-s0.45 --cert signer-chain.pem --key signer-key.pem
node bin/series.mjs pin out/fal-s0.45 --dry-run
node bin/series.mjs release-init out/demo-archive.json -o release.json --creator <адреса> --price 0.2
node bin/series.mjs upload <тека-набору> --keypair deployer.json --max-price 1
node bin/series.mjs guards release.json -o guard-config.json
node bin/series.mjs guards release.json --allowlist wallets.txt
node bin/series.mjs hidden <тека-набору> --uri <посилання-на-hidden.json>
node bin/series.mjs mint release.json --keypair minter.json
node bin/series.mjs reveal <тека-набору> --keypair creator.json
node bin/series.mjs compose out/demo-archive.json --layers layers --base input/primary.png -o out/layers
node bin/series.mjs compose out/demo-archive.json --layers layers --over out/fal-s0.35 --only hat,scarf
node bin/series.mjs verify release.json
node bin/series.mjs notify "Готово"
node bin/series.mjs manifest out/demo-archive.json --profile opensea
node bin/series.mjs showcase out/demo-archive.json -o out/showcase.html
node bin/series.mjs release-config out/demo-archive.json --profile magiceden -o out/cm-config.json
# --legacy пише застарілий Sugar у sugar/; без прапорця — Core Candy Machine
```

---

## Структура

| Шлях | Призначення |
|---|---|
| `presets/` | Пресети серій |
| `libraries/traits/` | Паки рис |
| `templates/` | Шаблони пресетів і ComfyUI |
| `input/` | Базові картинки |
| `out/` | Архіви, набори, `versions/`, `trash/`, бандли; у local ще `render-log.jsonl` |
| `data/` | Леджер, дані гаманців і (у public) `render-log.jsonl` (gitignored) |
| `workspace/` | Автозбереження UI |
| `src/` | Ядро + `platform/` (вхід, кредити) |
| `server/` | HTTP, `/login`, Studio UI, guard |
| `deploy/series-lab/` | Staging / бекап (за командою хостингу) |
| `.github/workflows/` | `health.yml`, `deploy-site.yml` (тестів у GitHub немає: `npm run ci`) |
| `bin/series.mjs` | CLI |
| `scripts/` | Перевірки документів, збір сайту, `build-vendor.mjs` (бібліотеки для браузера) |
| `server/ui/vendor/` | Зібрані з наших залежностей `solana-tx.js` і `evm-address.js` (`npm run vendor`) |
| `test/` | Автотести (`npm test`) |
| `docs/` | Документація, індекс [docs/README.md](docs/README.md) |
| `diploma/` | Пакет документів дипломної роботи (не входить до npm-пакета й Docker) |

---

## Документація

- [docs/PRODUCT.md](docs/PRODUCT.md) — бачення: місія, етапи, економіка, що поза продуктом
- [docs/QUALITY-REVIEW.md](docs/QUALITY-REVIEW.md) — огляд якості після запитів #1–#9
- [docs/RECOMMENDATIONS.md](docs/RECOMMENDATIONS.md) — план і поточний статус пунктів R1–R21
- [docs/GUIDE.md](docs/GUIDE.md) — початківцям
- [docs/ENGINES.md](docs/ENGINES.md) — вибір рушія, сили референсу й бази за живими тестами
- [docs/C2PA.md](docs/C2PA.md) — маркування ШІ-зображень (ст. 50 AI Act): що зроблено, що ні
- [docs/README.md](docs/README.md) — індекс
- [docs/ECONOMY.md](docs/ECONOMY.md) — кредити, маржа, хостинг, обмін crypto→USD
- [docs/ROADMAP.md](docs/ROADMAP.md) · [CHANGELOG.md](CHANGELOG.md)
- [docs/HOSTING.md](docs/HOSTING.md) — перенос процесу майстерні на хост (чекліст; живий деплой не входить)
- [docs/DEPLOY.md](docs/DEPLOY.md) — https://studio.w3ir.io (статичний сайт, без API майстерні)
- [docs/STANDALONE.md](docs/STANDALONE.md) · [docs/DEPLOY-PLATFORM.md](docs/DEPLOY-PLATFORM.md) — окремий продукт і розгортання
- [diploma/](diploma/README.md) — окрема структура проєкту: пакет документів дипломної роботи (не входить до npm-пакета й Docker-образу)

Термінологія: **базова картинка(и) серії**; `primary` = головна базова. Мінт Solana Core — `series mint` на цьому ПК. Продаж — на майданчику. Розкриття EVM — кабінет Thirdweb.

## Ліцензія

MIT © 2026 W3IR
