# `infra/deploy/` — DS Platform pre-pilot deploy slice (DSO-100)

IaC **skeleton** for deploying the built auth vertical (feature 003, epic #80) onto
an **always-on** Timeweb production environment with live SMS + Email.

> **Design (SSOT):** [`apps/docs/content/specs/tech/2026-07-02-ds-platform-prepilot-deploy-slice-design-en.md`](../../apps/docs/content/specs/tech/2026-07-02-ds-platform-prepilot-deploy-slice-design-en.md).
> Read it first — this README is the operational runbook, the spec is the decisions.

## What this is (and is not)

- **Is:** two Timeweb VPSes (`api-prod` public + `data-prod` private) joined by a
  private network (per ADR-0012), plus a pgbackrest S3 backup repo. Own Terraform
  harness, own state, own `TWC_TOKEN`, **project-scope `ds-platform`** (tenancy SSOT).
- **Is a skeleton:** the `terraform/` harness provisions the hosts/network/S3, but
  `compose/**`, `cloud-init/*`, and several attribute shapes carry explicit
  `TODO(DSO-100)` markers (image build+publish pipeline, secret provisioning
  runbook, pgbackrest repo config, VPC-attach/firewall-bind attribute names). These
  are tracked follow-ups, **not** apply-and-forget.
- **Is NOT:** the full pre-pilot. Cerbos, BullMQ workers, Centrifugo, Unleash,
  admin/cms/promo/mobile, WAF, HA, LB, CDN, preview-vps, Beget S3 offsite are all
  **out of slice** — deploying only what 003 actually runs (spec §2.3, §8).

## Layout

```
infra/deploy/
  .env.example        TWC_TOKEN (copy to .env — gitignored)
  terraform/          twc harness: providers, variables, network (vpc+firewall),
                      api-prod, data-prod, s3 (pgbackrest repo), outputs
  cloud-init/         first-boot base hardening (non-root deploy user, ufw, docker)
  compose/
    api-prod/         caddy + api + portal + zitadel + zitadel-login (skeleton) + Caddyfile
    data-prod/        postgres(pgvector) + redis + pgbackrest (skeleton)
```

## Apply order

1. **Prereqs:** `cp .env.example .env` and set `TWC_TOKEN` (an account-level Timeweb
   token; project-scoped tokens do not exist). Confirm/create the `ds-platform`
   Timeweb project and set `project_id`. Generate deploy SSH keypairs and set the
   `*_ssh_pubkey_path` + real pubkeys in `cloud-init/*.yaml`. Set `admin_ssh_cidr`.
2. **Provision:** from `terraform/`: `set -a; . ../.env; set +a` then
   `terraform init && terraform validate && terraform plan`.
   **Resolve every `TODO(DSO-100)` `validate` notice first** (twc_vpc / twc_firewall
   attribute names + VPC-attach/firewall-bind args are unverified against the
   provider schema — the bbm template does not use these resources yet). Then `apply`.
3. **DNS (manual, at Beget — the zone is NOT at Timeweb):** point A-records
   `api.` / `app.` / `id.doctor.school` at the `api_prod_public_ip` output. Root
   `doctor.school` A-record is untouched. Email records (MX/SPF/DKIM/DMARC) are
   already live (memory `reference_doctor_school_email_dns`).
4. **Secrets (out-of-band):** provision `/etc/ds-platform/{api,zitadel,data}.env`
   onto each VPS (root:root, `0600`) — app/runtime secrets are never committed and
   never produced by Terraform (spec §5.4). **Exception (DD-6):** the pgbackrest S3
   keys ARE Terraform-generated (they live in `tfstate`); copy them into `data.env`
   with `terraform output -raw pgbackrest_s3_access_key` and
   `terraform output -raw pgbackrest_s3_secret_key` (+ `pgbackrest_bucket_full_name`
   / `pgbackrest_s3_hostname` for the repo target).
5. **Bring up services:** `docker compose -f compose/data-prod/compose.yml up -d`
   first (DB/Redis/backup), then `compose/api-prod/compose.yml` (after resolving the
   image build+publish TODOs). Set `EMAIL_DELIVERY_MODE=real` + `SMS_DELIVERY_MODE=real`
   and run the Zitadel provider reconcile so delivery points at mail.ru + SMS-Aero.
6. **Verify (definition of done):** drive the auth vertical in the live UI
   (`app.doctor.school`) — real email + SMS OTP + `/me/*` + valid TLS + a pgbackrest
   basebackup/WAL in S3 with a restore dry-run (spec §10).

## Key gotchas

- **152-ФЗ zone-pinning:** `availability_zone` is MANDATORY on every `twc_server`
  and the VPC — without it the provider silently places servers in `ams-1` (outside
  RF). Both VPSes + VPC are pinned to `nsk-1` (single-AZ, single VPC).
- **Public IP is a separate paid resource** (+180₽/mo) — only `api-prod` gets one;
  `data-prod` stays private (no `twc_server_ip`).
- **Self-hosted PG, not Managed PG** — Managed PG has no pgvector + no superuser
  (spec §3). The Postgres image MUST carry pgvector.
- **Disk upgrade trigger:** `data-prod` starts on 80 GB; bump `data_prod_preset_id`
  when local disk >70% or on-box backup retention is needed (spec §4).
- **Terraform state has secrets** (S3 keys via outputs) — `*.tfstate` is gitignored;
  keep it out of any shared location. Vault migration is a tracked follow-up.
