---
title: "DS Platform — Pre-pilot Deploy Slice (auth 003 on always-on prod) — Design [EN]"
description: "Deploy the built auth vertical (feature 003, epic #80) onto an always-on Timeweb production environment with live SMS + Email — the narrow 'deploy-what-exists' slice, not the full 23-blocker pre-pilot. Two-VPS docker-compose per ADR-0012, self-hosted Postgres per ADR-0003, DNS at Beget, own Terraform harness in this repo."
slug: prepilot-deploy-slice
status: Draft
lang: en
---

> **EN (this)** — tech-spec, EN-only (RU split is for product feature-specs only).

# DS Platform — Pre-pilot Deploy Slice (auth 003 on always-on prod) — Design

**Date:** 2026-07-02
**Status:** Draft (design locked in brainstorm 2026-07-02; topology applied live 2026-07-03, on-box deploy payload apply-ready)
**Type:** Platform-level deployment design + applied IaC (Terraform) + on-box deploy payload (docker-compose + Dockerfiles + runbook). Not an ADR — it _applies_ ADR-0012 (topology) and ADR-0003 (data layer) to one concrete slice; it does not re-decide them.
**Tracker:** Plane **DSO-100** (`plane.bbm.academy`, project DSO), child of milestone **DSO-10** (infra readiness). Child: **DSO-101** (tenancy-spec "Managed PG" reconcile).
**Applies (not inherits):** ADR-0001 (Identity — Zitadel), ADR-0002 (NestJS + Fastify + BullMQ), ADR-0003 (Postgres 17 + Drizzle + pgvector + Redis + backup topology §2.4), ADR-0011 (egress control plane), ADR-0012 (deployment topology v1 — 2-VPS docker-compose), engineering-readiness spec (§"Pre-pilot deployment slice").
**Implements the deploy of:** feature **003** (identity/auth — epic #80): passwordless email/SMS-OTP login + registration, session→token exchange, PD-lifecycle `/me/*`, live SMS (SMS-Aero) + Email (mail.ru business relay).

---

## 0. Purpose and non-purpose

**Purpose.** Stand up **real, always-on** infrastructure and deploy the auth vertical that already exists on `main` (feature 003), so that (a) the team can exercise it on a prod-like stand with **live SMS + Email**, and (b) there is a running platform onto which subsequent product features deploy incrementally.

**This is a slice, not the pre-pilot.** The engineering-readiness spec enumerates 23 pre-pilot blockers; this design deliberately ships a **subset** — "deploy what 003 actually needs to run" — and defers the rest as tracked DSO child tasks (§8). The slice is a vertical (F-22): a doctor can complete the auth journey end-to-end on the live stand, not "all backend handlers are merged".

**Non-purpose (explicitly out — see §8 for the tracked list):** admin app, Payload CMS, promo app, mobile, Cerbos, BullMQ workers, Centrifugo, Unleash, Tempo, WAF, HA/replicas, load balancer, CDN, preview-vps, Beget S3 offsite. None are required to run 003.

**Legal note.** Onboarding the first real doctor is gated by RKN/ФСТЭК registration — that gate is on _first-user onboarding_, **not** on this deploy. The stand may run with synthetic operators before legal clearance.

---

## 1. The stand IS the future prod (ADR-0012)

Per the brainstorm decision and ADR-0012, this environment is **built once as production** — there is no throw-away staging tier to migrate off later. Permanent staging is deferred to the pilot transition (ADR-0012 OQ-T1). The single-AZ 99.0% SLO and the 02:00–06:00 MSK maintenance window (ADR-0002 §5.6 via ADR-0012 §5) apply as written.

**Topology (ADR-0012 §1):** two Timeweb VPSes joined by a fresh Timeweb private network (`twc_vpc`), each running one `docker-compose.yml`, plus a network-level NAT router that carries the private box's egress:

- **`api-prod`** — public plane. Has one public IPv4. Runs the internet-facing services (TLS terminator + API + portal + IdP).
- **`data-prod`** — persistence plane. **No public IPv4 at all.** Reachable only over the private network; its internet egress comes from the NAT router (below). Runs Postgres + Redis + the backup sidecar.
- **`twc_router` (NAT gateway)** — Timeweb-recommended egress path for the IP-less `data-prod`: the provider implements no per-server SNAT on a local network, so an IP-less host reaches the internet only through a router that NATs the whole VPC subnet from a floating IP (§5.1).

Both VPSes (and the router floating IP) are pinned to the **same RF availability zone** (`msk-1` / ru-3 Moscow) — a `twc_vpc` private network is single-location, and single-AZ is the accepted v1 failure model. An explicit zone is mandatory (152-ФЗ; without it the provider defaults to `ams-1`, outside RF) **and** must match the preset's node pool: a preset is pinned to its zone, so a mismatched zone fails apply with `location_zone not valid`. The `msk-1`/ru-3 pinning was chosen because ru-1/ru-3 carry live 4/8/80 capacity (Novosibirsk excluded).

---

## 2. Process inventory — what the 003 slice actually runs

This inventory is derived from **what the code on `main` actually calls**, not from ADR-0012's v1 _target_ inventory. Verified against the 003 source (see §2.3 for the reconcile against ADR-0012):

### 2.1 `api-prod` (public)

| Container          | Image (approx.)                                         | Purpose                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `caddy`            | `caddy:2`                                               | TLS termination (automatic Let's Encrypt), reverse-proxy vhosts, single-origin IdP routing                                                                                              |
| `api`              | `ds-api:<tag>` (NestJS, `node dist/main.js`)            | main HTTP BFF/API (auth, sessions, `/me/*`, mailer, SMS-budget)                                                                                                                         |
| `portal`           | `ds-portal:<tag>` (Next.js standalone)                  | user-facing auth screens (`app.doctor.school`)                                                                                                                                          |
| `zitadel`          | `ghcr.io/zitadel/zitadel:v4.15.0`                       | IdP core (OIDC issuer `id.doctor.school`)                                                                                                                                               |
| `zitadel-login`    | `ghcr.io/zitadel/zitadel-login:v4.15.0`                 | Zitadel Login V2 UI (pinned in lockstep with core — dev-stand precedent)                                                                                                                |
| `sms-aero-adapter` | `node:22-alpine` (dev-stand `server.mjs`, bind-mounted) | HTTP SMS bridge: Zitadel's generic HTTP SMS provider POSTs each OTP → adapter → SMS-Aero Gate API v2. Required by the DoD's live SMS (§6.2, §10.3); reuses the dev-stand adapter script |

Caddy routes `id.doctor.school`: `/ui/v2/login/*` → `zitadel-login`, everything else → `zitadel` core — the same single-origin split the dev-stand's `idp-proxy` performs (dev-stand `.env.example` §Console).

### 2.2 `data-prod` (private)

| Container    | Image (approx.)                                 | Purpose                                                                                    |
| ------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `postgres`   | `postgres:17-bookworm` (pgvector-enabled build) | two databases: `ds_prod` (app, ADR-0003) + `zitadel` (IdP store)                           |
| `redis`      | `redis:7-alpine` (AOF)                          | session store, rate-limit counters, SMS-budget, login-challenge (single-node, ADR-0003 §8) |
| `pgbackrest` | pgbackrest custom image                         | cron daily basebackup + continuous WAL archive → Timeweb S3 (ADR-0003 §2.4)                |

Postgres image must carry **pgvector** (ADR-0003) — this is the decisive reason for self-hosted PG over Timeweb Managed PG (§3). The `ds_prod`/`zitadel` split mirrors the dev-stand's `init.sql` (`infra/dev-stand/postgres/`).

### 2.3 Reconcile against ADR-0012's target inventory (deviations are intentional slice-subsets)

ADR-0012 §Process-inventory lists components this slice does **not** deploy. Each omission is grounded in the built code, not a silent skip:

| ADR-0012 target component                          | Slice status      | Why                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nginx` (TLS/reverse-proxy)                        | **Caddy instead** | Automatic ACME with no manual agent intervention (engineering-readiness §1 permits Caddy/Traefik; dev-stand IdP already uses Caddy). ADR-0012 §1 names nginx → 1-line reconcile (§7 decision-debt).                                                                                         |
| `generic-worker` + `notifications-worker` (BullMQ) | **not deployed**  | 003 has **no** BullMQ queues/workers (verified: no `bullmq`/`Queue`/`Processor` in `apps/api/src`). The mailer sends via SMTP synchronously; SMS via the SMS-Aero adapter. Workers deploy when the first queue lands.                                                                       |
| `centrifugo`                                       | **not deployed**  | Real-time is deferred to pilot (engineering-readiness "Deferred to pilot"); 003 has no realtime surface.                                                                                                                                                                                    |
| Cerbos (embedded in `api`)                         | **not deployed**  | 003's `AuthzGuard` is role-based + fail-closed; object-level `IPolicyEngine`/Cerbos is an explicit unimplemented **SEAM** (`apps/api/src/authz/authz.guard.ts`, DSO-27). No code path calls Cerbos — `CERBOS_URL` has zero TS usages. Deploying it would provision infra nothing exercises. |

This is `slice ⊂ target`, not a contradiction: ADR-0012 remains the v1 destination; the slice ships the subset 003 exercises today and each deferred component is a tracked DSO child (§8).

---

## 3. Database — self-hosted Postgres 17 on `data-prod` (not Managed PG)

**Decision (locked):** self-hosted Postgres 17 in a container on `data-prod`, **not** Timeweb Managed PG (`twc_db_postgres`). Reasons:

1. **pgvector.** Timeweb Managed-PG's extension whitelist (`pg_stat_statements, timescaledb, postgis, uuid-ossp, amcheck, pg_repack, pg_stat_kcache, pg_trgm, pgcrypto`) has **no pgvector** — which ADR-0003 requires. No superuser either, so the extension cannot be added.
2. **Cost.** Managed 4/8/80 (`id1173`, ru-3) ≈ **3160 ₽/mo** vs a self-hosted 4/8/80 VPS (preset `4803`, ru-3) ≈ **1800 ₽/mo** (~1.75×).

Backups (§6) go to Timeweb Object Storage via pgbackrest. This choice **supersedes** the tenancy-spec's "Managed PG" line — reconciled under **DSO-101** (a 1-line bbm doc follow-up; §7).

**Redis** is single-node with AOF on `data-prod` (ADR-0003 §8) — session store + rate-limit + budgets; not used for anything that needs HA at pre-pilot scale.

---

## 4. VPS presets and cost

Prices from the live Timeweb API (`GET /api/v1/presets/servers`, RF, 2026-07; see `reference_timeweb_terraform_harness`). Presets are Terraform **variables** with the defaults below — validated on `apply`.

| VPS                           | Preset (default)                   | vCPU/RAM/disk | Zone    | Public IPv4                | ₽/mo (approx.)      |
| ----------------------------- | ---------------------------------- | ------------- | ------- | -------------------------- | ------------------- |
| `api-prod`                    | `4803` (ru-3 msk, cheapest 4/8/80) | 4 / 8 / 80    | `msk-1` | **yes** (+180 ₽)           | 1800 + 180          |
| `data-prod`                   | `4803` (same class)                | 4 / 8 / 80    | `msk-1` | **no** (egress via router) | 1800                |
| `twc_router` (NAT gateway)    | `2009` (ru-3 msk, 1/1, cheapest)   | 1 / 1 / —     | `msk-1` | floating IP (NAT source)   | ~450                |
| Timeweb S3 (pgbackrest repo)  | Hot, ~50 GB                        | —             | RF      | —                          | ~200–400            |
| **Total slice (prod-direct)** |                                    |               |         |                            | **~4400–4650 ₽/mo** |

Well under the ADR-0012 ≤30k ₽/month envelope (this is a slice; observability reuses bbm's `mon-prod-tw` at no incremental ds cost). The NAT router (+ its floating IP) is the price of an IP-less data plane — Timeweb has no per-server SNAT, so a public-IP-less host's egress must come from a network router (§5.1).

**Disk note (decision-debt §7):** ADR-0012's cost table sketched `data-prod` at 200 GB; the slice starts on the 80 GB preset because pre-pilot has 0 real users and WAL + basebackups offload to S3 (only the live cluster + local WAL spool sit on disk). **Upgrade trigger:** local disk >70% or basebackup retention needs on-box copies → bump the `data_prod_preset_id` variable to a larger-disk preset (documented in the IaC README).

---

## 5. Networking, TLS, DNS, secrets

### 5.1 Private network + NAT router + firewall (as-built)

- **Fresh `twc_vpc`** (`192.168.0.0/24`, region ru-3 = Moscow, containing AZ `msk-1`); both VPSes attached with static addresses via a `no_nat` (local-only) VPC port. `api-prod` = `192.168.0.20` + its own public IPv4; **`data-prod` = `192.168.0.10` and no public IPv4 at all** — the private network is the only inbound path to Postgres/Redis.
- **Egress for the IP-less `data-prod` = a network-level NAT router** (`twc_router.ds`), per Timeweb support's explicit recommendation. The provider implements **no per-server SNAT** on a local network, so a public-IP-less host reaches the internet only through a router that NATs the whole VPC subnet from a floating IPv4. The router gateway sits inside the VPC at **`192.168.0.4`** and is `data-prod`'s default-route target; the router's floating IP is the NAT source (an egress-only address — never a DNS/inbound target). `api-prod`'s VPC port is `no_nat`, so the router does not rewrite it — `api-prod`'s public path is untouched.
- **Two provider facts the topology rests on** (verified live, DSO-100 2026-07-03):
  1. The VPC-port `nat_mode` label reads `dnat_and_snat` on a public-IP server **regardless of the requested mode** — it is **cosmetic**; SSH and egress were verified healthy with it set. It is not evidence of a misconfigured port.
  2. VPC port modes are **sticky** — once a port flips to `dnat_and_snat` the per-port PATCH 404s, so a contaminated network cannot be repaired, only **destroyed and recreated**. This is why the topology is built on a **fresh** VPC every rebuild rather than reusing an existing one.
- **`twc_firewall`** (default-deny; binds to each server via a `link` block):
  - `api-prod`: inbound `80`, `443` from `0.0.0.0/0`; `22` (SSH) from the operator's admin CIDR only.
  - `data-prod`: inbound only from the VPC CIDR (`5432`, `6379`); `22` from the VPC CIDR (operator jumps through `api-prod` as a bastion, so its SSH source is a VPC address).
- **Cloud-init ordering on the IP-less `data-prod`:** because the host has zero egress until its default route via the router gateway exists, `cloud-init/data-prod.yaml` installs a netplan default-route drop-in **first** (via `write_files` + an ordered `runcmd` that runs `netplan apply` before any `apt`), and installs packages from `runcmd` — **not** the cloud-init `packages` module, which runs before `runcmd` and would hang against unreachable mirrors. IPv4 public resolvers (`1.1.1.1`/`8.8.8.8`) ride the same route (Timeweb's provisioned resolvers are IPv6-only, unreachable from the private plane).
- Egress: LAN/VPC traffic is intra-zone trusted, not routed through the ADR-0011 egress PII scanner (dev-stand rule generalizes — private-network calls are intra-zone).

### 5.2 TLS — Caddy with automatic Let's Encrypt

Caddy on `api-prod` terminates TLS for all three public hostnames and auto-renews without operator intervention (engineering-readiness §1). HTTP-01 challenge over `:80`. No manual certificate handling — the deploy discipline requires "auto-renewal without manual agent intervention".

### 5.3 DNS — at Beget (not Timeweb)

The `doctor.school` zone lives at **Beget** (`ns1/ns2.beget.com`), so Terraform does **not** manage DNS (no `twc_dns_zone`). The following A-records are created **manually at Beget**, pointing at `api-prod`'s public IPv4 (from the Terraform `api_prod_public_ip` output):

| Hostname            | Target             | Purpose                                                     |
| ------------------- | ------------------ | ----------------------------------------------------------- |
| `api.doctor.school` | api-prod public IP | NestJS BFF/API                                              |
| `app.doctor.school` | api-prod public IP | portal (Next.js)                                            |
| `id.doctor.school`  | api-prod public IP | Zitadel OIDC issuer (`IDP_ISSUER=https://id.doctor.school`) |

Root `doctor.school` A-record (`92.118.115.14`, the existing site) is untouched. Email records (MX `emx.mail.ru`, SPF, DKIM selectors, `_dmarc p=none`) are already live at Beget (`reference_doctor_school_email_dns`) — no change in this slice; DMARC tightening to `p=quarantine` is a separate, later step after ~2 weeks of `rua` review.

### 5.4 Secrets — `.env` files on the box (Vault-light), Vault later

Per the brainstorm decision (#7) and the dev-stand precedent, the **application/runtime secrets** are **`.env` files provisioned out-of-band** onto each VPS (root-owned, `0600`), referenced by docker-compose `env_file:` — **never** committed, and **not** produced by Terraform (so they never enter Terraform state):

| File (on the VPS)              | Holds                                                                                                                                                                                                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/etc/ds-platform/api.env`     | `DATABASE_URL`, `REDIS_URL`, `IDP_*` (issuer, service token, client id/secret, project, redirect, webhook secret), `AUDIT_IDENTIFIER_PEPPER`, `EMAIL_/SMS_DELIVERY_MODE`, **`IDP_SMTP_REAL_*`** (mail.ru relay — the api's env schema + `provision.sh` consume them), `MAILER_PORTAL_BASE_URL`, `SMSAERO_*`, `API_PROXY_TARGET` |
| `/etc/ds-platform/zitadel.env` | `ZITADEL_MASTERKEY` (exactly 32 chars), the Zitadel DB host + user/admin passwords, first-boot `ZITADEL_FIRSTINSTANCE_*` bootstrap. **Note:** the real SMTP provider is configured by `idp/provision.sh` from the `IDP_SMTP_REAL_*` values in **`api.env`**, not by this file.                                                  |
| `/etc/ds-platform/data.env`    | `POSTGRES_PASSWORD`, pgbackrest S3 creds + repo cipher passphrase                                                                                                                                                                                                                                                               |

`TWC_TOKEN` for Terraform lives in `infra/deploy/.env` (gitignored), same account as bbm, **project-scope `ds-platform`**. Migration to Vault (KEK for encrypted backups, ADR-0003 §2.4) is a tracked follow-up — env is the interim bootstrap default + fail-closed fallback (the same pattern 003 uses for delivery-mode flags until Unleash lands).

**Terraform-generated secrets are the exception (DD-6).** The pgbackrest S3 access/secret keys are **generated by Timeweb when the bucket is created** and surfaced as `sensitive` outputs — they therefore **do land in `terraform.tfstate` in plaintext** (`sensitive` only suppresses CLI display, not at-rest storage). So the "not in Terraform state" rule above is scoped to the on-box `.env` secrets (DB password, IdP tokens, masterkey, pepper) that Terraform never touches; the S3 backup creds are the one class that state holds. Mitigation for the slice: `*.tfstate` is gitignored and kept off any shared location; the operator copies the keys into `data.env` via `terraform output -raw` (§9 README). Encrypted remote state / Vault-managed backup creds is the tracked follow-up (DD-6, §7).

---

## 6. Email, SMS, backups

### 6.1 Email — mail.ru business relay (live)

- **Zitadel identity emails** (verification / OTP / reset): `IDP_SMTP_REAL_HOST=smtp.mail.ru:465`, sender `noreply@doctor.school` — **already configured and tested** by the operator (`reference_doctor_school_email_dns`). The `IDP_SMTP_REAL_*` creds live in **`api.env`** (§5.4); at deploy, set `EMAIL_DELIVERY_MODE=real` and run `pnpm --filter @ds/api reconcile:sweep` / `provision.sh` (sourcing `api.env`) so Zitadel converges onto the real SMTP provider.
- **BFF transactional email** (the duplicate-registration notice, #207): `MAILER_SMTP_*` currently points at Mailpit → repoint at the **same mail.ru relay** at deploy (it reuses the `IDP_SMTP_REAL_*` creds under the `email-delivery-real` flag, per the dev-stand `.env.example`).
- **Rate limit:** mail.ru is dynamic/reputation-based (`451 Ratelimit exceeded`, fresh box ~50/day). Adequate for pre-pilot; not a bulk guarantee.

### 6.2 SMS — SMS-Aero (live)

SMS-OTP via the `sms-aero-adapter` (SMS-Aero Gate API v2, `reference_sms_provider_smsaero`). Set `SMS_DELIVERY_MODE=real`; creds (`SMSAERO_EMAIL`/`SMSAERO_API_KEY`) in `api.env`. **Real SMS costs money** — the SMS budget service (`SmsBudgetService`, #87) is the runtime guard; exercise the live path with one supervised paid test.

### 6.3 Backups — pgbackrest → Timeweb S3

Per ADR-0003 §2.4, on `data-prod`:

- **WAL archive:** continuous (`archive_command` → Timeweb S3) → RPO ≤ 15 min.
- **Basebackup:** daily full at 02:30 MSK (inside the maintenance window); incremental every 6 h.
- **Retention:** `repo1-retention-full=7` (7 daily fulls).
- **Encryption:** pgbackrest repo cipher (AES-256-CBC), passphrase in `data.env` (Vault-light → Vault KEK later).
- **RTO:** ≤ 2 h manual restore (ADR-0012 SLO-compliant; no automated failover at v1).
- **Offsite:** Beget S3 weekly sync is **deferred** (OUT list §8) — Timeweb S3 primary only for this slice.

---

## 7. Decision debt (deviations from documented conventions — surfaced per AGENTS.md §6)

| #    | Deviation                                                                      | Convention                                           | Disposition                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DD-1 | TLS via **Caddy**, not nginx                                                   | ADR-0012 §1 process inventory names `nginx`          | Intentional (auto-ACME, engineering-readiness §1 permits it). 1-line ADR-0012 reconcile: "nginx" → "Caddy or nginx (operator choice)".                                                                                                                                                                                                                                                                                   |
| DD-2 | Zitadel **co-located on `api-prod`**, not on a separate `shared-tooling` VPS   | ADR-0012 §6 lists Zitadel as shared-tooling infra    | Intentional: ds has no shared-tooling VPS (bbm's `mon` is observability-only). Co-location is correct for a single-product slice; revisit if a shared IdP is needed across products.                                                                                                                                                                                                                                     |
| DD-3 | Cerbos / BullMQ workers / Centrifugo **not deployed**                          | ADR-0012 §Process-inventory lists them in v1 target  | Intentional slice-subset — none is called by 003 code (§2.3). Each is a tracked DSO child (§8).                                                                                                                                                                                                                                                                                                                          |
| DD-4 | `data-prod` on **80 GB** preset                                                | ADR-0012 cost table sketched 200 GB                  | Intentional: 0 users + WAL/basebackup → S3. Documented upgrade trigger (§4).                                                                                                                                                                                                                                                                                                                                             |
| DD-5 | Tenancy-spec says **"Managed PG"**                                             | bbm tenancy design line                              | Superseded by ADR-0003/ADR-0012 self-hosted PG. Reconcile tracked as **DSO-101**.                                                                                                                                                                                                                                                                                                                                        |
| DD-6 | pgbackrest **S3 creds land in `terraform.tfstate`** (plaintext at rest)        | §5.4 "secrets not in Terraform state"                | Unavoidable: Timeweb generates the bucket keys, exposed as `sensitive` outputs. Scoped exception to §5.4 (on-box `.env` secrets stay out of state). Mitigation: gitignored state off shared locations; follow-up = encrypted remote state / Vault-managed backup creds.                                                                                                                                                  |
| DD-7 | **Mandatory public IPv6 on both VPSes** (incl. the "IP-less" `data-prod`)      | §5.1 "`data-prod` has no public path"                | Provider-forced: every Timeweb VPS gets a public IPv6 even when public IPv4 is declined. The cloud `twc_firewall` default-deny still holds — the whitelist is v4-only, so it matches **no** IPv6 inbound. Host-level `ufw` v6 hardening on both boxes is a tracked follow-up (not a slice blocker: default-deny already closes v6 inbound).                                                                              |
| DD-8 | **Router gateway IP pinned as a Terraform variable** (`vpc_router_gateway_ip`) | IaC normally derives addresses from resource outputs | The `twc_router` provider resource has no `gateway` attribute, so the VPC-internal gateway (Timeweb-assigned, observed `192.168.0.4`) cannot be read back and must be pinned as a variable to render `data-prod`'s cloud-init default route. Verify-after-recreate procedure documented in `variables.tf` (re-read `GET /api/v1/routers → networks[].gateway` after any router recreate and update the var if it moved). |
| DD-9 | **Cosmetic ghost firewall links to destroyed server ids**                      | Clean provider state has no dangling links           | Timeweb re-link bug: during the rebuild the provider left firewall→server link records pointing at destroyed server ids, and the backend refuses their deletion. They match no live server (the firewalls re-bind to the current servers via `link`), so they are inert; no follow-up beyond awareness.                                                                                                                  |

---

## 8. Out-of-slice — tracked DSO child tasks (F-22 deferrals)

Each is an explicit, tracked deferral (not a silent default). To become DSO children of DSO-100 with a "done against the real dependency" criterion:

- **Cerbos deploy** — lands with `IPolicyEngine` (DSO-27); no deploy value before object-level policies exist.
- **BullMQ workers** — deploy with the first queue.
- **Centrifugo** — deploy if/when a realtime surface ships (pilot trigger).
- **Unleash self-hosted** — env-flag interim until then (#184/#185).
- **Beget S3 offsite backups** — weekly sync after the base backup path is proven.
- **preview-vps** (per-PR environments) — ADR-0012 §2.
- **admin / cms / promo / mobile apps** — later product slices.
- **WAF** (Coraza/ModSecurity on the reverse proxy) — deferred.
- **Tempo** (tracing), **HA/replicas**, **LB**, **CDN** — post-v1 (ADR-0012 OQ-T2/T3).
- **Observability wiring** — reuse bbm `mon-prod-tw` (Loki/Prometheus/Grafana/Alloy) with DS dashboard folders + alert channels + GlitchTip; Alloy agents on both VPSes ship logs/metrics. (In-slice-adjacent; sized on bbm, not here.)

---

## 9. IaC layout (applied Terraform + on-box deploy payload)

Own Terraform harness under `infra/deploy/` — same Timeweb account as bbm, **project-scope `ds-platform`** (tenancy SSOT), own state + own `TWC_TOKEN`. bbm's `infra/timeweb/terraform` is the template, not a shared dependency.

```
infra/deploy/
  README.md                    apply order, secret handling, DNS runbook, upgrade triggers, recovery
  .env.example                 TWC_TOKEN (gitignored real .env)
  api.env.example              api/portal/sms-aero-adapter/migrate runtime env template (§5.4)
  zitadel.env.example          Zitadel masterkey + DB + first-boot bootstrap template (§5.4)
  data.env.example             POSTGRES_PASSWORD + pgbackrest S3 creds + cipher template (§5.4)
  terraform/                   APPLIED (topology live 2026-07-03); state gitignored
    providers.tf               twc provider ~> 1.7 (pinned 1.7.1), token from env
    variables.tf               presets, zone/region, project_id, SSH pubkeys, admin CIDR, vpc + router gateway IP
    network.tf                 twc_vpc (fresh) + twc_floating_ip + twc_router (NAT egress) + twc_firewall (+ rules)
    api-prod.tf                twc_ssh_key + twc_server (public IPv4, no_nat VPC port) + cloud-init
    data-prod.tf               twc_server (NO public IPv4, no_nat VPC port, router-NAT egress) + templated cloud-init
    s3.tf                      twc_s3_bucket (pgbackrest repo, Hot v2)
    outputs.tf                 api_prod_public_ip, egress IP, server ids, private IPs, bucket + S3 creds
    .gitignore                 tfstate(*), .terraform, .env, *.tfvars
  cloud-init/
    api-prod.yaml              base hardening (non-root user, ufw, docker+compose, tz)
    data-prod.yaml             route-first hardening (netplan default route via router gw, THEN apt/docker via runcmd)
  compose/
    api-prod/
      compose.yml              caddy + api + portal + zitadel + zitadel-login + sms-aero-adapter + one-shot migrate (build contexts = repo root)
      Caddyfile                vhost + IdP single-origin routing
    data-prod/
      compose.yml              postgres + redis + pgbackrest
      postgres/                Dockerfile (pg17 + pgvector) + init.sql (ds_prod/zitadel split) + postgresql.conf
      pgbackrest/              Dockerfile + entrypoint.sh + backup.sh + crontab + pgbackrest.conf

# image builds (repo root context, on-box, no registry):
apps/api/Dockerfile            NestJS runtime + `migrate` target (drizzle-kit)
apps/portal/Dockerfile         Next.js standalone
.dockerignore                  (repo root) prunes the on-box build context
```

The `compose/**`, Dockerfiles, cloud-init, and env templates are an **apply-ready on-box deploy payload**, not a skeleton: image builds wire from the repo root as the Docker context (on-box git clone, no registry — bbm-portal precedent), the pgbackrest sidecar carries its full repo config, and every `.env.example` names exactly the keys the built 003 code reads. The Terraform topology is **applied live** (`terraform plan` clean); state and `.tfvars` are gitignored (never committed). Remaining gaps are the tracked follow-ups in §7/§8 (Vault-managed secrets, encrypted remote state, host-level v6 `ufw`), not silent stubs.

---

## 10. Verification (definition of done for the slice)

The slice is done when, on the live always-on stand, a user can complete the auth vertical end-to-end in the **actual running UI** (`app.doctor.school`, Playwright on the live stand — AGENTS.md §6 "Verify UI live"):

1. Register with email → receive a **real** verification email (mail.ru) → verify.
2. Passwordless email-OTP login → receive a real OTP email → land authenticated.
3. Passwordless SMS-OTP login → receive a **real** SMS (SMS-Aero, one supervised paid test) → land authenticated.
4. `/me/*` PD-lifecycle endpoints respond behind a valid session.
5. TLS valid on all three hostnames (Caddy auto-cert); Zitadel Login V2 reachable at `id.doctor.school`.
6. pgbackrest: a basebackup + WAL land in Timeweb S3; a restore dry-run meets RTO ≤ 2 h.

Build/typecheck/lint/Mode-a are necessary but **not** sufficient — the live email + SMS deliveries and the browser journey are the gate.

---

## 11. Cross-references

- **ADR-0012** — deployment topology v1 (2-VPS docker-compose, SLO 99.0%, maintenance window). This slice applies it; DD-1/DD-3 note the reconciles.
- **ADR-0003 §2.4 / §8** — backup topology + Redis single-node policy + pgvector requirement.
- **ADR-0001** — Zitadel IdP.
- **engineering-readiness §"Pre-pilot deployment slice"** — the authoritative IN/Deferred list; this slice is a subset.
- **`reference_timeweb_terraform_harness`** — twc provider, presets, prices, Managed-PG pgvector gap.
- **`reference_doctor_school_email_dns`** — Beget zone, mail.ru relay, DMARC, sender inventory.
- **`reference_sms_provider_smsaero`** — SMS-Aero Gate API v2.
- **DSO-101** — tenancy-spec "Managed PG" reconcile (DD-5).
