# `infra/deploy/` — DS Platform pre-pilot deploy slice (DSO-100)

Applied Terraform topology + **apply-ready** on-box deploy payload for deploying the
built product verticals — auth (feature 003, epic #80) + webinars wave-1 (admin app,
Centrifugo room chat, program-PDF uploads; payload wiring shipped with #729, live
apply per [Wave-1 apply order](#wave-1-apply-order-729--dso-134)) — onto an
**always-on** Timeweb production environment with live SMS + Email.

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
- **Is NOT:** the full pre-pilot. Cerbos, BullMQ workers, Unleash,
  cms/promo/mobile, WAF, HA, LB, CDN, preview-vps, Beget S3 offsite are all
  **out of slice** — deploying only what the built features actually run
  (spec §2.3, §8). The webinars wave-1 additions (admin app, Centrifugo,
  S3 `uploads` bucket) are **in-slice** (spec §2.1, §6.3); their compose/Caddy/
  Terraform wiring is in this payload (#729) — live apply is owner-gated, see
  [Wave-1 apply order](#wave-1-apply-order-729--dso-134).

## Layout

```
infra/deploy/
  .env.example        TWC_TOKEN (copy to .env — gitignored)
  terraform/          twc harness: providers, variables, network (vpc+firewall),
                      api-prod, data-prod, s3 (pgbackrest repo), outputs
  cloud-init/         first-boot base hardening (non-root deploy user, ufw, docker)
  api.env.example     /etc/ds-platform/api.env template (api + portal + admin +
                      centrifugo + sms-adapter + migrate)
  zitadel.env.example /etc/ds-platform/zitadel.env template (masterkey, DB, FIRSTINSTANCE)
  data.env.example    /etc/ds-platform/data.env template (POSTGRES_PASSWORD, pgbackrest S3)
  compose/
    api-prod/         Caddyfile + compose: caddy + api + portal + admin + centrifugo +
                      zitadel + zitadel-login + sms-aero-adapter + a one-shot
                      `migrate` service, plus centrifugo/config.json (non-secret)
    data-prod/        compose: postgres + redis + pgbackrest, plus
                      postgres/  (Dockerfile pgvector+partman+pgbackrest, postgresql.conf, init.sql)
                      pgbackrest/(Dockerfile, pgbackrest.conf, crontab, entrypoint.sh, backup.sh)
```

## Runtime contract (discovered from the built 003 code)

| Service          | Port          | Key env (from `env_file`)                                                                        |
| ---------------- | ------------- | ------------------------------------------------------------------------------------------------ |
| api (NestJS)     | 3000 (`PORT`) | `DATABASE_URL` `REDIS_URL` `IDP_*` `AUDIT_IDENTIFIER_PEPPER` `*_DELIVERY_MODE` `IDP_SMTP_REAL_*` |
| portal (Next.js) | 3001          | `API_PROXY_TARGET=http://api:3000` (build-arg `NEXT_PUBLIC_SMARTCAPTCHA_SITE_KEY` — wave-1 ON)   |
| admin (Next.js)  | 3002          | `API_PROXY_TARGET=http://api:3000` (build-time, same routes-manifest bake as the portal)         |
| centrifugo       | 8000          | `CENTRIFUGO_HTTP_API_KEY` `CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY` (native names, from api.env) |
| zitadel core     | 8080 (h2c)    | `ZITADEL_MASTERKEY` `ZITADEL_DATABASE_POSTGRES_*` `ZITADEL_EXTERNAL*`                            |
| zitadel-login    | 3000          | `ZITADEL_API_URL` + the ds-bootstrap PAT file mount                                              |
| sms-aero-adapter | 8091          | `SMSAERO_EMAIL` `SMSAERO_API_KEY` `SMSAERO_SIGN` (from api.env)                                  |
| postgres         | 5432 (VPC)    | `POSTGRES_PASSWORD` `PGBACKREST_*`                                                               |
| redis            | 6379 (VPC)    | — (AOF)                                                                                          |

Health: `/v1/health` (api), `/v1/ready` (api — probes Postgres + pgvector).

Note: redis runs AOF with **no `maxmemory` / eviction policy set yet** — fine at
0 users (pre-pilot); tune per ADR-0003 §6 as a tracked follow-up, not an on-box edit.

## Workstation prerequisites (every apply/deploy session)

- **terraform binary** — not on PATH on this box; the working copy is bbm's
  vendored `bbm/infra/timeweb/terraform/.bin/terraform.exe` (1.15.5 — compatible
  with this harness's twc v1.7.1 lock). Run it from `infra/deploy/terraform/`
  with the token sourced: `set -a; . ../.env; set +a` (`TWC_TOKEN` lives in
  `infra/deploy/.env`, gitignored). Never ask the owner for Timeweb keys — they
  are already on the workstation.
- **SSH to the boxes is gated by `admin_ssh_cidr`** (gitignored
  `terraform.tfvars`): the api-prod firewall allows port 22 only from that /32.
  An SSH **timeout** with a green `https://api.doctor.school/v1/health` almost
  always means the workstation's egress IP changed (verify: `curl
https://api.ipify.org`), NOT a downed box — update `admin_ssh_cidr` in
  tfvars, then `terraform plan` (expect exactly one in-place
  `twc_firewall_rule.api_ssh` update) and `apply`. **Recurring** (the egress IP
  is dynamic): `184.22.76.93` → `27.130.223.208` (2026-07-12, #729 wave-1 apply)
  → `27.130.220.41` (2026-07-18, `release-2026.07.18-1` deploy). Runbook
  failure-mode: `run-prod-deploy` SKILL → Failure modes.

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
2. **Ship** — `git archive <sha>` streamed over SSH to a sibling staging tree on
   **both** boxes; only after successful extraction does it replace
   `~/ds-platform`. The gitignored api-prod compose `.env` (the non-secret
   `DEPLOY_SHA` / `SMARTCAPTCHA_SITE_KEY` interpolation file) is the single
   carried-forward file; other untracked files are not preserved. No registry,
   no deploy key (README step 5).
3. **data-prod** — `docker compose up -d --build` (idempotent). Builds run with
   **`BUILDX_NO_DEFAULT_ATTESTATIONS=1`** so an unchanged build yields a
   byte-identical image ID: a no-op redeploy is a **true no-op** and does NOT
   recreate the `postgres` container (#486 — without it, BuildKit's default
   provenance attestation churns the image digest every build → `up -d` recreates
   → a ~24s persistence blip). A real Dockerfile/context change still rebuilds and
   recreates. The same flag guards the api-prod `build`/`migrate` (step 5).
4. **Checkpoint (DSO-129)** — a pgbackrest **pre-migrate `incr` backup** (the
   same `backup.sh` cron runs) **before** any migration, so a restore point
   exists at the pre-migrate state. See [Prod migration rule](#prod-migration-rule--expandcontract).
5. **api-prod** — `migrate` (idempotent drizzle-kit) → `build` → `up -d`. Images
   are SHA-tagged **`ds-api:<sha>` / `ds-portal:<sha>`** (DSO-127) — the compose
   `image:` reads `DEPLOY_SHA` from a `.env` the script writes beside `compose.yml`.
   The script then compares the shipped `Caddyfile` and
   `centrifugo/config.json` with the files visible through the running containers
   and **restarts only consumers whose bind mount is stale**. It verifies both
   mounts again after apply; a mismatch fails the deploy (#1175).
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
   `api.` / `academy.` / `id.` / `admin.doctor.school` at the `api_prod_public_ip`
   output (`admin.` is the wave-1 addition — Wave-1 apply order step 2;
   `academy.` is the portal host per #1171). Those four are the intended public
   record set — the pre-#1171 portal host is being retired in #1173 (its Caddy
   vhost is already gone from this tree; its A-record is deleted by hand, see the
   cutover section's retirement marker below).
   Root `doctor.school` A-record is untouched. Email records (MX/SPF/DKIM/DMARC)
   are already live (memory `reference_doctor_school_email_dns`).
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
   # BUILDX_NO_DEFAULT_ATTESTATIONS=1 → reproducible image ID, so a re-run doesn't
   # recreate postgres (#486). `sudo VAR=val cmd` (var AFTER sudo) is honored; the
   # `.env` route above is only for compose *interpolation* vars, not the build env.
   sudo BUILDX_NO_DEFAULT_ATTESTATIONS=1 docker compose up -d --build   # pgvector+partman+pgbackrest, redis, pgbackrest sidecar
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
   > (`sudo BUILDX_NO_DEFAULT_ATTESTATIONS=1 docker compose up -d --build`) and confirm the pgbackrest stanza check
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
     # idp-login-client.pat perms are LOAD-BEARING (#866): zitadel-login runs as
     # uid 1001 (`nextjs`), so the copy MUST be owner uid 1001, mode 400. A
     # root:root 600 file bind-mounts fine but is unreadable in the container →
     # service token empty → EVERY cookie-less (cold) login 500s while sessions
     # with existing cookies keep working (9-day silent outage). The compose
     # healthcheck now fails closed on an unreadable PAT, and `pnpm deploy:smoke`
     # drives the cold login surface — but provision it right at the source:
     sudo install -m 400 -o 1001 /etc/ds-platform/idp-bootstrap-pat.txt /etc/ds-platform/idp-login-client.pat
     sudo stat -c '%a %u %n' /etc/ds-platform/idp-login-client.pat  # MUST print: 400 1001 /etc/ds-platform/idp-login-client.pat
     # (idp-bootstrap-pat.txt itself stays 600 root:root ON PURPOSE — its only
     # consumers are ops steps run via sudo, e.g. provision.sh --pat-file below;
     # no container mounts it.)
     sudo sed -i -E 's/^(ZITADEL_FIRSTINSTANCE_)/#\1/' /etc/ds-platform/zitadel.env   # re-comment so a restart never re-inits
     sudo docker compose up -d                              # now the rest: api + portal + sms-adapter + zitadel-login + caddy
     # put IDP_SERVICE_TOKEN=<that PAT> in api.env AFTER DNS + provision.sh (below);
     # pre-DNS, leave it unset so the api boots on its in-memory fake for local smoke.
     ```

   - **Provision the OIDC app + activate the real providers** (idempotent; SMTP creds
     come from `api.env`, so source it). This grants `IAM_LOGIN_CLIENT`, registers the
     prod redirect URI, and activates mail.ru + SMS-Aero as the boot providers:

     ```bash
     # api.env is root:root 0600 — source it AS ROOT (sudo bash -c): a non-root `.`
     # fails (Permission denied) and silently yields an EMPTY env; provision.sh now
     # rejects real mode with absent creds fail-closed (#902 — the 2026-07-14 incident
     # silently activated Mailpit on prod instead of the real mail.ru relay).
     # Sourcing runs api.env through bash: values with spaces MUST be double-quoted
     # (e.g. SMSAERO_SIGN="SMS Aero"), or the var truncates at the first space and
     # the remainder errors as `command not found`.
     cd ~/ds-platform/infra/dev-stand/idp
     sudo bash -c 'set -a; . /etc/ds-platform/api.env; set +a; \
       IDP_BASE_URL=https://id.doctor.school \
       IDP_REDIRECT_URIS=https://api.doctor.school/auth/callback \
       IDP_POST_LOGOUT_URIS=https://academy.doctor.school \
       EMAIL_DELIVERY_MODE=real SMS_DELIVERY_MODE=real \
       ./provision.sh --pat-file /etc/ds-platform/idp-bootstrap-pat.txt'
     # copy the emitted IDP_CLIENT_ID / IDP_CLIENT_SECRET / IDP_PROJECT_ID into api.env,
     # then: docker compose up -d api   (restart to pick up the OIDC creds)
     ```

10. **Verify (definition of done, spec §10).** Drive the auth vertical in the live
    UI (`https://academy.doctor.school`, Playwright): register → **real** verification
    email (mail.ru); email-OTP login; **one supervised paid** SMS-OTP login
    (SMS-Aero); `/me/*` behind a session; valid TLS on all three hostnames; a
    pgbackrest basebackup + WAL in S3 with a restore dry-run (RTO ≤ 2 h).

## IdP admin-access model & login-policy posture (#877)

**Who is admin.** Exactly two Zitadel administrator identities exist, both created
at first-instance init (Apply order step 9, `zitadel.env` FIRSTINSTANCE block):

- **`ds-bootstrap`** (machine user) — the org-owner machine user whose PAT
  (`/etc/ds-platform/idp-bootstrap-pat.txt`, root:root 0600) drives
  `provision.sh` and any ops Admin-API call; provision.sh step 5 additionally
  grants it `IAM_LOGIN_CLIENT`. Its uid-1001/0400 copy
  (`/etc/ds-platform/idp-login-client.pat`) is the zitadel-login service token
  (perms are load-bearing, #866 — see Apply order step 9).
- **`zitadel-admin`** (human) — the console org owner for interactive
  `/ui/console` administration (break-glass; day-to-day changes go through
  provision.sh so posture stays committed + re-runnable).

**Operator access to the product admin app is a PROJECT role, not a Zitadel
manager role.** `platform_admin` is a project role on the OIDC project (seeded
by provision.sh step 2); the admin surface authorizes on that role in the token
(spec §6.4). Issue it to a future admin user as a user grant, via the bootstrap
PAT (idempotent — re-granting an existing grant is rejected as a no-change):

```bash
# on api-prod; USER_ID from user search, IDP_PROJECT_ID from provision.sh output
curl -sS -X POST "https://id.doctor.school/management/v1/users/$USER_ID/grants" \
  -H "Authorization: Bearer $(sudo cat /etc/ds-platform/idp-bootstrap-pat.txt)" \
  -H 'Content-Type: application/json' \
  -d "{\"projectId\":\"$IDP_PROJECT_ID\",\"roleKeys\":[\"platform_admin\"]}"
```

**Product users must NEVER receive Zitadel manager roles** (`IAM_*`, `ORG_*`,
project-manager memberships): a manager role grants IdP-administration power;
everything a product operator needs rides the `platform_admin` project role.

**Login-policy posture: public self-registration is DISABLED** — encoded in
provision.sh step 8.quater (`allowRegister -> false` on the default login
policy; read-modify-write, idempotent, converges on every provision run) and
asserted by the prod smoke ("register closed" probe,
`tools/deploy/smoke-prod.mjs`). The zitadel-login container caches login
settings in-process — after the FIRST provision run that flips the policy,
`sudo docker compose restart zitadel-login`, or the register form keeps
rendering from the cached settings (verified live, #877). Account creation happens ONLY through the api
BFF (Management API `POST /v2/users/new` with the service PAT), which
`allowRegister` does not gate. Registration-adjacent doors (sweep verdicts the
step prints on every run, #877): `allowExternalIdp` is preserved but **no
external IdP is linked** (idps=0 ⇒ no auto-registration path);
`passwordlessType` authenticates existing users only (no signup path);
`allowDomainDiscovery` routes to register only when `allowRegister` is true;
`allowUsernamePassword` is a login method for existing users, not a creation
door.

## Wave-1 apply order (#729 / DSO-134)

The webinars wave-1 increment onto the already-live 003 stand: admin app
(`admin.doctor.school`), Centrifugo room chat, S3 `uploads` bucket, prod
SmartCaptcha (#186). The repo payload (compose/Caddy/Terraform/env templates) is
apply-ready; the steps below cover **initial provisioning or recovery** — after
them, `pnpm deploy:prod` covers steady-state redeploys (it already builds every
`build:` service, admin included, and the migrate step picks up the wave-1
events/rooms migrations like any other). Out-of-band provider resources and
on-box values still have to satisfy the invariants below before each affected
image build.

> Steps marked **[OWNER-GATED]** are irreversible/paid provider actions or
> product-owner calls — they need an explicit owner "go" (AGENTS.md §6,
> live-infra pre-flight) and are run by / with the owner, never autonomously.

1. **[OWNER-GATED] Terraform S3 delta — `uploads` bucket.** From
   `infra/deploy/terraform/`: `terraform plan` must show exactly **one additive
   resource** (`twc_s3_bucket.uploads`) plus its four outputs — plus the known
   pending `twc_firewall_rule.glitchtip_ingest` (DSO-125, additive, see the
   GlitchTip section). Anything else in the plan = STOP and reconcile first.
   Then `terraform apply` (paid resource, ~79₽/mo at 10 GB base) and capture:

   ```bash
   terraform output -raw uploads_bucket_full_name   # → S3_BUCKET_UPLOADS
   terraform output -raw uploads_s3_hostname        # → S3_ENDPOINT (as https://<host>)
   terraform output -raw uploads_s3_access_key      # → S3_ACCESS_KEY
   terraform output -raw uploads_s3_secret_key      # → S3_SECRET_KEY
   ```

   DD-6 applies: these keys sit in the gitignored tfstate; they go into
   `api.env` by hand, never into a committed file.

2. **[OWNER-GATED] Beget DNS — `admin.doctor.school` A-record.** At Beget (the
   zone is NOT at Timeweb), add the A-record `admin.doctor.school` → the
   existing `api_prod_public_ip` output (same target as `api.`/`academy.`/`id.`).
   Caddy auto-issues the cert on first request once the record resolves — no
   manual cert step.

3. **SmartCaptcha production invariant (#186).** Use the dedicated Yandex Cloud
   resource `ds-platform-prod`; never reuse the localhost-only dev keypair.
   Keep domain validation **ON**. Post-#1173 the allowed-domains list is
   `academy.doctor.school` alone — the portal auth surface, and the only host that
   serves it; the legacy `app.doctor.school` entry is removed from the resource as
   an owner-gated console step of that retirement (cutover step 2 below), which is
   pending until the lead runs it. Creating or replacing the provider resource is
   **[OWNER-GATED]**;
   capture its **site key** (public, build-time) and **server key** (secret), but
   never print or copy the server key into a repo file, command transcript, or
   issue/PR.

   Before an image build that activates or revalidates bot protection, confirm
   the on-box state without printing either value:

   ```bash
   test "$(sudo grep -c '^BOT_PROTECTION_ENABLED=true$' /etc/ds-platform/api.env)" -eq 1
   test "$(sudo grep -c '^SMARTCAPTCHA_SERVER_KEY=' /etc/ds-platform/api.env)" -eq 1
   test "$(sudo grep -c '^SMARTCAPTCHA_SERVER_KEY=ysc2_' /etc/ds-platform/api.env)" -eq 1
   test "$(grep -c '^SMARTCAPTCHA_SITE_KEY=' ~/ds-platform/infra/deploy/compose/api-prod/.env)" -eq 1
   test "$(grep -c '^SMARTCAPTCHA_SITE_KEY=ysc1_' ~/ds-platform/infra/deploy/compose/api-prod/.env)" -eq 1

   server_pair_id="$(sudo sed -n 's/^SMARTCAPTCHA_SERVER_KEY=ysc2_\([^[:space:]]\{20\}\).*/\1/p' /etc/ds-platform/api.env)"
   site_pair_id="$(sed -n 's/^SMARTCAPTCHA_SITE_KEY=ysc1_\([^[:space:]]\{20\}\).*/\1/p' ~/ds-platform/infra/deploy/compose/api-prod/.env)"
   test -n "$server_pair_id" && test "$server_pair_id" = "$site_pair_id"
   unset server_pair_id site_pair_id
   ```

   [Yandex defines](https://yandex.cloud/en/docs/smartcaptcha/concepts/keys)
   those 20 characters after the `ysc1_` / `ysc2_` prefixes as the shared
   keypair identifier; comparing only that identifier verifies the pair without
   printing the server key.

   The site key is baked into the portal bundle at `next build`, so a portal
   image built before the binding exists must be rebuilt even when the source
   SHA is unchanged.

4. **Converge the on-box env (out-of-band, root:root 0600).** On api-prod,
   ensure `/etc/ds-platform/api.env` contains the wave-1 blocks from
   `api.env.example`:
   - the Centrifugo triple (`CENTRIFUGO_URL=https://api.doctor.school`,
     `CENTRIFUGO_API_KEY`, `CENTRIFUGO_TOKEN_HMAC_SECRET` — `openssl rand -hex 32`
     each) **plus** their Centrifugo-native duplicates
     (`CENTRIFUGO_HTTP_API_KEY`, `CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY` —
     byte-equal to their twins; the centrifugo container reads the same file);
   - the S3 six-key set from step 1 (**mandatory** — with `S3_ENDPOINT` unset
     the api silently fail-opens to in-memory `FakeObjectStorage`, spec §5.4);
   - `BOT_PROTECTION_ENABLED=true` + `SMARTCAPTCHA_SERVER_KEY` from step 3.

   And in the **non-secret** `.env` beside `compose/api-prod/compose.yml` (the
   `DEPLOY_SHA` interpolation file), ensure there is exactly one build-time site
   key entry, preserving every other line:

   ```dotenv
   SMARTCAPTCHA_SITE_KEY=<site-key-from-step-3>
   ```

5. **Ship source + build images.** Ship the merged `origin/main` tree to the
   boxes (Apply order step 5 / `pnpm deploy:prod` does this), then on api-prod:

   ```bash
   cd ~/ds-platform/infra/deploy/compose/api-prod
   sudo BUILDX_NO_DEFAULT_ATTESTATIONS=1 docker compose build admin portal api
   # admin is NEW; portal MUST rebuild (bakes the captcha site key); api rebuilds
   # to the wave-1 code. centrifugo is pulled (centrifugo/centrifugo:v6).
   ```

6. **One-shot migrations.** The wave-1 events/rooms migrations are ordinary
   Drizzle migrations through the existing one-shot service — no new mechanism.
   (A pgbackrest pre-migrate checkpoint first, per DSO-129 — `pnpm deploy:prod`
   does this automatically on the scripted path.)

   ```bash
   sudo docker compose --profile migrate run --rm migrate
   ```

7. **Bring up the extended stack.**

   ```bash
   sudo docker compose up -d    # adds admin + centrifugo; recreates api/portal on the new images
   sudo docker compose ps       # all healthy; admin :3002 and centrifugo :8000 in-network
   ```

8. **Provision `platform_admin` (spec §6.4).** The admin app's operator access
   rides the `platform_admin` role in prod Zitadel, seeded idempotently by the
   existing dev-stand converge script — the same one that activates the real
   SMTP/SMS providers (Apply order step 9):

   ```bash
   # Same root-sourced invocation as Apply order step 9 (api.env is root:root 0600;
   # a non-root source silently yields an empty env — #902), and the real delivery
   # modes MUST be passed: this converge script also activates the boot SMTP/SMS
   # providers, and the defaults (mailpit/sink) would deactivate the real ones.
   cd ~/ds-platform/infra/dev-stand/idp
   sudo bash -c 'set -a; . /etc/ds-platform/api.env; set +a; \
     IDP_BASE_URL=https://id.doctor.school \
     IDP_SEED_ROLE=platform_admin \
     EMAIL_DELIVERY_MODE=real SMS_DELIVERY_MODE=real \
     ./provision.sh --pat-file /etc/ds-platform/idp-bootstrap-pat.txt'
   # then grant the role to the operator's user (Zitadel console or the script's
   # grant path) — an account WITHOUT platform_admin must be rejected by the
   # admin surface (in-service role-based authz, spec §2.3).
   ```

> **Lead pre-flight before ANY owner smoke (every release, not just wave 1).**
> After deploy + scripted smoke go green, the lead first **drives the release's
> key affordances end-to-end** — everything drivable without owner-only inputs:
> every file-download link actually fetches (2xx, not a raw-S3 `AccessDenied`),
> a write→public-read path (create/publish in admin → appears on the public
> surface), a lifecycle transition → public render reflects it. A public-route
> curl/screenshot sweep + grants check alone is **NOT** a green pre-flight:
> on 2026-07-13 both drivable affordances the lead skipped broke in the owner's
> hands within minutes (#842 unsigned-S3 PDF link, #843 stale live surfaces).
> Only after this pass does the owner get the smoke checklist.
> The deploy and this pre-flight are **ONE atomic unit**: do not launch
> `pnpm deploy:prod` unless the session has context headroom left to run (or
> dispatch, paying only the ≤30-line verdict) the pre-flight tail in the SAME
> session — prod must never cross a session boundary deployed-but-unverified
> (2026-07-13, the #729 fix redeploy did exactly that).

9. **[OWNER-GATED] Wave-1 smoke (spec §10.7–10.8).** Drive the journey in the
   live UI: a `platform_admin` operator creates a test event (with a program
   PDF upload) via `https://admin.doctor.school` → a doctor registers for it
   from `https://academy.doctor.school` (SmartCaptcha widget live on registration)
   → enters the room → exchanges **live chat** messages (real Centrifugo path,
   wss on `api.doctor.school/connection/websocket`) → fetches the program PDF
   back through the portal. **Real-S3 assertion (mandatory, spec §10.8):**

   ```bash
   sudo docker compose exec api node -e "console.log(process.env.S3_ENDPOINT || 'FAKE-STORAGE!')"
   # must print the Timeweb S3 endpoint — the api fail-opens to FakeObjectStorage
   # when S3_ENDPOINT is unset, and a fake in prod is a silent failure mode.
   ```

   TLS valid on **all four** hostnames (admin.doctor.school included).

## Verify-on-box

The workstation has no Docker, so the following are **build/run-verify-only** on the
first `apply` (report, don't assume green):

- `apps/api/Dockerfile` — `pnpm deploy --prod /out` resolving the workspace graph
  (add `--legacy` if pnpm 10 requires it); `node dist/main.js` boot.
- `apps/portal/Dockerfile` — the Next standalone COPY paths (the pinned
  `outputFileTracingRoot` should land the entry at `apps/portal/server.js`).
- `apps/admin/Dockerfile` (#729) — same standalone pattern, entry expected at
  `apps/admin/server.js`; NO `public/` COPY (the app has no public dir — brand
  assets ride the bundle). If a build adds `apps/admin/public/`, add the COPY.
- `compose/api-prod/centrifugo/config.json` (#729) — env-name overrides landing
  (`CENTRIFUGO_HTTP_API_KEY` / `CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY`), the
  `/health` check, and a real wss handshake through the Caddy route.
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
  `pnpm deploy:prod`). Manual equivalent on the box: edit the `DEPLOY_SHA=` line
  in `~/ds-platform/infra/deploy/compose/api-prod/.env` (do NOT `printf … > .env`
  — the file also carries `SMARTCAPTCHA_SITE_KEY`, #729) then
  `sudo docker compose up -d`.

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

## Portal host cutover — `app.` → `academy.doctor.school` (#1171)

The portal's public host is `academy.doctor.school`. The cutover ran on
2026-08-03; retiring the legacy host entirely was approved on 2026-08-15 (#1173)
and lands in two halves. The repo half is merged — the Caddy vhost, the
Centrifugo origin, the legacy Zitadel post-logout URI and the smoke probe are
gone from this tree. The live half is manual, owner-gated, and may still be
pending: delete the Beget `app` A-record → verify it no longer resolves → remove
`app.doctor.school` from the `ds-platform-prod` SmartCaptcha allowed-domains →
re-run the Zitadel `PUT` with the reduced URI set → the Caddy/Centrifugo edits
apply at the next `deploy:prod`. Full statement of both halves: the retirement
marker at the end of this section. What follows is the recorded procedure for
moving the portal host. Steps 1 and
2 are out-of-band console state (Beget DNS, Yandex Cloud SmartCaptcha) and MUST
land **before** the deploy that adds the vhost: pointing the new name at a host
that still answers as something else, or a captcha whose allowed-domain list omits
the new host, breaks registration for every user at once.

**Every signed-in user is logged out by a host cutover** — expected, not a fault.
The session cookie is `__Host-`-prefixed, therefore host-only: it does not travel
across a host change, so anyone signed in re-authenticates on the new host
(a user sitting in a live webinar room lands on `/login?returnTo=…`). Do **not**
cut over during a scheduled webinar.

**Precondition — step 1 (DNS) must be verified live BEFORE the deploy step runs.**
The Caddyfile vhost rides in whichever `pnpm deploy:prod` happens first, for any
unrelated feature. Until the new name resolves to api-prod, that deploy silently
sends every portal user to whatever else answers on that name. Do not deploy on
an unverified step 1.

Order — steps run in sequence; **do not reorder 4 and 5** (the reason is in 5):

1. **[OWNER-GATED] Beget DNS — REPOINT, not an add.** `academy.doctor.school`
   is **not a free name**: it currently holds a `CNAME → cname.vercel-dns.com`
   serving the «OrtoBio School × Doctor.School» sponsorship landing on the
   owner's Vercel. A CNAME and an A-record cannot coexist at the same name, so
   this is a delete-then-add, and it **evicts that landing from this hostname**.

   Owner-approved (2026-08-03, decision recorded on
   [#1171](https://github.com/doctor-school/ds-platform/issues/1171)):
   «Лендинг остаётся только на тех. домене — там была временная презентация» —
   the landing keeps living on its own `*.vercel.app` technical domain (owner's
   Vercel account, outside this repo), and `academy.` is released to the portal.
   Nothing on the Vercel side needs deleting; only the DNS record here moves.

   There is **no Beget API access in our tooling** (`~/.ds-platform/.env.local`
   holds no Beget credentials) — these are manual owner-side console steps:

   1. Beget DNS console → zone `doctor.school` → **delete** the `academy`
      CNAME record (`cname.vercel-dns.com`).
   2. **Add** A-record `academy` → `77.233.220.222` (the `api_prod_public_ip`
      terraform output — re-read it rather than trusting this literal).

   Then **verify propagation before proceeding** — Caddy issues the cert on
   first request, so a deploy that runs while the old CNAME is still cached
   yields an ACME failure, not a working vhost:

   ```bash
   nslookup academy.doctor.school 8.8.8.8   # must return A 77.233.220.222,
   nslookup academy.doctor.school 1.1.1.1   # NOT a cname.vercel-dns.com alias
   ```

   Both resolvers must show the A-record before step 4. Beget's zone TTL governs
   how long the stale CNAME lingers; re-check rather than assuming.

2. **[OWNER-GATED] SmartCaptcha allowed domains.** Bot protection is **live on
   prod** (#186, completed 2026-08-06). This repo **mandates** domain validation
   **ON** for the `ds-platform-prod` resource — that is the wave-1 invariant
   recorded in the SmartCaptcha production invariant above, not a property anyone
   read back from the Yandex Cloud console (nothing in this repo can observe it;
   treat it as required-and-unverified and act accordingly). Under that
   requirement the allowed-domains list is load-bearing: a portal host missing
   from it fails every protected auth action — registration included — for every
   user at once. In the Yandex Cloud console, **add the new
   host before the deploy that adds its vhost**, and remove a host only once it is
   fully retired. Post-#1173 the list is `academy.doctor.school` alone: the legacy
   `app.doctor.school` entry is dropped as part of the retirement, after its DNS
   record is gone. The site key is unchanged either way, so **no portal rebuild is
   needed** for this step.

3. **Zitadel URI set — re-pass EVERY URI, not just the new one.** `provision.sh`
   sends ONE full-object `PUT` on `oidc_config`: the payload it builds carries
   both `redirectUris` and `postLogoutRedirectUris`, so the PUT **replaces** both
   arrays — it is idempotent, not additive. Any URI you omit is deleted, and
   `IDP_REDIRECT_URIS` falls back to a `http://localhost` default that `devMode:true`
   happily accepts, so the run **reports success while prod's OIDC callback is
   gone** and every login fails with a redirect_uri mismatch. Sourcing `api.env`
   does not save you: it defines `IDP_REDIRECT_URI` (singular, the api's own
   callback), never the plural `IDP_REDIRECT_URIS` the script reads.

   Run exactly this — every variable spelled out, no partial invocation:

   ```bash
   cd ~/ds-platform/infra/dev-stand/idp
   sudo bash -c 'set -a; . /etc/ds-platform/api.env; set +a; \
     IDP_BASE_URL=https://id.doctor.school \
     IDP_REDIRECT_URIS=https://api.doctor.school/auth/callback \
     IDP_POST_LOGOUT_URIS=https://academy.doctor.school \
     EMAIL_DELIVERY_MODE=real SMS_DELIVERY_MODE=real \
     ./provision.sh --pat-file /etc/ds-platform/idp-bootstrap-pat.txt'
   ```

   Then **verify the callback survived** before moving on. The failure is silent,
   so read the set back **from Zitadel** — the api container's own
   `IDP_REDIRECT_URI` (from `api.env`) is NOT the registered set: `provision.sh`
   never reads or writes it, so it prints the expected string whether or not the
   `redirectUris` array was just clobbered. Query the management API with the same
   PAT the provision script uses:

   ```bash
   sudo bash -c 'set -a; . /etc/ds-platform/api.env; set +a; \
     PAT="$(cat /etc/ds-platform/idp-bootstrap-pat.txt)"; \
     APP_ID="$(curl -sS -X POST \
       "https://id.doctor.school/management/v1/projects/${IDP_PROJECT_ID}/apps/_search" \
       -H "Authorization: Bearer ${PAT}" -H "Content-Type: application/json" \
       -d "{\"queries\":[{\"nameQuery\":{\"name\":\"ds-platform-dev\",\"method\":\"TEXT_QUERY_METHOD_EQUALS\"}}]}" \
       | jq -r ".result[0].id")"; \
     curl -sS "https://id.doctor.school/management/v1/projects/${IDP_PROJECT_ID}/apps/${APP_ID}" \
       -H "Authorization: Bearer ${PAT}" \
       | jq ".app.oidcConfig | {redirectUris, postLogoutRedirectUris}"'
   ```

   `redirectUris` MUST contain `https://api.doctor.school/auth/callback`. If it
   shows `http://localhost:...` instead, the PUT clobbered it — re-run the command
   above with every variable present before going further. (App name = `IDP_APP_NAME`,
   default `ds-platform-dev`; adjust if the prod app was provisioned under another name.)

   Finally, **drive one real login through the host that is live right now** — not
   the new one: its vhost does not exist until step 4's deploy, so a login attempt
   there proves nothing about this step.

   What this step actually buys: registering the portal host in
   `postLogoutRedirectUris` is forward-looking hygiene — nothing in `apps/api` or
   `apps/portal` currently sends `post_logout_redirect_uri` or calls `end_session`. The **real** risk of
   the step is the redirect-URI clobber above, which is why the full command is
   spelled out rather than a one-flag delta.

4. **Deploy.** `pnpm deploy:prod` ships the Caddyfile (the portal vhost) and the
   Centrifugo origin allowlist, then compares both running single-file mounts
   with the shipped files. Only a stale consumer is restarted,
   and both mounts are verified afterward (#1175). No manual SSH restart is
   required. When the Centrifugo config changed, its restart drops open sockets;
   clients reconnect.

   Then confirm the new host actually serves over a valid cert:

   ```bash
   curl -sSI https://academy.doctor.school/ | head -1   # 200/3xx over valid TLS
   pnpm deploy:smoke                                    # PORTAL_HOST already academy.
   ```

5. **On-box env — only after step 4 is verified green.** In
   `/etc/ds-platform/api.env` set
   `MAILER_PORTAL_BASE_URL=https://academy.doctor.school`, then restart the api.
   This moves **newly sent** e-mail links (Zitadel OTP `sendCode` template + the
   BFF duplicate-registration notice) onto the new host.

   This is last **on purpose**: flip it before the deploy and mail sent in the gap
   points at a host with DNS but no Caddy site block and no ACME certificate — the
   TLS handshake simply fails, and an OTP link with a real expiry clock is dead on
   arrival. Once `academy.` serves, the window is closed in both directions.

**Legacy-host retirement (#1173, approved 2026-08-15).** The old host was kept for
12 days as a path-preserving 301 so already-delivered verification/OTP e-mails
(which carry a real expiry clock, and which mail clients cache) kept resolving. The
owner then approved removing the domain **entirely**. Accepted consequence: a
bookmark or an old e-mail link on the legacy host becomes a dead name (DNS
failure), not a redirect.

> **Landing in two halves — the live half may still be pending.** The repo half is
> merged: the Caddy vhost, the Centrifugo origin, the legacy post-logout URI in the
> documented `provision.sh` command, and the `legacy portal 301` smoke probe are
> removed from this tree. The live half is manual and owner-gated, in this order:
> delete the Beget `app` A-record → verify it no longer resolves → remove
> `app.doctor.school` from the `ds-platform-prod` SmartCaptcha allowed-domains →
> re-run the Zitadel `PUT` with the reduced URI set → the Caddy/Centrifugo edits
> apply at the next `deploy:prod`. Until all five are green, provider state still
> carries the legacy host. Delete this marker once they are.

Retiring a portal host in future follows the same shape: repo config first, then
DNS, then the captcha domain list, then the Zitadel `PUT`, then the deploy.

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
- **Firewall:** the web port binds `192.168.0.10:8000` (VPC, never `0.0.0.0`).
  `twc_firewall_rule.glitchtip_ingest` (network.tf) declares tcp `8000` from
  `var.vpc_cidr` for consistency with the `data_pg` / `data_redis` rules, but the
  Timeweb cloud firewall does **not** filter data-prod's private VPC interface (no
  public NIC), so api-prod already reaches `:8000` over the VPC without it (verified
  `curl → HTTP 200`, DSO-125). The rule was therefore **not** applied to live state
  on deploy — it materialises on the next planned `terraform apply` (one additive
  resource). No public exposure either way.
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
- **Alert email (DSO-132, live):** `EMAIL_URL` in `glitchtip.env` is wired to the
  mail.ru relay (`smtp+ssl://…@smtp.mail.ru:465`, `DEFAULT_FROM_EMAIL=noreply@doctor.school`
  — same relay as Zitadel/BFF; see `glitchtip.env.example` for the scheme gotcha) and the
  `api` project carries an email alert rule (fires on new issues). Live-verified: test
  event → alert notification `sent=True`; delivery to the owner's mailbox awaits owner
  confirmation. Grafana infra-alert email is a **separate** channel (bbm mon, below).
- **Gotcha — no team ⇒ alert emails silently not sent (DSO-132).** GlitchTip resolves
  alert recipients through user → org → **team** → project → alert, and sets
  `is_sent=True` unconditionally (processed ≠ sent) — an org/project with no team
  produces zero recipients and zero emails, with nothing in the logs. After onboarding,
  always: create a team, add the user to it, attach the project. Verify the resolution:

  ```bash
  sudo docker compose exec -T web ./manage.py shell -c "from django.apps import apps; from django.contrib.auth import get_user_model; n = apps.get_model('alerts','Notification').objects.order_by('-id').first(); print(list(get_user_model().objects.alert_notification_recipients(n).values_list('email', flat=True)))"
  # non-empty list of emails = recipients resolve; [] = alerts go nowhere
  ```

## Мониторинг (внешний, через bbm mon-prod-tw, tenant=ds)

As-built (OBS-трек, живьём верифицировано):

- **Стек:** mon.bbm.academy (Grafana/Prometheus/Loki), фолдер «Doctor.School»,
  дашборд uid `ds-host-overview`.
- **Push-агенты:** Alloy на api-prod и data-prod (node-метрики + journald + docker →
  mon; `instance=api-prod`/`data-prod`, `tenant=ds`). Конфиг: `/etc/alloy/config.alloy`;
  креды push — `~/alloy.env` (chmod 600). Read-only docker-socket-proxy на
  `127.0.0.1:2375`.
- **Egress data-prod** к mon идёт через router-NAT, source-IP `72.56.14.72`
  (в `mon-push-allow.conf` на mon).
- **Алерты** `tenant=ds` → канал «DS Мониторинг» (Mattermost; Telegram временно
  недоступен — bbm-side egress-блокер): `S3BackupStale-ds` (pgbackrest
  `ds-prod-pgbackrest` >26ч), `ServiceDown`/`CertExpirySoon` (3 эндпоинта),
  `HostTelemetryStale-api-prod`/`-data-prod`, `DiskFillHigh` (>85/92%).
- **Blackbox-эндпоинты:** `api.doctor.school/v1/health`,
  `academy.doctor.school/`, `id.doctor.school/`. Конфиг blackbox живёт на mon вне
  репозитория — при смене публичного хоста портала его правят там же вручную.
  Сверка целей после ретайра легаси-хоста (#1173) отслеживается в #1273.
