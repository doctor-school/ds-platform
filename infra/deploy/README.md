# `infra/deploy/` — DS Platform pre-pilot deploy slice (DSO-100)

IaC **skeleton** for deploying the built auth vertical (feature 003, epic #80) onto
an **always-on** Timeweb production environment with live SMS + Email.

> **Design (SSOT):** [`apps/docs/content/specs/tech/2026-07-02-ds-platform-prepilot-deploy-slice-design-en.md`](../../apps/docs/content/specs/tech/2026-07-02-ds-platform-prepilot-deploy-slice-design-en.md).
> Read it first — this README is the operational runbook, the spec is the decisions.

## What this is (and is not)

- **Is:** two Timeweb VPSes (`api-prod` public + `data-prod` private) joined by a
  private network (per ADR-0012), plus a pgbackrest S3 backup repo. Own Terraform
  harness, own state, own `TWC_TOKEN`, **project-scope `ds-platform`** (tenancy SSOT).
- **Is a skeleton:** the `terraform/` harness provisions the hosts/network/S3
  (all provider attribute shapes verified against `timeweb-cloud/timeweb-cloud`
  v1.7.1 — `terraform validate` passes), but `compose/**` and `cloud-init/*` carry
  explicit `TODO(DSO-100)` markers (image build+publish pipeline, secret
  provisioning runbook, pgbackrest repo config). These are tracked follow-ups,
  **not** apply-and-forget.
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
2. **Value-preflight (BEFORE `plan`/`apply`).** Attribute-shape `validate`-green
   does NOT cover value-level availability — enumerate these from the **live
   provider API** (not a repo mapping), else you learn them via failed applies:
   - **VPC region:** `twc_vpc.location` is only offered in `ru-1 / ru-3 / de-1 /
nl-1` — **NOT `ru-2`** (Novosibirsk has no private network). RF-only (152-ФЗ)
     ⇒ `ru-1` (SPb) or `ru-3` (Moscow). Cheapest RF VPC-capable 4/8/80 = `id2581`
     (ru-1, 1485₽); `id4803` (ru-3, 1800₽).
   - **Availability-zone code:** SPb = `spb-3` (NOT `spb-1`), Moscow = `msk-1`,
     Novosibirsk = `nsk-1`. A fixed RF preset also works with the AZ **omitted**
     (bbm's ru-1 host sets none). Query `GET /api/v1/presets/servers`.
   - **Free capacity:** a valid region/zone can still return `no_free_node` (409)
     at apply — check the account panel / retry / pick an available region before
     committing. (2026-07-02: ru-1/2581 hit `no_free_node`; MSK-1 was available.)
3. **Provision:** from `terraform/`: `set -a; . ../.env; set +a` then
   `terraform init && terraform validate && terraform plan`. Provider attribute
   shapes are resolved & `validate`-green against `timeweb-cloud` v1.7.1 (twc_vpc
   uses a region `location`; firewalls bind via `link {id,type="server"}`; servers
   join the VPC via a `local_network {id,ip,mode}` block — DSO-100 2026-07-02).
   Review the plan (region/preset/cost) before `apply`.
4. **DNS (manual, at Beget — the zone is NOT at Timeweb):** point A-records
   `api.` / `app.` / `id.doctor.school` at the `api_prod_public_ip` output. Root
   `doctor.school` A-record is untouched. Email records (MX/SPF/DKIM/DMARC) are
   already live (memory `reference_doctor_school_email_dns`).
5. **Secrets (out-of-band):** provision `/etc/ds-platform/{api,zitadel,data}.env`
   onto each VPS (root:root, `0600`) — app/runtime secrets are never committed and
   never produced by Terraform (spec §5.4). **Exception (DD-6):** the pgbackrest S3
   keys ARE Terraform-generated (they live in `tfstate`); copy them into `data.env`
   with `terraform output -raw pgbackrest_s3_access_key` and
   `terraform output -raw pgbackrest_s3_secret_key` (+ `pgbackrest_bucket_full_name`
   / `pgbackrest_s3_hostname` for the repo target).
6. **Bring up services:** `docker compose -f compose/data-prod/compose.yml up -d`
   first (DB/Redis/backup), then `compose/api-prod/compose.yml` (after resolving the
   image build+publish TODOs). Set `EMAIL_DELIVERY_MODE=real` + `SMS_DELIVERY_MODE=real`
   and run the Zitadel provider reconcile so delivery points at mail.ru + SMS-Aero.
7. **Verify (definition of done):** drive the auth vertical in the live UI
   (`app.doctor.school`) — real email + SMS OTP + `/me/*` + valid TLS + a pgbackrest
   basebackup/WAL in S3 with a restore dry-run (spec §10).

## Key gotchas

- **152-ФЗ region/zone:** keep both VPSes + the VPC in the same **RF** region. A
  **fixed RF preset** (e.g. `id2581` ru-1) lands in RF even with `availability_zone`
  **omitted** — bbm's ru-1 host sets none (the `ams-1` default risk is for
  location-agnostic ordering, not a pinned RF preset). If you DO pin an AZ, use a
  valid code (`spb-3` for ru-1, `msk-1` for ru-3 — NOT `spb-1`). See the
  value-preflight in Apply order §2.
- **Public IP is a separate paid resource** (+180₽/mo) — only `api-prod` gets one;
  `data-prod` stays private (no `twc_server_ip`).
- **Self-hosted PG, not Managed PG** — Managed PG has no pgvector + no superuser
  (spec §3). The Postgres image MUST carry pgvector.
- **Disk upgrade trigger:** `data-prod` starts on 80 GB; bump `data_prod_preset_id`
  when local disk >70% or on-box backup retention is needed (spec §4).
- **Terraform state has secrets** (S3 keys via outputs) — `*.tfstate` is gitignored;
  keep it out of any shared location. Vault migration is a tracked follow-up.
- **first-boot egress (data-prod):** data-prod has no public IP; its VPC interface
  is `mode="snat"` so runtime egress (pgbackrest→S3, image pulls) is NAT'd out.
  But cloud-init runs at **first boot**, possibly before SNAT is fully up — if the
  data-prod cloud-init needs the internet (apt, docker install) it may stall. The
  provider docs' remedy is a temporary `floating_ip_id` on the server during
  provisioning (dropped afterward), or bake the image/pre-pull offline. Confirm on
  the first `apply`; if cloud-init hangs, attach a floating IP, re-run, detach.
- **VPC region vs server AZ:** `twc_vpc.location` takes a **region** code
  (`ru-1`/`ru-3`, NOT `ru-2` — no VPC there), while `twc_server.availability_zone`
  takes an **AZ** (`spb-3`/`msk-1`). Keep them co-located (single-AZ, ADR-0012). The
  committed spec §1/§4 + `variables.tf` defaults still say ru-2/nsk-1 — full DD-8
  region reconcile is a tracked follow-up (see `project_infra_deploy_prepilot_recon`).
