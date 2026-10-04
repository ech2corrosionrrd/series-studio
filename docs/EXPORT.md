# Export · Mint-Ready ZIP, Manifests, Showcase & Deploy Hub

Етап **7 · Експорт** у Series Lab забезпечує підготовку всіх необхідних файлів для релізу колекції на блокчейн-платформах.

Series Lab **не мінтить безпосередньо з сервера** (non-custodial): готовий пакет → ZIP → зовні портал лаунчпада / маркетплейс. У UI: **«Архів випуску»** (чекліст + ZIP лише з keep) і CTA **«Далі · портал запуску»**.

---

## 1. Структура Mint-Ready ZIP

При збиранні бандлу через `POST /api/export/bundle`, **«Архів випуску»** або **«Зібрати ZIP»** формується архів у `out/bundles/<preset>-<set>-<format>.zip`:

```
images/
  1.png              # Основна картинка / обкладинка (1, 2, 3...)
  1.mp4              # Відео / анімація (якщо присутня у наборі)
  2.png
  2.glb              # 3D модель (якщо присутня)
metadata/
  1.json             # Метадані відповідного стандарту (ERC-721 / Metaplex / Ordinals)
  2.json
manifest.csv         # Гуртовий CSV маніфест з усіма трейтами та посиланнями
cm-config.json       # Чернетка Core Candy Machine (Solana, типово)
sugar/config.json    # Застарілий Sugar, не для нової колекції
thirdweb.json        # Конфігурація для деплою ERC-721 Drop контракту (для OpenSea / EVM)
release-guide.txt    # Локалізована покрокова інструкція для запуску
collection.json      # Підсумок параметрів та складу бандлу
README.txt           # Загальний опис архіву
```

---

## 2. Підтримувані профілі лаунчпадів

| Профіль | Стандарт | Підтримка | Особливості |
|---------|----------|-----------|-------------|
| **`opensea`** | ERC-721 | Ethereum, Polygon, Base, Arbitrum | `display_type` для числових характеристик, гуртовий CSV імпорт, `thirdweb.json` |
| **`magiceden`** | Metaplex | Solana | Масив роялті `properties.creators`, `seller_fee_basis_points`, `cm-config.json` (Sugar лише в `sugar/`) |
| **`launchmynft`** | Metaplex | Solana | Підтримка 0-based індексації (`0.png`, `0.json`) |
| **`ordinalsbot`** | Ordinals | Bitcoin | Маніфести інскрипцій з прив'язкою `collection` та `edition` |

---

## 3. Динамічні медіа (Dynamic Media Pipeline)

Series Lab підтримує автоматичне виявлення та пакування динамічних медіафайлів поруч зі статичними обкладинками:
- **Відео / Анімації**: `.mp4`, `.webm`, `.mov`, `.gif`
- **3D Моделі**: `.glb`, `.gltf`
- **Інтерактивні додатки**: `.html`

У метаданих автоматично генерується поле `animation_url`, а для Metaplex виставляється відповідна категорія (`properties.category: "video" | "vr" | "html" | "image"`) та масив `properties.files` з точними MIME-типами.

---

## 4. Гуртовий CSV Маніфест (`manifest.csv`)

Для прямого імпорту в OpenSea Studio та інші портали створюється зведений CSV-файл:

- **Колонки**: `id,edition,name,description,image,animation_url,<trait_1>,<trait_2>,...`
- **Отримання через API**: `GET /api/export/manifest.csv?archive=<file>&profile=opensea&imageUriPrefix=ipfs://Qm.../`
- **Отримання через CLI**: `node bin/series.mjs manifest <archive.json> --profile opensea --image-prefix ipfs://Qm.../`

---

## 5. Standalone Showcase & Trait Rarity Scorecard (`showcase.html`)

Автономний інтерактивний вебдодаток (один HTML-файл без зовнішніх залежностей) для візуального аудиту та перевірки рідкості колекції:
- **Оцінка рідкості**: автоматичний підрахунок рідкості кожного трейту ($1/F$) та загального балу токена.
- **Ранжування**: присвоєння рангів від #1 до #N.
- **Рівні рідкості**: Mythic (Top 2%), Legendary (Top 10%), Epic (Top 25%), Rare (Top 50%), Common (Bottom 50%).
- **Інтерактивність**: живий пошук за номером/ДНК/трейтом, фільтрація за тієрами, темний дизайн з glassmorphism.
- **Отримання через API**: `GET /api/export/showcase.html?archive=<file>`
- **Отримання через CLI**: `node bin/series.mjs showcase <archive.json> -o out/showcase.html`

---

## 6. Децентралізоване зберігання (Arweave через Irys)

> Мережа спільна для вкладок Експорт, Набір деплою і Набір маркетплейсу: зміна профілю чи мережі на одній оновлює решту (Sugar лишається Sugar на Solana). Поля Експорту й підказки залежать від профілю. **Solana** (Magic Eden, LaunchMyNFT): префікс `ar://…`, кнопка Arweave, адреса Solana. **EVM** (OpenSea): префікс `ipfs://…` або `https://…`, кнопки Arweave немає. **Bitcoin Ordinals**: файли йдуть в інскрипцію, поля префіксів приховані й очищаються, роялті 0 (попереднє значення повертається при зміні профілю).

Вкладка Експорт підтримує 1-клік завантаження набору зображень в Arweave через Irys (потрібен `IRYS_PRIVATE_KEY` окремого гаманця з малим балансом і пакети `@irys/upload`, `@irys/upload-solana`):
- **API**: `POST /api/storage/pin` `{ dir: "set-dir", name: "my-series" }`
- **CLI**: `node bin/series.mjs pin out/set-dir --name my-series`
- Для випуску в мережу використовуйте `series upload` (ключ на ПК, відновлюване, `cache.json`): [RELEASE.md](./RELEASE.md).
- Отриманий ID маніфесту автоматично підставляється в поле `Image URI Prefix` (`ar://<id>/`), оновлюючи попередній перегляд метаданих у реальному часі.

---

## 7. Release & Deployment Hub

Спеціальний блок у вкладці Експорт надає:
- Прямі посилання на створення дропу в **OpenSea Studio**, **Magic Eden Creator Hub (лише Solana)**, **LaunchMyNFT**, **Thirdweb**, **OrdinalsBot**.
- Посилання на **Тестнет-портали** (Sepolia, Devnet).
- Кнопку завантаження конфігурацій деплою:
  - `cm-config.json` для Core Candy Machine (типово для Solana). `sugar.json` лише з `?legacy=1` і позначкою «застарілий».
  - `thirdweb.json` для деплою через Thirdweb. Пароль delayed reveal туди не входить.
- Покроковий інтерактивний чекліст підготовки до запуску.

---

## 7a. Перевірка перед завантаженням

`POST /api/preflight` і збірка ZIP (`gate`) проганяють `src/preflight.mjs`: унікальні DNA і байти картинок, кількість файлів = кількості метаданих, схема ERC-721 / Metaplex / Ordinals, роялті в межах 0–10000 bps, формат і розмір. Помилка блокує ZIP (HTTP 422) і звіт показується в UI. Попередження (порожній опис, локальні URI, заглушка адреси) не блокують. У архіві також `cover.*`, `royalties.json`, `rarity.json`, `rarity.txt`, `README.txt` під обрану мережу.

Набір деплою і набір маркетплейсу — `POST /api/deploy-kit`, `POST /api/marketplace-kit`. Деталі й ціни: [PRODUCT.md](./PRODUCT.md).

## 8. NFT Readiness Checklist

`GET /api/checklist?archive=…&set=…` виконує автоматичну перевірку готовності до ship:
- Наявність та валідність пресету й архіву.
- Відсутність дублікатів DNA.
- Відповідність кількості картинок заявленому розміру серії.
- Відсутність дефектів у зображеннях (PNG magic bytes, мінімальний розмір).
- Відсутність заблокованих брендів у промптах (Lint safety).
- Наявність помічених карток `keep`.

---

## 9. NFT Provenance Hash (Криптографічний доказ незмінності)

Для верифікації чесності розподілу та незмінності токенів до відкриття продажів (стандарт великих Web3-колекцій):
- Кожне зображення серії хешується за алгоритмом `SHA-256`.
- Усі хеші з'єднуються в єдиний детермінований рядок у порядку номерів видання (`#1..#N`).
- Обчислюється фінальний хеш колекції: `provenanceHash = sha256(hash_1 + ... + hash_N)`.
- Результат записується в `provenance.json` усередині ZIP-бандлу, а також включається у `collection.json` та `thirdweb.json`.
- Команда перевірки: `node bin/series.mjs provenance <dir> --verify`.

---

## 10. LoRA & AI Training Dataset Exporter («Серія як датасет»)

Режим експорту відібраних робіт серії для навчання власних генеративних моделей (Kohya_ss, Flux Gym, ComfyUI LoRA Trainer):
- Формує навчальні пари: `001.png` + `001.txt`, `002.png` + `002.txt`...
- Можливість вказати власне унікальне тригерне слово (наприклад, `gremlin_artstyle` або `cybergirl_line`).
- Підтримка двох форматів підписів:
  - **Danbooru/Tags-style** (для SDXL / SD 1.5): тригер-слово, розділені комами назви рис та дескриптори.
  - **Natural Language** (для Flux.1 / Midjourney LoRA): повний зв'язний опис сцени.
- Команда експорту: `node bin/series.mjs dataset <archive.json> --images <dir> --trigger "my_token" -o out/dataset.zip`.

---

Див. також: [STAGES.md](./STAGES.md) · [API.md](./API.md) · [ROADMAP.md](./ROADMAP.md)
