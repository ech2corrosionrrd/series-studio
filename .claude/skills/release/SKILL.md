---
name: release
description: Випуск версії - підняти версію, CHANGELOG, docs/README, тег, deploy. Лише за словом власника ("випусти vX.Y.Z").
---

Випуск робиться з чистого `main`; нова версія приходить від власника (або запропонуй за semver і дочекайся згоди).

1. `git status --short` чистий, `git pull`, `npm run ci` зелений.
2. `package.json`: нова версія. `docs/README.md`: рядок «Стан: vX.Y.Z». `README.md`/`docs/HOSTING.md`, якщо в них згадана версія (`grep -rn "<стара версія>" README.md docs`).
3. `CHANGELOG.md`: перенеси `## [Unreleased]` у `## [X.Y.Z] - дата` і залиш порожній `[Unreleased]`.
4. `npm run docs:check` і `npm run ci`.
5. Коміт `chore: випуск vX.Y.Z (версія, CHANGELOG, README, docs/README)` з рядком `Co-Authored-By` з системної вказівки.
6. Малий випуск - прямо в `main`; інакше гілка й PR (мердж лише за словом власника).
7. Тег `git tag vX.Y.Z` і `git push origin vX.Y.Z` - тільки після пуша коміту.
8. Деплой хоста - скіл `/deploy-staging`. Звіт: версія, коміт, ci, що задеплоєно.
