# Export · Mint-Ready ZIP, Manifests, Showcase & Deploy Hub

Етап **7 · Експорт** у Series Lab забезпечує підготовку всіх необхідних файлів для релізу колекції на блокчейн-платформах.

Series Lab **не мінтить безпосередньо з сервера** (для забезпечення безпеки та non-custodial принципу), а генерує готові для деплою пакети, маніфести, автономні візуальні пруфи та конфігурації.

---

## 1. Структура Mint-Ready ZIP

При збиранні бандлу через `POST /api/export/bundle` або кнопку **«Зібрати ZIP»** в UI формується архів у `out/bundles/<preset>-<set>-<format>.zip` наступної структури:

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
sugar.json           # Конфігурація для Solana Metaplex Sugar CLI (для Magic Eden / Solana)
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
| **`magiceden`** | Metaplex | Solana, EVM | Масив роялті `properties.creators`, `seller_fee_basis_points`, `sugar.json` |
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

## 6. Децентралізоване зберігання (IPFS Pinata Dispatcher)

Вкладка Експорт підтримує 1-клік завантаження набору зображень у Pinata IPFS:
- **API**: `POST /api/storage/pin` `{ dir: "set-dir", name: "my-series" }`
- **CLI**: `node bin/series.mjs pin out/set-dir --name my-series`
- Отриманий CID автоматично підставляється в поле `Image URI Prefix` (`ipfs://<CID>/`), оновлюючи попередній перегляд метаданих у реальному часі.

---

## 7. Release & Deployment Hub

Спеціальний блок у вкладці Експорт надає:
- Прямі посилання на створення дропу в **OpenSea Studio**, **Magic Eden Creator Hub**, **LaunchMyNFT**, **Thirdweb**, **OrdinalsBot**.
- Посилання на **Тестнет-портали** (Sepolia, Devnet).
- Кнопку завантаження конфігурацій деплою:
  - `sugar.json` для розгортання через Solana Metaplex Sugar CLI.
  - `thirdweb.json` для 1-клік деплою через Thirdweb / Hardhat.
- Покроковий інтерактивний чекліст підготовки до запуску.

---

## 8. NFT Readiness Checklist

`GET /api/checklist?archive=…&set=…` виконує автоматичну перевірку готовності до ship:
- Наявність та валідність пресету й архіву.
- Відсутність дублікатів DNA.
- Відповідність кількості картинок заявленому розміру серії.
- Відсутність дефектів у зображеннях (PNG magic bytes, мінімальний розмір).
- Відсутність заблокованих брендів у промптах (Lint safety).
- Наявність помічених карток `keep`.

Див. також: [STAGES.md](./STAGES.md) · [API.md](./API.md) · [ROADMAP.md](./ROADMAP.md)
