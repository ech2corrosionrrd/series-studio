---
name: deploy-staging
description: Деплой Series Lab на хост lab.w3ir.io (root@HOST_IP) - бекап, upload.sh, перевірка health і образу. Лише за словом власника.
---

Перед початком: `git log -1` збігається з тим, що треба задеплоїти (`upload.sh` вантажить `git archive HEAD`; якщо коміт мовчки не пройшов, піде старий HEAD). Робоче дерево чисте.

1. Бекап: `ssh root@HOST_IP "BACKUP_MODE=hourly bash /opt/series-lab/backup.sh"`.
2. Деплой: `OPEN_ACCESS=1 ENABLE_PAYMENTS=1 ENABLE_TELEGRAM=1 bash deploy/series-lab/upload.sh root@HOST_IP`. Без `LAB_ENV_FILE` (секрети вже в `/opt/series-lab/lab.env`) і без `SERIES_SPEND_CAP_USD=off` (phase3.sh сам ставить за замовчуванням).
3. Перевірка: `curl -sS https://lab.w3ir.io/health`; `ssh root@HOST_IP "grep -o 'series-lab:[a-z0-9]*' /opt/series-lab/docker-compose.yml; docker ps"`; тег образу = короткий хеш `git rev-parse --short HEAD`.
4. 502 після деплою: `deploy/series-lab/phase3-rollback.sh` або поверни в `docker-compose.yml` попередній тег образу.
5. Статику Cloudflare кешує без `private` в `Cache-Control`; після деплою UI перевір, що віддається нова версія (ETag/вміст), а не кеш.
6. Звіт: старий і новий образ, health, що перевірено.

Не чіпати: ledger у `/opt/series-lab/data-next`, секрети, чужі проєкти на тому ж хості (Промт, gremlin-nft-site, w3ir-tma-gateway).
