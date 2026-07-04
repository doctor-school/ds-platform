# `infra/deploy/` — DS Platform pre-pilot deploy slice (DSO-100)

Applied Terraform topology + **apply-ready** on-box deploy payload for deploying the
built auth vertical (feature 003, epic #80) onto an **always-on** Timeweb production
environment with live SMS + Email.

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

Note: redis runs AOF with **no `maxmemory` / eviction policy set yet** — fine at
0 users (pre-pilot); tune per ADR-0003 §6 as a tracked follow-up, not an on-box edit.

## Deploy — one command (`pnpm deploy:prod`)

The **steady-state redeploy** is a single idempotent command (DSO-126) that
formalises the manual steps 5–8 + 10 below — nothing hand-run on the box:

```bash
pnpm deploy:prod                 # deploy origin/main (the default)
pnpm deploy:prod --rollback <sha>   # app-only rollback to a prior SHA tag (see Rollback)
pnpm deploy:prod --skip-ci-check    # escape hatch (logs a loud warning)
```

Pipeline (`tools/deploy/prod.mjs`), fail-closed and stops at the first red step:

1. **Pre-flight** — refuses a **dirty working tree**, a HEAD **≠ `origin/main`**,
   or a **red CI** for that SHA (latest check-run per name via `gh api
…/commits/<sha>/check-runs`). The deployed commit is `origin/main`'s SHA.
2. **Ship** — `git archive <sha>` streamed over SSH to **both** boxes
   (`rm -rf ~/ds-platform && tar x`); no registry, no deploy key (README step 5).
3. **data-prod** — `docker compose up -d --build` (idempotent).
4. **Checkpoint (DSO-129)** — a pgbackrest **pre-migrate `incr` backup** (the
   same `backup.sh` cron runs) **before** any migration, so a restore point
   exists at the pre-migrate state. See [Prod migration rule](#prod-migration-rule--expandcontract).
5. **api-prod** — `migrate` (idempotent drizzle-kit) → `build` → `up -d`. Images
   are SHA-tagged **`ds-api:<sha>` / `ds-portal:<sha>`** (DSO-127) — the compose
   `image:` reads `DEPLOY_SHA` from a `.env` the script writes beside `compose.yml`.
6. **Retention (DSO-127)** — keeps the **last 3** SHA-tagged images per repo,
   prunes older (never `:local`, never the running one).
7. **Smoke (DSO-128)** — `tools/deploy/smoke-prod.mjs --expect-sha <sha>`; a red
   smoke fails the deploy loud and prints the rollback pointer.

The **deployed SHA is queryable over HTTP** (DSO-127): the api reports it at
`GET /v1/health` → `{"version":"<sha>", …}` (from the `DEPLOY_SHA` env; unset in
local dev). `curl -s https://api.doctor.school/v1/health | jq .version`.

The script is the **steady-state** path only. **First-time provisioning**
(Terraform §§1–3, DNS §4, out-of-band secrets §6, and the **Zitadel first-boot
bootstrap** §9) stays the manual runbook below — those are one-time, not
per-deploy. Run them once; from then on `pnpm deploy:prod` is the whole deploy.

## Apply order

> **Steps 5–8 + 10 are what `pnpm deploy:prod` automates** on every redeploy —
> they are documented here as the manual fallback + the record of what the
> script does on the box. Steps 1–4, 6 (secrets), and 9 (Zitadel first-boot) are
> **first-time provisioning**, run once by hand.

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
5. **Get the committed `main` source onto both boxes (images build on-box, no registry).**

   > **DSO-100 on-box finding:** deploy keys are **disabled org-wide** for
   > `doctor-school` (GitHub Free org policy; no REST API to toggle, and enabling it
   > changes security posture for every repo in the org). So the deploy-key clone
   > below does **not** work as written. Instead, ship the committed `origin/main`
   > tree over the already-trusted SSH channel — no credential ever lands on a prod
   > box, and the build is identical (`.git`/`.github` are `.dockerignore`d, the
   > builds run no git command, so an archive == a shallow clone for build purposes):
   >
   > ```bash
   > # from the workstation (repo root), for EACH box (api-prod and data-prod):
   > git archive --format=tar.gz --prefix=ds-platform/ origin/main \
   >   | ssh <box> 'rm -rf ~/ds-platform && tar xzf - -C ~'
   > ```
   >
   > Original (blocked) deploy-key path, kept for when org deploy keys are enabled:
   > `ssh-keygen -t ed25519 -f ~/.ssh/ds-deploy -N ''` → `gh repo deploy-key add
~/.ssh/ds-deploy.pub --title ds-<box> --repo doctor-school/ds-platform` →
   > `GIT_SSH_COMMAND='ssh -i ~/.ssh/ds-deploy -o IdentitiesOnly=yes' git clone
--depth 1 git@github.com:doctor-school/ds-platform.git ~/ds-platform`.

   Both boxes need the tree: api-prod builds api/portal + runs migrations from it;
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

   > **DSO-100 on-box findings (both apply to every `docker compose` call below and
   > in steps 8–9):**
   >
   > - The `env_file`s are `root:root 0600`; the docker-compose **CLI reads them as
   >   the invoking user**, so the `deploy` user gets `permission denied`. Run every
   >   compose command as **`sudo docker compose …`** (the daemon already runs as
   >   root). `sudo` strips inline env vars, so pass `VPC_IP` via a **`.env` beside
   >   `compose.yml`**, not `VPC_IP=… sudo docker compose`.

   ```bash
   cd ~/ds-platform/infra/deploy/compose/data-prod
   echo "VPC_IP=192.168.0.10" > .env                     # interpolation var (NOT a secret); sudo strips inline vars
   sudo docker compose up -d --build                     # builds pgvector+partman+pgbackrest, redis, pgbackrest sidecar
   sudo docker compose logs -f postgres                  # wait for "database system is ready"
   # pgbackrest sidecar auto-runs `stanza-create` + `check` on start; confirm:
   sudo docker compose logs pgbackrest                   # expect the stanza check to pass
   ```

   > **DSO-100 code defect (BLOCKS backups + WAL archiving):** neither
   > `compose/data-prod/postgres/Dockerfile` nor `compose/data-prod/pgbackrest/Dockerfile`
   > installs **`ca-certificates`**, so the containers have no TLS trust store and
   > pgbackrest's `stanza-create`/`check` **and** Postgres's `archive_command` both
   > fail against `s3.twcstorage.ru` with OpenSSL error 19 (`self-signed certificate
in certificate chain`) — even though the cert is a valid public GlobalSign cert
   > (the host `curl`s it fine). **Fixed:** both Dockerfiles now install
   > `ca-certificates`. On a box first deployed from the pre-fix images, rebuild
   > (`sudo docker compose up -d --build`) and confirm the pgbackrest stanza check
   > passes and `pg_stat_archiver` failures stop — until then the DB runs but is
   > **unbacked**.

8. **Migrate `ds_prod`, then bring up api-prod.** Migrations run from the one-shot
   `migrate` service (carries drizzle-kit; the runtime image does not), against the
   data-prod DB via `api.env`'s `DATABASE_URL`:

   > **DSO-100 on-box findings (all three fixed in the committed files):**
   >
   > - **`apps/api/Dockerfile` needs `--legacy`:** pnpm v10's `deploy` refuses a
   >   non-injected workspace (`ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE`); the deploy
   >   line is now `pnpm --filter=@ds/api deploy --prod --legacy /out`.
   > - **Portal `/v1/*` proxy is baked at BUILD time:** `apps/portal/next.config.ts`
   >   resolves the rewrite destination from `API_PROXY_TARGET` inside `rewrites()`,
   >   which Next evaluates at `next build` and freezes into
   >   `.next/routes-manifest.json` — built without the env, the
   >   `?? "http://localhost:3000"` fallback got frozen in and the portal proxied
   >   `/v1/*` to `127.0.0.1:3000` (ECONNREFUSED) despite a correct runtime env.
   >   Fixed: the portal Dockerfile takes `ARG API_PROXY_TARGET` before the build and
   >   the compose portal service passes `build.args: API_PROXY_TARGET:
http://api:3000`. A portal image built before this fix must be REBUILT.
   > - **`PORT` must not live in the shared `api.env`:** the portal shares `api.env`
   >   as its `env_file`, so a `PORT=3000` line (meant for the api) overrode the
   >   portal Dockerfile's `ENV PORT=3001` → portal bound 3000 → Caddy's
   >   `portal:3001` upstream failed. Fixed: the template carries no `PORT` line (the
   >   api defaults to 3000 in code) and the compose portal service pins `PORT: "3001"`
   >   via `environment:` (which outranks env_file). If a deployed `api.env` still
   >   carries `PORT=3000`, delete that line.

   ```bash
   cd ~/ds-platform/infra/deploy/compose/api-prod
   sudo docker compose --profile migrate run --rm migrate # applies apps/api/drizzle/0000..0004
   sudo docker compose build                              # api + portal (~10-20 min on 4 vCPU); zitadel/login/sms pulled
   # NOTE: do NOT `up -d` the whole stack yet — Zitadel must first-boot ALONE with the
   # FIRSTINSTANCE block set, so the ds-bootstrap PAT exists before zitadel-login
   # (whose PAT bind-mount is fail-closed) and caddy start. See step 9.
   ```

9. **Zitadel bootstrap + OIDC provision (spec §6.1; mirrors `infra/dev-stand/idp/bootstrap.md`).**
   - **First boot only** — the `ZITADEL_FIRSTINSTANCE_*` block MUST be **uncommented
     before Zitadel's very first boot** (start-from-init writes the PAT only while the
     `zitadel` DB is empty; a later uncomment on an already-initialised instance never
     re-fires). So bring **zitadel up alone first**, capture the PAT, **re-comment**
     the block, then `up -d` the rest (DSO-100 ordering fix — the old flow uncommented
     only after a full `up`, missing the PAT window):

     ```bash
     # zitadel.env FIRSTINSTANCE_* uncommented at provisioning time (step 6):
     sudo docker compose up -d zitadel                      # first-init on the empty `zitadel` DB
     # wait until healthy:
     until [ "$(sudo docker inspect ds-api-prod-zitadel-1 --format '{{.State.Health.Status}}')" = healthy ]; do sleep 5; done
     PID=$(sudo docker inspect ds-api-prod-zitadel-1 --format '{{.State.Pid}}')
     sudo cat /proc/$PID/root/pat/pat.txt | sudo tee /etc/ds-platform/idp-bootstrap-pat.txt >/dev/null
     sudo chmod 600 /etc/ds-platform/idp-bootstrap-pat.txt
     sudo install -m 600 /etc/ds-platform/idp-bootstrap-pat.txt /etc/ds-platform/idp-login-client.pat
     sudo sed -i -E 's/^(ZITADEL_FIRSTINSTANCE_)/#\1/' /etc/ds-platform/zitadel.env   # re-comment so a restart never re-inits
     sudo docker compose up -d                              # now the rest: api + portal + sms-adapter + zitadel-login + caddy
     # put IDP_SERVICE_TOKEN=<that PAT> in api.env AFTER DNS + provision.sh (below);
     # pre-DNS, leave it unset so the api boots on its in-memory fake for local smoke.
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

## Rollback

Two independent failure classes, two independent reverts (DSO-127) — never
conflate them:

- **Bad APP build** (api/portal code regression, healthy DB) → **app-only
  rollback**, one command, no rebuild:

  ```bash
  pnpm deploy:prod --rollback <previous-sha>
  ```

  It `up -d`s the already-present `ds-api:<sha>` / `ds-portal:<sha>` images (kept
  by retention — the **last 3** SHAs), rewrites the `DEPLOY_SHA` `.env`, and
  re-smokes. It does **not** rebuild, migrate, or touch the DB. If the target SHA
  was already pruned, roll **forward** instead (check out that commit's `main`,
  `pnpm deploy:prod`). Manual equivalent on the box:
  `cd ~/ds-platform/infra/deploy/compose/api-prod && printf 'DEPLOY_SHA=<sha>\n' > .env && sudo docker compose up -d`.

- **Bad MIGRATION** (schema/data corruption) → **pgbackrest restore** to the
  pre-migrate checkpoint (DSO-129 took one right before `migrate`; restore is
  ~23s, RTO ≤ 2h target). On data-prod, with postgres stopped:

  ```bash
  cd ~/ds-platform/infra/deploy/compose/data-prod
  sudo docker compose stop postgres
  sudo docker compose run --rm pgbackrest gosu postgres \
    pgbackrest --stanza=ds --delta --type=default restore   # or --type=time --target='<pre-migrate ts>'
  sudo docker compose up -d postgres
  ```

  A PITR `--type=time` target rewinds to just before the bad migration using the
  continuously-archived WAL. Confirm with `pgbackrest --stanza=ds info`.

## Prod migration rule — expand/contract

**All prod DB migrations MUST be backward-compatible (expand/contract).** A
migration may only **add** (nullable columns, new tables, new indexes
`CONCURRENTLY`), never **destructively rename/drop** in the same release as the
code that stops using the old shape. The reason is the rollback contract above:
an **app-only rollback** (`--rollback <sha>`) swaps the app image **without**
touching the DB, so the previous app build must still run against the
already-migrated schema. Sequence a removal across **two** deploys — expand
(add + dual-write/read) ships and beds in, then contract (drop the old) ships
only once no rolled-back app version can need it. This keeps app rollback a
one-command, no-DB-rollback operation and reserves the pgbackrest restore for
genuine data corruption, not routine reverts.

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
- **first-boot egress (data-prod):** data-prod has no public IP and its VPC port is
  `mode="no_nat"` (local-only) — there is **no per-server SNAT** on a Timeweb local
  network, and `mode="snat"` must never be requested (it 500s cosmetically, orphans
  the resource, and contaminates the VPC's port modes — spec §5.1). All egress comes
  from the **`twc_router` network NAT** (gateway `var.vpc_router_gateway_ip`, NAT
  source = the router's floating IP). Because the host has zero egress until its
  default route exists, `cloud-init/data-prod.yaml` is **route-first**: a netplan
  drop-in (`write_files`) + `netplan apply` as the first `runcmd`, with packages
  installed from `runcmd` (NOT the cloud-init `packages` module, which runs earlier
  and would hang against unreachable mirrors). Do **not** attach a temporary
  floating IP to data-prod as an egress workaround — that puts a public IP on the
  IP-less data plane; if first-boot egress fails, verify the router gateway var
  (DD-8 in the spec) and the netplan drop-in instead.
- **VPC region vs server AZ:** `twc_vpc.location` takes a **region** code
  (`ru-1`/`ru-3`, NOT `ru-2` — no VPC there), while `twc_server.availability_zone`
  takes an **AZ** (`spb-3`/`msk-1`). Keep them co-located (single-AZ, ADR-0012).
  The `variables.tf` defaults are `msk-1` (AZ) / `ru-3` (VPC region) — as-built.
  Caution that stays true: a **preset is pinned to its zone**, so a preset↔zone
  mismatch fails apply with a misleading `location_zone not valid` / `no_free_node`
  (no availability API to pre-check) — validate on `apply` (Apply order §2).

## GlitchTip error monitoring (DSO-125)

Self-hosted [GlitchTip](https://glitchtip.com) (Sentry-compatible) for api error
monitoring. Sentry SaaS is rejected by 152-ФЗ (ADR-0004 §15 / ADR-0005 §10), so the
collector runs in-RF on **data-prod** — the persistence box has the headroom (only
the Postgres stack runs there) and GlitchTip's storage colocates with Postgres. The
UI is **not** internet-published; api-prod ships events over the VPC and the owner
reaches the UI via an SSH tunnel.

- **Stack:** `compose/data-prod/glitchtip/compose.yml` (name `ds-glitchtip`) — a
  GlitchTip v6 `all_in_one` `web` container (web + worker + beat + auto-migrate) plus
  a **dedicated** `valkey` broker. Separate from the core data plane (`../compose.yml`)
  so it never destabilises postgres / redis / pgbackrest.
- **Database:** a NEW `glitchtip` database + least-priv role in the EXISTING Postgres
  17 — created by hand (NEVER touch the `ds` role or `ds_prod`):

  ```bash
  # on data-prod, via the running postgres container (no volume edits):
  GTPW=$(openssl rand -hex 24)   # keep this — it goes in glitchtip.env's DATABASE_URL
  sudo docker exec -i ds-data-prod-postgres-1 psql -U ds -d ds_prod <<SQL
  CREATE ROLE glitchtip LOGIN PASSWORD '$GTPW';
  CREATE DATABASE glitchtip OWNER glitchtip;
  SQL
  ```

  pgbackrest backs the whole cluster, so the new database is captured automatically —
  no pgbackrest config change.

- **Secrets:** `/etc/ds-platform/glitchtip.env` (root:root 0600) from
  `infra/deploy/glitchtip.env.example` — `SECRET_KEY` (`openssl rand -hex 32`),
  `DATABASE_URL` (the glitchtip role's password + `192.168.0.10:5432/glitchtip`),
  `GLITCHTIP_DOMAIN`.
- **Firewall:** `twc_firewall_rule.glitchtip_ingest` (network.tf) opens tcp `8000`
  from `var.vpc_cidr` ONLY — the web port binds `192.168.0.10:8000` (VPC, never
  `0.0.0.0`). Single-rule terraform add; `plan` shows exactly one resource to create.
- **Bring up:**

  ```bash
  cd ~/ds-platform/infra/deploy/compose/data-prod/glitchtip
  echo "VPC_IP=192.168.0.10" > .env            # interpolation var (NOT a secret)
  sudo docker compose up -d                     # web auto-runs migrations on first boot
  sudo docker compose logs -f web               # wait for the web server to bind :8000
  ```

- **Create the project + DSN:** open the UI over an SSH tunnel and register the first
  user, then create org `ds-platform` + project `api` (platform: Node.js) and copy the
  DSN. Rewrite the DSN host to the VPC endpoint (`192.168.0.10:8000`) and put it in
  `api.env` as `SENTRY_DSN` (README §api.env), then recreate the api
  (`cd ~/ds-platform/infra/deploy/compose/api-prod && sudo docker compose up -d api`).

  ```bash
  # from the workstation — tunnel to the private UI through the api-prod bastion:
  ssh -L 8000:192.168.0.10:8000 ds-data-prod    # then open http://localhost:8000
  ```

- **api integration:** `apps/api` initialises `@sentry/node` only when `SENTRY_DSN`
  is set (a no-op on the dev-stand / CI) and a global exception filter reports 5xx /
  unexpected errors; PII is stripped from every event (ADR-0011). See
  `apps/api/src/observability/`.
