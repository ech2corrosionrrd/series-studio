# Пресет серії (Контракт даних `series-preset/v0`)

Схема валідації: `schemas/series-preset-v0.json` · `schema: "series-preset/v0"`.

Пресет є єдиним джерелом істини для генерації детермінованого архіву рецептів, промптів та метаданих серії.

---

## 1. Повний приклад структури пресету

```json
{
  "schema": "series-preset/v0",
  "id": "gremlin-girls",
  "name": "Gremlin Girls Series",
  "seed": "gremlin-seed-v1",
  "size": 48,
  "base": {
    "path": "input/primary.png",
    "note": "Головна базова картинка серії"
  },
  "lines": {
    "cyber": { "quota": 24, "who": "cybernetic female gremlin" },
    "steampunk": { "quota": 24, "who": "steampunk female gremlin" }
  },
  "promptTemplate": {
    "keep": ["same character face", "high aesthetic", "no text no watermark"],
    "changeKeys": ["hair", "hairColor", "outfit"],
    "extraKeys": ["eyewear", "headwear"],
    "suffix": "masterpiece, 8k resolution"
  },
  "traits": {
    "items": [
      {
        "key": "hair",
        "type": "string",
        "options": [
          { "value": "Buzz Cut", "weight": 5, "prompt": "buzz cut haircut" },
          { "value": "Twin Buns", "weight": 3, "prompt": "neon twin buns hairstyle" }
        ]
      }
    ]
  },
  "styleLock": {
    "angle": "chest-up centered",
    "light": "soft studio rim lighting",
    "mood": "cyberpunk calm",
    "framing": "square portrait",
    "extraKeep": ["no watermark", "no logo"]
  },
  "rules": {
    "conflicts": [
      { "a": "headwear:Beanie", "b": "hair:Afro Short", "note": "Beanie conflicts with high volume hair" }
    ]
  },
  "engineMatrix": {
    "flux": { "trigger": "gremlin_girl_v2", "suffix": "photorealistic" },
    "sdxl": { "lora": "gremlin_lora:0.8", "qualityTags": "masterpiece, sharp focus" },
    "midjourney": { "params": "--v 6.1 --stylize 250 --ar 1:1" }
  },
  "engine": {
    "default": "kontext",
    "strength": 0.45
  }
}
```

---

## 2. Відповідальність полів за етапами майстерні

| Поле пресету | Власник у UI | Опис та призначення |
|--------------|--------------|---------------------|
| **`id`**, **`name`**, **`size`**, **`seed`** | 1 · Огляд | Базова ідентичність серії та параметри випадковості. |
| **`base`** | 2 · Основа | Шлях до головного візуального референсу. |
| **`promptTemplate`** | 3 · Конструктор | Правила побудови промпту (`keep`, `changeKeys`, `extraKeys`, `suffix`). |
| **`traits.items`** | 3 · Конструктор | Знімок каталогу трейтів та їх варіантів (`options`). |
| **`styleLock`** | 3 · Конструктор | Фіксація кінематографічних параметрів кадру: `angle`, `light`, `mood`, `framing` йдуть абзацом «Style lock» у кожен промпт, `extraKeep` (масив або рядок, одна фраза на рядок) додається до `keep`. У DNA не входить. |
| **`rules.conflicts`** | 3 · Конструктор | Правила взаємного виключення несумісних рис. |
| **`engineMatrix`** | 3 · Конструктор | Матриця налаштувань LoRA та параметрів під різні рушії. |
| **`engine`** | 1 / 5 | Дефолтний двигун та сила зв'язку з референсом. |

---

## 3. Зв'язок з архівом рецептів (`series-archive/v0`)

На основі пресету функція `buildRecipes(preset)` детерміновано генерує архів `out/<id>.json`:
- Кожен рецепт містить точний `edition`, `line`, `traits`, згенерований `prompt` та унікальний `dna` хеш.
- Архів валідується схемою `schemas/series-archive-v0.json`.

Див. також: [TRAITS.md](./TRAITS.md) · [EXPORT.md](./EXPORT.md) · [API.md](./API.md)
