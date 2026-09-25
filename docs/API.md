# Series Lab · HTTP API

Джерело істини: `server/index.mjs`. Сервер: `127.0.0.1:5344`. UI: `/studio/`.  
Статика: `/input/…`, `/out/…`. Ключі з `.env` **не** повертаються клієнту.

Усі JSON-відповіді — `application/json`, якщо не зазначено інакше.

## Health / resources

| Method | Path | Опис |
|--------|------|------|
| GET | `/api/health` | ok, product, port, base status, keysFile path, engines |
| GET | `/api/resources` | наявність ключів (presence only) |

## Presets / templates / trait packs

| Method | Path | Опис |
|--------|------|------|
| GET | `/api/presets` | список пресетів |
| GET | `/api/preset?file=` | повний пресет |
| POST | `/api/validate` | body `{ file }` або `{ preset }` |
| POST | `/api/preset/save` | записати `presets/<id>.json` |
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
| POST | `/api/generate` | live generate: batch з архіву або single prompt; SSE стрім + паралелізм (`concurrency`), `mode: "redo"` |

Режими відбору (`mode` / `selection`): `pilot` · `only` · `first` · `missing` · `redo`.  
`force: true` — перезаписати наявні файли в сеті. Потрібна головна базова. Lint блокує 400.

## Review (sets / marks / triage)

| Method | Path | Опис |
|--------|------|------|
| GET | `/api/sets` | список наборів у `out/` |
| GET | `/api/set?dir=` | зображення сету + marks + light QA |
| GET | `/api/marks?dir=` | keep/redo marks |
| POST | `/api/marks` | оновити marks (`dir` + `edition`/`mark` або `marks`) |
| POST | `/api/qa/triage` | AI Auto-Triage & Smart Critic (`dir`, `mode`, `provider`, `autoApplyMarks`) |

## Export / checklist / workspace / storage

| Method | Path | Опис |
|--------|------|------|
| GET | `/api/export/csv?file=` | CSV промптів |
| GET | `/api/export/txt?file=` | TXT промптів |
| POST | `/api/export/bundle` | mint-ready ZIP → `out/bundles/` (ERC-721, Metaplex, Ordinals; опційно `imageUriPrefix`) |
| POST | `/api/export/preview-meta` | генерація попереднього перегляду метаданих `1.json` |
| GET | `/api/checklist` | `?archive=&set=` — NFT readiness items |
| GET | `/api/workspace` | прочитати `workspace/current.json` |
| POST | `/api/workspace` | зберегти / `clear` workspace |
| GET | `/api/storage/status` | статус ключів децентралізованого зберігання (Pinata) |
| POST | `/api/storage/pin` | завантаження набору зображень у Pinata IPFS |
| GET | `/api/launchpads` | список підтримуваних профілів лаунчпадів (OpenSea, Magic Eden, LaunchMyNFT, Ordinals) |
| GET | `/api/export/manifest.csv` | експорт CSV маніфесту для гуртового імпорту (`?archive=&profile=&zeroIndexed=`) |
| GET | `/api/export/showcase.html` | завантаження автономного HTML візуального пруфу та оцінки рідкості |
| GET | `/api/release/portals` | отримання посилань на лаунчпади та покрокових порад (`?profile=&archive=`) |
| GET | `/api/release/config` | завантаження конфігів деплою (`sugar.json` / `thirdweb.json`) |

## Versions / trash / spend (захист оплачених рендерів)

| Method | Path | Опис |
|--------|------|------|
| GET | `/api/versions?dir=&edition=` | історія версій картинки: `out/<set>/versions/<N>/` |
| POST | `/api/versions/current` | `{ dir, edition, v }` — зробити версію поточною (`<N>.png`) |
| POST | `/api/versions/drop` | `{ dir, edition, v }` — непоточну версію в кошик |
| GET | `/api/trash` | записи кошика `out/trash/<id>/` (новіші першими) |
| POST | `/api/trash/restore` | `{ id }` — повернути файли на місце (відмова, якщо ціль уже існує) |
| POST | `/api/trash/purge` | `{ id }` — видалити запис назавжди |
| GET | `/api/spend` | `{ capUsd, spentTodayUsd, byEngine }` з `out/render-log.jsonl` |

Перегенерація (`force`) і `series render` більше не перезаписують `<N>.png`: попередня картинка переходить у `versions/`.
Видалення базових картинок, паків трейтів, перезапис пілотів і primary — через кошик.
Платні виклики пишуться в `out/render-log.jsonl`; `SERIES_SPEND_CAP_USD` блокує запуск понад денну межу (400, `code: "spend_cap"`).
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
| GET | `/api/admin/economy?days=` | `7` \| `30` \| `all` — маржа, накладні, сценарії (адмін) |
| POST | `/api/notifications/test` | тест Telegram (адмін) |

## Статика

| Path | Опис |
|------|------|
| `/studio/…` | UI (`server/ui/`) |
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
- `release-config <archive.json> [options]` — експорт конфігурацій деплою (`sugar.json`, `thirdweb.json`)
- `render <preset.json> [options]` — автономний пакетний рендер
- `triage <set-dir> [options]` — автоматичний аудит та оцінка якості зображень
- `pin <set-dir> [options]` — завантаження зображень у IPFS / Pinata

Див.: [STUDIO-UI.md](./STUDIO-UI.md) · [EXPORT.md](./EXPORT.md) · [STAGES.md](./STAGES.md) · [ECONOMY.md](./ECONOMY.md)
