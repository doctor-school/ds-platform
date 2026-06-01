---
title: "DS Platform — Local Developer Environment (Design)"
description: "Portable contract (in git, for all developers) + personal deployment recipes for the local dev stand — Compose stack, container isolation, TrueNAS hybrid reference recipe."
slug: local-dev-environment-setup
status: Implemented
lang: en
---

> **RU:** [`2026-05-18-local-dev-environment-setup-design-ru.md`](./2026-05-18-local-dev-environment-setup-design-ru.md) · **EN (this)**

# DS Platform — Local Developer Environment (Portable Contract + Personal Recipes) — Design

**Date:** 2026-05-18 (rewritten 2026-05-18 evening after challenge: split portable contract vs personal deployment)
**Status:** Implemented (Phase-0 scope shipped 2026-06-01 — see "Implementation status" below)
**Type:** Platform-level design (portable contract — in git, for all developers) + reference recipe (Tech Lead's TrueNAS hybrid — runbook, personal topology outside git). The platform-level part may become an ADR on first shared use; Tech Lead's recipe is a runbook, not architecture.
**Linked:** Plane DSO-70 (`8c4b69c2-7df6-45b5-8d7c-34c8b682eda8`), milestone DSO-10
**Applies (not inherits — this is a setup document):** ADR-0001 (Identity), ADR-0002 (NestJS+Fastify+BullMQ), ADR-0003 (Postgres17+Drizzle+Redis), ADR-0004 (Next.js 15 + 4 apps), ADR-0005 (RN+Expo), ADR-0007 (AI loop), ADR-0008 (repo strategy), ADR-0011 (egress control plane), engineering-readiness spec

---

## 0. Implementation status

**Phase-0 scope — Implemented (2026-06-01).**

- **Layer A — portable contract (§14.1):** shipped to `infra/dev-stand/` (`compose.core.yml` with all seven core services — postgres/redis/minio/idp/centrifugo/cerbos/mailpit — `.env.example`, `postgres/`, `centrifugo/`, `cerbos/`, `idp/bootstrap.md`, README) and `tools/dev/run.mjs`. Tracked under Plane milestone DSP-150 (sub-issues DSP-152..159).
- **Layer B — TrueNAS Hybrid reference recipe (§14.2):** recipe scripts in `tools/dev/recipes/truenas-hybrid/` (`snapshot.sh`, `rollback.sh`); personal `.env.local` / `compose.override.yml` kept outside git.
- **Contract smoke test (§14.3):** `pnpm dev:smoke` (DSP-159).
- **AGENTS.md §9 "Local Dev Stand":** portable rules + DX-command cheat sheet shipped.

**Deferred by design** (revisit triggers in §11, not gaps): `compose.observability.yml` → DSO-32; `compose.future.yml.example` (outline/unleash/vault) → by trigger; Zitadel OIDC-application bootstrap → first OIDC consumer.

---

## 1. Context

DS Platform tech stack is fixed in ADR-0001..0011: NestJS+Fastify api+worker, Postgres17+Drizzle+pgvector, Redis, MinIO-compatible object storage, Zitadel (closed per ADR-0001 §8 / DSP-209), Centrifugo, Cerbos, four Next.js 15 apps (promo/portal/admin/cms), RN+Expo (Pre-pilot phased to PWA), observability stack (Loki+Grafana+GlitchTip+Outline+Unleash, Pre-pilot).

ADR-0008 §2.10 covers repo bootstrap (Sprint 3), but **where this stack physically runs on a developer's machine — no ADR addresses this.** Prod deploys are built by CI on dedicated servers per ADR-0008 §2.8 and engineering-readiness spec; "local → prod" as a deploy pattern is not supported. This spec covers **the developer workstation during Phase 0–Pre-pilot**, not production.

**Platform-level requirements** (what any developer needs from the stand, not tied to specific hardware):

- **AI agents** are the primary development mechanism. Compile/HMR feedback loop must be fast (depends on the developer's host; the contract does not prescribe).
- **Prod parity on data layer:** same images (Postgres major version, extensions) as in prod. This is part of the contract.
- **Single source of truth for service composition** — one `compose.core.yml` in git, shared across developers.
- **Source code always on the developer's host** (file watcher, IDE, AI agent run on local NVMe).
- **AI-agent-friendly tooling** — DX scripts are env-driven so AGENTS.md rules work regardless of recipe.
- **ADR-0011 compatibility** (egress control plane): LAN endpoints classified as trusted, not routed through the PII scanner.
- [[feedback_tech_stack_criteria_no_team_skill]]: criteria in the spec are objective platform requirements, not "the team knows X".
- [[feedback_docs_as_ssot]]: the portable contract (compose, .env.example, AGENTS.md) lives in git as the single source.

**Personal-level preferences** (Tech Lead's motivations that drove the design of his recipe — see §5):

- Save space on C: (my SSD is shared with games/media).
- ZFS snapshots as a "time machine" for Postgres before migrations.
- The stack's state survives a Windows reinstall.

These are **why I chose the TrueNAS Hybrid recipe**, not platform-level constraints. Another developer with different preferences will choose a different recipe.

**Non-constraints (at the platform level):**

- Mobility / offline work — recipe-specific. For me — no (always at home LAN); a future contractor may differ → their recipe handles it.
- Multi-developer right now (Product Lead does not write code this quarter; recipe-library revisit trigger — §11).
- Stand high availability: a machine reboot = temporary api unavailability ≈ OK for dev.
- Early Vault/Unleash/Outline activation: deferred per engineering-readiness spec.

---

## 2. Decision — two-layer model: Portable Contract + Personal Recipe

### 2.1 Principle

A local dev environment is **two independent layers**:

| Layer                               | Defines                                                                                                                   | Lives in                                                                           | Decided by                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------- |
| **A. Portable contract** (in git)   | Which services exist, their images/versions, ports, env-var names they expect, healthchecks, named volumes / mount points | `doctor-school/ds-platform/infra/dev-stand/` (after repo bootstrap per ADR-0008)   | Platform-level (same for every developer) |
| **B. Personal recipe** (NOT in git) | Which Docker daemon to use, hostname / IP, real disk paths, real passwords, network mode, backup strategy                 | Developer's personal files (`.env.local`, `compose.override.yml`, private runbook) | Each developer for their own hardware     |

**The contract (layer A)** guarantees: a new developer clones the repo, copies `.env.example` → `.env.local`, fills it in for their machine, runs → all services come up as the platform expects.

**The recipe (layer B)** captures: the developer describes their specific topology (everything on host via Docker Desktop? on a NAS? in a cloud VM?) — that's **their choice**, not a platform decision.

### 2.2 Source code always lives on the developer's host

Regardless of recipe: `apps/*`, `packages/*` live on the developer's local NVMe (for file watcher, IDE, AI agent). Remote Docker hosts (TrueNAS, cloud VM) only receive Docker volumes — never source code.

### 2.3 Reference recipe: "TrueNAS Hybrid" (Tech Lead) — §5–§6

The spec documents one full recipe — my setup (i9-9900KF host + TrueNAS Scale 24.10 for stateful services). This is a **reference implementation**, not a mandate. See §5 (ZFS layout), §6 (snapshot policy). Future developers add their own recipes to the README — or simply use the platform contract without publishing their recipe.

### 2.4 Where the compose contract itself lives

The compose contract lives at `infra/dev-stand/` in this repository (monorepo with the application code) — DS infra lives **with the DS platform**, alongside the code it supports.

### 2.5 Host → Docker daemon link (recipe-driven)

The contract does not specify how the host reaches the Docker daemon — that's recipe-specific:

- Tech Lead's recipe: wrappers through `ssh.exe` running `sudo docker` as user `claude` (see §5+§9). `DOCKER_HOST=ssh://claude@truenas.local` is deferred — it needs `claude` in the `docker` group, which the shared box deliberately avoids in favour of `sudo docker` (§11 OQ-1).
- "Host-only" recipe: `DOCKER_HOST` unset, local Docker Desktop / WSL2.
- "Cloud VM" recipe: `DOCKER_HOST=ssh://...` or Tailscale tunnel.

No VPN in the Phase 0 baseline (offline work is not a constraint).

---

## 3. Portable contract: services, ports, env names

This is the part **in git**. Identical for every developer. Volumes use **env-driven paths** (`${DS_DATA_PATH:-./data}/postgres`), not absolute paths. Service hostnames are internal compose names (`postgres`, `redis`...). Host-side endpoints are env-driven (`DATABASE_URL`, `REDIS_URL`...).

### 3.1 Core stack (always-on in any recipe)

| Service                          | Image                                                            | External port (for host access) | Container | RAM (typical)                         | Host-side consumer                                                  |
| -------------------------------- | ---------------------------------------------------------------- | ------------------------------- | --------- | ------------------------------------- | ------------------------------------------------------------------- |
| `postgres`                       | `pgvector/pgvector:pg17` (Postgres 17 base + pgvector extension) | 5432                            | 5432      | 1–4 GB                                | api, worker, admin, cms, payload                                    |
| `redis`                          | `redis:7-alpine`                                                 | 6379                            | 6379      | 256 MB                                | api (cache + sessions), worker (BullMQ broker), Centrifugo (PubSub) |
| `minio`                          | `minio/minio:latest`                                             | 9000 (S3) + 9001 (console)      | 9000+9001 | 512 MB                                | api (uploads), Payload (media), mobile (offline cache target)       |
| `idp` (Zitadel, per ADR-0001 §8) | `ghcr.io/zitadel/zitadel:latest` (single Go binary)              | 9080 (HTTP+gRPC h2c)            | 8080      | 256–512 MB (binary) + shared Postgres | api (JWT issuer), all web apps (OIDC login)                         |
| `centrifugo`                     | `centrifugo/centrifugo:v6`                                       | 8000                            | 8000      | 128 MB                                | api (publish), web/mobile (WS subscribe)                            |
| `cerbos`                         | `ghcr.io/cerbos/cerbos:latest`                                   | 3592 (HTTP), 3593 (gRPC)        | 3592/3593 | 128 MB                                | api (PDP queries)                                                   |
| `mailpit`                        | `axllent/mailpit:latest`                                         | 1025 (SMTP), 8025 (UI)          | 1025/8025 | 64 MB                                 | api (email dev catch-all)                                           |

**Total core RAM:** ≈ 4–8 GB working set. Recipe-specific: whether this fits on your machine is your check. On Tech Lead's recipe (TrueNAS hybrid) — OK (≈18–20 GB usable).

### 3.2 Observability stack (optional, on-demand)

Started via a separate compose file (`compose.observability.yml`) only when needed. Not started for every dev session — saves RAM.

| Service     | Image                        | Host port        | RAM                        |
| ----------- | ---------------------------- | ---------------- | -------------------------- |
| `loki`      | `grafana/loki:latest`        | 3100             | 512 MB                     |
| `grafana`   | `grafana/grafana:latest`     | 4000             | 256 MB                     |
| `glitchtip` | `glitchtip/glitchtip:latest` | 8001             | 512 MB + internal Postgres |
| `promtail`  | `grafana/promtail:latest`    | — (host network) | 128 MB                     |

### 3.3 Future / deferred

`outline` (8002), `unleash` (4242), `vault` (8200) — added as compose fragments by trigger (see §11). Not in initial skeleton.

### 3.4 Host-side ports (for reference)

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

**No port conflicts within TrueNAS services** (5432, 6379, 8000, 8001, 9000, 9001, 9080, 9443, 3100, 4000, 1025, 8025, 3592, 3593). Host-side ports (3000–3005, 4001, 8081) live on a separate machine and do not collide.

---

## 4. Portable contract: env-vars and network model

### 4.1 `.env.example` — template in repo

```env
# === Docker host (recipe-specific) ===
# Tech Lead's recipe: leave empty — uses sudo-docker wrappers over ssh (user claude)
# Host-only recipe: leave empty
DOCKER_HOST=

# === Service endpoints (recipe-specific hostnames) ===
DATABASE_URL=postgres://ds:CHANGE_ME@HOST:5432/ds_dev
REDIS_URL=redis://HOST:6379
S3_ENDPOINT=http://HOST:9000
S3_REGION=us-east-1
S3_BUCKET_UPLOADS=ds-uploads-dev
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=CHANGE_ME
IDP_ISSUER=http://HOST:9080
IDP_EXTERNAL_DOMAIN=localhost
IDP_CLIENT_ID=ds-platform-dev
IDP_CLIENT_SECRET=CHANGE_ME
CENTRIFUGO_URL=http://HOST:8000
CENTRIFUGO_API_KEY=CHANGE_ME
CERBOS_URL=http://HOST:3592
SMTP_HOST=HOST
SMTP_PORT=1025

# === Data volume root (recipe-specific) ===
# Tech Lead's TrueNAS recipe: DS_DATA_PATH=/mnt/dev-stand
# Host-only recipe (named volumes): leave empty → compose uses named volumes
DS_DATA_PATH=

# === Compose-side secrets ===
POSTGRES_PASSWORD=CHANGE_ME
MINIO_ROOT_PASSWORD=CHANGE_ME
IDP_SECRET_KEY=CHANGE_ME
```

`.env.example` is committed. `.env.local` (with real values) is gitignored.

### 4.2 Compose network model

Bridge network + port publication on `0.0.0.0:<port>`. Service hostnames inside compose — standard names (`postgres`, `redis`, ...) — used for inter-container traffic.

External hostnames — recipe-specific (see §5+).

### 4.3 Firewall — recipe-specific

Specific to each deployment. Tech Lead's recipe (TrueNAS Scale 24.10) — no firewall change needed: the box has no host-level inbound filter, LAN ports are reachable as-is (see §5.4). Host-only recipe — Windows Firewall unchanged (localhost-only).

---

## 5. Reference recipe "TrueNAS Hybrid" (Tech Lead) — details

This is **one possible deployment recipe**. Documented as a reference for other developers and for AI agents working in my session. Personal paths / IP addresses go into `.env.local` (not in git).

**Hardware for this recipe (my home gear):**

| Node                               | Spec                                                                                                                                                                                                |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Host**                           | Intel i9-9900KF (8C/16T, Coffee Lake Refresh, 3.6 GHz base / ~5 GHz boost) · 32 GB RAM · 1 TB NVMe SSD · RTX 2070S · Windows 11 Pro 26200                                                           |
| **TrueNAS** (LAN, `192.168.1.115`) | TrueNAS Scale 24.10 ElectricEel · Intel i5-4670K (4C/4T Haswell, 3.4 GHz) · 24 GB RAM (≈18–20 GB usable after ZFS ARC) · Daily SSD pool 900 GB · RaidPool 449 GB · Media pool 7.14 TiB · 1 Gbit LAN |
| **Network**                        | Home LAN, always reachable                                                                                                                                                                          |

### 5.1 Hardware reasoning (why hybrid)

Host i9-9900KF (8C/16T, 32 GB RAM, 1 TB NVMe) handles app processes with minimal compile latency. TrueNAS i5-4670K (4C/4T Haswell, 24 GB RAM) — weak for compile, but native Linux Docker + ZFS snapshots make it ideal for stateful services. 1 Gbit LAN adds ~100 µs to each Postgres query — negligible for dev workload.

Alternative recipes (host-only / cloud VM) may discard this split — but mine wins on C: space savings + ZFS snapshots + native Linux Docker without WSL2 overhead.

### 5.2 mDNS resolution (Tech Lead's network)

TrueNAS Scale 24.10 publishes `truenas.local` via avahi. Windows 11 26200 supports mDNS out of the box.

**Caveat 1 (Windows network profile):** the Windows mDNS resolver works only when the network profile is **Private**. On a fresh Windows install / after a profile reset `truenas.local` silently fails until switched. Bootstrap checklist for this recipe verifies (`Get-NetConnectionProfile`).

**Caveat 2 (WSL2):** mDNS inside WSL2 default NAT mode **does not work** (open bug microsoft/WSL#12354). DX scripts run via native Windows `ssh.exe`, not WSL2 bash. If api runs from WSL2 — fallback to static IP in WSL `/etc/hosts` OR `networkingMode=mirrored` (WSL 2.3.17+).

Static IP fallback: `192.168.1.115` (DHCP reservation on router).

### 5.3 ZFS dataset layout (Tech Lead's recipe)

```
Daily SSD pool (900 GB)
├── Daily SSD/dev-postgres        # Postgres pgdata,   mountpoint /mnt/dev-stand/postgres
├── Daily SSD/dev-redis           # Redis AOF/RDB dumps,         /mnt/dev-stand/redis
├── Daily SSD/dev-minio           # MinIO buckets storage,       /mnt/dev-stand/minio
├── Daily SSD/dev-centrifugo      # Centrifugo state (small),    /mnt/dev-stand/centrifugo
├── Daily SSD/dev-cerbos-policies # Cerbos PDP policies,         /mnt/dev-stand/cerbos-policies
└── Daily SSD/dev-observability   # Loki/Grafana/GlitchTip,      /mnt/dev-stand/observability

RaidPool (449 GB) — reserved for per-feature snapshot clones (§5.5 OQ-2); free until trigger.
Media (7.14 TiB) — off-host ZFS replication target.
```

> **Note (DSP-155 implementation):** the SSD pool is named `Daily SSD` (with a space), not `Daily` — datasets are `Daily SSD/dev-*`. The space stays only inside `zfs` commands (always quoted); each dataset carries an explicit `mountpoint=/mnt/dev-stand/<name>`, so Docker bind-mount paths are space-free.

> **Note (DSP-157):** `idp` (Zitadel) has no dataset of its own — it is DB-backed (config, users, orgs, signing keys, assets all live in the shared Postgres), so its reboot-persistence rides on `dev-postgres`.

**Recordsize tuning:**

- `Daily SSD/dev-postgres`: `recordsize=16K`, `compression=lz4`, `atime=off`, `logbias=throughput`, `primarycache=metadata`. **Caveat:** `primarycache=metadata` is effective when `shared_buffers` covers the working set. The current dev `shared_buffers=512MB` against a ~4 GB working set may cause a cold-read penalty — if observed, switch to `primarycache=all` (open ZFS discussion openzfs/zfs#15400).
- `Daily SSD/dev-minio`: `recordsize=1M`, `compression=lz4`, `atime=off`.
- `Daily SSD/dev-redis`: `recordsize=128K`, `compression=lz4`.

In `compose.override.yml` (Tech Lead's personal file, **not in git**) bind mounts point to these datasets:

```yaml
# ~/.ds-platform/compose.override.yml (gitignored, Tech Lead's recipe)
services:
  postgres:
    volumes:
      - /mnt/dev-stand/postgres:/var/lib/postgresql/data
  redis:
    volumes:
      - /mnt/dev-stand/redis:/data
  # ... etc
```

### 5.4 Firewall + DHCP (Tech Lead's recipe)

- TrueNAS Scale 24.10 ships **no host-level inbound firewall** — the live nftables ruleset contains only Docker's bridge-isolation chains, no `filter hook input`. LAN clients on `192.168.1.0/24` reach the published ports (5432/6379/9000-9001/9080/9443/8000/3100/4000/1025/8025/3592/3593) with no extra configuration — "open the firewall" is a no-op for this recipe. If inbound filtering is ever required, add it explicitly via a custom nftables init script.
- Internet exposure is governed by the router (no port-forwarding to the TrueNAS box), not by a host firewall.
- DHCP reservation `192.168.1.115` for TrueNAS MAC on the router.

### 5.5 Snapshot & backup (Tech Lead's recipe — ZFS-based)

**Why not a TrueNAS Periodic Snapshot Task:** the TrueNAS box is not 24/7. A fixed-time cron task is silently skipped on every day the box is powered off at that hour — TrueNAS Periodic Snapshot Tasks have no catch-up. The recipe instead uses an age-checked, boot-triggered maintenance script, so coverage depends on uptime, not wall-clock time.

**Auto-snapshot:** `/root/dev-stand-maintenance.sh` on TrueNAS, launched ~30 min after each boot via a Post-Init init script (`systemd-run --on-active=30min`). For each `Daily SSD/dev-*` dataset it creates a snapshot only if the newest `@auto-dev-*` snapshot is ≥ 7 days old, then prunes to the last 3. Cadence is effectively "weekly, relative to uptime": the box is configured to auto-shut-down daily, so the boot trigger fires every day and the 7-day age check gates the actual snapshot. Uptime never exceeds ~1 day, so there is no missed-window edge case.

**Off-pool replication:** the same script — if the last replica is ≥ 7 days old — runs an incremental `zfs send -I … | zfs recv` of `Daily SSD/dev-postgres` → `Media/backups/dev-stand/postgres`, then prunes target snapshots older than 4 weeks. Backup for Daily-SSD-pool corruption, not disaster recovery.

**Pre-migration manual snapshot:** before `pnpm drizzle:migrate` AI agent / dev runs `pnpm dev:snapshot pre-mig-<desc>`. Wrapper SSHs into TrueNAS, `zfs snapshot "Daily SSD/dev-postgres@<...>"`. Rollback: `pnpm dev:rollback <snapshot>` (requires `docker compose stop postgres` before `zfs rollback`).

Drizzle pre-migration hook — wrapper in `apps/api/package.json` (see §9.2).

**OQ-2: Per-feature ZFS clone** — when a second dev joins on the same hardware. Not in Phase 0.

### 5.6 Docker autostart on TrueNAS reboot (Tech Lead's recipe)

SSH-managed compose is **not** managed by the TrueNAS Apps supervisor. After reboot, containers come back via `restart: unless-stopped` + Docker daemon autostart. On TrueNAS Scale 24.10, `dockerd` starts as part of the Apps engine — the SSH-managed compose stack rises automatically. **The bootstrap checklist must verify this** on the first reboot (`reboot` → wait → `pnpm dev:status`).

---

## 6. Alternative recipes (placeholder)

Documented as more developers appear. Each recipe = a section in the README with: hardware assumptions, mDNS/network setup, volume strategy (bind / named / cloud), backup policy, autostart guarantees, AI-agent integration notes.

Candidates for future recipes:

- **"Docker Desktop host-only" recipe** — Mac/Linux dev on one machine, named volumes, no remote Docker host. Simplest variant for a new dev.
- **"Cloud VM" recipe** — Hetzner/Selectel small VM, `DOCKER_HOST=ssh://...`, EBS snapshots instead of ZFS. For a distributed-team scenario.

Each developer can: (a) use one of the documented recipes as-is, (b) make a hybrid, (c) publish nothing — as long as the portable contract (§3, §4) is satisfied.

---

## 7. Compose layout

### 7.1 File structure (in git)

```
infra/dev-stand/
├── README.md                                   # bootstrap + recipes library + commands cheat sheet
├── compose.core.yml                            # PORTABLE: services, images, env names, named volumes
├── compose.observability.yml                   # PORTABLE: optional loki/grafana/glitchtip
├── compose.future.yml.example                  # PORTABLE template: outline/unleash/vault — by trigger
├── .env.example                                # PORTABLE: env template (see §4.1)
├── postgres/
│   ├── init.sql                                # PORTABLE: CREATE EXTENSION vector; CREATE DATABASE ds_dev
│   └── postgresql.conf.dev                     # PORTABLE: dev tuning
├── idp/
│   └── bootstrap.md                            # PORTABLE: manual OIDC application setup (any IdP)
├── centrifugo/
│   └── config.json                             # PORTABLE
└── cerbos/
    └── policies/                               # PORTABLE: PDP policies (symlink to packages/cerbos-policies/)
```

**Personal overlay (NOT in git, on developer's machine):**

```
~/.ds-platform/                                 # or another personal location
├── .env.local                                  # real passwords + endpoints (HOST=truenas.local|localhost|...)
└── compose.override.yml                        # per-recipe overrides (bind mounts, DOCKER_HOST, etc.)
```

The repo `.gitignore` excludes `.env.local` and `compose.override.yml` in `infra/dev-stand/` (if a developer puts them there instead of `~/.ds-platform/`).

### 7.2 Volume strategy: portable vs personal

**Portable compose.core.yml** uses **named volumes** (default — Docker manages, isolated per machine):

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
  ds-centrifugo:
```

`idp` (Zitadel) carries no named volume — it is DB-backed, so its state persists in `ds-postgres` (§3.1, §5.3 note).

**Tech Lead's personal `compose.override.yml`** replaces named volumes with bind mounts to ZFS datasets:

```yaml
# ~/.ds-platform/compose.override.yml — gitignored, Tech Lead's recipe
services:
  postgres:
    volumes:
      - /mnt/dev-stand/postgres:/var/lib/postgresql/data
  redis:
    volumes:
      - /mnt/dev-stand/redis:/data
  minio:
    volumes:
      - /mnt/dev-stand/minio:/data
  # ... etc
```

Docker Compose automatically merges `compose.core.yml` + `compose.override.yml` (when both `-f` are given). Override volumes win — `bind:` has priority over `volume:` reference at merge time.

**Principle:** the in-repo contract does not prescribe a storage topology. Each recipe decides (named / bind / network volume / cloud disk).

### 7.3 Bootstrap (general shape)

```
# 1. Clone the ds-platform repo
git clone git@github.com:doctor-school/ds-platform.git
cd ds-platform/infra/dev-stand

# 2. Create your personal .env.local
cp .env.example ~/.ds-platform/.env.local
# Edit values for your machine (HOST, DOCKER_HOST, passwords, paths)

# 3. (Optional) Create a personal override
cp compose.override.example.yml ~/.ds-platform/compose.override.yml
# Edit for your recipe (bind mounts, network mode, etc.)

# 4. Start via the DX script (reads env + override)
pnpm dev:up
```

Then — manual steps in `idp/bootstrap.md` (create OIDC application, scope mapping). Unavoidable for any IdP.

### 7.4 TrueNAS Apps UI vs SSH (Tech Lead's recipe deviation)

Applies only to the "TrueNAS Hybrid" recipe. In my recipe I prefer SSH + direct `docker compose` (not Apps UI):

- Apps UI parses compose incompletely (custom networks, healthchecks lost).
- SSH management mirrors the prod Coolify / manual compose flow.
- AI agents prefer logs/shell via SSH.

Other recipes are not bound by this choice.

---

## 8. AI-agent integration

### 8.1 What an AI agent sees on host (portable + per-recipe)

**Portable rules (in `AGENTS.md` in repo, for everyone):**

- Endpoints are read from `.env.local` (NOT hardcoded in AGENTS.md).
- Commands `pnpm dev:up` / `dev:down` / `dev:logs <service>` / `dev:snapshot <name>` / `dev:rollback <name>` — standard.
- Rule: **"before `pnpm drizzle:migrate` ALWAYS run `pnpm dev:snapshot pre-mig-<short-desc>` first".**
- Rule: **"do not edit files inside volumes directly — that's live data".**
- Baseline failure modes: port in use (`netstat`), compose down (`dev:logs`/`dev:restart`), endpoint unreachable (check `.env.local`).

**Per-recipe AI context (Tech Lead's `~/.ds-platform/AGENT_NOTES.md`, not in git):**

- Recipe-specific endpoints (`truenas.local:5432` for me).
- ZFS-specific failure modes (mDNS not resolving → static IP in hosts; pool corruption → rollback procedure).
- DOCKER_HOST URL.

Other developers keep their AGENT_NOTES.md beside their `.env.local`.

### 8.2 Host → Docker daemon control (recipe-specific)

The contract does not prescribe. Recipe-specific:

- **Tech Lead's recipe (TrueNAS):** SSH wrappers (`tools/dev/*.sh` via `ssh.exe`) running `sudo docker` as user `claude`. Alternative — `DOCKER_HOST=ssh://claude@truenas.local` (deferred — needs `claude` in the `docker` group, see §11 OQ-1).
- **"Host-only" recipe:** local Docker daemon, `DOCKER_HOST` unset.
- **"Cloud VM" recipe:** `DOCKER_HOST=ssh://...` via Tailscale or direct.

### 8.3 Egress control plane compatibility

ADR-0011 (egress control plane) imposes outbound-call rules on AI agents. Compose services on TrueNAS are **LAN endpoints**, not egress (per ADR-0011 §2.1 LAN is classified as a trusted network). The AI agent **must not** route `truenas.local` requests through the PII scanner — these are intra-zone communications.

### 8.4 Dual-LLM (ADR-0010) integration with local stand

Quarantine LLM workload (per ADR-0010 mandatory pattern) in Pre-pilot runs via the prod AI service (RU cloud + cross-zone egress), **not** via the local stand. The local stand does not run Ollama / vLLM. Revisit trigger: if Pre-pilot dev needs an offline LLM for tests — a separate compose fragment `compose.local-llm.yml`. See §11 OQ-5.

---

## 9. DX scripts

### 9.1 List (`package.json` scripts at repo root)

All scripts are **env-driven**: they read `.env.local` (HOST, DOCKER_HOST, paths) and work with any recipe.

| Script                       | Portable behaviour                                                                                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev:up`                | `docker compose -f compose.core.yml -f $OVERRIDE_FILE up -d` (via DOCKER_HOST if set)                                                                                         |
| `pnpm dev:down`              | `docker compose down` (volumes preserved)                                                                                                                                     |
| `pnpm dev:logs <service>`    | `docker compose logs -f <service>`                                                                                                                                            |
| `pnpm dev:restart <service>` | `docker compose restart <service>`                                                                                                                                            |
| `pnpm dev:psql`              | `psql $DATABASE_URL`                                                                                                                                                          |
| `pnpm dev:snapshot <name>`   | **Recipe-specific.** Tech Lead: SSH → `zfs snapshot`. Host-only: `pg_dump` or `docker compose stop && cp -r volume`. If recipe does not support — graceful skip with warning. |
| `pnpm dev:rollback <name>`   | **Recipe-specific.** Tech Lead: `zfs rollback`. Host-only: restore from pg_dump.                                                                                              |
| `pnpm dev:reset-db`          | `dev:down` → drop+recreate volume (per recipe) → `dev:up` → `drizzle:migrate` → seed                                                                                          |
| `pnpm dev:status`            | `docker compose ps`                                                                                                                                                           |
| `pnpm dev:config`            | Dry-validate the resolved compose config + `${VAR}` interpolation (`docker compose config --quiet`) — no `up`.                                                                |
| `pnpm dev:smoke`             | Contract-level smoke probe — reaches the core services to confirm the stand converged (DSP-159).                                                                              |

Wrapper scripts in `tools/dev/`: portable Node.js launcher `tools/dev/run.mjs` (cross-platform), reads env and dispatches. Recipe-specific logic (`snapshot.sh` / `rollback.sh`) lives **in personal overlay** or loads from `tools/dev/recipes/<recipe-name>/*.sh` (published reference recipes).

**On Windows host** the built-in `ssh.exe` is used for recipes with `DOCKER_HOST=ssh://...`, not WSL2 bash (avoiding the WSL2 mDNS bug).

### 9.2 Pre-migration hook

`drizzle-kit migrate` wrapper in `apps/api/package.json` (cross-platform — timestamp is generated inside `tools/dev/recipes/truenas-hybrid/snapshot.sh` on the TrueNAS Linux side to avoid relying on bash `$(date +%s)` substitution on the Windows host):

```json
{
  "scripts": {
    "drizzle:migrate": "pnpm -w run dev:snapshot pre-mig-auto && drizzle-kit migrate"
  }
}
```

`pnpm -w run dev:snapshot` (corrected during spec 002 / #59 implementation): `dev:snapshot` lives in the workspace-root `package.json`, but `drizzle:migrate` runs with cwd = the consuming package (`apps/api`), and pnpm does not resolve scripts up the workspace tree. `-w` runs the script from the workspace-root package. The bare `pnpm dev:snapshot` form errors with "Command 'dev:snapshot' not found" from a sub-package.

`tools/dev/recipes/truenas-hybrid/snapshot.sh` (streamed to TrueNAS via `ssh.exe`) appends the timestamp on the Linux side:

```bash
# tools/dev/recipes/truenas-hybrid/snapshot.sh (excerpt)
NAME="$1-$(date -u +%Y%m%dT%H%M%SZ)"
zfs snapshot "Daily SSD/dev-postgres@${NAME}"
```

This yields readable names (`pre-mig-auto-20260518T091230Z`) and works identically on a Windows host (cmd / PowerShell / WSL without bash-substitution headaches).

If the snapshot fails → migrate does not run. This is a soft guardrail, not hard (can be bypassed with `--force`). Hard guardrail = ADR-level, deferred.

---

## 10. Secrets handling

Phase 0 secrets:

- `infra/dev-stand/.env` on TrueNAS — contains `POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`, `IDP_SECRET_KEY` (Zitadel masterkey — a 32-char secret for encryption-at-rest, per ADR-0001 §8 / DSP-209), etc. Manually created from `.env.example` at bootstrap. **Not committed** (gitignore).
- `ds-platform/.env.local` on host — connection strings + IdP client secret. **Not committed.**
- Vault is not used in Phase 0 (per engineering-readiness spec). Activation trigger: first shared developer (see §11 OQ-3).

**This is dev data. No PII.** On accidental `.env` leak, rotation = `dev:reset-db` + regenerated secrets via a script.

**Backup secrets:** `.env` files are NOT covered by ZFS snapshots (they live in the compose directory on the TrueNAS root disk, not on a snapshotted dataset), and `.env.local` on the host is also not backed up. On a Windows reinstall / wipe of the TrueNAS OS drive, secrets are lost → rotation. **Bootstrap secrets must be saved in a password manager** (1Password / Bitwarden) or exported to an encrypted file on the Media pool. This is an explicit step in `infra/dev-stand/README.md`.

---

## 11. Open questions / Revisit triggers

| ID    | Q                                                                                      | Decide when                                                                                                 |
| ----- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| OQ-1  | `DOCKER_HOST=ssh://...` vs manual SSH wrappers                                         | After first week of use: if SSH wrappers become frictionful, migrate to Docker context                      |
| OQ-2  | Per-developer Postgres namespace (`ds_dev_anton`, `ds_dev_eduard`) vs single shared DB | When a second dev joins                                                                                     |
| OQ-3  | Vault for dev secrets                                                                  | When first shared developer arrives OR when secrets live in > 3 places                                      |
| OQ-4  | Drizzle pre-migration hook integration                                                 | **CLOSED** — implemented (§9.2): `apps/api` `drizzle:migrate` wraps `pnpm -w run dev:snapshot pre-mig-auto` |
| OQ-5  | Local LLM compose fragment (Ollama/vLLM)                                               | If Pre-pilot dev needs offline LLM tests                                                                    |
| OQ-6  | Replace SSH wrappers with TrueNAS Apps UI                                              | If a second dev is not an SSH power user                                                                    |
| OQ-7  | Off-site backup of dev data                                                            | NOT needed (dev data is recreatable). Do not open.                                                          |
| OQ-8  | Replace TrueNAS with newer hardware                                                    | If Haswell i5-4670K becomes a bottleneck even for core services (Postgres CPU > 50% sustained)              |
| OQ-9  | mDNS resolution in WSL2 (if api runs in WSL instead of native Windows Node)            | At first API run, if WSL2 cannot see `truenas.local` — fallback to IP                                       |
| OQ-10 | Static IP / mDNS reliability                                                           | At first fallback                                                                                           |
| OQ-11 | What to do with `dev-stand/` (Next.js mobile prototype)                                | Unrelated to this dev stand; nothing changes                                                                |

**Revisit triggers (when to re-open this ADR):**

- Second developer joins → §6.3 + OQ-2 + OQ-6 reopen.
- Prod servers deployed → §1 clarifies "local is not the path to prod", update CI references.
- IdP OIDC application bootstrap (DSP-157 follow-up) → the `idp` Zitadel service is wired into compose (DSP-157, per ADR-0001 §8 / DSP-209); creating the OIDC application (`ds-platform-dev` client, redirect URIs, scope/claim mapping) is deferred until the first OIDC consumer lands (see `infra/dev-stand/idp/bootstrap.md`).
- TrueNAS Scale major upgrade (25.x) → verify Apps Docker still works.
- Observability stack activates (DSO-32) → `compose.observability.yml` promoted from "optional" into the regular flow.
- Core RAM on TrueNAS > 18 GB sustained → OQ-8 trigger.

---

## 12. Alternatives considered

| Alternative                                                      | Reason rejected/deferred                                                                                                                                                                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A. TrueNAS-all (including api+worker+Next dev)**               | Haswell i5-4670K (4C/4T, 2013) vs i9-9900KF (8C/16T, 2018) — compile 2.5–3× slower on TrueNAS. AI agent waits for `pnpm dev` restarts. File watcher through SMB/NFS — known Webpack/Vite/Next.js issue. Rejected.              |
| **C. Host-only (Docker Desktop / WSL2)**                         | vmmem.exe consumes 8–12 GB RAM (competes with IDE + AI agents). All services share 16 host threads with compile. On Windows reinstall — dev state lost. TrueNAS idle. Prod parity 80% (WSL2 ≈ Linux, not identical). Rejected. |
| **Run a Linux VM on host and run Docker inside**                 | vmmem-equivalent with the same RAM cost; no upside vs WSL2 + extra hypervisor overhead. Rejected.                                                                                                                              |
| **Coolify / Portainer on TrueNAS instead of raw docker-compose** | Coolify is a deploy orchestrator (Heroku-like UI), overkill for local dev. Portainer is a Docker UI, replaces SSH flow without AI-agent upside. Deferred.                                                                      |
| **k3s on TrueNAS instead of compose**                            | Kubernetes overhead for 7–10 dev containers is unjustified. Pre-pilot prod may go to k3s/k8s — separate ADR on prod deploy. Deferred.                                                                                          |
| **TrueNAS Apps UI instead of SSH compose file**                  | Apps UI parses compose incompletely (see §7.4). On Apps config update git history is lost. SSH + gitted compose — best AI-agent flow. Rejected for Phase 0, revisit per OQ-6.                                                  |
| **Off-site replication of dev data**                             | Dev data is recreatable from migrations + seed. Off-site backup is for prod data, not dev. Rejected.                                                                                                                           |
| **VPN (Tailscale/WireGuard) for remote stand access**            | Offline work is not a constraint (see §1). VPN vendor — separate ADR. Deferred.                                                                                                                                                |
| **Reuse `dev-stand/` (existing mobile app prototype) as a base** | `dev-stand/` is an unrelated Next.js mobile prototype for Beget (see CLAUDE.md). No relation to DS Platform local dev environment. Rejected. Files stay as is.                                                                 |

---

## 13. Consequences

### Positive

- **Portable contract → moves without pain.** A new dev clones the repo, copies `.env.example`, fills it in for their machine — it works.
- **Each dev chooses their recipe** — no obligation to copy my TrueNAS hybrid.
- **Compile/HMR feedback loop on i9-9900KF** (my machine) — AI agent works with minimal latency. Others — per their recipe.
- **C: occupancy minimal** in my recipe (~5–10 GB), named volumes on TrueNAS. Other recipes vary.
- **Prod-parity data layer** — same images via portable contract, regardless of recipe.
- **ZFS snapshots** = free "time machine" for Postgres in my recipe. Other recipes use pg_dump or VM snapshots.
- **Survives Windows reinstall** in my recipe (state on TrueNAS); host-only recipe is higher risk.
- **One SSOT for the contract** (`compose.core.yml` in repo). Recipes are runbooks.
- **Native Linux Docker** in my recipe (no WSL2 overhead). Windows host-only recipe hits WSL2 issues.

### Negative

- **Two machines to maintain** (my recipe) — TrueNAS upgrades / disk health / network reboots become a concern. Other recipes free of this.
- **Each dev has their own `compose.override.yml`** — no "copy-paste and it works". Mitigated: README with recipes + `compose.override.example.yml`.
- **TrueNAS reboot crashes host-side api** in my recipe — needs healthchecks and autorestart hooks (§5.6).
- **SSH wrappers** add one indirection in my recipe (mitigated by DX scripts, §9).
- **`dev:reset-db` via SSH+ZFS** slower in my recipe than local `docker compose down -v`.

### Risks

- **`truenas.local` mDNS resolution in WSL2** may not work (known edge case Windows 11 + WSL2 networking). Mitigation: fallback to static IP `192.168.1.115` in WSL's `/etc/hosts`.
- **TrueNAS Haswell EOL** — i5-4670K is out of Intel's support stream; security patches arrive rarely. Mitigation: TrueNAS Scale is Linux under the hood with current kernel. Not critical for dev stand. Re-plan per OQ-8.
- **1 Gbit network** adds ~100 µs to Postgres queries from api. Mitigation: acceptable for dev; if ever noticeable — upgrade to 2.5 Gbit or 10 Gbit DAC between host and NAS (one-time cost, low ops).
- **TrueNAS Apps major upgrade breaks the compose stack** (24.x → 25.x). Mitigation: Scale version is pinned in README; upgrade is a separate change with smoke test.
- **ZFS arc shrink under memory pressure** causes burst latency in Postgres. Not critical for dev workload.

---

## 14. Implementation hand-off (two-layer split)

Implementation splits by layer. Plane tracking already created (DSP-150 milestone + DSP-152..159 sub-issues, being updated to match the new split).

### 14.1 Layer A — Portable contract (in git, target `doctor-school/ds-platform/infra/dev-stand/`)

Done **first**, outlives any single developer.

1. Create `infra/dev-stand/` skeleton + portable `.env.example` + `.gitignore` + README skeleton.
2. Write `compose.core.yml` with named volumes and env-driven hostnames/ports (§3, §7.2).
3. Write `postgres/init.sql`, `postgres/postgresql.conf.dev`, `centrifugo/config.json` (§7.1).
4. Write env-driven DX scripts `tools/dev/run.mjs` + bash helpers (§9).
5. Add idp to compose (after ADR-0001 §8 spike) + `idp/bootstrap.md` manual for any IdP.
6. Write README with: portable bootstrap flow + recipe library (Tech Lead's recipe documented as example; others — stubs).
7. AGENTS.md "Local Dev Stand" section — portable rules (env-driven endpoints, command list, snapshot-before-migrate, no-direct-volume-edit).

### 14.2 Layer B — Tech Lead's TrueNAS Hybrid recipe (runbook + personal files)

Done **in parallel** with Layer A, but content partially in repo (as recipe documentation) and partially personal.

1. Bootstrap Tech Lead's TrueNAS: SSH keys, DHCP reservation, Windows Private profile, OpenSSH client check.
2. ZFS datasets `Daily SSD/dev-*` with tunings (§5.3).
3. TrueNAS firewall — verify there is no host inbound filter; no change needed (§5.4).
4. Boot-triggered snapshot + replication maintenance script (§5.5).
5. Tech Lead's `~/.ds-platform/compose.override.yml` with bind mounts to ZFS datasets.
6. Tech Lead's `~/.ds-platform/.env.local` with real secrets + endpoints.
7. Recipe documentation in repo README (§7.4, §5) — for future devs and AI agents.

### 14.3 Smoke test (contract-level)

Run `api` on host (any machine with Layer A + any Layer B recipe), reach Postgres+Redis+MinIO+Centrifugo+Cerbos+Mailpit. On Tech Lead's recipe — additionally a TrueNAS reboot survival check.

Implementation timeline — Sprint 2 (target 29.05, see Plane DSP-150).

---

## 15. Related ADRs / Dependencies

**Inherits from:**

- ADR-0001 — Identity provider shortlist (IdP service in compose; concrete one after §8 spike).
- ADR-0002 — Backend core (api+worker run on host via `pnpm start:dev`).
- ADR-0003 — Data layer (Postgres17+pgvector image, Redis, Cerbos PDP).
- ADR-0004 — Frontend stack (4 Next.js apps on host).
- ADR-0006 — Documentation & SSOT (compose file lives in repo, docs alongside).
- ADR-0007 — AI loop (DX scripts + AGENTS.md section).
- **ADR-0008** — Repo strategy. Dev-stand infra lives in `infra/dev-stand/` (monorepo with the app code). Prod-deploy infra (Coolify/k3s manifests) — a separate repo, a separate ADR at first prod deploy.
- ADR-0011 — Egress control plane (LAN-coverage classification for AI agent).
- Engineering-readiness spec — runtime tooling (Vault/Unleash/Outline triggers).

**Delegated:**

- Concrete IdP wiring into dev-stand compose (DSP-157) — Zitadel per ADR-0001 §8 (DSP-209).
- Prod-deploy compose (Coolify / k3s / manual) — separate ADR in pre-pilot.
- Local LLM compose fragment — OQ-5.
- Multi-developer namespace pattern — OQ-2.

**Affects:**

- AGENTS.md / CLAUDE.md — bootstrap "Local Dev Stand" section.
- ADR-0008 §2.10 step 22 (first feature-spec smoke test) — will use this stand.
- DSO-32 (Pre-pilot stack-dependent unpack) — `compose.observability.yml` is promoted there.
