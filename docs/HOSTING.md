# Хостинг: після завершення розробки ядра (2026-09-25)

> **Статус.** Ядро Series Lab (хвилі 1–25) **закрито** у репозиторії. Розробка
> фіч майстерні на цьому циклі завершена; далі — стабілізація локально й за
> окремою командою власника — оновлення staging / Ф4.
>
> Цей файл **не** є автоматичним чеклістом деплою. Нічого на Hetzner / Caddy /
> доменах не робити, доки власник явно не відкриє тему хостингу.
>
> «Локально» = лише де стоїть процес (`127.0.0.1`). Продукт (вхід гаманцем,
> кредити, адмін) повний і на loopback. Кроки деплою — [DEPLOY-PLATFORM.md](./DEPLOY-PLATFORM.md).
> Лендінг сайту — [DEPLOY.md](./DEPLOY.md). План хвиль — [ROADMAP.md](./ROADMAP.md).

## Що вже є (факт)

| Шар | Де | Стан |
|-----|-----|------|
| Код майстерні + платформа | GitHub `series-studio` (`main`) | ✅ ядро 1.5.0 (хвилі 1–25) |
| CI | `.github/workflows/test.yml`, `health.yml`, `deploy-site.yml` | ✅ тести на PR/push; health staging; лендінг Pages |
| Лендінг | https://studio.w3ir.io (Cloudflare Pages) | ✅ статичний сайт |
| Staging платформи | https://next.w3ir.io (Hetzner, контейнер `serieslab`) | 🟡 Ф3; образ може **відставати** від `main` після циклу 1.5.0 |
| Бойові домени `w3ir.io` / `ai.` / `gen.` / `pay.` | Промт | ⏸ до Ф4 |
| Offsite-бекап леджера | `BACKUP_RCLONE_REMOTE` + passphrase | ⏸ доки не задані в `backup.env` |

## Після закінчення розробки — що робити (лише за командою)

1. **Зафіксувати `main` на GitHub** (цей реліз) і прогнати `npm test` локально.
2. **Не** перемикати бойові домени автоматично.
3. Коли власник відкриє хостинг:
   - оновити образ на `next.w3ir.io` з нового `main` (`deploy/series-lab/upload.sh` / phase3) **або** свідомий Ф4 за [DEPLOY-PLATFORM.md](./DEPLOY-PLATFORM.md);
   - перевірити `SERIES_ALLOWED_HOSTS`, бекап cron, запас RAM;
   - увімкнути offsite лише з `BACKUP_RCLONE_REMOTE` + `BACKUP_PASSPHRASE`.

## Рекомендації (коли відкриють хостинг)

### 1. Лендінг лишити на Cloudflare Pages

Статичний сайт, автодеплой з `main`, DNS у тій самій зоні.

### 2. Платформа — на VPS, не на serverless

- `users.db` — SQLite на диску;
- вебхуки Helio в той самий процес/БД;
- довгі генерації.

### 3. Перед Ф4 (перемикання доменів з Промт)

**а)** Caddy для `next.w3ir.io` уже в `main` Промт. Перед Ф4 — розділити блоки проєктів через `import` на сервері.

**б)** Бекап `users.db`: `deploy/series-lab/backup.sh` + cron через `install-backup.sh`. Offsite — лише з remote і парольною фразою.

**в)** Запас RAM на спільному CX22 (~3.8 ГБ): перед Ф4 — `free -m` / `docker stats` під генерацією.

### 4. Моніторинг

`health.yml` б’є `next.w3ir.io`, `gen.w3ir.io`, `studio.w3ir.io`. Окремий пейджер після Ф4 корисний для `ai.` і `pay.`.

### 5. Економіка на проді

Після Ф4 задайте в `.env` Lab lean-накладні й комісії (`HOSTING_MONTHLY_USD`, `SAAS_MONTHLY_USD`, `PAYMENT_FEE_PCT`, `FX_FEE_PCT`, `RESOURCE_FX_PCT`) — див. [ECONOMY.md](./ECONOMY.md). Адмін → Економіка читає живий `users.db`.

## Пов’язані файли

- [MIGRATION.md](./MIGRATION.md) — Ф3–Ф5  
- [DEPLOY-PLATFORM.md](./DEPLOY-PLATFORM.md) — операції на VPS  
- [DEPLOY.md](./DEPLOY.md) — Pages лендінг  
- [ECONOMY.md](./ECONOMY.md) — маржа, хостинг, crypto→USD  
- `C:\Gremlins\HOSTING.md` — картина всіх проєктів (поза цим репо)
