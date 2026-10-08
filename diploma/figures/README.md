# Рисунки для дипломної роботи

21 ілюстрація: системний аналіз, архітектура, взаємодія, скріни етапів, CI/Docker, **графіки економіки**, додатки Б.

| Файл | Підпис |
|---|---|
| `rys-1-1.png` | Контекстна діаграма |
| `rys-1-2.png` | Життєвий цикл |
| `rys-1-3.png` | Дерево цілей |
| `rys-2-1` … `rys-2-3` | Архітектура, ER, взаємодія |
| `rys-3-1` … `rys-3-6` | Скріни сайту / майстерні |
| `rys-3-7.png` | Оплата USDC |
| `rys-4-1`, `rys-4-2` | CI, Docker |
| `rys-5-1`, `rys-5-2` | Економіка (pie / bar) |
| `dod-b1` … `dod-b4` | Додаток Б |

```
python diploma/render_figures.py          # діаграми Mermaid
python diploma/render_economy_charts.py   # рис. 5.1–5.2
python diploma/build_docx.py
node diploma/build_pptx.mjs               # презентація захисту
```
