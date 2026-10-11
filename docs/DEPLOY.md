# Публічний сайт: Cloudflare Pages

Публічна частина Series Lab — **статичний сайт** (лендінг, посібник і сторінки для автора українською та англійською). На цьому сайті немає API майстерні, ключів і генерації. Це зібрані HTML-файли (`scripts/build-site.mjs` → `dist/site`), не процес `server/index.mjs`.

На ПК майстерня слухає `127.0.0.1:5344`. Той самий процес можна поставити на хост — це [HOSTING.md](./HOSTING.md), не цей домен.

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
| `/` · `/en/` | Лендінг: що таке Series Lab, 7 етапів (вкладки студії 1–7; «8 · Деплой» і «9 · Маркет» названо на сторінках посібника й вкладок), посилання на сторінки для автора, страховка, безкоштовний режим, запуск (Node.js 22.13+) |
| `/guide/` · `/en/guide/` | Посібник для початківців (ті самі тексти, що й вкладка «❓ Довідка», включно з Деплоєм і Маркетом) |
| `/docs/` · `/en/docs/` | Зміст сторінок для автора. Звідси видно, що запуск — на головній, а README лишається в репозиторії |
| `/stages/` · `/en/stages/` | Етапи дропу: вкладки 1–7, шари PNG, далі деплой, `series mint`, `series reveal` і маркет |
| `/tabs/` · `/en/tabs/` | Короткий гід вкладками, без переліку кожної кнопки; генерація згадує «Скласти шари», деплой — той самий порядок команд |
| `/base/` · `/en/base/` | Базова картинка серії, Vision Assist і нижній шар «Скласти шари» |
| `/traits/` · `/en/traits/` | Паки рис, редактор опцій і файли `layers/<риса>/<значення>.png` |
| `/export/` · `/en/export/` | ZIP, мережа, Arweave через Irys, список дозволених, `series mint` і `series reveal` зі свого ключа |
| `/preset/` · `/en/preset/` | Короткий довідник файлу пресету, не повна схема. Мінт і розкриття — у `release.json`, не тут |
| `/terms/` · `/privacy/` (і `/en/…`) | Умови і Політика конфіденційності (бета-версія від 05.10.2026) з `docs/legal/published/`; посилання у футері. Збираються лише коли є обидві мови і немає `[плейсхолдерів]`; на сервері майстерні `/legal` переспрямовує сюди. Інструкція: [legal/published/README.md](./legal/published/README.md) |
| `/404.html` | Сторінка «не знайдено» |
| `/_headers` | Заголовки безпеки: CSP без скриптів, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` |
| `/robots.txt`, `/sitemap.xml` | Індексація |

Посібник береться з `server/ui/locales/uk.js` і `en.js`, тож сайт, довідка в застосунку та [GUIDE.md](./GUIDE.md) не розходяться. Решта сторінок для автора збирається з `scripts/site-pages.mjs`: це скорочений переказ [STAGES.md](./STAGES.md), [STUDIO-UI.md](./STUDIO-UI.md), [BASE.md](./BASE.md), [TRAITS.md](./TRAITS.md), [EXPORT.md](./EXPORT.md) і короткий уривок [PRESET.md](./PRESET.md), тим самим шляхом, що й довідка: пресет, шари, список дозволених, завантаження, приховані метадані, guards, машина, verify, `series mint`, `series reveal`. [API.md](./API.md) і історія хвиль з [ROADMAP.md](./ROADMAP.md) на сайт не виводяться.

Ті самі сторінки віддає локальна майстерня, без деплою цього сайту: `http://127.0.0.1:5344/studio/docs/` і `http://127.0.0.1:5344/studio/docs/en/`. Вкладка «❓ Довідка» веде на них (мова — як у майстерні). Щоб їх читати, Cloudflare не потрібен.

## Оновити сайт

**Автоматично (основний спосіб).** Workflow `.github/workflows/deploy-site.yml` запускається при push у `main`, якщо змінились тексти (`server/ui/locales/**`), `scripts/build-site.mjs`, `scripts/site-pages.mjs`, `package.json` або сам workflow. Він збирає `dist/site`, перевіряє, що всі сторінки на місці, і викладає сайт у проєкт `series-lab` через `wrangler pages deploy`. Запустити вручну: GitHub → Actions → **Deploy site** → *Run workflow*.

**Пошта на сторінках.** Cloudflare Email Address Obfuscation замінює адреси на «[email protected]», а CSP сайту не дозволяє скрипт розшифрування. Тому `richText` (`scripts/inline-md.mjs`) обгортає адреси й `mailto:` у `<!--email_off-->`; налаштування в панелі Cloudflare міняти не потрібно.

Налаштування репозиторію (GitHub → Settings → Secrets and variables → Actions):

| Назва | Тип | Значення |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Secret | API-токен Cloudflare з правом **Account · Cloudflare Pages · Edit** (лише на цей акаунт) |
| `CLOUDFLARE_ACCOUNT_ID` | Variable | ID акаунта Cloudflare |

Без секрету workflow лише збирає сайт і попереджає, що деплою не було.

**Вручну** (якщо GitHub недоступний):

```bash
npm run build:site          # → dist/site/
npx wrangler pages deploy dist/site --project-name series-lab --branch main
```

або в дашборді: Workers & Pages → `series-lab` → **Create deployment** → завантажити вміст `dist/site/`.

## Моніторинг

`.github/workflows/health.yml` кожні ~15 хв ззовні (з GitHub, не з VPS: якщо ляже хост, його cron і алерти лягають разом із ним) перевіряє `lab.w3ir.io/health`, `gen.w3ir.io/health`, `studio.w3ir.io` (`/`, `/en/`, `/guide/` дають `200`, неіснуючий шлях `404`) і наявність заголовків CSP, `X-Frame-Options: DENY`, `nosniff`. Червоний запуск і лист від GitHub є сигналом. Розклад GitHub не точний (затримки до десятків хвилин) і вимикається після 60 днів без активності в репозиторії; для хвилинної каденції додайте зовнішній монітор (наприклад, UptimeRobot) на ті самі адреси.

Кожен деплой зберігається в історії проєкту; попередню версію можна повернути кнопкою **Rollback** на вкладці Deployments.

## Перевірка після деплою

```bash
curl -sI https://studio.w3ir.io/ | grep -iE "content-security|x-frame"
```

Має повернути `200`, заголовки CSP і `x-frame-options: DENY`. Те саме для `/en/`, `/guide/`, `/en/guide/`, `/docs/`, `/stages/`, `/tabs/`, `/base/`, `/traits/`, `/export/`, `/preset/` і їхніх `/en/…` двійників. Неіснуючий шлях — `404`.

## Чого тут свідомо немає

- **Процесу майстерні.** Pages не стає студією. Вхід гаманцем, кредити і генерація — у `server/index.mjs`. Як його поставити на хост, що задати і що лишається на ПК (ключ творця, `series mint`, `series reveal`) — [HOSTING.md](./HOSTING.md). Цей сайт на те ім'я не перемикати.
- **Довідника розробника.** `docs/API.md` і історія хвиль із `docs/ROADMAP.md` лишаються в репозиторії. На сайті — лише те, що потрібно автору дропу.
- **Git-інтеграції Cloudflare Pages.** Проєкт створено як Direct Upload, тому деплой іде з GitHub Actions через `wrangler`, а не через вбудоване підключення репозиторію.
