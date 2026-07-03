# `infra/deploy/` — DS Platform pre-pilot deploy slice (DSO-100)

IaC **skeleton** for deploying the built auth vertical (feature 003, epic #80) onto
an **always-on** Timeweb production environment with live SMS + Email.

> **Design (SSOT):** [`apps/docs/content/specs/tech/2026-07-02-ds-platform-prepilot-deploy-slice-design-en.md`](../../apps/docs/content/specs/tech/2026-07-02-ds-platform-prepilot-deploy-slice-design-en.md).
> Read it first — this README is the operational runbook, the spec is the decisions.

## What this is (and is not)

- **Is:** two Timeweb VPSes (`api-prod` public + `data-prod` private) joined by a
  private network (per ADR-0012), plus a pgbackrest S3 backup repo. Own Terraform
  harness, own state, own `TWC_TOKEN`, **project-scope `ds-platform`** (tenancy SSOT).
- **Is apply-ready (`compose/**`):** both `compose.yml` files, the Caddyfile, the
  Dockerfiles, the data-layer Postgres image, and the pgbackrest sidecar are
  resolved against the built 003 code — no `TODO(DSO-100)` stubs remain. Images
  build **on-box** (no registry; the box gets source via a read-only deploy-key
  `git clone`). What remains is **build-verify-on-box** (the workstation has no
  Docker) — see [Verify-on-box](#verify-on-box).
- **Is still preliminary elsewhere:** the `terraform/` harness provisions the
  hosts/network/S3 (attribute shapes verified against `timeweb-cloud/timeweb-cloud`
  v1.7.1 — `terraform validate` passes) but the region/zone reconcile is a
  fast-follow (DD-8, see `terraform.tfvars`); `cloud-init/*` is base hardening.
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
  api.env.example     /etc/ds-platform/api.env template (api + portal + sms-adapter + migrate)
  zitadel.env.example /etc/ds-platform/zitadel.env template (masterkey, DB, FIRSTINSTANCE)
  data.env.example    /etc/ds-platform/data.env template (POSTGRES_PASSWORD, pgbackrest S3)
  compose/
    api-prod/         Caddyfile + compose: caddy + api + portal + zitadel +
                      zitadel-login + sms-aero-adapter + a one-shot `migrate` service
    data-prod/        compose: postgres + redis + pgbackrest, plus
                      postgres/  (Dockerfile pgvector+partman+pgbackrest, postgresql.conf, init.sql)
                      pgbackrest/(Dockerfile, pgbackrest.conf, crontab, entrypoint.sh, backup.sh)
```

## Runtime contract (discovered from the built 003 code)

| Service          | Port          | Key env (from `env_file`)                                                                        |
| ---------------- | ------------- | ------------------------------------------------------------------------------------------------ |
| api (NestJS)     | 3000 (`PORT`) | `DATABASE_URL` `REDIS_URL` `IDP_*` `AUDIT_IDENTIFIER_PEPPER` `*_DELIVERY_MODE` `IDP_SMTP_REAL_*` |
| portal (Next.js) | 3001          | `API_PROXY_TARGET=http://api:3000` (build-arg `NEXT_PUBLIC_SMARTCAPTCHA_SITE_KEY`, off)          |
| zitadel core     | 8080 (h2c)    | `ZITADEL_MASTERKEY` `ZITADEL_DATABASE_POSTGRES_*` `ZITADEL_EXTERNAL*`                            |
| zitadel-login    | 3000          | `ZITADEL_API_URL` + the ds-bootstrap PAT file mount                                              |
| sms-aero-adapter | 8091          | `SMSAERO_EMAIL` `SMSAERO_API_KEY` `SMSAERO_SIGN` (from api.env)                                  |
| postgres         | 5432 (VPC)    | `POSTGRES_PASSWORD` `PGBACKREST_*`                                                               |
| redis            | 6379 (VPC)    | — (AOF)                                                                                          |

Health: `/v1/health` (api), `/v1/ready` (api — probes Postgres + pgvector).

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
5. **Deploy-key `git clone` (both boxes — images build on-box, no registry).**
   Generate a read-only deploy key, add its public half to this private GitHub repo
   (Settings → Deploy keys, read-only), and clone the repo onto each VPS (short path
   → Windows long-path irrelevant on Linux, but keep it shallow to save disk):

   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/ds-deploy -N '' -C 'ds-platform deploy-ro'
   # → add ~/.ssh/ds-deploy.pub as a READ-ONLY deploy key on the GitHub repo
   # on EACH VPS (api-prod and data-prod), as the deploy user:
   GIT_SSH_COMMAND='ssh -i ~/.ssh/ds-deploy -o IdentitiesOnly=yes' \
     git clone --depth 1 git@github.com:<org>/ds-platform.git ~/ds-platform
   ```

   Both boxes need the clone: api-prod builds api/portal + runs migrations from it;
   data-prod builds the Postgres + pgbackrest images from `infra/deploy/compose/data-prod/`
   (and the api-prod compose bind-mounts `infra/dev-stand/sms-aero-adapter/server.mjs`).

6. **Secrets (out-of-band).** Provision `/etc/ds-platform/{api,zitadel}.env` on
   api-prod and `/etc/ds-platform/data.env` on data-prod, root:root `0600`, from the
   templates (`infra/deploy/*.env.example`). App/runtime secrets are never committed
   and never produced by Terraform (spec §5.4). The **same `ds` DB password** goes in
   all three (`DATABASE_URL` / `ZITADEL_DATABASE_*_PASSWORD` / `POSTGRES_PASSWORD`).

   ```bash
   sudo install -d -m 700 /etc/ds-platform
   sudo install -m 600 ~/ds-platform/infra/deploy/api.env.example  /etc/ds-platform/api.env     # api-prod
   sudo install -m 600 ~/ds-platform/infra/deploy/zitadel.env.example /etc/ds-platform/zitadel.env  # api-prod
   sudo install -m 600 ~/ds-platform/infra/deploy/data.env.example /etc/ds-platform/data.env    # data-prod
   # …then edit each to fill REAL values (openssl rand -hex 32 for pepper / cipher pass;
   #    exactly 32 chars for ZITADEL_MASTERKEY: openssl rand -hex 16).
   ```

   **DD-6 — pgbackrest S3 keys from Terraform** (the one secret class in `tfstate`).
   On the workstation, in `infra/deploy/terraform/`:

   ```bash
   terraform output -raw pgbackrest_bucket_full_name   # → PGBACKREST_REPO1_S3_BUCKET
   terraform output -raw pgbackrest_s3_hostname        # → PGBACKREST_REPO1_S3_ENDPOINT
   terraform output -raw pgbackrest_s3_access_key      # → PGBACKREST_REPO1_S3_KEY
   terraform output -raw pgbackrest_s3_secret_key      # → PGBACKREST_REPO1_S3_KEY_SECRET
   ```

7. **Bring up data-prod FIRST** (DB/Redis/backup). `VPC_IP` = data-prod's private
   address (`var.data_prod_private_ip`, default `192.168.0.10`) — the published
   ports bind to it, never `0.0.0.0`:

   ```bash
   cd ~/ds-platform/infra/deploy/compose/data-prod
   VPC_IP=192.168.0.10 docker compose up -d --build     # builds pgvector+partman+pgbackrest, redis, pgbackrest sidecar
   docker compose logs -f postgres                       # wait for "database system is ready"
   # pgbackrest sidecar auto-runs `stanza-create` + `check` on start; confirm:
   docker compose logs pgbackrest                        # expect the stanza check to pass
   ```

8. **Migrate `ds_prod`, then bring up api-prod.** Migrations run from the one-shot
   `migrate` service (carries drizzle-kit; the runtime image does not), against the
   data-prod DB via `api.env`'s `DATABASE_URL`:

   ```bash
   cd ~/ds-platform/infra/deploy/compose/api-prod
   docker compose --profile migrate run --rm migrate     # applies apps/api/drizzle/0000..0004
   docker compose up -d --build                           # caddy + api + portal + zitadel + zitadel-login + sms-aero-adapter
   docker compose logs -f zitadel                         # first boot: start-from-init runs Zitadel's own DB migration
   ```

9. **Zitadel bootstrap + OIDC provision (spec §6.1; mirrors `infra/dev-stand/idp/bootstrap.md`).**
   - **First boot only** — uncomment the `ZITADEL_FIRSTINSTANCE_*` block in
     `zitadel.env`, `docker compose up -d zitadel`, then capture the ds-bootstrap PAT
     from the `/pat` tmpfs and **re-comment** the block:

     ```bash
     PID=$(docker inspect ds-api-prod-zitadel-1 --format '{{.State.Pid}}')
     sudo cat /proc/$PID/root/pat/pat.txt | sudo tee /etc/ds-platform/idp-bootstrap-pat.txt
     # put IDP_SERVICE_TOKEN=<that PAT> in api.env; place the same PAT for zitadel-login:
     sudo install -m 600 /etc/ds-platform/idp-bootstrap-pat.txt /etc/ds-platform/idp-login-client.pat
     ```

   - **Provision the OIDC app + activate the real providers** (idempotent; SMTP creds
     come from `api.env`, so source it). This grants `IAM_LOGIN_CLIENT`, registers the
     prod redirect URI, and activates mail.ru + SMS-Aero as the boot providers:

     ```bash
     set -a; . /etc/ds-platform/api.env; set +a
     cd ~/ds-platform/infra/dev-stand/idp
     IDP_BASE_URL=https://id.doctor.school \
       IDP_REDIRECT_URIS=https://api.doctor.school/auth/callback \
       IDP_POST_LOGOUT_URIS=https://app.doctor.school \
       EMAIL_DELIVERY_MODE=real SMS_DELIVERY_MODE=real \
       ./provision.sh --pat-file /etc/ds-platform/idp-bootstrap-pat.txt
     # copy the emitted IDP_CLIENT_ID / IDP_CLIENT_SECRET / IDP_PROJECT_ID into api.env,
     # then: docker compose up -d api   (restart to pick up the OIDC creds)
     ```

10. **Verify (definition of done, spec §10).** Drive the auth vertical in the live
    UI (`https://app.doctor.school`, Playwright): register → **real** verification
    email (mail.ru); email-OTP login; **one supervised paid** SMS-OTP login
    (SMS-Aero); `/me/*` behind a session; valid TLS on all three hostnames; a
    pgbackrest basebackup + WAL in S3 with a restore dry-run (RTO ≤ 2 h).

## Verify-on-box

The workstation has no Docker, so the following are **build/run-verify-only** on the
first `apply` (report, don't assume green):

- `apps/api/Dockerfile` — `pnpm deploy --prod /out` resolving the workspace graph
  (add `--legacy` if pnpm 10 requires it); `node dist/main.js` boot.
- `apps/portal/Dockerfile` — the Next standalone COPY paths (the pinned
  `outputFileTracingRoot` should land the entry at `apps/portal/server.js`).
- `compose/data-prod/pgbackrest` — `stanza-create` + `check` succeeding against S3,
  the socket-based backup connection (local `trust`), and a real full/incr + restore.
- Caddy ACME issuance for all three hostnames (needs the Beget A-records live first).

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
