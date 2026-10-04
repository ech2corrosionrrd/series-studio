# Шлях випуску: від архіву до перевіреного мінту

Алгоритм перенесено з `gremlin-nft` (рецепти → відбір → бандл → Arweave → deploy → guard → verify). Усі кроки нижче працюють **локально**: ключ гаманця лишається на вашому ПК, у Lab і на сервер не передається.

```
архів → release-init → [Експорт: набір деплою] → upload → deploy (Sugar / mplx) → guards → verify
```

## 1. `release.json` — одне джерело правди
`series release-init out/archive.json -o release.json --creator <адреса> --price 0.2`

Поля: `name`, `symbol`, `size`, `sellerFeeBasisPoints`, `creators` (частки = 100), `priceSol`, `standard` (`core` або `v3`), `reserve.count` (резерв команди, не йде в публічний продаж), `mint.startDate` (UTC), `mint.limitPerWallet`, `deployed` (адреси після деплою). Адреса-заглушка не проходить перевірку.

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
`series guards release.json -o guard-config.json` → Sugar-конфіг для `sugar guard update`. ⚠ `guard update` **замінює весь набір правил**, тому оплата (`solPayment`) входить завжди, а без коректної ціни й творця файл не створюється.

## 5. Перевірка з блокчейну
`series verify release.json [--rpc <url>]` лише читає: скільки змінтовано, хто керує правилами, чи збігаються ціна, дата і ліміт з `release.json`. Код виходу 1 при розбіжності. Розбирає **Candy Machine v3 / Sugar**; для Core — `mplx cm validate`.

## Серверна кнопка «Arweave» в Експорті
`POST /api/storage/pin` платить серверним `IRYS_PRIVATE_KEY` і списує кредити етапу «архів». Це швидкий шлях для префікса `ar://<id>/` (маніфест папки). Для випуску в мережу використовуйте `series upload`: він пише посилання у метадані й веде `cache.json`. Тримайте `IRYS_PRIVATE_KEY` окремим гаманцем із малим балансом.
