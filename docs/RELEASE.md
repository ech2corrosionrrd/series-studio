# Шлях випуску: від архіву до перевіреного мінту

Алгоритм перенесено з `gremlin-nft` (рецепти → відбір → бандл → Arweave → deploy → guard → verify). Усі кроки нижче працюють **локально**: ключ гаманця лишається на вашому ПК, у Lab і на сервер не передається.

```
архів → release-init → [Експорт: набір деплою] → upload → series hidden → deploy (mplx / Sugar) → guards → verify → series mint → series reveal --keypair
```

## 1. `release.json` — одне джерело правди
`series release-init out/archive.json -o release.json --creator <адреса> --price 0.2`

Поля: `name`, `symbol`, `size`, `sellerFeeBasisPoints`, `creators` (частки = 100), `priceSol`, `standard` (`core` або `v3`), `reserve.count` (резерв команди, не йде в публічний продаж), `mint.startDate` (UTC), `mint.limitPerWallet`, `allowlist`, `reveal`, `deployed` (адреси після деплою). Адреса-заглушка не проходить перевірку.

`allowlist` — список адрес Solana, або `{ "label": "wl", "wallets": ["…"], "priceSol": 0.05 }`. `label` — 1–6 символів (ім’я групи Candy Guard). `priceSol` міняє ціну лише цієї фази. Які адреси стоять у парі, входить у merkle root: порядок усередині пари хеш не змінює (пари сортуються), інше групування — змінює.

`reveal` лишається `null`, доки немає хешу. Після `series hidden` поставте `{ "enabled": true, "name": "Hidden #", "uri": "<посилання hidden.json>", "hash": "<64 hex>" }`, і `series verify` звірить hidden settings на машині.

## 2. Завантаження в Arweave (відновлюване)
`series upload <тека-набору> --keypair <deployer.json> [--max-price 1] [--no-fund] [--dry-run]`

- Читає `assets/N.png + N.json` і `collection.*` (набір деплою з Експорту).
- Для кожної позиції: спершу картинка, її посилання вписується в `image` і `properties.files`, потім завантажується JSON.
- Після **кожної** позиції оновлюється `cache.json` (формат Sugar: посилання + SHA-256). Обрив — просто запустіть знову: готове пропускається.
- Перед оплатою: оцінка в SOL, порівняння з балансом Irys, поповнення з запасом 5% (вимкнути: `--no-fund`), ліміт `--max-price`.
- `--dry-run` без ключа рахує лише кількість і розмір.

> Перевірено на mainnet (04.10.2026): новий клієнт `@irys/upload` завантажив тестову позицію, посилання на картинку й метадані відкриваються на `gateway.irys.xyz`. Вартість одного файлу ≈ 0.000002 SOL; мінімального поповнення Irys не вимагає.

## 3. Deploy
Набір деплою містить інструкцію: Core Candy Machine (`mplx cm …`) або Sugar (застарілий) з `cache.json`. Адреси запишіть у `release.json → deployed`.

## 4. Правила мінту
`series guards release.json -o guard-config.json` пише набір правил (оплата, дата старту, ліміт на гаманець, allowlist) у форматі вашого стандарту. Список гаманців можна дати файлом: `series guards release.json --allowlist wallets.txt` (один адрес на рядок, `#` — коментар). Поруч із конфігом з’являється `allowlist-proofs.json`.

- **`standard: "core"`** (типово): `guardConfig` з конфіга `mplx cm create`. Ціна в **лампортах** (ціле число, без похибки float), `mintLimit` з `id` і `limit`, `startDate` у ISO 8601. Allowlist — **окрема група** (`wl`, якщо не перейменовано): `groups[].guards.allowList.merkleRoot` — 64 hex без `0x`. Група замінює типовий набір, тому в ній повторені `solPayment` і `mintLimit`. Типовий `guardConfig` лишається публічною фазою **без** `allowList`, щоб відкритий мінт не вимагав доказу. У `mplx` **немає команди** оновити guard вже створеної Core-машини: або вкажіть конфіг при створенні, або застосуйте той самий набір через SDK (`updateCandyGuard`). Формат дати для JSON CLI офіційна документація не наводить (лише для SDK), тож після створення виконайте `mplx cm validate` і `series verify`.
- **`standard: "v3"`**: Sugar-конфіг для `sugar guard update --config … --cache cache.json --keypair <deployer.json>`. Корінь allowlist у групі — **base58** тих самих 32 байт.

Листок merkle: `keccak256` від тексту адреси в base58 (не від сирих байтів pubkey). Пари сортуються як беззнакові байти; непарний вузол піднімається вище, а не дублюється. Це `getMerkleRoot` з клієнта Metaplex Candy Machine. Доказ у транзакцію кладе `series mint` (група `wl`). `allowlist-proofs.json` лишається поруч із конфігом, щоб звірити корінь; окремим кроком його передавати не треба.

⚠ Оновлення guard **замінює весь набір правил**, тому оплата (`solPayment`) входить завжди, а без коректної ціни й творця файл не створюється.

У майстерні (вкладка деплою, лише Solana) той самий список адрес потрапляє в ZIP як `allowlist.json` з тим самим коренем. Повний guard з оплатою все одно збирає `series guards`: у наборі немає поля ціни, тож нульову ціну туди не підставляємо.

## 4a. Приховане розкриття (Solana Core)
Набір деплою кладе справжні `hidden.json` і `hidden.png` (те, що бачить покупець до розкриття) і чернетку `hidden-settings.json` з порожнім `uri` та `hash: null`. Хеш ще невідомий: він рахується з посилань метаданих після завантаження. Пароля на Solana немає. EVM лишається кроком кабінету Thirdweb (`thirdweb.json`, `passwordStored: false`); пароль у файл не пишеться.

1. `series upload <тека> --keypair <ваш.json>` — з’являється `cache.json`.
2. Завантажте `hidden.json` (і `hidden.png`) і візьміть посилання на JSON.
3. `series hidden <тека> --uri <посилання на hidden.json>` — читає `cache.json` (позиція `-1` це колекція і в хеш не входить) і пише `hidden-settings.json`: `{ name, uri, hash }`. Хеш — SHA-256 від `JSON.stringify([{name,uri}, ...])`, як у [гайді Core hidden settings](https://www.metaplex.com/docs/smart-contracts/core-candy-machine/guides/create-a-core-candy-machine-with-hidden-settings). Поруч — `reveal-data.json`. Якщо `cache.json` ще немає, `--uri-prefix <префікс>` збирає URI як `<префікс><індекс>.json` з `assets/N.json`.
4. Поставте `hiddenSettings` на машину **без** config lines. Ім’я до 32 символів, URI до 200.
5. Мінт: `series mint release.json --keypair <гаманець-мінтера.json>`. Команда читає `itemsRedeemed` і підписує Candy Guard `mintV1` на цьому ПК. Якщо цей гаманець є в `allowlist`, береться група `wl`: спочатку `route` записує доказ merkle в PDA, потім `mintV1` передає цей PDA разом з рахунком оплати й лічильником ліміту. `--public` мінтить публічним набором, без allowList. `--dry-run` показує план і нічого не надсилає (бере індекс з `--index`, інакше 0, і не читає мережу). Живий мінт пише `mints.json` поруч із `release.json` (або в `--bundle`, або в `-o`). Sugar (`standard: "v3"`) ця команда не збирає: шлях продукту — Core.
6. Розкриття: `series reveal <тека> --keypair <ключ оновлення колекції.json>` підписує `UpdateV1` (ім'я й URI) для кожного асета з `mints.json`. Асет у колекції зберігає повноваження оновлення як колекцію, тож підпис — гаманець оновлення колекції, не PDA машини (той PDA лише делегат, щоб машина могла мінтити). Без `--keypair` команда пише `reveal-updates.json` і не підписує. `--check revealed.json` порівнює чужий список name/uri з хешем. Приховані налаштування мінтять по порядку 0, 1, 2, … — індекс у `mints.json` і є цей порядок.
7. EVM delayed reveal лишається кроком кабінету Thirdweb. Майстерня приватний ключ не приймає: і мінт, і розкриття — лише CLI.

Створення самої машини й guard лишається за `mplx cm create` (конфіг дає `series guards`): Lab не деплоїть програму. Якщо на guard увімкнено правило поза `solPayment`, `startDate`, `allowList` і `mintLimit` (наприклад `botTax`), `series mint` зупиняється і не збирає неповну транзакцію. Мінт, зроблений не через `series mint`, у `mints.json` сам не з’являється: адреса Core-асета — новий ключ, не PDA. Для такого асета достатньо рядка `{ "index", "asset" }` у `mints.json`; name/uri все одно беруться з `reveal-data.json`.

## 4b. Шари PNG поруч із промптами
`series compose <archive.json> --layers <тека> --base <png> [-o out/layers]` складає готові PNG: базова картинка, потім шар на кожну рису. Файл за замовчуванням — `layers/<ключ риси>/<значення>.png`. Своє місце: поле `layer` в опції (відносний шлях у тій теці, без `..`). `None` нічого не малює. `skipDna` малює, але в DNA не входить. DNA збігається з рецептом. Промпти на рецептах не чіпаються і копіюються в `dna.json`.

У майстерні кнопка «Скласти шари» на вкладці Генерація викликає `POST /api/compose` (тека `layers/` у проєкті, базова картинка з `input/`, результат `out/layers`). Кредити не списуються. Генерація промптами (`series render`) лишається.

## 5. Перевірка з блокчейну
`series verify release.json [--rpc <url>]` лише читає: скільки змінтовано, хто керує правилами, чи збігаються ціна, дата і ліміт з `release.json`. Код виходу 1 при розбіжності.

- **`standard: "core"`** (типово): Metaplex Core Candy Machine. Потрібні `deployed.candyMachine` і `deployed.candyGuard` (за потреби `deployed.collection`). Перевіряє: власники акаунтів (програми Core Candy Machine / Core Candy Guard), що mint authority машини — саме цей guard (інакше правила обходяться), колекцію, кількість предметів (розмір мінус резерв), приховані налаштування (hidden settings) і всі 31 правила guard. Якщо в `release.json` увімкнено `reveal`, машина має мати hidden settings і той самий хеш; без `reveal` hidden settings лишаються розбіжністю (предмети не перелічені окремо). Група `allowlist.label` має містити той самий `allowList.merkleRoot`.
- **`standard: "v3"`**: Candy Machine v3 / Sugar, ті самі звірки правил і кількості.

Розкладку акаунтів Core взято з `metaplex-foundation/mpl-core-candy-machine` і звірено з живими акаунтами mainnet: 600 випадкових машин і 586 їхніх guard розібрано без помилок, у 509 guard без груп декодер дочитав точно до кінця акаунта (решта — залишок старішого довшого набору правил після оновлення; реальні акаунти лежать у `test/fixtures/core-candy-live.json`). Правила, додані платформою (`botTax`, `solFixedFee`, `edition`), показуються як «extra on chain»: це не помилка, але їх варто знати.

## Серверна кнопка «Arweave» в Експорті
`POST /api/storage/pin` платить серверним `IRYS_PRIVATE_KEY` і списує кредити етапу «архів». Це швидкий шлях для префікса `ar://<id>/` (маніфест папки). Для випуску в мережу використовуйте `series upload`: він пише посилання у метадані й веде `cache.json`. Тримайте `IRYS_PRIVATE_KEY` окремим гаманцем із малим балансом.
