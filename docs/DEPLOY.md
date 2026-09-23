# Публічний сайт: Cloudflare Pages

Публічна частина Series Lab — **статичний сайт** (лендинг і посібник українською та англійською). Сама майстерня й далі працює лише на вашому ПК (`127.0.0.1`): на сайті немає API, ключів і генерації.

| | |
|---|---|
| **Прод** | https://studio.w3ir.io |
| **Резервна адреса** | https://series-lab.pages.dev |
| **Акаунт Cloudflare** | W3ir@proton.me · зона `w3ir.io` |
| **Проєкт** | Workers & Pages → `series-lab` (Direct Upload) |
| **DNS** | `studio` CNAME → `series-lab.pages.dev` (proxied), створений Cloudflare автоматично при підключенні домену |

## Сторінки

| Шлях | Зміст |
|---|---|
| `/` · `/en/` | Лендинг: що таке Series Lab, 7 етапів, страховка, безкоштовний режим, запуск |
| `/guide/` · `/en/guide/` | Повний посібник (ті самі тексти, що й вкладка «❓ Довідка») |
| `/404.html` | Сторінка «не знайдено» |
| `/_headers` | Заголовки безпеки: CSP без скриптів, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` |
| `/robots.txt`, `/sitemap.xml` | Індексація |

Тексти беруться з `server/ui/locales/uk.js` і `en.js`, тож сайт, довідка в застосунку та [GUIDE.md](./GUIDE.md) не розходяться.

## Оновити сайт

```bash
npm run build:site          # → dist/site/
```

Потім одним зі способів:

1. **Дашборд** (як зараз): Workers & Pages → `series-lab` → **Create deployment** → завантажити вміст `dist/site/` (теку або ZIP) → Deploy.
2. **Wrangler** (з терміналу): один раз `npx wrangler login`, далі
   ```bash
   npx wrangler pages deploy dist/site --project-name series-lab --branch main
   ```

Кожен деплой зберігається в історії проєкту; попередню версію можна повернути кнопкою **Rollback** на вкладці Deployments.

## Перевірка після деплою

```bash
curl -sI https://studio.w3ir.io/ | grep -iE "content-security|x-frame"
```

Має повернути `200`, заголовки CSP і `x-frame-options: DENY`; `/en/`, `/guide/`, `/en/guide/` — теж `200`, неіснуючий шлях — `404`.

## Чого тут свідомо немає

- **Майстерні через інтернет.** Щоб відкрити Studio ззовні, потрібні вхід (Cloudflare Access або власна авторизація) і обов'язкова денна межа витрат — інакше будь-хто витрачатиме ваші ключі. Це окремий крок (див. [ROADMAP.md](./ROADMAP.md)).
- **Автодеплою з Git.** Репозиторій приватний; підключення GitHub до Cloudflare Pages можна додати пізніше (build command `npm run build:site`, output `dist/site`).
