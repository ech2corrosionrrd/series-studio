# Розгортання Series Lab (staging `next.w3ir.io`)

> **Команда власника.** Кроки нижче **не** запускати автоматично: вони виконуються на сервері й потребують вашого рішення ([HOSTING.md](./HOSTING.md)). Series Lab — окремий продукт ([STANDALONE.md](./STANDALONE.md)): розгортання не читає й не копіює дані чи `.env` жодного іншого проєкту.

## Що вже перевірено локально

- `npm test` — 217 тестів (на 25.09.2026): вхід гаманцем, кредити, оплата USDC у Solana (перевірка переказів на підробленому RPC), наскрізний сценарій сервера в публічному режимі, бекап, формат сесій/реферальних кодів/промптів (знімок у `test/fixtures/`).
- Оплата перевірена на живому Solana RPC (лише читання): USDC-рахунок гаманця-отримувача знайдено, реальні перекази на нього читаються.

## Змінні середовища

Файл Lab: локально `.env`, на сервері `/opt/series-lab/lab.env` (секрети, `chmod 600`). **Series Lab самодостатній**: усі ключі й адреса для оплат живуть лише в ньому. `phase3.sh` збирає з `lab.env` файл `.env.series-lab` (плюс перевизначення для staging) і не звертається до чужих файлів.

| Змінна | Призначення |
|---|---|
| `AUTH_SESSION_SECRET` | сесії SIWE / реферальні коди (обов'язково; без нього скрипт зупиниться) |
| `AUTH_DOMAIN`, `AUTH_URI`, `AUTH_CHAIN_ID` | текст SIWE-повідомлення |
| `SOLANA_PAY_RECIPIENT` | публічна Solana-адреса для оплати USDC (ключ не потрібен); порожньо — оплата вимкнена. Опційно `SOLANA_PAY_RPC_URL` / `SOLANA_RPC_URL`, `SOLANA_PAY_RECONCILE_INTERVAL_SECONDS`, `SOLANA_PAY_ORDER_DAYS` |
| `SERIES_TELEGRAM_BOT_TOKEN`, `SERIES_TELEGRAM_CHAT_ID` | сповіщення оператору від імені Series Lab |
| `GREMLIN_API_KEY`, `TMA_API_KEY`, `W3IR_B2B_KEYS` | ключі партнерів (Passport, Telegram), опційно |
| `OPENAI_API_KEY`, `REPLICATE_API_TOKEN`, `STABILITY_API_KEY`, … | рушії студії |
| `WELCOME_*`, `EARLY_WELCOME_*`, `GENERATION_RATE_LIMIT_PER_MINUTE`, `FREEMIUM_DAILY_LIMIT`, `REFERRAL_BONUS_CREDITS` | правила кредитів |
| `ADMIN_WALLETS`, `TEAM_WALLETS`, `OPERATOR_WALLET`, `DOGFOOD_WALLETS` | адміни й внутрішні гаманці. `ADMIN_WALLETS` і `TEAM_WALLETS` не задані — типові адреси; заданий список замінює типові (порожній `ADMIN_WALLETS=` прибирає адмінів). `OPERATOR_WALLET` і `DOGFOOD_WALLETS` лише додають внутрішні |
| `SOLANA_RPC_URL`/`ALCHEMY_API_KEY`, `GENESIS_*`, `VAULT_*` | холдери Genesis і NFT-сейф |

Додатково: `SERIES_MODE=public` (уже в образі), `SERIES_SPEND_CAP_USD` (запобіжник на весь сервер), `SERIES_ALLOWED_HOSTS` (обов'язково, бо образ слухає `0.0.0.0` і без списку не перевіряє `Host`), `LANDING_HOSTS`, `VISION_CREDIT_COST`, `ENGINE_CREDIT_COSTS` (за потреби). Staging пише `SERIES_ALLOWED_HOSTS=next.w3ir.io`.

## Бекап

`deploy/series-lab/backup.sh` знімає узгоджену копію **лише даних Lab**: `users.db` (SQLite online backup, потім `PRAGMA integrity_check`), `data-next/users/` (дані гаманців) і `genesis_mints.json` / `vault_catalog.json`. Ротація: 7 щоденних і 4 щотижневі в `/opt/series-lab/backups/`. `phase3.sh` ставить cron на 03:15 UTC. Локально те саме робить `npm run backup` ([GUIDE.md](./GUIDE.md#бекап)).

Копії лежать на тому ж диску, що й жива база. Вивантаження назовні вмикається в `/opt/series-lab/backup.env`:

```bash
BACKUP_RCLONE_REMOTE=offsite:series-lab-backups
BACKUP_PASSPHRASE=...
```

Без парольної фрази скрипт відмовляється відправляти архів. Відновлення: `openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE -in users-YYYYMMDD-HHMM.tar.gz.enc | tar -xz`, потім відкрити `users.db` і перевірити `PRAGMA integrity_check`.

## Staging на `next.w3ir.io`

Усе робить один скрипт — з ПК, з кореня репозиторію:

```bash
bash deploy/series-lab/upload.sh            # root@HOST_IP за замовчуванням
# з власними секретами (передаються по ssh один раз і ставляться як lab.env):
LAB_ENV_FILE=./.env SERIES_ALLOWED_WALLETS=0x…,So1… bash deploy/series-lab/upload.sh
```

Він завантажує поточний коміт і запускає на сервері `deploy/series-lab/phase3.sh`, який:

1. розпаковує код у **`/opt/series-lab`**;
2. збирає образ `series-lab:<коміт>`;
3. створює **власну порожню** теку даних `data-next` (леджер Lab створює сам при першому запуску; жодного копіювання чужих даних);
4. будує `.env.series-lab` із **власного** `lab.env` + перевизначення для staging: без прийому оплат (`SOLANA_PAY_RECIPIENT` порожній), без Telegram, без сейфу, SIWE-домен `next.w3ir.io`, **вхід лише для `ADMIN_WALLETS`** (або `SERIES_ALLOWED_WALLETS=…`), межа витрат $5/день. Якщо `lab.env` немає, скрипт створює його з `.env.example` і зупиняється, щоб ви заповнили секрети;
5. запускає контейнер `serieslab` (ліміт пам'яті 512 МБ);
6. додає блок `next.w3ir.io` у reverse-proxy (`Caddyfile.staging`), перевіряє конфіг і перезавантажує Caddy; якщо перевірка не пройшла — повертає попередній Caddyfile. `SKIP_CADDY=1` лише друкує блок;
7. ставить власний бекап (cron);
8. перевіряє `next` через proxy (і, за бажанням, `SMOKE_OTHER=host/path` для іншого сайту за тим самим proxy).

Повторний запуск оновлює образ і конфіг; **дані не чіпає**. Відкат: `ssh root@HOST_IP bash /tmp/series-lab-phase3-rollback.sh` (зупиняє контейнер і повертає Caddyfile; `PURGE=1` — ще й видаляє `/opt/series-lab`). Чистий аркуш (порожній леджер, свій `lab.env`): `CONFIRM=yes bash /tmp/series-lab-reset-staging.sh` — торкається лише `/opt/series-lab`.

Після скрипту — DNS: запис `next` → IP сервера (proxied) у зоні `w3ir.io`.

Перевірка: 2–3 запрошені користувачі (їхні гаманці в `SERIES_ALLOWED_WALLETS`) проходять звичний сценарій на `next.w3ir.io/login`. Оплати на staging вимкнені, кредити там тестові.

## Власний домен

Series Lab не перебирає чужі хости: для власного домену додайте до proxy блок за зразком `Caddyfile.staging`, задайте `SERIES_ALLOWED_HOSTS`, `AUTH_DOMAIN`, `AUTH_URI` і (для прийому оплат) `SOLANA_PAY_RECIPIENT` у `lab.env`. Перед відкриттям — `npm run backup` / `backup.sh` і перевірка: `/health`, вхід, тестовий переказ USDC (Solana), одна зі сторінок `/c/<slug>`.

## Користувач контейнера

Образ працює не від root, а як користувач `node` (**uid/gid 1000**). Леджер, `users/` і `render-log.jsonl` пишуться в том `/data` (на хості — `data-next` або `SERIES_LAB_DATA`).

Порожній каталог, який створює Docker, наслідує власника з образу. Каталог, який раніше наповнював root, процес у контейнері не зможе оновити.

Один раз на сервері, до перезапуску нового образу:

```bash
sudo chown -R 1000:1000 /opt/series-lab/data-next
```

`phase3.sh` робить цей `chown` сам після `chown` дерева на користувача хоста. Якщо дані лежать в іншій теці — та сама команда на неї. Опційний `/opt/sugar` змонтовано лише для читання: каталог має бути читабельним для uid 1000 (типово `755`).

## Відомі обмеження

**NFT-сейф.** Вебхук Helio, який запускав видачу NFT, прибрано, тож `src/platform/vault.mjs` і таблиця `nft_fulfillments` не мають тригера. Окрім того, `vault_token_mints` приймає відповідь RPC лише у вигляді списку, а стандартний `getTokenAccountsByOwner` повертає `{context, value: [...]}` — перевірка сейфу відхилятиме реальні відповіді (fail-closed). Якщо сейф знадобиться, це виправлення в одному рядку; рішення за вами.
