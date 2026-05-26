---
title: "ADR-0012 — Deployment Topology v1 (production cluster shape + preview environments) для DS Platform [RU]"
description: "После DSO-59 зафиксирован v1 availability target = 99.0% single-AZ (ADR-0002 §5.6) с cost envelope ≤30k ₽/мес. Эти рамки определяют форму..."
lang: ru
---

> **EN:** [`0012-deployment-topology-v1-en.md`](./0012-deployment-topology-v1-en.md) · **RU (this)**

# ADR-0012 — Deployment Topology v1 (production cluster shape + preview environments) для DS Platform

**Дата:** 2026-05-18
**Статус:** Accepted
**Связан с:** Plane DSO-53 (`fb3e57f2-6602-40ea-af66-f29694dc5002`), milestone DSO-10 (infra readiness), DSO-59 (v1 availability target — ADR-0002 §5.6)
**Lift source:** ADR-0003 §8 (cluster topology v1), backend-core-design §5.8 (capacity planning + infra footprint)
**Наследует:** ADR-0002 (NestJS API + BullMQ + Centrifugo), ADR-0003 (Postgres 17 + Redis 7 + canonical backup topology §2.4), ADR-0002 §5.6 (99.0% v1 single-AZ, maintenance window 02:00–06:00 МСК)

---

## Context

После DSO-59 зафиксирован v1 availability target = **99.0% single-AZ** (ADR-0002 §5.6) с cost envelope ≤30k ₽/мес. Эти рамки определяют форму prod-кластера. До настоящего ADR deployment topology была декларативно зафиксирована в ADR-0003 §8 как side-decision data-layer ADR и в backend-core-design §5.8 как capacity table — без формального сравнения с альтернативными оркестраторами и с противоречием в инвентаре Redis (§5.8 показывал «3× Redis Sentinel», ADR-0003 §8 — «single-node Redis acceptable v1, HA trigger >1000 active users»).

DSO-53 (originally «Принять ADR-0003: deployment topology DS Platform») мигрирована в ADR-0012, чтобы:

1. Дать оркестратору формальный artifact выбора с rejected alternatives.
2. Закрыть staging-topology open question из ADR-0003 §8 (formally deferred до pilot transition).
3. Зафиксировать preview-environments topology, явно не описанную ни в одном предыдущем ADR.
4. Починить Redis-inconsistency между backend-core §5.8 и ADR-0003 §8.
5. Закрыть ADR-0002 OQ10.

---

## Decision

### 1. Production v1 = 2-VPS docker-compose

Два VPS на Timeweb, объединённые через Timeweb private network:

- **`api-prod`** — компоненты API-плоскости: NestJS API + BullMQ workers + Centrifugo + nginx (TLS + reverse proxy + virtual hosts).
- **`data-prod`** — компоненты persistence-плоскости: PostgreSQL 17 + Redis 7 (single-node) + pgbackrest sidecar (cron + WAL archive).

Каждый VPS запускает один `docker-compose.yml` с явно перечисленными сервисами. Health-чеки, ресурс-лимиты, restart-policy = `unless-stopped`. Private network между api-prod и data-prod — единственный канал доступа к данным; data-prod не имеет публичного IP.

### 2. Preview environments — отдельный `preview-vps`

Отдельный VPS с Coolify (или Dokploy — выбор оператора фиксируется в DSO-10, не в этом ADR). На VPS — общий пул PR-environments: контейнеры приходят при открытии PR, уходят при close/merge. Размерность v1 — 1 vCPU / 2 GB / 30 GB. Upgrade trigger — OQ-T4 ниже.

### 3. Permanent staging — deferred до pilot transition

Pre-pilot имеет 0 реальных юзеров: permanent staging не оправдан ни smoke-testing'ом (покрыт per-PR preview), ни load-testing'ом (нет baseline данных). Permanent staging spin up — синхронно с pre-pilot → pilot transition (тот же триггер, что в ADR-0002 §5.6 / OQ-D7 ADR-0003). Топология permanent staging добавляется в этот ADR в момент введения.

### 4. Orchestrator: docker-compose

Rejected alternatives — §Rejected ниже. docker-compose выбран как mainstream-стандарт для команды 1–2 без kubernetes-discipline; вся существующая инфра (Plane на DSO-13, Zitadel, KB) уже на docker-compose, AI-агенты пишут его лучше всех альтернатив.

### 5. Maintenance window

Weekly window 02:00–06:00 МСК (один слот) исключён из SLO calculation (наследуется из ADR-0002 §5.6). Конкретный график (день недели, длительность каждого окна) — операционный детайл, фиксируется в DSO-10 readiness checklist.

### 6. Зависимости на shared-tooling VPS (вне scope этого ADR)

DS Platform prod зависит от сервисов на отдельном `shared-tooling` VPS (вне scope ADR-0012, фиксируется DSO-10):

- **Verdaccio** — npm pull-through mirror (защита CI от блокировок upstream npm).
- **Harbor / Nexus** — Docker registry mirror.
- **Loki + Tempo + Prometheus + Grafana** — observability bundle (data-prod и api-prod отгружают логи/метрики/traces).
- **GlitchTip** — error tracking.
- **Zitadel** — IdP (ADR-0001 §8, закрыто по DSP-209).
- **Vault** — KEK storage для encrypted backups (ADR-0003 §2.4).

Эти сервисы — shared infra (используются также Plane / KB / Mattermost / Outline). Их sizing и cost — в DSO-10, не дублируется здесь.

---

## Process inventory v1

| VPS       | Контейнер            | Образ (примерно)                      | CPU/RAM лимит | Назначение                                                                           |
| --------- | -------------------- | ------------------------------------- | ------------- | ------------------------------------------------------------------------------------ |
| api-prod  | nginx                | nginx-stable-alpine                   | 0.2 / 128M    | TLS termination, reverse proxy, static fallback                                      |
| api-prod  | api                  | ds-api:vN (NestJS)                    | 2.0 / 2G      | основной HTTP API                                                                    |
| api-prod  | generic-worker       | ds-api:vN (NestJS, worker entrypoint) | 1.0 / 1G      | BullMQ generic queue (ledger, audit emit, PDF)                                       |
| api-prod  | notifications-worker | ds-api:vN (NestJS, worker entrypoint) | 0.5 / 512M    | BullMQ notifications queue (SMS, email, push)                                        |
| api-prod  | centrifugo           | centrifugo:v6                         | 0.5 / 512M    | realtime gateway (вебинары, presence)                                                |
| data-prod | postgres             | postgres:17-bookworm                  | 2.0 / 4G      | primary DB                                                                           |
| data-prod | redis                | redis:7-alpine                        | 0.5 / 1G      | cache + BullMQ broker + volatile concerns (см. ADR-0003 §7)                          |
| data-prod | pgbackrest           | pgbackrest custom Docker              | 0.3 / 256M    | cron daily basebackup + 15-min WAL → Timeweb Object Storage + weekly sync → Beget S3 |

**Total api-prod:** ~4.2 vCPU / ~4.5 GB (бьётся в 4 vCPU / 8 GB Timeweb tier с буфером).
**Total data-prod:** ~2.8 vCPU / ~5.3 GB (бьётся в 4 vCPU / 8 GB Timeweb tier с буфером).

Cerbos embedded mode (ADR-0003 §4) — внутри `api` и worker'ов (in-process), не отдельный контейнер.

Backup orchestration (rclone Timeweb → Beget) запускается тоже как pgbackrest-sidecar cron на data-prod.

---

## Cost envelope v1

| Компонент                                | Tier                             | Цена ₽/мес (Timeweb 2026-Q2) |
| ---------------------------------------- | -------------------------------- | ---------------------------- |
| api-prod VPS                             | 4 vCPU / 8 GB / 80 GB SSD        | 4 500–5 500                  |
| data-prod VPS                            | 4 vCPU / 8 GB / 200 GB SSD       | 6 500–8 000                  |
| preview-vps                              | 1 vCPU / 2 GB / 30 GB SSD        | 600–900                      |
| Timeweb Object Storage (backups primary) | ~50 GB                           | 200–400                      |
| Beget S3 (offsite weekly)                | ~50 GB                           | 200–400                      |
| Timeweb CDN                              | 50 GB egress/мес                 | 500–1 500                    |
| Static IP × 2                            | api-prod public + preview public | 200–400                      |
| **Total v1 prod + preview**              |                                  | **~12 700–17 100 ₽/мес**     |

Shared-tooling VPS (Verdaccio + observability + IdP + Vault) — shared infra, cost проходит по DSO-10 budget, не дублируется здесь (~8–12k ₽/мес отдельно).

**Total DS Platform prod-direct cost:** ~12–17k ₽/мес. С запасом на CDN-всплески, snapshot-storage, мелкие сервисы — ~20–25k ₽/мес. Помещается в envelope ≤30k ₽/мес (DSO-59).

---

## Rejected alternatives

### Single-VPS docker-compose (api + data на одном VPS)

**Rejected.** Postgres OOM/IO-spike коллапсит API; OOM-killer kills randomly; backup cron конкурирует с API за IO. На v1-budget Timeweb tier 4 vCPU / 8 GB ресурсная подушка не достаточна для co-location.

### Multi-VPS + nginx LB (3+ api-VPS за внешним LB)

**Rejected.** v1 нагрузка ~50 RPS peak (backend-core §5.8); один api-VPS с буфером покрывает. Multi-instance даёт horizontal scale-out, но при 99.0% SLO single-AZ + одной точке отказа на data-prod — это не reliability improvement, а только +cost +ops-burden. Re-evaluate trigger: v2 при >500 RPS или OQ-D7 ADR-0003 (HA Postgres) активирован.

### K3s self-hosted

**Rejected.** Полноценный kubernetes (хоть и slim K3s) добавляет: control-plane overhead на маленьких VPS (~500M RAM на ноду), etcd backup discipline, требование 3-node control-plane для HA (что само по себе превышает v1 budget). Команда 1–2 без active k8s opex'а — это не sustainable на маленьком scope. **AI-агентам** легче писать docker-compose YAML, чем k8s manifests, при сопоставимой выразительности на v1 scope. **Re-evaluate triggers:** v2 при ≥3 api-replicas + cross-VPS distributed state (sessions / cache), или при наличии в команде dedicated DevOps-инженера с k8s background. ADR-0011 §125 уже отметил, что k8s отсутствует pre-pilot.

### Nomad

**Rejected.** HashiCorp-стек в РФ-комьюнити слабее k8s, в команде не используется (нет Consul / Vault кроме Vault-as-KEK), AI пишет hcl-конфиги хуже Compose-yaml. Совмещает минусы k8s (overhead) с минусами docker-compose (нет advanced scheduling) без чистых плюсов. Не пересматривается до v3.

### Docker Swarm

**Rejected.** Deprecated path (Docker Inc. больше не активно развивает), в РФ-комьюнити мёртв, AI часто пишет outdated patterns. Не пересматривается.

### Managed Kubernetes (Timeweb Managed k8s / Yandex Cloud Managed k8s)

**Rejected.** Снимает control-plane ops с команды, но: (a) сохраняет k8s discipline overhead в коде (manifests, helm-charts, operators) — AI-friendliness ниже docker-compose; (b) provider lock-in на kube-API-level выше, чем на docker-compose-level; (c) managed-tier cost premium ~30-50% поверх self-hosted VPS при сопоставимом scale v1; (d) Yandex Managed k8s — внешний провайдер для PD-обработки, +1 processor для 152-ФЗ DPA. Триггер пересмотра — тот же, что у OQ-T3 (K3s self-hosted) — managed заходит вместе с self-hosted в один и тот же момент решения.

---

## Open questions (deferred)

| OQ                                                                         | Trigger пересмотра                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OQ-T1.** Permanent staging environment topology                          | Pre-pilot → pilot transition (тот же триггер, что OQ-D7 ADR-0003)                                                                                                                                                                                                                                                                     |
| **OQ-T2.** Multi-VPS HA для data-plane (Postgres replica + Redis Sentinel) | OQ-D7 ADR-0003 (v2 HA target 99.5%)                                                                                                                                                                                                                                                                                                   |
| **OQ-T3.** Migration к K3s                                                 | (a) ≥3 api-replicas requirement, ИЛИ (b) cross-VPS distributed-state requirement, ИЛИ (c) в команде появляется dedicated DevOps-инженер с k8s background                                                                                                                                                                              |
| **OQ-T4.** Preview-VPS pool size + sizing                                  | (a) PR-throughput >5/день, ИЛИ (b) OOM-кратность на preview-vps ≥1/неделю                                                                                                                                                                                                                                                             |
| **OQ-T5.** Backup off-site provider re-evaluation                          | Если Beget S3 становится недоступен / некомпатибилен с pgbackrest                                                                                                                                                                                                                                                                     |
| **OQ-T6.** Geographic redundancy (multi-region / cross-DC)                 | v3 при ≥1M MAU или явное regulatory requirement                                                                                                                                                                                                                                                                                       |
| **OQ-T7.** Log-shipping topology + sidecar buffer                          | Если shared-tooling VPS (где живёт Loki/Tempo/Prometheus) даст >1 outage/мес или observability-gap во время outage'а будет critical. Кандидаты: Promtail с local queue, Vector с persistent buffer на api-prod/data-prod, отдельный durable-spool. Pre-pilot: log loss во время outage'а приемлем; pilot transition — пересматриваем. |

---

## Consequences

### Положительные

- Минимальный ops-overhead для команды 1–2: docker-compose уже использован в shared-tooling / Plane / Zitadel, дисциплина та же.
- AI-агенты пишут docker-compose YAML консистентно между сессиями (mainstream + большой обучающий датасет).
- Изоляция api ⟷ data: OOM/IO в одном плоскости не разрушает другую.
- Cost envelope ≤30k ₽/мес выполнен с запасом (~20–25k ₽/мес).
- Preview-vps обеспечивает PR-environments без касания prod.

### Отрицательные

- 2-VPS = 2 separate failure domains (vs 1 на single-VPS), но 1 SPOF per plane (vs HA cluster). Принято в рамках 99.0% v1 SLO (ADR-0002 §5.6).
- docker-compose не имеет встроенного rolling-update — deploy через `docker compose up -d` с image-tag bump = short downtime (<60s) ИЛИ ручной blue-green с nginx upstream switch. Pilot trigger blue-green automation — engineering-readiness §1.
- Нет автоматического failover'а: data-prod-VPS down = manual restore из ADR-0003 §2.4 backup (RTO ≤2 ч). Соответствует SLO.
- Preview-vps shared pool — при 5+ concurrent PR ресурсы кончаются (OQ-T4 trigger).

### Архитектурные качества (метрики, не декларации)

| Качество                | Метрика                                | v1              | v2                      |
| ----------------------- | -------------------------------------- | --------------- | ----------------------- |
| Availability            | uptime SLO (наследуется ADR-0002 §5.6) | 99.0%           | 99.5% (HA trigger)      |
| Recoverability          | RTO (manual restore, ADR-0003 §2.4)    | ≤2 ч            | ≤5 мин (HA)             |
| Data integrity          | RPO (WAL gap, ADR-0003 §2.4)           | ≤15 мин         | ≤5 мин                  |
| Deploy frequency        | целевая                                | ≥1/неделю       | ≥1/день                 |
| Deploy duration         | от merge до prod                       | ≤30 мин         | ≤10 мин                 |
| Maintenance window      | weekly                                 | 02:00–06:00 МСК | то же или уже           |
| Preview env spin-up     | от PR-open до URL                      | ≤5 мин          | ≤2 мин                  |
| PR-throughput supported | concurrent PR environments             | ≤3 без OOM      | масштабируется по OQ-T4 |

---

## Cross-references

- **ADR-0002 OQ10** — CLOSED 2026-05-18 (DSO-53), see this ADR.
- **ADR-0003 §8** — content lifted here; original section now a stub-pointer.
- **ADR-0002 §5.6** (DSO-59) — v1 availability 99.0% + maintenance window source.
- **ADR-0003 §2.4** — canonical backup topology (наследуется).
- **ADR-0003 §8** — Redis single-node v1 policy + HA trigger.
- **Backend-core-design §5.8** — capacity table; Redis-count fixed синхронно с этим ADR.
- **Engineering-readiness §1** — CI/CD, preview-env tooling (Coolify/Dokploy), blue-green pilot.
- **DSO-10** — infra readiness checklist (maintenance schedule, shared-tooling sizing, Verdaccio + observability deploy).
- **DSO-70** — local dev environment (separate scope, не пересекается).
- **ADR-0011 §125** — k8s deferred to Phase 1+ (consistent с OQ-T3 здесь).

---

## Verification

После применения ADR-0012 грепом убедиться:

```bash
# Не должно быть «3× Redis Sentinel» / «Sentinel минимум 3 узла» нигде кроме исторических объяснений
grep -rn "3× Redis\|3x Redis\|Sentinel минимум\|Sentinel minimum\|Sentinel auto-failover" docs/

# Не должно быть упоминаний «ADR-0003 deployment topology» как актуальной ссылки
grep -rn "ADR-0003.*deployment\|deployment.*ADR-0003" docs/

# ADR-0002 OQ10 должен быть CLOSED
grep -n "OQ10" docs/adr/0002-backend-core-stack-{ru,en}.md

# ADR-0003 §8 должен быть stub-pointer на ADR-0012
grep -n "Cluster topology v1\|Cluster shape v1" docs/adr/0003-data-layer-stack-{ru,en}.md
```
