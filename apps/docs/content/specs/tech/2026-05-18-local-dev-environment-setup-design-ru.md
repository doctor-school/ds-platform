---
title: "DS Platform — Local Developer Environment (Design)"
description: "Portable contract (в git, для всех разработчиков) + персональные deployment-рецепты для local dev stand — Compose-стек, изоляция контейнеров, TrueNAS hybrid reference recipe."
slug: local-dev-environment-setup
status: Draft
lang: ru
---

> **EN mirror:** [`2026-05-18-local-dev-environment-setup-design-en.md`](./2026-05-18-local-dev-environment-setup-design-en.md) · **RU (this)**

# DS Platform — Local Developer Environment (Portable Contract + Personal Recipes) — Design

**Дата:** 2026-05-18 (rewritten 2026-05-18 evening после challenge: разделение portable contract vs personal deployment)
**Статус:** Draft → User Review
**Тип:** Platform-level design (portable contract — в git, для всех разработчиков) + reference recipe (Tech Lead's TrueNAS hybrid — runbook, личная топология вне git). Platform-level часть может стать ADR при первом shared use; Tech Lead's recipe — это runbook, не архитектура.
**Связан с:** Plane DSO-70 (`8c4b69c2-7df6-45b5-8d7c-34c8b682eda8`), milestone DSO-10
**Применяет (не наследует — это setup-документ):** ADR-0001 (Identity), ADR-0002 (NestJS+Fastify+BullMQ), ADR-0003 (Postgres17+Drizzle+Redis), ADR-0004 (Next.js 15 + 4 apps), ADR-0005 (RN+Expo), ADR-0007 (AI loop), ADR-0008 (repo strategy), ADR-0011 (egress control plane), engineering-readiness spec

---

## 1. Context

DS Platform — выбранный стек (ADR-0001..0011): NestJS+Fastify api+worker, Postgres17+Drizzle+pgvector, Redis, MinIO-compatible object storage, Authentik|Zitadel (TBD spike), Centrifugo, Cerbos, четыре Next.js 15-приложения (promo/portal/admin/cms), RN+Expo (Pre-pilot phased to PWA), observability stack (Loki+Grafana+GlitchTip+Outline+Unleash, Pre-pilot).

ADR-0008 §2.10 фиксирует repo bootstrap (Спринт 3), но **где физически крутится этот стек на машине разработчика — не зафиксировано ни одним ADR.** Прод-deploy строит CI на отдельных серверах per ADR-0008 §2.8 и engineering-readiness spec; «локалка → прод» как deploy-паттерн не поддерживается. Это spec'и про **рабочее место разработчика на Phase 0–Pre-pilot**, не про production.

**Platform-level requirements** (что нужно любому разработчику, не привязано к hardware):

- **AI-агенты** — основной механизм разработки. Compile/HMR feedback loop должен быть быстрым (зависит от host'а разработчика; контракт не предписывает).
- **Prod-parity по data layer:** те же images (Postgres major version, extensions), что в проде. Это контракт.
- **Single source of truth для service composition** — один `compose.core.yml` в git, общий для всех разработчиков.
- **Source code всегда на host'е разработчика** (file watcher, IDE, AI-агент работают на локальной NVMe).
- **AI-agent-friendly tooling** — DX-скрипты env-driven, чтобы AGENTS.md правила работали независимо от recipe'а.
- **Compatibility с ADR-0011** (egress control plane): LAN-endpoints классифицируются как trusted, не proxy через PII-scanner.
- [[feedback_tech_stack_criteria_no_team_skill]]: критерии выбора в spec'е — объективные требования платформы, не «команда умеет».
- [[feedback_docs_as_ssot]]: portable contract (compose, .env.example, AGENTS.md) живёт в git как single source.

**Personal-level preferences** (мотивации Tech Lead, повлиявшие на дизайн его recipe'а — см. §5):

- Экономия места на C: (мой SSD разделяется с играми/медиа).
- ZFS snapshots как «машина времени» для Postgres перед миграциями.
- State stack'а переживает переустановку Windows.

Это — **причины, по которым я выбрал TrueNAS Hybrid recipe**, не platform-level constraints. Другой разработчик с другими предпочтениями выберет другой recipe.

**Что НЕ constraint (на уровне платформы):**

- Mobility / оффлайн-работа — recipe-specific. У меня — нет (всегда в домашней сети); у будущего contractor'а может быть иначе → их recipe это покрывает.
- Multi-developer прямо сейчас (Product Lead не пишет код в этом quarter; trigger пересмотра recipe-library — §11).
- High-availability стенда: ребут одной из машин = временная недоступность api ≈ OK для dev.
- Раннее подключение Vault/Unleash/Outline: deferred по engineering-readiness spec.

---

## 2. Decision — двухслойная модель: Portable Contract + Personal Recipe

### 2.1 Принцип

Локальная dev-среда — это **два независимых слоя**:

| Слой                              | Что определяет                                                                                                                                        | Где живёт                                                                        | Кто решает                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------- |
| **A. Portable contract** (в git)  | Какие сервисы существуют, какие у них images/версии, какие порты, какие env-имена они ожидают, какие healthchecks, какие named volumes / mount-points | `doctor-school/ds-platform/infra/dev-stand/` (после bootstrap repo per ADR-0008) | Платформенно (общее для всех разработчиков) |
| **B. Personal recipe** (НЕ в git) | На каком Docker daemon запускается, какой hostname / IP, какие реальные пути на disk'е, какие пароли, какой network mode, какая backup-стратегия      | Личные файлы разработчика (`.env.local`, `compose.override.yml`, личный runbook) | Каждый разработчик сам под своё железо      |

**Контракт (слой A)** обеспечивает: новый разработчик клонирует repo, копирует `.env.example` → `.env.local`, заполняет под свою машину, запускает → все сервисы поднимаются как нужно платформе.

**Recipe (слой B)** обеспечивает: разработчик описывает свою конкретную топологию (хочет всё на host'е через Docker Desktop? на NAS? в облачной VM?) — это **его выбор**, не решение платформы.

### 2.2 Source code — всегда на host разработчика

Независимо от рецепта: `apps/*`, `packages/*` живут на локальной NVMe разработчика (file watcher, IDE, AI-агент). На удалённых Docker hosts (TrueNAS, cloud VM) уезжают только Docker volumes — никогда исходники.

### 2.3 Reference recipe: «TrueNAS Hybrid» (Tech Lead) — §5–§6

В spec'е документирован один полный рецепт — мой setup (i9-9900KF host + TrueNAS Scale 24.10 для stateful-сервисов). Это **референсная реализация**, не mandate. См. §5 (ZFS layout), §6 (snapshot policy). Будущие разработчики добавят свои рецепты в README (Docker Desktop host-only, cloud VM, и т.д.) — или просто будут пользоваться платформенным контрактом без публикации своего рецепта.

### 2.4 Где живёт сам compose-контракт

Compose-контракт живёт в `infra/dev-stand/` этого репозитория (monorepo с application code) — DS-инфра живёт **с DS-платформой**, рядом с кодом, который она обслуживает.

### 2.5 Связь host → Docker daemon (через recipe)

В контракте не указано, как host достукивается до Docker daemon — это recipe-specific:

- Tech Lead's recipe: wrapper'ы через `ssh.exe`, выполняющие `sudo docker` под пользователем `claude` (см. §5+§9). `DOCKER_HOST=ssh://claude@truenas.local` отложен — требует `claude` в группе `docker`, чего общий сервер намеренно избегает в пользу `sudo docker` (§11 OQ-1).
- Recipe «host-only»: `DOCKER_HOST` не выставлен, локальный Docker Desktop / WSL2.
- Recipe «cloud VM»: `DOCKER_HOST=ssh://...` или Tailscale tunnel.

Никакого VPN в Phase 0 baseline (оффлайн-работа не constraint, см. §1).

---

## 3. Portable contract: сервисы, порты, env-имена

Это часть, которая **в git**. Идентична у всех разработчиков. Volumes — через **env-vars** (`${DS_DATA_PATH:-./data}/postgres`), не abs-paths. Hostname сервисов — внутренние compose-имена (`postgres`, `redis`...). Hostname / endpoint для host'a — через env-vars (`DATABASE_URL`, `REDIS_URL`...).

### 3.1 Core stack (всегда-on в любом recipe)

| Service                                                  | Image                                                            | Внешний порт (для host-доступа) | Контейнер          | RAM (typical)                                    | Хост-side зависимость                                               |
| -------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------- | ------------------ | ------------------------------------------------ | ------------------------------------------------------------------- |
| `postgres`                                               | `pgvector/pgvector:pg17` (база Postgres 17 + pgvector extension) | 5432                            | 5432               | 1–4 GB                                           | api, worker, admin, cms, payload                                    |
| `redis`                                                  | `redis:7-alpine`                                                 | 6379                            | 6379               | 256 MB                                           | api (cache + sessions), worker (BullMQ broker), Centrifugo (PubSub) |
| `minio`                                                  | `minio/minio:latest`                                             | 9000 (S3) + 9001 (console)      | 9000+9001          | 512 MB                                           | api (uploads), Payload (media), mobile (offline cache target)       |
| `idp` (`authentik` или `zitadel`, TBD ADR-0001 §8 spike) | placeholder сервис, имя `idp` фиксируется сейчас                 | 9080 (HTTP), 9443 (HTTPS)       | 9000/9443 internal | 1–2 GB + внутренний Postgres + Redis (или общий) | api (JWT issuer), все web-apps (OIDC login)                         |
| `centrifugo`                                             | `centrifugo/centrifugo:v6`                                       | 8000                            | 8000               | 128 MB                                           | api (publish), web/mobile (WS subscribe)                            |
| `cerbos`                                                 | `ghcr.io/cerbos/cerbos:latest`                                   | 3592 (gRPC), 3593 (HTTP)        | 3592/3593          | 128 MB                                           | api (PDP queries)                                                   |
| `mailpit`                                                | `axllent/mailpit:latest`                                         | 1025 (SMTP), 8025 (UI)          | 1025/8025          | 64 MB                                            | api (email dev catch-all)                                           |

**Суммарно core RAM:** ≈ 4–8 GB working set. Recipe-specific: помещается ли это на твоей машине — твоя проверка. У Tech Lead (TrueNAS hybrid) — ОК (≈18–20 GB usable).

### 3.2 Observability stack (optional, on-demand)

Стартует отдельным compose-файлом (`compose.observability.yml`) только когда нужен. Не запускается на каждый dev-сеанс — экономит RAM.

| Service     | Image                        | Host port        | RAM                          |
| ----------- | ---------------------------- | ---------------- | ---------------------------- |
| `loki`      | `grafana/loki:latest`        | 3100             | 512 MB                       |
| `grafana`   | `grafana/grafana:latest`     | 4000             | 256 MB                       |
| `glitchtip` | `glitchtip/glitchtip:latest` | 8001             | 512 MB + внутренний Postgres |
| `promtail`  | `grafana/promtail:latest`    | — (host network) | 128 MB                       |

### 3.3 Future / deferred

`outline` (8002), `unleash` (4242), `vault` (8200) — добавляются compose-фрагментами по триггеру (см. §11). Изначально не в скелете.

### 3.4 Host-side порты (для справки)

| App                                 | Port |
| ----------------------------------- | ---- |
| `apps/api` (NestJS)                 | 4001 |
| `apps/portal` (Next.js)             | 3000 |
| `apps/admin` (Next.js + Refine)     | 3001 |
| `apps/cms` (Next.js + Payload)      | 3002 |
| `apps/promo` (Next.js)              | 3003 |
| `apps/docs` (Fumadocs Next.js)      | 3004 |
| `apps/docs-cms` (Keystatic Next.js) | 3005 |
| `apps/mobile` (Expo Metro)          | 8081 |

**Конфликтов нет в рамках TrueNAS-сервисов** (5432, 6379, 8000, 8001, 9000, 9001, 9080, 9443, 3100, 4000, 1025, 8025, 3592, 3593). Host-side порты (3000–3005, 4001, 8081) живут на отдельной машине и с TrueNAS-портами не пересекаются.

---

## 4. Portable contract: env-vars и network model

### 4.1 `.env.example` — шаблон в repo

```env
# === Docker host (recipe-specific) ===
# Tech Lead's recipe: оставить пустым — sudo-docker wrapper'ы через ssh (user claude)
# Host-only recipe: оставить пустым
DOCKER_HOST=

# === Сервисные endpoints (recipe-specific hostnames) ===
DATABASE_URL=postgres://ds:CHANGE_ME@HOST:5432/ds_dev
REDIS_URL=redis://HOST:6379
S3_ENDPOINT=http://HOST:9000
S3_REGION=us-east-1
S3_BUCKET_UPLOADS=ds-uploads-dev
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=CHANGE_ME
IDP_ISSUER=http://HOST:9080/application/o/ds-platform/
IDP_CLIENT_ID=ds-platform-dev
IDP_CLIENT_SECRET=CHANGE_ME
CENTRIFUGO_URL=http://HOST:8000
CENTRIFUGO_API_KEY=CHANGE_ME
CERBOS_URL=http://HOST:3592
SMTP_HOST=HOST
SMTP_PORT=1025

# === Data volume root (recipe-specific) ===
# Tech Lead's TrueNAS recipe: DS_DATA_PATH=/mnt/Daily/dev
# Host-only recipe (named volumes): оставить пустым → compose использует named volumes
DS_DATA_PATH=

# === Compose-side secrets ===
POSTGRES_PASSWORD=CHANGE_ME
MINIO_ROOT_PASSWORD=CHANGE_ME
IDP_SECRET_KEY=CHANGE_ME
```

`.env.example` коммитится. `.env.local` (с реальными значениями) — `.gitignore`.

### 4.2 Network model в compose.core.yml

Bridge network + публикация портов на `0.0.0.0:<port>`. Hostname-внутри-compose — стандартные service-names (`postgres`, `redis`, ...) — используются для inter-container traffic.

Hostname-снаружи — recipe-specific (см. recipe в §5+).

### 4.3 Firewall — recipe-specific

Это специфика конкретного deployment'a. У Tech Lead's recipe (TrueNAS Scale) — nftables-правила открывают список портов с `192.168.1.0/24`. У host-only recipe — Windows Firewall не трогается (localhost-only). См. §5.4 (Tech Lead's recipe).

---

## 5. Reference recipe «TrueNAS Hybrid» (Tech Lead) — детали

Это **один из возможных deployment-recipe'ев**. Описан как референс для других разработчиков и для AI-агентов, которые работают в моей сессии. Личные пути / IP-адреса вынесены в `.env.local` (не в git).

**Hardware этого recipe'а (моё домашнее железо):**

| Узел                               | Спецификация                                                                                                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Host**                           | Intel i9-9900KF (8C/16T, Coffee Lake Refresh, 3.6 GHz base / ~5 GHz boost) · 32 GB RAM · 1 TB NVMe SSD · RTX 2070S · Windows 11 Pro 26200                                                            |
| **TrueNAS** (LAN, `192.168.1.115`) | TrueNAS Scale 24.10 ElectricEel · Intel i5-4670K (4C/4T Haswell, 3.4 GHz) · 24 GB RAM (≈18–20 GB usable после ZFS-кеша) · Daily SSD pool 900 GB · RaidPool 449 GB · Media pool 7.14 TiB · 1 Gbit LAN |
| **Сеть**                           | Домашняя LAN, постоянно доступна                                                                                                                                                                     |

### 5.1 Hardware-обоснование (почему именно hybrid)

Host i9-9900KF (8C/16T, 32 GB RAM, 1 TB NVMe) тянет app-процессы с минимальной compile latency. TrueNAS i5-4670K (4C/4T Haswell, 24 GB RAM) — слаб для compile, но native Linux Docker + ZFS-snapshots делает его идеальным для stateful-сервисов. 1 Gbit LAN добавляет ~100 µs к каждому Postgres query — пренебрежимо для dev-нагрузки.

Альтернативные recipe'ы (host-only / cloud VM) могут отбросить этот split — но мой рецепт выигрывает по экономии места на C: + ZFS snapshots + native Linux Docker без WSL2 overhead.

### 5.2 mDNS-резолвинг (Tech Lead's network)

TrueNAS Scale 24.10 публикует `truenas.local` через avahi. Windows 11 26200 поддерживает mDNS из коробки.

**Caveat 1 (Windows network profile):** mDNS-резолвер Windows работает только когда профиль сети — **Private**. На свежей установке Windows / после reset профиля `truenas.local` молча перестаёт резолвиться. Bootstrap-чеклист моего recipe явно проверяет (`Get-NetConnectionProfile`).

**Caveat 2 (WSL2):** mDNS внутри WSL2 в default NAT-режиме **не работает** (open bug microsoft/WSL#12354). DX-скрипты вызываются через native Windows `ssh.exe`, не WSL2 bash. Если api запускается из WSL2 — fallback static IP в WSL `/etc/hosts` ИЛИ `networkingMode=mirrored` (WSL 2.3.17+).

Static IP fallback: `192.168.1.115` (DHCP-reservation на роутере).

### 5.3 ZFS dataset layout (Tech Lead's recipe)

```
Daily SSD pool (900 GB)
├── Daily/dev-postgres        # Postgres pgdata, mountpoint /mnt/Daily/dev/postgres
├── Daily/dev-redis           # Redis AOF/RDB dumps
├── Daily/dev-minio           # MinIO buckets storage
├── Daily/dev-idp             # Authentik|Zitadel media + сертификаты
├── Daily/dev-centrifugo      # Centrifugo state (small)
├── Daily/dev-cerbos-policies # Cerbos PDP policies
└── Daily/dev-observability   # Loki chunks, Grafana state, GlitchTip Postgres (если активирован)

RaidPool (449 GB) — резерв под per-feature snapshot clones (§5.5 OQ-2); до trigger'а свободен.
Media (7.14 TiB) — off-host ZFS replication target.
```

**Recordsize tuning:**

- `Daily/dev-postgres`: `recordsize=16K`, `compression=lz4`, `atime=off`, `logbias=throughput`, `primarycache=metadata`. **Caveat:** `primarycache=metadata` эффективен когда `shared_buffers` покрывает рабочий набор. Текущий dev `shared_buffers=512MB` против ~4 GB working set может приводить к cold-read penalty — если заметим, перейти на `primarycache=all` (open ZFS discussion openzfs/zfs#15400).
- `Daily/dev-minio`: `recordsize=1M`, `compression=lz4`, `atime=off`.
- `Daily/dev-redis`: `recordsize=128K`, `compression=lz4`.

В `compose.override.yml` (личный файл Tech Lead, **не в git**) bind mounts указывают на эти dataset'ы:

```yaml
# ~/.ds-platform/compose.override.yml (gitignored, Tech Lead's recipe)
services:
  postgres:
    volumes:
      - /mnt/Daily/dev/postgres:/var/lib/postgresql/data
  redis:
    volumes:
      - /mnt/Daily/dev/redis:/data
  # ... etc
```

### 5.4 Firewall + DHCP (Tech Lead's recipe)

- TrueNAS Scale firewall (nftables) разрешает 5432/6379/9000-9001/9080/9443/8000/3100/4000/1025/8025/3592/3593 с `192.168.1.0/24`.
- Интернет-порты закрыты.
- DHCP reservation `192.168.1.115` для MAC TrueNAS на роутере.

### 5.5 Snapshot & backup (Tech Lead's recipe — ZFS-based)

**Auto-snapshot:** Periodic Snapshot Task — daily 03:00 retention 7d, на все `Daily/dev-*`.

**Off-pool replication:** weekly `Daily/dev-postgres` → `Media/backups/dev-stand/`, retention 4 weeks. Это backup на случай corruption Daily pool, не disaster recovery.

**Pre-migration manual snapshot:** перед `pnpm drizzle:migrate` AI-агент / dev вызывает `pnpm dev:snapshot pre-mig-<desc>`. Wrapper SSH'ит на TrueNAS, `zfs snapshot Daily/dev-postgres@<...>`. Откат: `pnpm dev:rollback <snapshot>` (требует `docker compose stop postgres` перед `zfs rollback`).

Drizzle pre-migration hook — wrapper в `apps/api/package.json` (см. §9.2).

**OQ-2: Per-feature ZFS clone** — при подключении второго dev'а на этом железе. Не в Phase 0.

### 5.6 Docker autostart на TrueNAS reboot (Tech Lead's recipe)

SSH-managed compose **не** управляется TrueNAS Apps supervisor'ом. После ребута контейнеры подымаются через `restart: unless-stopped` + autostart Docker daemon. На TrueNAS Scale 24.10 `dockerd` стартует как часть Apps engine'а — SSH-managed compose стек поднимается автоматически. **Bootstrap-чеклист обязан верифицировать** на первом ребуте (`reboot` → ждать → `pnpm dev:status`).

---

## 6. Альтернативные recipes (placeholder)

Документируются по мере появления других разработчиков. Каждый recipe = раздел в README с: hardware-assumptions, mDNS/network setup, volume strategy (bind / named / cloud), backup policy, autostart guarantees, особенности AI-agent integration.

Кандидаты на будущие recipes:

- **Recipe «Docker Desktop host-only»** — Mac/Linux dev на одной машине, named volumes, no remote Docker host. Простейший вариант для нового dev'а.
- **Recipe «Cloud VM»** — Hetzner/Selectel small VM, `DOCKER_HOST=ssh://...`, EBS-snapshots вместо ZFS. Для distributed-team сценария.

Каждый разработчик может: (a) использовать один из задокументированных recipe'ев как есть, (b) собрать гибрид, (c) ничего не публиковать — главное чтобы portable contract (§3, §4) удовлетворялся.

---

## 7. Compose layout

### 7.1 Файловая структура (в git)

```
infra/dev-stand/
├── README.md                                   # bootstrap + recipes library + commands cheat sheet
├── compose.core.yml                            # PORTABLE: services, images, env-имена, named volumes
├── compose.observability.yml                   # PORTABLE: optional loki/grafana/glitchtip
├── compose.future.yml.example                  # PORTABLE template: outline/unleash/vault — по триггеру
├── .env.example                                # PORTABLE: env-шаблон (см. §4.1)
├── postgres/
│   ├── init.sql                                # PORTABLE: CREATE EXTENSION vector; CREATE DATABASE ds_dev
│   └── postgresql.conf.dev                     # PORTABLE: dev tuning (shared_buffers, max_connections)
├── idp/
│   └── bootstrap.md                            # PORTABLE: manual OIDC application setup (любой IdP)
├── centrifugo/
│   └── config.json                             # PORTABLE
└── cerbos/
    └── policies/                               # PORTABLE: PDP policies (symlink на packages/cerbos-policies/)
```

**Personal overlay (НЕ в git, на машине разработчика):**

```
~/.ds-platform/                                 # или другое личное место
├── .env.local                                  # реальные пароли + endpoints (HOST=truenas.local|localhost|...)
└── compose.override.yml                        # per-recipe overrides (bind mounts, DOCKER_HOST, и т.д.)
```

`.gitignore` repo'a исключает `.env.local` и `compose.override.yml` в `infra/dev-stand/` (если разработчик кладёт их туда вместо `~/.ds-platform/`).

### 7.2 Volume strategy: portable vs personal

**Portable compose.core.yml** использует **named volumes** (default — Docker управляет, рассыпан по машинам):

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg17
    restart: unless-stopped
    environment:
      POSTGRES_USER: ds
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ds_dev
    ports: ["${POSTGRES_PORT:-5432}:5432"]
    volumes:
      - ds-postgres:/var/lib/postgresql/data
      - ./postgres/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
      - ./postgres/postgresql.conf.dev:/etc/postgresql/postgresql.conf:ro
    command: postgres -c config_file=/etc/postgresql/postgresql.conf

volumes:
  ds-postgres:
  ds-redis:
  ds-minio:
  ds-idp:
  ds-centrifugo:
```

**Tech Lead's personal `compose.override.yml`** заменяет named volumes на bind mounts на ZFS-датасеты:

```yaml
# ~/.ds-platform/compose.override.yml — gitignored, Tech Lead's recipe
services:
  postgres:
    volumes:
      - /mnt/Daily/dev/postgres:/var/lib/postgresql/data
  redis:
    volumes:
      - /mnt/Daily/dev/redis:/data
  minio:
    volumes:
      - /mnt/Daily/dev/minio:/data
  # ... etc
```

Docker Compose автоматически мержит `compose.core.yml` + `compose.override.yml` (при `-f` указании обоих). Override-volumes побеждают named volumes — `bind:` имеет приоритет над `volume:` reference при merge.

**Принцип:** в repo контракт не предписывает топологию storage. Каждый recipe сам решает (named / bind / network volume / cloud disk).

### 7.3 Bootstrap (общий каркас)

```
# 1. Клонировать ds-platform repo
git clone git@github.com:doctor-school/ds-platform.git
cd ds-platform/infra/dev-stand

# 2. Создать свой личный .env.local
cp .env.example ~/.ds-platform/.env.local
# Отредактировать значения под свою машину (HOST, DOCKER_HOST, passwords, paths)

# 3. (Опционально) Создать personal override
cp compose.override.example.yml ~/.ds-platform/compose.override.yml
# Отредактировать под свой recipe (bind mounts, network mode, и т.д.)

# 4. Запустить через DX-скрипт (читает env + override)
pnpm dev:up
```

После — `idp/bootstrap.md` ручные шаги (создание OIDC application, scope mapping). Это unavoidable manual step для любого IdP.

### 7.4 Развёртывание через TrueNAS Apps UI vs SSH (Tech Lead's recipe deviation)

Только для recipe «TrueNAS Hybrid». В моём recipe я выбираю SSH + `docker compose` напрямую (не Apps UI):

- Apps UI парсит compose неполно (custom networks, healthchecks теряются).
- SSH-управление = тот же flow, что на prod Coolify / manual compose.
- AI-агенту удобнее логи/shell через SSH.

Другие recipe'ы не привязаны к этому решению.

---

## 8. AI-agent integration

### 8.1 Что AI-агент знает на host'е (portable + per-recipe)

**Portable правила (в `AGENTS.md` repo'a, для всех):**

- Эндпоинты читаются из `.env.local` (НЕ хардкодятся в AGENTS.md).
- Команды `pnpm dev:up` / `dev:down` / `dev:logs <service>` / `dev:snapshot <name>` / `dev:rollback <name>` — стандартные.
- Правило: **«перед `pnpm drizzle:migrate` ВСЕГДА сначала `pnpm dev:snapshot pre-mig-<short-desc>`».**
- Правило: **«не редактируй файлы внутри volume'ов напрямую — это live data».**
- Failure modes baseline: порт занят (`netstat`), compose упал (`dev:logs`/`dev:restart`), endpoint не доступен (проверить `.env.local`).

**Per-recipe AI-context (Tech Lead's `~/.ds-platform/AGENT_NOTES.md`, не в git):**

- Endpoints этого recipe (`truenas.local:5432` для меня).
- ZFS-specific failure modes (mDNS не резолвится → static IP в hosts; pool corruption → rollback procedure).
- DOCKER_HOST URL.

Другие разработчики держат свои AGENT_NOTES.md рядом с их `.env.local`.

### 8.2 Host → Docker daemon control (recipe-specific)

Контракт не предписывает. Recipe-specific:

- **Tech Lead's recipe (TrueNAS):** SSH-wrapper'ы (`tools/dev/*.sh` через `ssh.exe`), выполняющие `sudo docker` под пользователем `claude`. Альтернатива — `DOCKER_HOST=ssh://claude@truenas.local` (deferred — требует `claude` в группе `docker`, см. §11 OQ-1).
- **Recipe «host-only»:** локальный Docker daemon, `DOCKER_HOST` не выставлен.
- **Recipe «cloud VM»:** `DOCKER_HOST=ssh://...` через Tailscale или direct.

### 8.3 Egress-control plane совместимость

ADR-0011 (egress control plane) накладывает на AI-агента правила исходящих вызовов. Compose-сервисы на TrueNAS — это **LAN endpoint**, не egress (per ADR-0011 §2.1 LAN классифицируется как trusted network). AI-агент **не** должен через PII-scanner пропускать запросы к `truenas.local` — это intra-zone communication.

### 8.4 Dual-LLM (ADR-0010) integration с локалкой

Quarantine LLM workload (per ADR-0010 mandatory pattern) в Pre-pilot работает через прод-AI-сервис (RU-cloud + cross-zone egress), **не** через локальный стенд. Локальный стенд не запускает Ollama / vLLM. Trigger пересмотра: если в Pre-pilot dev нужен offline-LLM для тестов — отдельный compose-фрагмент `compose.local-llm.yml`. См. §11 OQ-5.

---

## 9. DX scripts

### 9.1 Список (`package.json` scripts на root репо)

Все скрипты **env-driven**: читают `.env.local` (HOST, DOCKER_HOST, paths) и работают с любым recipe.

| Script                       | Portable behaviour                                                                                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev:up`                | `docker compose -f compose.core.yml -f $OVERRIDE_FILE up -d` (через DOCKER_HOST если выставлен)                                                                            |
| `pnpm dev:down`              | `docker compose down` (volumes preserved)                                                                                                                                  |
| `pnpm dev:logs <service>`    | `docker compose logs -f <service>`                                                                                                                                         |
| `pnpm dev:restart <service>` | `docker compose restart <service>`                                                                                                                                         |
| `pnpm dev:psql`              | `psql $DATABASE_URL`                                                                                                                                                       |
| `pnpm dev:snapshot <name>`   | **Recipe-specific.** Tech Lead: SSH→`zfs snapshot`. Host-only: `pg_dump` или `docker compose stop && cp -r volume`. Если recipe не поддерживает — graceful skip с warning. |
| `pnpm dev:rollback <name>`   | **Recipe-specific.** Tech Lead: `zfs rollback`. Host-only: restore from pg_dump.                                                                                           |
| `pnpm dev:reset-db`          | `dev:down` → drop+recreate volume (per recipe) → `dev:up` → `drizzle:migrate` → seed                                                                                       |
| `pnpm dev:status`            | `docker compose ps`                                                                                                                                                        |

Скрипты-обёртки в `tools/dev/`: portable Node.js launcher `tools/dev/run.mjs` (cross-platform), который читает env и диспатчит. Recipe-specific логика (`snapshot.sh` / `rollback.sh`) живёт **в personal overlay** или загружается из `tools/dev/recipes/<recipe-name>/*.sh` (опубликованные референсные recipe'ы).

**На Windows host'е** используется встроенный `ssh.exe` для recipe'ов с `DOCKER_HOST=ssh://...`, не WSL2 bash (избегаем WSL2 mDNS бага).

### 9.2 Pre-migration hook

`drizzle-kit migrate` обёртка в `apps/api/package.json` (cross-platform — таймстамп генерируется внутри `tools/dev/snapshot.sh` на TrueNAS Linux-стороне, чтобы не зависеть от bash `$(date +%s)` substitution на Windows host):

```json
{
  "scripts": {
    "drizzle:migrate": "pnpm dev:snapshot pre-mig-auto && drizzle-kit migrate"
  }
}
```

`tools/dev/snapshot.sh` (выполняется через `ssh.exe truenas.local`) добавляет timestamp на стороне Linux:

```bash
# tools/dev/snapshot.sh (excerpt)
NAME="$1-$(date -u +%Y%m%dT%H%M%SZ)"
zfs snapshot "Daily/dev-postgres@${NAME}"
```

Это даёт читаемые имена (`pre-mig-auto-20260518T091230Z`) и работает identically на Windows host (cmd / PowerShell / WSL без bash-substitution headache).

Если snapshot fails → migrate не запускается. Это soft guardrail, не hard (можно через `--force` обойти). Hard guardrail = ADR-уровень, deferred.

---

## 10. Secrets handling

Phase 0 secrets:

- `infra/dev-stand/.env` на TrueNAS — содержит `POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`, `IDP_SECRET_KEY` (Authentik `AUTHENTIK_SECRET_KEY` или Zitadel `ZITADEL_MASTERKEY` в зависимости от выбора по ADR-0001 §8) и др. Файл вручную создаётся при bootstrap из `.env.example`. **Не коммитится** (gitignore).
- `ds-platform/.env.local` на host — connection strings + IdP client secret. **Не коммитится.**
- Vault не используется в Phase 0 (per engineering-readiness spec). Trigger подключения: первый shared developer (см. §11 OQ-3).

**Это dev-данные. Никаких ПДн.** При случайной утечке `.env` rotation сводится к `dev:reset-db` + регенерация секретов скриптом.

**Backup secrets:** `.env` файлы НЕ покрываются ZFS-snapshot'ами (живут в compose-directory на root-disk TrueNAS, не на snapshotted dataset'е), `.env.local` на host'е тоже не бэкапится. При reinstall Windows / wipe TrueNAS OS drive секреты теряются → rotation. **Bootstrap-секреты обязаны быть сохранены в password manager** (1Password / Bitwarden) или экспортированы в зашифрованный файл на Media pool. Это explicit step в `infra/dev-stand/README.md`.

---

## 11. Open questions / Revisit triggers

| ID    | Q                                                                                        | Когда решать                                                                                              |
| ----- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| OQ-1  | `DOCKER_HOST=ssh://...` vs ручной SSH-wrapper                                            | После первой недели использования: если SSH-wrapper'ы становятся frictionful, мигрируем на Docker context |
| OQ-2  | Per-developer namespace в Postgres (`ds_dev_anton`, `ds_dev_eduard`) vs single shared DB | При присоединении второго dev'а                                                                           |
| OQ-3  | Vault для dev secrets                                                                    | При первом shared developer ИЛИ когда secrets живут в > 3 местах                                          |
| OQ-4  | Drizzle pre-migration hook integration                                                   | На момент первой работающей миграции в `apps/api` (после ADR-0008 step 22)                                |
| OQ-5  | Local LLM compose-фрагмент (Ollama/vLLM)                                                 | Если Pre-pilot dev нуждается в offline-LLM тестах                                                         |
| OQ-6  | Замена SSH-wrapper'ов на TrueNAS Apps UI                                                 | Если второй dev не SSH-power-user                                                                         |
| OQ-7  | Off-site backup dev-data                                                                 | НЕ нужен (dev-data recreatable). Не открывать.                                                            |
| OQ-8  | Замена TrueNAS на более новое железо                                                     | Если Haswell i5-4670K становится bottleneck даже для core-сервисов (Postgres CPU usage > 50% sustained)   |
| OQ-9  | mDNS-резолвинг в WSL2 (если api запускается из WSL вместо native Windows Node)           | На момент первого API run, если WSL2 не видит `truenas.local` — fallback на IP                            |
| OQ-10 | Static IP / mDNS reliability                                                             | На момент первого falback'а                                                                               |
| OQ-11 | Что делать с `dev-stand/` (Next.js mobile prototype)                                     | Этот dev-stand prototype не связан с DS Platform dev environment; ничего не меняется по нему              |

**Revisit triggers (когда переоткрывать этот ADR):**

- Второй разработчик присоединяется → §6.3 + OQ-2 + OQ-6 переоткрыты.
- Прод-сервера развёрнуты → §1 уточнить «локалка ≠ путь до прода», обновить ссылки на CI.
- IdP spike закрывается (Authentik vs Zitadel) → конкретный сервис вместо placeholder `idp` в §3.1.
- TrueNAS Scale major upgrade (25.x) → проверить, не сломались ли Apps Docker.
- Observability stack активируется (DSO-32) → `compose.observability.yml` промоутится из «optional» в «обычный flow».
- Core RAM на TrueNAS > 18 GB sustained → OQ-8 trigger.

---

## 12. Alternatives considered

Альтернативы к **двухслойной модели** (Portable Contract + Personal Recipe), не к моему recipe'у:

| Alternative                                                                                      | Reason rejected/deferred                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Single hardcoded compose (моя TrueNAS topology прямо в compose.core.yml)**                     | Это исходная формулировка spec'а до challenge'а пользователя. Не работает для второго dev'а; ломает при изменении hardware. Rejected per challenge 2026-05-18.                                               |
| **Полное отсутствие compose в repo — каждый dev пишет свой compose с нуля**                      | Нет SSOT для service contract'а → drift между разработчиками, AI-агенты получают разный context. Никто не уверен какой сейчас базовый стек dev'а. Rejected.                                                  |
| **«Только Tech Lead'овская TrueNAS topology, без override pattern»** (status quo до challenge'а) | Чужие разработчики либо адаптируют под себя ручным форком compose'а (drift!), либо вынуждены копировать мою TrueNAS topology. Rejected.                                                                      |
| **Helm chart / Kustomize вместо Docker Compose overrides**                                       | Overkill для team-of-1+AI. Compose overrides — built-in pattern, поддерживается Docker без extra tooling. Deferred (если когда-то прод уйдёт на k3s — отдельный ADR).                                        |
| **Docker Compose profiles вместо override.yml**                                                  | `profiles:` хороши для on/off для optional services (observability stack), но не для замены volumes. Используем оба паттерна: profiles для optional services, overrides для recipe-specific volumes/network. |

**Recipe-level альтернативы** (для Tech Lead's recipe — почему именно TrueNAS hybrid, а не другие):

| Recipe для Tech Lead                                                       | Reason rejected                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A. TrueNAS-всё (включая api+worker+Next dev)**                           | Haswell i5-4670K (4C/4T, 2013) против i9-9900KF (8C/16T, 2018) — compile в 2.5–3× медленнее на TrueNAS. AI-агент будет ждать `pnpm dev` рестартов. File watcher через SMB/NFS — известная проблема Webpack/Vite/Next.js. Rejected.         |
| **C. Host-only (Docker Desktop / WSL2)**                                   | vmmem.exe жрёт 8–12 GB RAM (соревнуется с IDE + AI-агентами). Все services делят 16 потоков host'а с compile. При reinstall Windows — dev-state пропадает. TrueNAS простаивает. Prod-parity 80% (WSL2 ≈ Linux, но не identical). Rejected. |
| **Поднять Linux VM на host'е и запускать Docker внутри**                   | vmmem-эквивалент с теми же RAM-cost'ами; никакой выгоды против WSL2 + extra hypervisor overhead. Rejected.                                                                                                                                 |
| **Coolify / Portainer на TrueNAS вместо raw docker-compose**               | Coolify — это deploy-orchestrator (как Heroku-like UI), избыточен для local dev. Portainer — UI поверх Docker, заменяет SSH-flow без преимуществ для AI-агента. Deferred.                                                                  |
| **k3s на TrueNAS вместо compose**                                          | Kubernetes overhead для 7–10 контейнеров на dev-стенде неоправдан. Pre-pilot prod может уйти на k3s/k8s — это отдельное решение в ADR на prod-deploy. Deferred.                                                                            |
| **TrueNAS Apps UI вместо SSH compose-file**                                | Apps UI парсит compose неполно (см. §7.4). При update Apps-конфигов теряется git-history. SSH + git'нутый compose — лучший AI-agent flow. Rejected for Phase 0, revisit per OQ-6.                                                          |
| **Off-site replication dev-data**                                          | Dev-data recreatable из миграций + seed. Off-site бэкап — это операция для prod-data, не dev. Rejected.                                                                                                                                    |
| **VPN (Tailscale/WireGuard) для удалённого доступа к стенду**              | Оффлайн-работа не constraint (см. §1). Vendor для VPN — отдельный ADR. Deferred.                                                                                                                                                           |
| **Использовать `dev-stand/` (существующий mobile-app prototype) как базу** | `dev-stand/` — это unrelated Next.js mobile prototype для Beget (см. CLAUDE.md). К local dev environment DS Platform отношения не имеет. Rejected. Файлы остаются как есть.                                                                |

---

## 13. Consequences

### Positive

- **Portable contract → переносится без боли.** Новый dev клонирует repo, копирует `.env.example`, заполняет под свою машину — работает.
- **Каждый dev выбирает свой recipe** — не обязан повторять мой TrueNAS hybrid.
- **Compile/HMR feedback loop на i9-9900KF** (моя машина) — AI-агент работает с минимальной задержкой. У других — по их recipe.
- **C: занят минимально** в моём recipe (~5–10 GB), названные volumes на TrueNAS. В других recipe'ах — по выбору.
- **Prod-parity data layer** — те же images через portable contract, независимо от recipe.
- **ZFS snapshots** = бесплатная «машина времени» для Postgres в моём recipe. В других recipe'ах — pg_dump или VM snapshots.
- **Survives Windows reinstall** в моём recipe (state на TrueNAS); в host-only recipe — risk выше.
- **One SSOT для контракта** (`compose.core.yml` в репо). Recipes — runbook'и.
- **Native Linux Docker** в моём recipe (без WSL2 overhead). Host-only recipe на Windows ловит WSL2 issues.

### Negative

- **Две машины поддерживать** (моя recipe) — TrueNAS upgrades / disk health / network reboots в зону внимания. Другие recipe'ы свободны от этого.
- **Compose.override.yml у каждого dev'а свой** — нет «копипаста и работает». Mitigated: README с recipe'ями + `compose.override.example.yml`.
- **При reboot TrueNAS api валится** в моём recipe — нужны healthchecks и autorestart hooks (§5.6).
- **SSH-wrapper'ы** добавляют один indirection в моём recipe (mitigated DX-скриптами, §9).
- **`dev:reset-db` через SSH+ZFS** медленнее в моём recipe, чем local `docker compose down -v`.

### Risks

- **`truenas.local` mDNS-резолвинг в WSL2** может не работать (известный edge case Windows 11 + WSL2 networking). Mitigation: fallback на статический IP `192.168.1.115` в `/etc/hosts` WSL'а.
- **TrueNAS Haswell EOL** — i5-4670K сошёл с потока поддержки Intel; патчи безопасности приходят редко. Mitigation: TrueNAS Scale — Linux под капотом, актуальное ядро. Не critical для dev-стенда. Replanning по OQ-8.
- **1 Gbit network** добавляет ~100 µs к Postgres query из api. Mitigation: для dev приемлемо; если когда-то заметно — 2.5 Gbit upgrade или 10 Gbit DAC между host и NAS (одноразовая цена, low ops).
- **TrueNAS Apps major upgrade ломает compose-стек** (24.x → 25.x). Mitigation: версия Scale пинится в README; upgrade — separate change с smoke test.
- **ZFS arc shrink при memory pressure** даёт burst latency Postgres. Не критично для dev workload.

---

## 14. Implementation hand-off (двухслойная нарезка)

Implementation split по слоям. Plane-tracking уже создан (DSP-150 milestone + DSP-152..159 sub-issues, обновляются для match нового split'а).

### 14.1 Layer A — Portable contract (в git, target `doctor-school/ds-platform/infra/dev-stand/`)

Делается **первым**, переживает любого разработчика.

1. Создать `infra/dev-stand/` skeleton + portable `.env.example` + `.gitignore` + README skeleton.
2. Написать `compose.core.yml` с named volumes и env-driven hostnames/portами (§3, §7.2).
3. Написать `postgres/init.sql`, `postgres/postgresql.conf.dev`, `centrifugo/config.json` (§7.1).
4. Написать env-driven DX-скрипты `tools/dev/run.mjs` + bash-helpers (§9).
5. Добавить idp в compose (после ADR-0001 §8 spike) + `idp/bootstrap.md` манул для любого IdP.
6. Написать README с: portable bootstrap flow + recipe library (Tech Lead's recipe documented как пример, другие — заглушки).
7. AGENTS.md раздел «Local Dev Stand» — portable правила (env-driven endpoints, command list, snapshot-before-migrate, no-direct-volume-edit).

### 14.2 Layer B — Tech Lead's TrueNAS Hybrid recipe (runbook + личные файлы)

Делается **параллельно** с Layer A, но содержание частично в repo (как recipe-документация) и частично личное.

1. Bootstrap Tech Lead's TrueNAS: SSH ключи, DHCP-резервация, Windows Private profile, OpenSSH client check.
2. ZFS datasets `Daily/dev-*` с tunings (§5.3).
3. TrueNAS firewall rules (§5.4).
4. Periodic Snapshot Task + weekly replication (§5.5).
5. Tech Lead's `~/.ds-platform/compose.override.yml` с bind mounts на ZFS-датасеты.
6. Tech Lead's `~/.ds-platform/.env.local` с реальными секретами + endpoint'ами.
7. Recipe-документация в repo README (§7.4, §5) — для будущих разработчиков и AI-агентов.

### 14.3 Smoke test (контракт-уровень)

Запустить `api` на host'е (любая машина с layer A + любым recipe layer B), достучаться до Postgres+Redis+MinIO+Centrifugo+Cerbos+Mailpit. На Tech Lead's recipe — дополнительно TrueNAS reboot survival check.

Implementation timeline — Спринт 2 (target 29.05, см. Plane DSP-150).

---

## 15. Related ADRs / Деpendencies

**Наследуется от:**

- ADR-0001 — Identity provider shortlist (IdP service в compose, конкретный — после §8 spike).
- ADR-0002 — Backend core (api+worker запускаются на host'е через `pnpm start:dev`).
- ADR-0003 — Data layer (Postgres17+pgvector image, Redis, Cerbos PDP).
- ADR-0004 — Frontend stack (4 Next.js apps на host'е).
- ADR-0006 — Documentation & SSOT (compose-файл живёт в repo, документация рядом).
- ADR-0007 — AI loop (DX-скрипты + AGENTS.md раздел).
- **ADR-0008** — Repo strategy. Dev-stand infra живёт в `infra/dev-stand/` (monorepo с app code). Prod-deploy infra (Coolify/k3s manifests) — отдельный repo, отдельный ADR при первом prod-deploy.
- ADR-0011 — Egress control plane (LAN-coverage классификация для AI-агента).
- Engineering-readiness spec — runtime tooling (Vault/Unleash/Outline triggers).

**Делегировано:**

- Конкретный IdP (Authentik vs Zitadel) — ADR-0001 §8 spike.
- Prod-deploy compose (Coolify / k3s / manual) — отдельный ADR в pre-pilot.
- Local LLM compose-фрагмент — OQ-5.
- Multi-developer namespace pattern — OQ-2.

**Влияет на:**

- AGENTS.md / CLAUDE.md — bootstrap раздел «Local Dev Stand».
- ADR-0008 §2.10 step 22 (smoke test первой feature-spec) — будет использовать этот стенд.
- DSO-32 (Pre-pilot stack-dependent unpack) — `compose.observability.yml` промоутится туда.
