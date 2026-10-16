---
title: "ADR-0012 — Deployment Topology v1 (production cluster shape + preview environments) for DS Platform [EN]"
description: "After DSO-59, the v1 availability target is fixed at 99.0% single-AZ (ADR-0002 §5.6) with a cost envelope ≤30k ₽/month. These bounds shape..."
lang: en
---

> **EN (this)** · **RU:** [`0012-deployment-topology-v1-ru.md`](./0012-deployment-topology-v1-ru.md)

# ADR-0012 — Deployment Topology v1 (production cluster shape + preview environments) for DS Platform

**Date:** 2026-05-18
**Status:** Accepted
**Related to:** Plane DSO-53 (`fb3e57f2-6602-40ea-af66-f29694dc5002`), milestone DSO-10 (infra readiness), DSO-59 (v1 availability target — ADR-0002 §5.6)
**Lift source:** ADR-0003 §8 (cluster topology v1), backend-core-design §5.8 (capacity planning + infra footprint)
**Inherits:** ADR-0002 (NestJS API + BullMQ + Centrifugo), ADR-0003 (Postgres 17 + Redis 7 + canonical backup topology §2.4), ADR-0002 §5.6 (99.0% v1 single-AZ, maintenance window 02:00–06:00 MSK)

---

## Context

After DSO-59, the v1 availability target is fixed at **99.0% single-AZ** (ADR-0002 §5.6) with a cost envelope ≤30k ₽/month. These bounds shape the production cluster. Until this ADR, deployment topology was declared as a side-decision inside the data-layer ADR (ADR-0003 §8) and a capacity table inside backend-core-design §5.8, without a formal comparison against alternative orchestrators and with a contradiction in the Redis inventory (§5.8 showed "3× Redis Sentinel", while ADR-0003 §8 declared "single-node Redis acceptable v1, HA trigger >1000 active users").

DSO-53 (originally "Accept ADR-0003: deployment topology DS Platform") is migrated to ADR-0012 in order to:

1. Give the orchestrator choice a formal artifact with rejected alternatives.
2. Close the staging-topology open question from ADR-0003 §8 (formally deferred to pilot transition).
3. Fix the preview-environments topology, which was not described in any prior ADR.
4. Resolve the Redis inconsistency between backend-core §5.8 and ADR-0003 §8.
5. Close ADR-0002 OQ10.

---

## Decision

### 1. Production v1 = 2-VPS docker-compose

Two VPSes on Timeweb joined via the Timeweb private network:

- **`api-prod`** — API-plane components: NestJS API + BullMQ workers + Centrifugo + nginx (TLS + reverse proxy + virtual hosts).
- **`data-prod`** — persistence-plane components: PostgreSQL 17 + Redis 7 (single-node) + pgbackrest sidecar (cron + WAL archive).

Each VPS runs a single `docker-compose.yml` with explicitly enumerated services. Health checks, resource limits, restart policy = `unless-stopped`. The private network between api-prod and data-prod is the only access channel to data; data-prod has no public IP.

### 2. Preview environments — separate `preview-vps`

A dedicated VPS with Coolify (or Dokploy — operator choice is fixed in DSO-10, not in this ADR). A shared PR-environment pool: containers spin up on PR open, are torn down on close/merge. v1 sizing — 1 vCPU / 2 GB / 30 GB. Upgrade trigger — OQ-T4 below.

### 3. Permanent staging — deferred to pilot transition

Pre-pilot has 0 real users: permanent staging is not justified for smoke testing (covered by per-PR previews) nor for load testing (no baseline data). Permanent staging spin-up happens synchronously with the pre-pilot → pilot transition (same trigger as in ADR-0002 §5.6 / OQ-D7 ADR-0003). The permanent staging topology will be added to this ADR at the moment of introduction.

### 4. Orchestrator: docker-compose

Rejected alternatives — see §Rejected below. docker-compose is selected as the mainstream standard for a 1–2-person team without kubernetes discipline; all existing infra (Plane on DSO-13, Zitadel, KB) already runs on docker-compose, and AI agents write it better than any alternative.

### 5. Maintenance window

Weekly window 02:00–06:00 MSK (one slot) is excluded from SLO calculation (inherited from ADR-0002 §5.6). The concrete schedule (day of week, duration of each window) is an operational detail anchored in the DSO-10 readiness checklist.

### 6. Dependencies on the shared-tooling VPS (out of scope of this ADR)

DS Platform prod depends on services hosted on a separate `shared-tooling` VPS (out of scope of ADR-0012, fixed by DSO-10):

- **Verdaccio** — npm pull-through mirror (protects CI from upstream npm blocks).
- **Harbor / Nexus** — Docker registry mirror.
- **Loki + Tempo + Prometheus + Grafana** — observability bundle (data-prod and api-prod ship logs/metrics/traces).
- **GlitchTip** — error tracking.
- **Zitadel** — IdP (ADR-0001 §8, closed per DSP-209).
- **Vault** — KEK storage for encrypted backups (ADR-0003 §2.4).

These services are shared infra (also used by Plane / KB / Mattermost / Outline). Their sizing and cost are in DSO-10, not duplicated here.

---

## Process inventory v1

| VPS       | Container            | Image (approx.)                       | CPU/RAM limit | Purpose                                                                              |
| --------- | -------------------- | ------------------------------------- | ------------- | ------------------------------------------------------------------------------------ |
| api-prod  | nginx                | nginx-stable-alpine                   | 0.2 / 128M    | TLS termination, reverse proxy, static fallback                                      |
| api-prod  | api                  | ds-api:vN (NestJS)                    | 2.0 / 2G      | main HTTP API                                                                        |
| api-prod  | generic-worker       | ds-api:vN (NestJS, worker entrypoint) | 1.0 / 1G      | BullMQ generic queue (ledger, audit emit, PDF)                                       |
| api-prod  | notifications-worker | ds-api:vN (NestJS, worker entrypoint) | 0.5 / 512M    | BullMQ notifications queue (SMS, email, push)                                        |
| api-prod  | centrifugo           | centrifugo:v6                         | 0.5 / 512M    | realtime gateway (webinars, presence)                                                |
| data-prod | postgres             | postgres:17-bookworm                  | 2.0 / 4G      | primary DB                                                                           |
| data-prod | redis                | redis:7-alpine                        | 0.5 / 1G      | cache + BullMQ broker + volatile concerns (see ADR-0003 §7)                          |
| data-prod | pgbackrest           | pgbackrest custom Docker              | 0.3 / 256M    | cron daily basebackup + 15-min WAL → Timeweb Object Storage + weekly sync → Beget S3 |

**Total api-prod:** ~4.2 vCPU / ~4.5 GB (fits the 4 vCPU / 8 GB Timeweb tier with buffer).
**Total data-prod:** ~2.8 vCPU / ~5.3 GB (fits the 4 vCPU / 8 GB Timeweb tier with buffer).

Cerbos in embedded mode (ADR-0003 §4) lives inside `api` and the workers (in-process), not a separate container.

Backup orchestration (rclone Timeweb → Beget) runs as a pgbackrest-sidecar cron on data-prod.

---

## Cost envelope v1

| Component                                | Tier                             | Price ₽/month (Timeweb 2026-Q2) |
| ---------------------------------------- | -------------------------------- | ------------------------------- |
| api-prod VPS                             | 4 vCPU / 8 GB / 80 GB SSD        | 4 500–5 500                     |
| data-prod VPS                            | 4 vCPU / 8 GB / 200 GB SSD       | 6 500–8 000                     |
| preview-vps                              | 1 vCPU / 2 GB / 30 GB SSD        | 600–900                         |
| Timeweb Object Storage (primary backups) | ~50 GB                           | 200–400                         |
| Beget S3 (weekly offsite)                | ~50 GB                           | 200–400                         |
| Timeweb CDN                              | 50 GB egress/month               | 500–1 500                       |
| Static IPs × 2                           | api-prod public + preview public | 200–400                         |
| **Total v1 prod + preview**              |                                  | **~12 700–17 100 ₽/month**      |

The shared-tooling VPS (Verdaccio + observability + IdP + Vault) is shared infra; its cost is on the DSO-10 budget and is not duplicated here (~8–12k ₽/month separately).

**Total DS Platform prod-direct cost:** ~12–17k ₽/month. With a buffer for CDN bursts, snapshot storage, and small services — ~20–25k ₽/month. Fits the envelope ≤30k ₽/month (DSO-59).

---

## Rejected alternatives

### Single-VPS docker-compose (api + data on one VPS)

**Rejected.** Postgres OOM/IO spikes collapse the API; OOM-killer kills randomly; the backup cron competes with the API for IO. On the v1-budget Timeweb tier 4 vCPU / 8 GB the resource cushion is not enough for co-location.

### Multi-VPS + nginx LB (3+ api-VPSes behind an external LB)

**Rejected.** v1 load ~50 RPS peak (backend-core §5.8); one api-VPS with buffer covers it. Multi-instance gives horizontal scale-out, but at 99.0% SLO single-AZ + one failure domain on data-prod, that is not a reliability improvement — only +cost +ops-burden. Re-evaluate trigger: v2 at >500 RPS or once OQ-D7 ADR-0003 (HA Postgres) is activated.

### K3s self-hosted

**Rejected.** A full kubernetes (even the slim K3s) adds: control-plane overhead on small VPSes (~500M RAM per node), etcd backup discipline, the requirement of a 3-node control-plane for HA (which by itself exceeds the v1 budget). A team of 1–2 without an active k8s opex is not sustainable on small scope. **AI agents** find it easier to write docker-compose YAML than k8s manifests, with comparable expressiveness on v1 scope. **Re-evaluate triggers:** v2 at ≥3 api-replicas + cross-VPS distributed state (sessions / cache), or when the team has a dedicated DevOps engineer with k8s background. ADR-0011 §125 already noted that k8s is absent pre-pilot.

### Nomad

**Rejected.** The HashiCorp stack has a weaker RF community than k8s, is not used by the team (no Consul / Vault except Vault-as-KEK), AI writes hcl configs worse than Compose YAML. Combines the downsides of k8s (overhead) with the downsides of docker-compose (no advanced scheduling) without clean upsides. Not reconsidered until v3.

### Docker Swarm

**Rejected.** Deprecated path (Docker Inc. no longer actively develops it), dead in the RF community, AI often writes outdated patterns. Not reconsidered.

### Managed Kubernetes (Timeweb Managed k8s / Yandex Cloud Managed k8s)

**Rejected.** Removes control-plane ops from the team, but: (a) the k8s discipline overhead remains in the code (manifests, helm charts, operators) — AI-friendliness lower than docker-compose; (b) provider lock-in at the kube-API level is higher than at the docker-compose level; (c) managed-tier cost premium ~30-50% above self-hosted VPS at comparable v1 scale; (d) Yandex Managed k8s — an external provider for PD processing, +1 processor for 152-FZ DPA. Review trigger — same as OQ-T3 (K3s self-hosted) — managed is reconsidered alongside self-hosted at the same decision moment.

---

## Open questions (deferred)

| OQ                                                                             | Review trigger                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OQ-T1.** Permanent staging environment topology                              | Pre-pilot → pilot transition (same trigger as OQ-D7 ADR-0003)                                                                                                                                                                                                                                                                                             |
| **OQ-T2.** Multi-VPS HA for the data plane (Postgres replica + Redis Sentinel) | OQ-D7 ADR-0003 (v2 HA target 99.5%)                                                                                                                                                                                                                                                                                                                       |
| **OQ-T3.** Migration to K3s                                                    | (a) ≥3 api-replicas requirement, OR (b) cross-VPS distributed-state requirement, OR (c) the team has a dedicated DevOps engineer with k8s background                                                                                                                                                                                                      |
| **OQ-T4.** Preview-VPS pool size + sizing                                      | (a) PR-throughput >5/day, OR (b) preview-vps OOM frequency ≥1/week                                                                                                                                                                                                                                                                                        |
| **OQ-T5.** Backup off-site provider re-evaluation                              | If Beget S3 becomes unavailable / incompatible with pgbackrest                                                                                                                                                                                                                                                                                            |
| **OQ-T6.** Geographic redundancy (multi-region / cross-DC)                     | v3 at ≥1M MAU or an explicit regulatory requirement                                                                                                                                                                                                                                                                                                       |
| **OQ-T7.** Log-shipping topology + sidecar buffer                              | If the shared-tooling VPS (which hosts Loki/Tempo/Prometheus) has >1 outage/month or the observability gap during an outage becomes critical. Candidates: Promtail with local queue, Vector with persistent buffer on api-prod/data-prod, a separate durable spool. Pre-pilot: log loss during an outage is acceptable; reconsidered at pilot transition. |

---

## Consequences

### Positive

- Minimal ops overhead for a 1–2-person team: docker-compose is already used in shared-tooling / Plane / Zitadel, the discipline is the same.
- AI agents write docker-compose YAML consistently across sessions (mainstream + a large training dataset).
- Isolation api ⟷ data: OOM/IO in one plane does not destroy the other.
- The ≤30k ₽/month cost envelope is met with buffer (~20–25k ₽/month).
- preview-vps provides PR-environments without touching prod.

### Negative

- 2-VPS = 2 separate failure domains (vs 1 on single-VPS), but 1 SPOF per plane (vs an HA cluster). Accepted within the 99.0% v1 SLO (ADR-0002 §5.6).
- docker-compose has no built-in rolling-update — deploy via `docker compose up -d` with an image-tag bump = short downtime (<60s) OR a manual blue-green with an nginx upstream switch. Blue-green automation is a pilot trigger — engineering-readiness §1.
- No automated failover: data-prod VPS down = manual restore from ADR-0003 §2.4 backup (RTO ≤2 h). Compliant with the SLO.
- preview-vps shared pool — with 5+ concurrent PRs resources run out (OQ-T4 trigger).

### Architectural qualities (metrics, not declarations)

| Quality                 | Metric                              | v1              | v2                 |
| ----------------------- | ----------------------------------- | --------------- | ------------------ |
| Availability            | uptime SLO (inherits ADR-0002 §5.6) | 99.0%           | 99.5% (HA trigger) |
| Recoverability          | RTO (manual restore, ADR-0003 §2.4) | ≤2 h            | ≤5 min (HA)        |
| Data integrity          | RPO (WAL gap, ADR-0003 §2.4)        | ≤15 min         | ≤5 min             |
| Deploy frequency        | target                              | ≥1/week         | ≥1/day             |
| Deploy duration         | from merge to prod                  | ≤30 min         | ≤10 min            |
| Maintenance window      | weekly                              | 02:00–06:00 MSK | same or narrower   |
| Preview env spin-up     | from PR-open to URL                 | ≤5 min          | ≤2 min             |
| PR-throughput supported | concurrent PR environments          | ≤3 without OOM  | scaled per OQ-T4   |

---

## Amendments

### A1 — Delivery: registry images built once in GitHub Actions; release through Actions with Environment approval; hardened SSH from hosted runners (2026-10-16, #2976)

**Context.** The 2-VPS docker-compose topology of §1 is running in production. Its delivery path was never decided in this ADR: releases run as `pnpm deploy:prod` (`tools/deploy/prod.mjs`), one foreground process on the owner's workstation that ships the source tree over SSH (`git archive`), builds every image on the boxes and holds the only SSH keys, with port 22 open to that workstation's `/32` only. Over 2026-09-15 → 2026-10-15 there were 29 successful and 17 failed or aborted releases; the failures that exist only because the release runs from a personal machine (egress IP drifting off the `/32`, an environment variable missing on the PC, the agent harness killing the process mid-release on 2026-10-13) and the ones caused by on-box builds (registry rate limits, api-prod overload) together outnumber real product failures. Nothing on the box detaches remote work, so a dead client can leave a release half-applied.

**Decision.**

- **Build once.** Each first-party image is built once by a GitHub-hosted runner on merge to `main`, tagged by the full commit SHA and pushed to the Timeweb Container Registry (`ds-platform.registry.twcstorage.ru`, ru-1). The build records each image's digest for that SHA; stage and production pull the same image by that recorded digest (never re-resolved by tag), PR-head images live under a separate `pr/` prefix, and no box builds an image.
- **Release through Actions.** A release is a `workflow_dispatch` (the agent on the owner's word, or the owner) for a SHA that already carries a green stage-suite check; it then waits on Environment `production` (deployment branches `main` only), whose required reviewer is the owner. The workflow records a GitHub Deployment for success and for failure; one release runs at a time (`concurrency`).
- **Approval is owner-only.** The agent dispatches and observes; it never approves. Today the agent's `gh` runs under the owner's account, so GitHub cannot tell the two apart: the control is a Claude Code + Codex permission deny rule on the pending-deployments approval API. That identity must exist before release step (e) goes live: the agent then runs under its own non-reviewer GitHub identity. Prevent-self-review stays off while the owner is the single human reviewer, because otherwise a release the owner dispatched could never be approved; the protection is the agent identity not being a reviewer, plus the deny rule.
- **Public logs.** The repository is public (ADR-0011 channel 3): prod jobs print status lines only (unit, phase, exit code, SHA, duration), full logs stay on the box; nothing from the stage suite that can carry credentials goes to GitHub (Playwright traces keep the stage basic-auth header and typed passwords): the public check shows only a summary (title, status, duration, retries), and the full report goes over SSH to ds-stage-1 (root-readable, 14-day retention).
- **Box access.** GitHub-hosted runners reach ds-api-prod and ds-stage-1 over SSH with the hardening set of the tech spec §4 (key-only, no root login, a dedicated `deploy` user, forced-command CI keys with an allowlisted entrypoint (the operator key keeps its sudo until the workstation path is retired, then sudo is narrowed to the entrypoint), rate limiting, unattended security upgrades); the prod key is released only after approval; ds-data-prod stays private behind ds-api-prod. The owner-`/32` rule is retired.
- **Durable box steps.** Every long box step runs as a locked `systemd-run` transient unit with an atomically written status file that is the authority for the step's verdict, so client death never kills it, a fresh runner can reattach, and a re-run never repeats backup or migrate.
- **Break-glass.** The same box entrypoints are runnable by hand with the owner's offline break-glass key.

**Consequences.** No personal machine, and no secret on one, is in the normal release path; the stage suite's results are stored as a commit check and a report artifact; on-box build load and its failure modes leave production; rollback becomes a pull of the previous digest. New dependencies: the Timeweb registry (fallback: `docker save` tarballs in S3) and GitHub Actions availability (fallback: break-glass). Port 22 becomes reachable from the internet under the hardening set; a pull agent remains the documented alternative if a regulatory requirement to close admin ports appears.

**Why now.** The owner asked for a full review of the release path (2026-10-15) and confirmed the target picture (2026-10-16, «Да, всё так.») and the registry («Окей, берём Container Registry Timeweb.»); the access model is a lead decision under the owner's delegation of 2026-10-16.

**Open follow-up.** Execution is staged under epic #2975 (tech spec §8, steps (a)–(f)): Actions build-once with pull-instead-of-build, durable `systemd-run` entrypoints, SSH hardening with stage opened to runners, stage converge and suite in Actions, the release workflow with the approval deny rule, and retirement of the workstation path to break-glass. Until step (f) lands, `pnpm deploy:prod` stays the runbook. The agent's own non-reviewer GitHub identity must exist before step (e) goes live. The registry has no Terraform resource (manual one-off); `ds-api-migrate` (1.92 GB) is to be shrunk. Step (f) also rewrites the release-cycle spec §10 autonomous-ship rule, which this amendment narrows: the agent still dispatches, the owner approves every production deployment.

**Affects.** Tech spec [`2026-10-16-release-pipeline-off-workstation-en.md`](../specs/tech/2026-10-16-release-pipeline-off-workstation-en.md); staging spec `2026-09-08-staging-previews-and-regression-contour-en.md` (§3 host builds, §5 operator-machine suite, §10 rows #2202 / #2701); skill `run-prod-deploy`; `tools/deploy/README.md`; `infra/deploy/terraform/{network,stage-1}.tf` (SSH firewall rules); ADR-0008 runner topology.

---

## Cross-references

- **ADR-0012 A1** — release-pipeline direction; plan: `specs/tech/2026-10-16-release-pipeline-off-workstation-en.md`.
- **ADR-0002 OQ10** — CLOSED 2026-05-18 (DSO-53), see this ADR.
- **ADR-0003 §8** — content lifted here; the original section is now a stub pointer.
- **ADR-0002 §5.6** (DSO-59) — v1 availability 99.0% + maintenance window source.
- **ADR-0003 §2.4** — canonical backup topology (inherited).
- **ADR-0003 §8** — Redis single-node v1 policy + HA trigger.
- **Backend-core-design §5.8** — capacity table; Redis count fixed synchronously with this ADR.
- **Engineering-readiness §1** — CI/CD, preview-env tooling (Coolify/Dokploy), blue-green pilot.
- **DSO-10** — infra readiness checklist (maintenance schedule, shared-tooling sizing, Verdaccio + observability deploy).
- **DSO-70** — local dev environment (separate scope, does not overlap).
- **ADR-0011 §125** — k8s deferred to Phase 1+ (consistent with OQ-T3 here).

---

## Verification

After applying ADR-0012, use grep to confirm:

```bash
# "3× Redis Sentinel" / "Sentinel minimum 3 nodes" must not appear anywhere except historical explanations
grep -rn "3× Redis\|3x Redis\|Sentinel минимум\|Sentinel minimum\|Sentinel auto-failover" docs/

# No mentions of "ADR-0003 deployment topology" as an active reference
grep -rn "ADR-0003.*deployment\|deployment.*ADR-0003" docs/

# ADR-0002 OQ10 must be CLOSED
grep -n "OQ10" docs/adr/0002-backend-core-stack-{ru,en}.md

# ADR-0003 §8 must be a stub pointer to ADR-0012
grep -n "Cluster topology v1\|Cluster shape v1" docs/adr/0003-data-layer-stack-{ru,en}.md
```
