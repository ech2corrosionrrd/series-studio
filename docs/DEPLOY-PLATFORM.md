# Розгортання платформи: Series Lab замість Промт (Ф3–Ф5)

Інструкція до фаз Ф3–Ф5 з [MIGRATION.md](./MIGRATION.md). Код Ф1–Ф2 готовий і протестований; ці кроки виконуються **на проді Hetzner** (`HOST_IP`, `/opt/w3ir`) і потребують вашого рішення на кожному етапі.

## Що вже перевірено локально

- `npm test` — 183 тести, з них 28 платформні: побайтна рівність із Промт (сесійні токени, реферальні коди, промпти Passport/TMA, модерація з кирилицею, юридичні сторінки, тарифи, розбір Helio) і наскрізний сценарій сервера в публічному режимі.
- `node scripts/contract-check.mjs --old https://gen.w3ir.io --new http://127.0.0.1:5344` — 10 з 10 безпечних GET-контрактів збігаються з живим Промт.

## Змінні середовища

Файл `/opt/w3ir/.env.series-lab`. **Скопіюйте значення з `/opt/w3ir/.env` Промт — імена ті самі.** Обов'язково збігаються:

| Змінна | Чому має збігатися з Промт |
|---|---|
| `AUTH_SESSION_SECRET` | тоді користувачі лишаються залогіненими після перемикання, а реферальні коди не змінюються |
| `AUTH_DOMAIN`, `AUTH_URI`, `AUTH_CHAIN_ID` | текст SIWE-повідомлення |
| `HELIO_*` | paylinks → пакети, підпис вебхука, звіряння |
| `GREMLIN_API_KEY`, `TMA_API_KEY`, `W3IR_B2B_KEYS` | ключі партнерів (Passport, Telegram) |
| `OPENAI_API_KEY`, `REPLICATE_API_TOKEN`, `STABILITY_API_KEY` | рушії для API партнерів і студії |
| `WELCOME_*`, `EARLY_WELCOME_*`, `GENERATION_RATE_LIMIT_PER_MINUTE`, `FREEMIUM_DAILY_LIMIT`, `REFERRAL_BONUS_CREDITS` | ті самі правила кредитів |
| `ADMIN_WALLETS`, `OPERATOR_WALLET`, `DOGFOOD_WALLETS` | внутрішні гаманці для воронки й доступ до службових екранів |
| `SOLANA_RPC_URL`/`ALCHEMY_API_KEY`, `GENESIS_*`, `VAULT_*`, `HELIO_MINT_PAYLINK_ID` | холдери Genesis і Дроп #2 |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | сповіщення оператору |

Додатково для Series Lab: `SERIES_MODE=public` (уже в образі), `SERIES_SPEND_CAP_USD` (запобіжник на весь сервер), `LANDING_HOSTS`, `PAY_SUBDOMAIN_HOSTS`, `VISION_CREDIT_COST`, `ENGINE_CREDIT_COSTS` (за потреби).

## Ф3 · Паралельний запуск на `next.w3ir.io`

Прод-хости й далі обслуговує Промт.

```bash
# на ПК
docker build -t series-lab:$(git rev-parse --short HEAD) .
docker save series-lab:<tag> | ssh root@HOST_IP docker load

# на сервері
cd /opt/w3ir
mkdir -p data-next && cp -a data/users.db data/genesis_mints.json data/vault_catalog.json data-next/ && cp -a data/public data-next/ 2>/dev/null
cp .env .env.series-lab            # потім дописати специфічне для Series Lab
# додати сервіс із deploy/series-lab/docker-compose.yml (SERIES_LAB_IMAGE=series-lab:<tag>, SERIES_LAB_DATA=data-next)
# додати блок із deploy/series-lab/Caddyfile.parallel у Caddyfile
docker compose up -d serieslab && docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
```

DNS: запис `next` → `HOST_IP` (proxied) у зоні `w3ir.io`.

Перевірка:

```bash
node scripts/contract-check.mjs --old https://gen.w3ir.io --new https://next.w3ir.io \
  --gremlin-key "$GREMLIN_API_KEY" --tma-key "$TMA_API_KEY"
```

Далі — 2–3 справжні користувачі проходять звичний сценарій на `next.w3ir.io/login`. Кредити в `data-next` — копія, **не справжні**; оплати Helio туди не надходять.

## Ф4 · Перемикання

1. Попередити користувачів з балансом (див. MIGRATION.md §5).
2. Зупинити запис у Промт: `docker compose stop streamlit api`.
3. Фінальна копія: `cp -a data data.backup-$(date +%F-%H%M)`.
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
| Адмін-панель (економіка, дайджест) | Streamlit | ще немає — воронка доступна в коді (`src/platform/stats.mjs`) |
| Сейф Дропу #2 | див. нижче | повторює поведінку Промт |

⚠️ **Знайдена прихована помилка Промт.** `vault_registry.vault_token_mints` приймає відповідь RPC лише у вигляді списку, а стандартний `getTokenAccountsByOwner` повертає `{context, value: [...]}`. Зараз це не проявляється: на проді сейф не налаштований (`/api/vault/status` → 500 «VAULT_WALLET_ADDRESS is not configured», перевірено 24.09.2026), тобто Дроп #2 вимкнений. Але якщо його ввімкнути, перевірка сейфу відхилятиме всі реальні відповіді й трансфери не пройдуть. Series Lab навмисно повторює поведінку Промт (fail-closed); виправлення — один рядок у `src/platform/vault.mjs`, рішення за вами.
