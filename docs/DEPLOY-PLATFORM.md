# Розгортання платформи: Series Lab замість Промт (Ф3–Ф5)

> **Команда власника.** Ядро 1.5.0 закрито в репо; кроки нижче **не** запускати
> автоматично. Staging / Ф4 — лише коли власник відкриє хостинг
> ([HOSTING.md](./HOSTING.md)).

Інструкція до фаз Ф3–Ф5 з [MIGRATION.md](./MIGRATION.md). Код Ф1–Ф2 готовий і протестований; ці кроки виконуються **на проді Hetzner** (`2.28.7.128`, `/opt/w3ir`) і потребують вашого рішення на кожному етапі.

## Що вже перевірено локально

- `npm test` — 183 тести, з них 28 платформні: побайтна рівність із Промт (сесійні токени, реферальні коди, промпти Passport/TMA, модерація з кирилицею, юридичні сторінки, тарифи, розбір Helio) і наскрізний сценарій сервера в публічному режимі.
- `node scripts/contract-check.mjs --old https://gen.w3ir.io --new http://127.0.0.1:5344` — 10 з 10 безпечних GET-контрактів збігаються з живим Промт.

## Змінні середовища

Файл Lab: локально `.env`, на проді `/opt/w3ir/.env.series-lab` (або `/opt/series-lab/.env`). **Series Lab самодостатній** — усі ключі й Helio-посилання живуть у його `.env`; `SERIES_PLATFORM_ENV` більше не підмішує чужий файл.

Імена змінних сумісні з колишнім Промт (зручно один раз скопіювати значення), але це **копія в .env Lab**, не live-залежність:

| Змінна | Призначення в Lab |
|---|---|
| `AUTH_SESSION_SECRET` | сесії SIWE / реферальні коди Lab |
| `AUTH_DOMAIN`, `AUTH_URI`, `AUTH_CHAIN_ID` | текст SIWE-повідомлення |
| `HELIO_*` | paylinks Lab → пакети, підпис вебхука, звіряння |
| `SERIES_TELEGRAM_BOT_TOKEN`, `SERIES_TELEGRAM_CHAT_ID` | сповіщення оператору від імені Series Lab |
| `GREMLIN_API_KEY`, `TMA_API_KEY`, `W3IR_B2B_KEYS` | ключі партнерів (Passport, Telegram) |
| `OPENAI_API_KEY`, `REPLICATE_API_TOKEN`, `STABILITY_API_KEY`, … | рушії студії |
| `WELCOME_*`, `EARLY_WELCOME_*`, `GENERATION_RATE_LIMIT_PER_MINUTE`, `FREEMIUM_DAILY_LIMIT`, `REFERRAL_BONUS_CREDITS` | правила кредитів |
| `ADMIN_WALLETS`, `OPERATOR_WALLET`, `DOGFOOD_WALLETS` | внутрішні гаманці / адмін |
| `SOLANA_RPC_URL`/`ALCHEMY_API_KEY`, `GENESIS_*`, `VAULT_*`, `HELIO_MINT_PAYLINK_ID` | холдери Genesis і Дроп #2 |

Додатково для Series Lab: `SERIES_MODE=public` (уже в образі), `SERIES_SPEND_CAP_USD` (запобіжник на весь сервер), `SERIES_ALLOWED_HOSTS` (обов'язково, бо образ слухає `0.0.0.0` і без списку не перевіряє `Host`), `LANDING_HOSTS`, `PAY_SUBDOMAIN_HOSTS`, `VISION_CREDIT_COST`, `ENGINE_CREDIT_COSTS` (за потреби).

Staging (`phase3.sh`) пише `SERIES_ALLOWED_HOSTS=next.w3ir.io`. Після Ф4 список має містити `w3ir.io,www.w3ir.io,ai.w3ir.io,gen.w3ir.io,pay.w3ir.io,next.w3ir.io` — те саме за замовчуванням у `deploy/series-lab/docker-compose.yml`.

## Бекап леджера

`deploy/series-lab/backup.sh` знімає узгоджену копію `users.db` (SQLite online backup, потім `PRAGMA integrity_check`): бойову базу Промт, поки контейнер `nft-builder-api` живий, і копію Series Lab, поки живий `serieslab`. Поруч кладе `genesis_mints.json` і `vault_catalog.json`. Ротація: 7 щоденних і 4 щотижневі в `/opt/series-lab/backups/`. `phase3.sh` ставить cron на 03:15 UTC.

Ці копії лежать на тому ж диску, що й жива база. Вивантаження назовні вмикається в `/opt/series-lab/backup.env`:

```bash
BACKUP_RCLONE_REMOTE=offsite:nft-builder-backups
BACKUP_PASSPHRASE=...
```

Без парольної фрази скрипт відмовляється відправляти архів. Відновлення копії: `openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE -in users-YYYYMMDD-HHMM.tar.gz.enc | tar -xz`, потім відкрити `users.db` і перевірити `PRAGMA integrity_check`.

## Ф3 · Паралельний запуск на `next.w3ir.io`

> **Стан на 24.09.2026: запущено.** `upload.sh` виконано (ревізія `058697f`): контейнер `serieslab` здоровий, `data-next` = 294 МБ копії Промт, Caddy перевірено й перезавантажено, DNS `next` додано. Блок Caddy закомічено в репозиторій Промт (PR #48, `2f64492`) і пережив деплой Промт. Хости Промт відповідають як раніше.

Прод-хости й далі обслуговує Промт. Усе робить один скрипт — з ПК, з кореня репозиторію:

```bash
bash deploy/series-lab/upload.sh            # root@2.28.7.128 за замовчуванням
```

Він завантажує поточний коміт і запускає на сервері `deploy/series-lab/phase3.sh`, який:

1. розпаковує код у **`/opt/series-lab`** — не в `/opt/w3ir`, бо деплой Промт робить `git clean -fd` і стер би все нове;
2. збирає образ `series-lab:<коміт>`;
3. робить **узгоджену** копію бази через SQLite online backup (не `cp`, бо WAL) + `genesis_mints.json`, `vault_catalog.json`, `public/` → `/opt/series-lab/data-next`;
4. пише `.env.series-lab` = `.env` Промт + перевизначення для staging: без звіряння Helio й вебхука, без Telegram, без сейфу, SIWE-домен `next.w3ir.io`, **вхід лише для `ADMIN_WALLETS`** (або `SERIES_ALLOWED_WALLETS=…`), межа витрат $5/день — бо копія кредитів витрачає справжні API-ключі;
5. запускає контейнер `serieslab` у мережі `w3ir_default` (ліміт пам'яті 512 МБ);
6. додає блок `next.w3ir.io` у Caddyfile Промт, перевіряє конфіг і перезавантажує Caddy; якщо перевірка не пройшла — повертає попередній Caddyfile;
7. перевіряє `next` через Caddy і що `ai.w3ir.io` Промт відповідає як раніше.

Повторний запуск оновлює образ і конфіг; дані перекопіюються лише з `REFRESH_DATA=1`. Відкат: `ssh root@2.28.7.128 bash /tmp/series-lab-phase3-rollback.sh` (зупиняє контейнер і повертає Caddyfile; `PURGE=1` — ще й видаляє `/opt/series-lab`).

Блок Caddy `next.w3ir.io` є в `main` Промт (`2f64492`), тож деплой Промт його більше не стирає. Той самий текст лежить у `deploy/series-lab/Caddyfile.parallel`.

Після скрипту — DNS: запис `next` → `2.28.7.128` (proxied) у зоні `w3ir.io`. Сертифікат Cloudflare Origin на сервері вже покриває `*.w3ir.io`.

Перевірка:

```bash
node scripts/contract-check.mjs --old https://gen.w3ir.io --new https://next.w3ir.io   --gremlin-key "$GREMLIN_API_KEY" --tma-key "$TMA_API_KEY"
```

Далі — 2–3 справжні користувачі (їхні гаманці в `SERIES_ALLOWED_WALLETS`) проходять звичний сценарій на `next.w3ir.io/login`. Кредити в `data-next` — копія, **не справжні**; оплати туди не надходять.

## Ф4 · Перемикання

1. Попередити користувачів з балансом (див. MIGRATION.md §5).
2. Зупинити запис у Промт: `docker compose stop streamlit api`.
3. Фінальна копія леджера: `bash /opt/series-lab/backup.sh` (online backup, не `cp` поверх WAL).
4. Series Lab на бойові дані: `SERIES_LAB_DATA=data`, `docker compose up -d serieslab`.
5. Caddyfile: блоки хостів замінити на `deploy/series-lab/Caddyfile.switch`, `caddy reload`.
6. Перевірити: `/health` на `pay.`; вхід на `ai.`; тестова оплата Helio; Passport (`/gremlin/activity`); Telegram (`/api/v1/tma/contract`); одна з `/c/<slug>`; воронка (`funnel_events` пишеться).

**Відкат:** повернути попередній Caddyfile, `docker compose start api streamlit`, `caddy reload`. Схема БД спільна, тож записи Series Lab Промт читає без перетворень.

## Ф5 · Архів Промт (через 14 днів без відкату)

- Прибрати сервіси `api` і `streamlit` з compose; фінальний бекап `data/`.
- Задачу `W3IR-Offsite-Pull` на ПК перевести на ту саму `data/users.db` (шлях не змінюється — Series Lab пише в неї).
- GitHub: репозиторій Промт → Settings → Archive; у README банер «Архів, наступник — Series Lab».
- Оновити `ПОВ'ЯЗАНІ_ПРОЄКТИ.md`, документацію Passport і w3ir-tma.

## Відомі відмінності від Промт

| Що | Промт | Series Lab |
|---|---|---|
| Вітальні кредити | нараховуються при першому відкритті Streamlit після входу | одразу після перевірки підпису (`/auth/verify`) — ті самі правила й леджер |
| Помилка валідації тіла TMA | 422 зі списком помилок pydantic | 422 з текстом помилки |
| Робочі проєкти Streamlit (`data/workspace/<wallet>`) | є | не переносяться: у Series Lab інша модель (пресет → рецепти → набори); баланси й історія кредитів переносяться повністю |
| Адмін-панель (економіка, дайджест) | Streamlit | **Адмін → Економіка** (`GET /api/admin/economy`, `src/platform/margin.mjs`); воронка — `stats.mjs`. Див. [ECONOMY.md](./ECONOMY.md) |
| Сейф Дропу #2 | див. нижче | повторює поведінку Промт |

⚠️ **Знайдена прихована помилка Промт.** `vault_registry.vault_token_mints` приймає відповідь RPC лише у вигляді списку, а стандартний `getTokenAccountsByOwner` повертає `{context, value: [...]}`. Зараз це не проявляється: на проді сейф не налаштований (`/api/vault/status` → 500 «VAULT_WALLET_ADDRESS is not configured», перевірено 24.09.2026), тобто Дроп #2 вимкнений. Але якщо його ввімкнути, перевірка сейфу відхилятиме всі реальні відповіді й трансфери не пройдуть. Series Lab навмисно повторює поведінку Промт (fail-closed); виправлення — один рядок у `src/platform/vault.mjs`, рішення за вами.
