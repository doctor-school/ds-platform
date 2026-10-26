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
    api-prod/         Caddyfile + compose: caddy + api + portal + admin + doctor +
                      centrifugo +
                      zitadel + zitadel-login + sms-aero-adapter + a one-shot
                      `migrate` service, plus centrifugo/config.json (non-secret)
    data-prod/        compose: postgres + redis + pgbackrest, plus
                      postgres/  (Dockerfile pgvector+partman+pgbackrest, postgresql.conf, init.sql)
                      pgbackrest/(Dockerfile, pgbackrest.conf, crontab, entrypoint.sh, backup.sh)
    stg-infra/        STAGE stand shared services — see «Staging box» below
  stage.env.example   /etc/ds-platform/stage.env template (STAGE box; sinks and the
                      stand's own captcha keys only, never a production credential)
```

## Staging box (`stage-1`)

A **third** VPS, separate from this production plane and not part of any deploy path
described below. It runs the STAGE stand: one shared service project plus a live
preview slot per pull request. Nothing here deploys to it and `pnpm deploy:prod`
never touches it.

- Terraform: `terraform/stage-1.tf` — its **own** VPC (`twc_vpc.stage`), no peering
  and no route to `twc_vpc.ds`. That absent route, not a firewall rule, is what keeps
  a box running arbitrary PR code away from production Postgres and Redis (the
  Timeweb rule model is allow-only; see the header of `terraform/network.tf`).
- Bootstrap: `cloud-init/stage-1.yaml` — the `api-prod` hardening set plus `git`, and
  deliberately nothing more: the provider hard-resets a new box mid-first-boot (#2121),
  so anything longer than the prod set is killed part-way. No CI agent and no unit of
  ours runs here: the box builds its own images from a tree the operator ships over SSH,
  and the regression suite runs on the operator's machine (`tools/staging/README.md`).
- Services, bring-up order, the Zitadel converge, the slot compose projects and the
  acceptance commands: **`compose/stg-infra/README.md`**.
- Env: `stage.env.example`. The box holds no production credential of any kind; that
  is an acceptance criterion, not an intention.
- Plan of record:
  `apps/docs/content/specs/tech/2026-09-08-staging-previews-and-regression-contour-en.md`.

## Runtime contract (discovered from the built 003 code)

| Service          | Port          | Key env (from `env_file`)                                                                                                         |
| ---------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| api (NestJS)     | 3000 (`PORT`) | `DATABASE_URL` `REDIS_URL` `IDP_*` `AUDIT_IDENTIFIER_PEPPER` `*_DELIVERY_MODE` `IDP_SMTP_REAL_*`                                  |
| portal (Next.js) | 3001          | `API_PROXY_TARGET=http://api:3000` (build-time); runtime `SMARTCAPTCHA_SITE_KEY` — wave-1 ON, `DOCTOR_PUBLIC_ORIGIN` (#3147)      |
| admin (Next.js)  | 3002          | `API_PROXY_TARGET=http://api:3000` (build-time, same routes-manifest bake as the portal); runtime `ACADEMY_PUBLIC_ORIGIN` (#2619) |
| doctor (Next.js) | 3004          | `API_PROXY_TARGET=http://api:3000` (build-time); runtime `ACADEMY_PUBLIC_ORIGIN` (#3147)                                          |
| centrifugo       | 8000          | `CENTRIFUGO_HTTP_API_KEY` `CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY` (native names, from api.env)                                  |
| zitadel core     | 8080 (h2c)    | `ZITADEL_MASTERKEY` `ZITADEL_DATABASE_POSTGRES_*` `ZITADEL_EXTERNAL*`                                                             |
| zitadel-login    | 3000          | `ZITADEL_API_URL` + the ds-bootstrap PAT file mount                                                                               |
| sms-aero-adapter | 8091          | `SMSAERO_EMAIL` `SMSAERO_API_KEY` `SMSAERO_SIGN` (from api.env)                                                                   |
| postgres         | 5432 (VPC)    | `POSTGRES_PASSWORD` `PGBACKREST_*`                                                                                                |
| redis            | 6379 (VPC)    | — (AOF)                                                                                                                           |

Health: `/v1/health` (api), `/v1/ready` (api — Postgres + pgvector + the cached object-storage probe; the deploy/rollback smoke gate, a 503 names the failing check).

**Mail links (api).** No mail the api sends carries a link: the code mails
(sign-in, verification, re-registration, reset) and the congress letters alike
(046 «Letters», #2634 — the congress letters name the congress site's domain as
plain text). The api therefore reads no mail-link origin; a leftover
`MAILER_DOCTOR_BASE_URL` line in `/etc/ds-platform/api.env` is ignored and may be
deleted.

Note: redis runs AOF with **no `maxmemory` / eviction policy set yet** — fine at
0 users (pre-pilot); tune per ADR-0003 §6 as a tracked follow-up, not an on-box edit.

## Workstation prerequisites (every apply/deploy session)

- **terraform binary** — not on PATH on this box; the working copy is bbm's
  vendored `bbm/infra/timeweb/terraform/.bin/terraform.exe` (1.15.5 — compatible
  with this harness's twc v1.7.1 lock). Run it from `infra/deploy/terraform/`
  with the token sourced: `set -a; . ../.env; set +a` (`TWC_TOKEN` lives in
  `infra/deploy/.env`, gitignored). Never ask the owner for Timeweb keys — they
  are already on the workstation.
- **SSH to api-prod takes port 22 from anywhere** (#3179, like stage-1 since #2984;
  see [SSH access model](#ssh-access-model-2984)): the release workflow's
  GitHub-hosted runners have no fixed range, so the workstation's dynamic egress IP
  no longer needs a `/32` in the firewall. An SSH **timeout** with a green
  `https://api.doctor.school/v1/health` is not a downed box: `terraform plan` shows
  whether `twc_firewall_rule.api_ssh` drifted from `0.0.0.0/0`. Runbook
  failure-mode: `run-prod-deploy` SKILL → Failure modes.

## SSH access model (#2984)

Tech spec `apps/docs/content/specs/tech/2026-10-16-release-pipeline-off-workstation-en.md`
§4, §8 step (c). Three kinds of key reach a box, and root reaches none:

| Key                              | User         | What it can do                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operator key                     | `deploy`     | ds-stage-1 only: an interactive shell with `NOPASSWD:ALL` sudo, for the agent-driven PR slots (`pnpm stage:slot`). Removed on ds-api-prod in step (f) (`harden-ssh.sh --role prod`): there `deploy` has no key but the CI keys and its one sudo rule.                                                                                                                                                                                                                                                                           |
| CI keys (one per Environment)    | `deploy`     | only the forced command (`no-pty`, no forwarding): `/usr/local/bin/ds-deploy-entrypoint` on ds-stage-1; `sudo -n /usr/local/bin/ds-deploy-entrypoint` with `no-user-rc` on ds-api-prod, whose one sudo rule `/etc/sudoers.d/90-ds-deploy` allows exactly that. Verbs: `status <env> <sha>`, `release <env> <sha>`, on ds-api-prod `rollback prod <sha>` and `rollback-status prod <sha>`, on ds-stage-1 `upload-report <sha>` and `observe <name>`. Anything else exits 2 and is logged (`journalctl -t ds-deploy-entrypoint`). |
| Break-glass key (owner, offline) | `breakglass` | an interactive shell with full sudo, no forced command — the admin path once root login is off.                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Settings: `/etc/ssh/sshd_config.d/10-ds-hardening.conf` (`PermitRootLogin no`,
`PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `MaxStartups 10:30:60`),
the image's `PermitRootLogin yes` in `/etc/ssh/sshd_config` commented out, root's
`authorized_keys` empty, fail2ban (`sshd` jail) and unattended-upgrades on,
`/etc/ds-platform/box-role` = `prod` / `stage` / `data`. ds-api-prod's port 22 is open to
the internet like stage-1's (GitHub-hosted runners have no fixed range; keys only, the CI
key reaches only its forced command); ds-data-prod stays VPC-only and holds no CI key.

`ds-deploy-entrypoint` is installed beside `ds-release` by every prod run (forward
deploy from the shipped tree, `--rollback` from the operator checkout) and, on stage-1,
only by the stage `main` converge of a SHA contained in `main` (#3125; PR slots and
hotfix-ref converges use what the box has — `tools/staging/README.md` → Box entrypoints).
Its `release` verb execs the box-side release driver
`/usr/local/lib/ds-platform/release-driver` (installed beside `ds-release` under the same
rule): on stage-1 it converges `stage-main` from the stdin `images-<sha>.json` in the
unit `ds-stage-main-<sha12>-driver` (tech spec §5 «Stage `main` release driver»); on
ds-api-prod (`box-role` `prod`) it releases `prod` in the unit `ds-prod-<sha12>-driver`,
which runs `tools/deploy/prod.mjs --local --images-file -` from the codeload tree of the
SHA (tech spec §5 «Prod release driver»; `tools/deploy/README.md` → Box-local release).
Each box refuses the other's env. The driver requires every recorded image in the
manifest and also accepts an image it does not know yet: it is installed from the tree a
release ships, so an image a newer tree adds would otherwise refuse every release past
the addition. Every image, known or not, must carry a strict image name and a `sha256`
digest reference of its own name, equal to the digest the registry serves for
`<image>:<sha>` in the release namespace; the shipped tree's `slot.mjs` / `prod.mjs`
judge the image set before they pull. `status` adds that unit's state as `driver`, with
`previousSha` — the SHA prod ran before, recorded by the prod unit — as the Deployment record's release-notes basis. Reports uploaded on stage-1 land in
`/var/lib/ds-platform/e2e-reports/<sha>/` (root-only, pruned after 14 days; validated and
extracted with python3 `tarfile`, plain tar only; a stream over
512 MiB, an archive unpacking past 2 GiB or holding more than 20000 entries is refused).

**New box:** cloud-init (`cloud-init/*.yaml`) writes the same drop-in, sudoers file and
role marker and creates `breakglass` from the key at `var.prod_breakglass_ssh_pubkey_path`
/ `var.stage_1_breakglass_ssh_pubkey_path` (public halves only). CI keys are never baked in.
cloud-init runs on first boot only, so the `twc_server.*` resources ignore `cloud_init`
changes: an edit to `cloud-init/*.yaml` never shows in the plan for a running server and
reaches a box only when it is created (replace/rebuild).

**Running box:** converge it with `infra/deploy/bin/harden-ssh.sh` (idempotent; a second
run prints `nothing to change`). Keep a second session open on the box while it runs.

```bash
# copy the script and the PUBLIC keys over, then on the box:
sudo bash harden-ssh.sh --role stage --breakglass-pubkey breakglass-stage-1.pub \
  --ci-pubkey ci-stage.pub --dry-run          # read the plan
sudo bash harden-ssh.sh --role stage --breakglass-pubkey breakglass-stage-1.pub \
  --ci-pubkey ci-stage.pub
# prod: --role prod, from a breakglass session (below); data-prod: the release runs --role data --from-release (below)
```

It runs `sshd -t` before `systemctl reload ssh` and restores the sshd files without a
reload when the check fails, then proves the effective values with `sshd -T`. The existing
operator line of `deploy`'s `authorized_keys` stays byte-identical; a CI key is matched by
its key body, so re-running with the same key changes nothing.

**sudo on prod (ds-api-prod, `--role prod`; tech spec §4 «sudo on prod», step (f)):**
`deploy` holds one sudo right, `/etc/sudoers.d/90-ds-deploy` (the entrypoint as root, no
argument, `SSH_ORIGINAL_COMMAND` kept through sudo's env reset), and the CI keys carry
`command="sudo -n /usr/local/bin/ds-deploy-entrypoint",…,no-user-rc`. Once `breakglass` is proven in
place the converge also removes `deploy`'s rules from every other sudoers.d file (cloud-init's
`90-cloud-init-users`), takes `deploy` out of groups `sudo` and `docker`, and removes every
`deploy` key line not behind the prod forced command — the operator key (and its interim
`from=` line) included; it refuses to unless it runs from a `breakglass` session
(`SUDO_USER=breakglass`). Run it from that session, in this order: (1) prove a
`breakglass` login on both prod boxes; (2) converge with `--role prod --ci-pubkey <prod CI
key>` (`--dry-run` first); (3) prove the Actions path with a `status` call and a
`rollback-status` read. ds-stage-1 (`--role stage`) keeps `deploy`'s sudo and operator key.

**sudo on data-prod (ds-data-prod, `--role data`; tech spec §4, §5 «Data-prod verbs.», #3313):**
the same narrowing, with `deploy`'s one key the hop line below. The converge refuses,
changing nothing, unless the installed `/usr/local/bin/ds-deploy-entrypoint` serves the data
verbs (any prod release after #3313 installs it) and `deploy`'s `authorized_keys` holds
exactly one hop line; it takes no `--ci-pubkey` (no CI key reaches the data box). It writes
`90-ds-deploy`, rewrites the hop line to
`command="sudo -n /usr/local/bin/ds-deploy-entrypoint",restrict,from="<api-prod VPC IP>" <key>`,
removes every other `deploy` key (the operator key included), `deploy`'s other sudoers
rules and its groups `sudo` and `docker`; the hop line goes first, so a hop session lost
mid-run leaves either a box the forced command serves or one the next release converges
again.

**The prod release runs it — no owner step (#3320).** The data `install` verb places a
root-owned copy at `/usr/local/lib/ds-platform/harden-ssh.sh`; right after it, while
`capabilities` still answers only through `sudo -n` (the hop has `deploy`'s shell and
sudo), the Actions run calls `install` once more (the entrypoint that served the first
call may predate harden-ssh.sh in its install list; the one it installed does not), then `sudo -n /usr/local/lib/ds-platform/harden-ssh.sh --role data
--from-release` over the hop and goes on only once the forced command answers. A converged
box makes the step a no-op. `--from-release` writes nothing of `breakglass`'s and takes no
key; in place of the breakglass-session proof it checks box-side, before any change, that
the break-glass path is usable — user `breakglass` exists with a login shell and an
unexpired account, its `authorized_keys` holds a key, `91-ds-breakglass` passes `visudo -c`
and grants it NOPASSWD sudo, and `sshd -t` passes with the new config — and refuses,
changing nothing, when any check fails (the release then fails before any data-prod
state change). The release log shows `↻ ds-data-prod: converging the hop to the forced
command` and `✓ … converged`; the next release logs `✓ … already converged`.

Break-glass only (a rebuilt box with no release yet, or a release refused by the checks
above): the same converge from a `breakglass` session on ds-data-prod, with the key:

```bash
# in a breakglass session (ssh -J breakglass@ds-api-prod breakglass@192.168.0.10):
sudo bash harden-ssh.sh --role data --breakglass-pubkey breakglass-prod.pub --dry-run   # read the plan
sudo bash harden-ssh.sh --role data --breakglass-pubkey breakglass-prod.pub
```

Prove the hop from ds-api-prod (the `capabilities` verb answers the data verb list,
anything else exits 2): `sudo -u deploy ssh -i /home/deploy/.ssh/data-prod-hop -o IdentitiesOnly=yes
-o BatchMode=yes deploy@192.168.0.10 capabilities`. A NEW data-prod box starts from
cloud-init with `deploy`'s sudo and gets the hop line below; its first release installs the
data verbs and converges it.

**Data-prod hop key (ds-api-prod → ds-data-prod, once, #3157):** the prod release
driver's unit runs on ds-api-prod and reaches ds-data-prod over the VPC as `deploy` with a
dedicated key. Generate it on ds-api-prod straight into `/home/deploy/.ssh/data-prod-hop`,
owned by `deploy`, mode 0600, beside `deploy`'s `known_hosts` (the driver names both on every hop;
the unit runs as root on ds-api-prod since step (f)); authorize its
public half on ds-data-prod restricted to ds-api-prod's VPC address
(`var.api_prod_private_ip`, default `192.168.0.20`), so the key works from nowhere else:

```bash
# on ds-api-prod
sudo -u deploy ssh-keygen -t ed25519 -N '' -C ds-api-prod-hop -f /home/deploy/.ssh/data-prod-hop
cat /home/deploy/.ssh/data-prod-hop.pub
# pin data-prod's host key for deploy (the driver uses StrictHostKeyChecking=yes);
# never trust on first use: the scanned fingerprint must equal the one read on data-prod
ssh-keyscan -t ed25519 192.168.0.10 > /tmp/data-prod.hostkey
ssh-keygen -lf /tmp/data-prod.hostkey   # compare with data-prod's own, below
# on ds-data-prod (operator's ssh session):
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
# back on ds-api-prod, only when both fingerprints are equal:
sudo -u deploy sh -c 'cat >> ~/.ssh/known_hosts' < /tmp/data-prod.hostkey; rm -f /tmp/data-prod.hostkey
# on ds-data-prod: one line in ~deploy/.ssh/authorized_keys
restrict,from="192.168.0.20" ssh-ed25519 AAAA… ds-api-prod-hop
```

`restrict` turns off pty, every forwarding and the user rc. Until the release's `--role
data` converge above the line carries no forced command and reaches `deploy`'s sudo; the converge
puts it behind `sudo -n /usr/local/bin/ds-deploy-entrypoint`, so it reaches only the data
verbs. That forced command is not a privilege boundary against the key's holder: `ship`,
`install` and `data-up` put a tree, root entrypoints and a compose file of the holder's
choosing on ds-data-prod, so the key stays root-equivalent there — the accepted risk of tech
spec §4 (ds-api-prod already holds the database owner credentials). What it buys: no
interactive shell and no ad-hoc command, every call one allowlisted, logged verb, and
`deploy` without its general sudo for any other key. Prove it from ds-api-prod as shown above (`… deploy@192.168.0.10 capabilities`).

**Node on stage-1 and ds-api-prod (post-boot, once):** the release driver runs
`tools/staging/slot.mjs` on stage-1 and `tools/deploy/prod.mjs` on ds-api-prod, so each
carries one pinned Node runtime. `infra/deploy/bin/install-node.sh`
downloads the official `linux-x64.tar.xz` of the pinned Node 24 LTS release, refuses it
unless it matches the pinned sha256, installs it under `/usr/local/lib/nodejs/<version>`
and links `/usr/local/bin/node`; a second run prints `nothing to change`. It is a
provisioning step on the running box, next to `harden-ssh.sh`, never cloud-init `runcmd`
(Timeweb hard-resets a box whose first boot runs long, `cloud-init/stage-1.yaml`).

```bash
# copy the script over, then on the box:
sudo bash install-node.sh --dry-run
sudo bash install-node.sh
```

## Docker Hub login on every box (#2240)

Every box builds its images **on-box**, and every one of those builds pulls its base
images (`node:*`, `postgres:*`, `caddy:*`, …) from Docker Hub. Anonymous pulls are
rate-limited to **100 per hour keyed on the source IP** — and on Timeweb that key is
the hoster's **shared IPv6 /64** (`2a03:6f00:a::`), so the budget is spent by other
tenants, not by us. Observed 2026-09-15/16/17 as `429 Too Many Requests` mid-build on
both stage-1 and api-prod; the prod `release-2026.09.16-1` deploy failed closed on it.

The fix is a Docker Hub **account** login on the box, which moves the quota key from
the shared IP to the account (200/h):

```bash
ssh -t <box> 'sudo docker login -u bbmacademy'   # paste the PAT at the prompt
```

- The secret is a Docker Hub **Personal Access Token** of the project account
  `bbmacademy`, scope **Read-only**, no expiry. It is typed at the prompt by the owner
  and lives **only** in `/root/.docker/config.json` (0600 root:root) — never in this
  repo, never in an env file, never in chat. Docker runs through `sudo` on both boxes,
  so the login must belong to **root**; a login as the deploy user is not seen by the
  build.
- `-t` is required: `docker login` reads the token from a TTY.
- **Verify** — a base-image pull must succeed rather than answer 429:
  `ssh <box> 'sudo docker pull node:24-slim'`. On a registry token request made with
  the box's credentials the headers then read `ratelimit-limit: 200;w=3600` and
  `docker-ratelimit-source: bbmacademy`; anonymously they read `100;w=3600` with the
  shared IPv6 prefix as the source.
- **A box recreate loses it.** `terraform apply -replace`, a rebuild from
  `cloud-init/*.yaml` or any fresh box starts anonymous — repeat the login as part of
  provisioning, before the first `compose build`.

This login is for Docker Hub only. On api-prod the product images are still built on
the box from a shipped tree; ds-stage-1 builds no product image any more — its slots
pull them from the registry below — but it still pulls third-party images and builds
`stg-infra`'s `postgres`, so it keeps the login too.

## Container registry

Our own images are built once per commit in GitHub Actions and pushed to a private
Timeweb Cloud container registry (#2981, tech spec
`apps/docs/content/specs/tech/2026-10-16-release-pipeline-off-workstation-en.md` §3–§4).

- **A manual one-off, not Terraform.** The registry was created through the Timeweb
  API on 2026-10-16; no Terraform resource models it, so `terraform plan` neither
  shows nor recreates it. Endpoint: `ds-platform.registry.twcstorage.ru`.
- **Two tokens, each scoped to the job that needs it.**

  | Token | Scope       | Lives in                                                                                                                       | Used by                                                                                       |
  | ----- | ----------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
  | push  | push + pull | GitHub Environment `build`, secret `REGISTRY_PUSH_TOKEN`                                                                       | `runtime-images.yml` `build` job only — it runs nothing but buildx after login                |
  | pull  | pull only   | GitHub Environment `build`, secret `REGISTRY_PULL_TOKEN`; each box, `/etc/ds-platform/registry-pull-token` (0600, `root:root`) | `runtime-images.yml` `verify` job (runs PR-head code); the box's `docker login` before a pull |

  The push token is being removed from ds-stage-1 (`/etc/ds-platform/registry-push-token`)
  under #2981 now that the box only pulls; after that it lives only in Environment `build`.

  The registry has no per-repository scopes, so an internal PR head could still push
  outside `pr/` with the push token. Accepted: a release takes only the digests a `main`
  build recorded in its `images-<sha>.json`, never a tag. Fork PRs get neither token.

  Login: `docker login ds-platform.registry.twcstorage.ru -u ds-platform --password-stdin`
  with the token on stdin — the token authenticates; the username is not checked.
  Neither token is ever written into this repo, an env file or chat.

- **Image naming.** Every `main` merge pushes `ds-platform.registry.twcstorage.ru/<image>:<sha>`;
  an internal pull request pushes `ds-platform.registry.twcstorage.ru/pr/<image>:<head-sha>`;
  a fork pull request builds and boots its images but never logs in or pushes.
  `<image>` ∈ `api`, `api-migrate`, `portal`, `admin`, `doctor`. The run's
  `images-<sha>.json` artifact (90 days) maps each image to its pushed `@sha256:` digest
  — a deploy pulls by digest, never by tag. The data-prod images (`ds-postgres`,
  `ds-pgbackrest`) are not in the registry.
- **Retention — the registry keeps production and its rollback targets only** (#3110).
  The registry has a fixed quota (25 GB); once full, every push fails. Workflow
  `registry-retention.yml` (Environment `build`, the push token) prunes it to:
  - per release repo (`<image>`): the target SHAs of the latest 3 `release-*`
    GitHub Releases (production + 2 rollback targets) ∪ the SHA of the latest
    successful production GitHub Deployment (a deploy whose release cut failed still
    keeps its images) ∪ the newest 3 first-parent `main` commits that have an image
    (the next release candidate, stage `main`) ∪ the heads of the open `hotfix/*`
    branches (a pending `pnpm deploy:prod --ref` candidate) ∪ the open PR heads;
  - per `pr/<image>` repo: the heads of the currently open pull requests;
  - everything else is deleted (`DELETE /v2/<repo>/manifests/<digest>`). Tags that are
    not 40-hex SHAs are left alone, and a digest any kept tag of the same repo resolves
    to is never deleted (identical rebuilds share a digest). If the releases, the
    production deployment, the hotfix branches, the open PRs or `main` cannot be
    listed, a release target is not a full SHA, or a tag listing cannot be proven
    complete (a Link-less page is confirmed by a `last=` probe), nothing is deleted
    and the run fails; a refused DELETE stops the run and fails it.

  It runs daily and after every `main` Runtime images run (whatever its conclusion —
  a run that failed on a full registry is exactly when space is needed); both
  triggers delete, so the push to `main` that merges this workflow starts its first
  deleting run. By hand:
  `gh workflow run registry-retention.yml --ref main` prints the plan only
  (`dry_run` defaults to true); `-f dry_run=false` deletes. Each run writes the plan
  (kept SHAs, per-repo counts) to its step summary. The job runs only on `main`, so no
  branch's code holds the push token's delete right. A deleted manifest's layers are
  freed when the registry's garbage collection runs, not at the DELETE. Consequence:
  `pnpm deploy:prod --rollback <sha>` can reach only the last 3 releases — an older
  SHA's recorded digests are gone, unless it is still the latest successful production
  deployment or among the newest 3 `main` images. Policy and planner:
  `tools/deploy/lib/registry-retention.mjs`; runner: `tools/deploy/registry-retention.mjs`.

- **Stage and production both consume it; neither box builds.** The shared mechanics
  live in `tools/deploy/lib/registry.mjs`: the commit's `images-<sha>.json` is resolved
  on the operator side, then the box logs in with its pull token, pulls each recorded
  digest and tags it `ds-<image>:<sha>`, then logs out again (the login shell's exit
  trap plus one unconditional `docker logout`), so the token file stays the only
  registry credential at rest on the box, and each tag's RepoDigests must carry its
  recorded digest.
  - **Stage** — every slot converge (`tools/staging/slot.mjs up|sync|reset`); a commit
    with no recorded images is not staged (`tools/staging/README.md` → «`slot.mjs` in
    one paragraph»).
  - **Production** — `pnpm deploy:prod` resolves the manifest in its pre-flight and
    accepts only a release build (`ref: "main"`, or `ref: "hotfix/<N>-<slug>"` for a
    `--ref` hotfix — `runtime-images.yml` also runs on `hotfix/**` pushes; release-namespace
    digests, never `pr/`; the exact release SHA); it also checks that `/etc/ds-platform/registry-pull-token` exists on
    ds-api-prod and refuses with this section as the pointer if not. The api-prod
    compose has no `build:` and tags every `ds-*` image `${DEPLOY_SHA:?}`; an app-only
    rollback whose target tags were pruned pulls that SHA's recorded release digests
    (`tools/deploy/README.md` → steps 1 and 5) — present in the registry for the last
    3 releases and the latest production deployment only (Retention, above).
  - **Provisioning the pull token on a box** is a once-per-box step by the lead: the
    read-only pull token goes to `/etc/ds-platform/registry-pull-token` as `root:root`
    `0600`, never through chat, an env file or this repo. Check without printing it:
    `ssh <box> 'sudo test -s /etc/ds-platform/registry-pull-token && echo ok'`.

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
   carried-forward file; other untracked files are not preserved. The tree needs
   no deploy key (README step 5); the api-prod images come from the registry (step 5 below).
3. **data-prod** — `docker compose up -d --build` (idempotent). Builds run with
   **`BUILDX_NO_DEFAULT_ATTESTATIONS=1`** so an unchanged build yields a
   byte-identical image ID: a no-op redeploy is a **true no-op** and does NOT
   recreate the `postgres` container (#486 — without it, BuildKit's default
   provenance attestation churns the image digest every build → `up -d` recreates
   → a ~24s persistence blip). A real Dockerfile/context change still rebuilds and
   recreates. (api-prod builds nothing since #2981 — step 5.)
4. **Checkpoint (DSO-129)** — a pgbackrest **pre-migrate `incr` backup** (the
   same `backup.sh` cron runs) **before** any migration, so a restore point
   exists at the pre-migrate state. See [Prod migration rule](#prod-migration-rule--expandcontract).
5. **api-prod** — `pull` (the recorded `main`/`hotfix/*` digests, see «Container registry»;
   nothing is built) → pre-swap boot verify → `migrate` (idempotent drizzle-kit,
   the pulled `ds-api-migrate:<sha>`) → `up -d`. Images are SHA-tagged
   **`ds-api:<sha>` / `ds-api-migrate:<sha>` / `ds-portal:<sha>` / `ds-admin:<sha>` /
   `ds-doctor:<sha>`** (DSO-127) — the compose `image:` reads `${DEPLOY_SHA:?}` from
   a `.env` the script writes beside `compose.yml`.
   The script then compares the shipped `Caddyfile` and
   `centrifugo/config.json` with the files visible through the running containers
   and **restarts only consumers whose bind mount is stale**. It verifies both
   mounts again after apply; a mismatch fails the deploy (#1175). An unparseable
   Caddyfile never gets this far: the BLOCK CI job `caddyfile-validate`
   (`tools/ci/validate-caddyfiles.sh`) runs `caddy validate` on every
   `compose/*/Caddyfile` with the image its sibling `compose.yml` pins (#3273).
6. **Retention (DSO-127)** — keeps the **last 3** SHA-tagged images per repo
   (`ds-api-migrate` included), prunes older (never `:local`, never the running
   one) and drops the registry digest references of pruned images.
7. **Smoke (DSO-128)** — `tools/deploy/smoke-prod.mjs --expect-sha <sha>`; a red
   smoke fails the deploy loud and prints the rollback pointer.

The **deployed SHA is queryable over HTTP** (DSO-127): the api reports it at
`GET /v1/health` → `{"version":"<sha>", …}` (from the `DEPLOY_SHA` env; unset in
local dev). `curl -s https://api.doctor.school/v1/health | jq .version`.

The script is the **steady-state** path only. **First-time provisioning**
(Terraform §§1–3, DNS §4, out-of-band secrets §6, and the **Zitadel first-boot
bootstrap** §9) stays the manual runbook below — those are one-time, not
per-deploy. Run them once; from then on a release is one Actions `deploy-prod.yml` run,
executed box-side by the prod release driver (release-pipeline spec §5 «Prod release
driver.»); `pnpm deploy:prod` is break-glass, run under the `breakglass` user.

## Apply order

> **Steps 5–8 + 10 are what the prod release driver runs** on every release
> (Actions `deploy-prod.yml`; `pnpm deploy:prod` is the break-glass path under
> `breakglass`) — they are documented here as the manual fallback + the record
> of what the pipeline does on the box. Steps 1–4, 6 (secrets), and 9 (Zitadel first-boot) are
> **first-time provisioning**, run once by hand.

1. **Prereqs:** `cp .env.example .env` and set `TWC_TOKEN` (an account-level Timeweb
   token; project-scoped tokens do not exist). Confirm/create the `ds-platform`
   Timeweb project and set `project_id`. Generate deploy SSH keypairs and set the
   `*_ssh_pubkey_path` + real pubkeys in `cloud-init/*.yaml`; the owner's break-glass
   public keys at `*_breakglass_ssh_pubkey_path` (#2984).
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
   `api.` / `academy.` / `id.` / `admin.` / `new.` / `login.doctor.school` at the
   `api_prod_public_ip` output (`admin.` is the wave-1 addition — Wave-1 apply
   order step 2; `academy.` is the portal host per #1171; `new.` is the doctor
   storefront's temporary host, #1723 — owner-gated and deliberately LAST, see
   the roll-out section; `login.` is the sign-in host, #3171). Those six are the intended public
   record set — the pre-#1171 portal host is being retired in #1173 (its Caddy
   vhost is already gone from this tree; its A-record is deleted by hand, see the
   cutover section's retirement marker below).
   Root `doctor.school` A-record is untouched. Email records (MX/SPF/DKIM/DMARC)
   are already live (memory `reference_doctor_school_email_dns`).
5. **Get the committed `main` source onto both boxes.** (Since #2981 the api-prod
   images are not built from this tree — they are pulled from the registry, see
   «Container registry»; the tree carries compose files and configs.)

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

   Both boxes need the tree: api-prod runs its compose and configs from it (the
   images are pulled in step 8);
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

   **First pull the release images and pin `DEPLOY_SHA`** (#2981). The api-prod
   compose has no `build:` and names every `ds-*` image `ds-<image>:${DEPLOY_SHA:?}`,
   so every `docker compose` call below (and in step 9) refuses until the box `.env`
   names a SHA whose five images are present. On a steady-state box `pnpm deploy:prod`
   does this itself, but on a fresh or rebuilt box it cannot run before this step and
   step 9, so do it by hand once. This is the same pull `tools/deploy/lib/registry.mjs`
   performs: the SHA step 5 shipped, its `main` manifest from `runtime-images.yml`,
   pulled by digest. Prerequisite: the pull token is on the box («Container registry»).

   ```bash
   # Workstation, repo root, authenticated gh. SHA = the commit step 5 shipped.
   SHA=$(git rev-parse origin/main)
   RUN=$(gh run list --workflow runtime-images.yml --commit "$SHA" --event push \
     --status success --json databaseId --jq '.[0].databaseId')   # empty → no recorded images; stop
   gh run download "$RUN" -n "images-$SHA" -D "images-$SHA"
   # Refuse another commit's or a pr/ manifest; emit one pull-by-digest + tag line per image.
   node -e 'const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
     if (m.sha !== process.argv[2] || m.ref !== "main") throw new Error(`manifest ${m.sha} ref ${m.ref}: not the main record of this SHA`);
     for (const [name, ref] of Object.entries(m.images)) console.log(`docker pull ${ref} && docker tag ${ref} ds-${name}:${m.sha}`);' \
     "images-$SHA/images-$SHA.json" "$SHA" > "images-$SHA/pull.sh"
   cat "images-$SHA/pull.sh"   # five lines (api, api-migrate, portal, admin, doctor), each `…@sha256:<digest>`
   # ds-api-prod, as root: log in from the token file (never argv), pull + tag, log out on exit.
   ssh ds-api-prod "sudo sh -ec 'trap \"docker logout ds-platform.registry.twcstorage.ru >/dev/null 2>&1\" EXIT
     docker login ds-platform.registry.twcstorage.ru -u ds-platform --password-stdin < /etc/ds-platform/registry-pull-token >/dev/null
     sh -e'" < "images-$SHA/pull.sh"
   # Pin DEPLOY_SHA in the compose .env, keeping every other line (SMARTCAPTCHA_SITE_KEY, #729).
   ssh ds-api-prod "cd ~/ds-platform/infra/deploy/compose/api-prod && \
     { grep -v '^DEPLOY_SHA=' .env 2>/dev/null; echo DEPLOY_SHA=$SHA; } > .env.new && mv .env.new .env && \
     sudo docker image ls --filter 'reference=ds-*:$SHA'"   # five ds-<image>:<sha> rows
   rm -rf "images-$SHA"
   ```

   ```bash
   cd ~/ds-platform/infra/deploy/compose/api-prod
   # zitadel / zitadel-login / sms-aero-adapter / caddy / centrifugo are upstream images
   # and pull on first use; every ds-* image is the one pulled above.
   sudo docker compose --profile migrate run --rm migrate # applies apps/api/drizzle/*
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
     prod redirect URI, and activates the explicitly selected SMTP relay + SMS-Aero
     as the boot providers. Before deploying the SMTP configuration revision, follow
     [Transactional SMTP configuration and controlled activation](./smtp-activation.md)
     for the required provider selection, native readback and rollback (#2116).

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
       IDP_POST_LOGOUT_URIS=https://academy.doctor.school,https://new.doctor.school \
       IDP_SIGN_IN_BASE_URI=https://login.doctor.school \
       IDP_BACK_CHANNEL_LOGOUT_URI=https://api.doctor.school/v1/auth/back-channel-logout \
       IDP_ACADEMY_REDIRECT_URI=https://academy.doctor.school/auth/callback \
       IDP_ACADEMY_POST_LOGOUT_URI=https://academy.doctor.school/ \
       IDP_DOCTOR_REDIRECT_URI=https://new.doctor.school/auth/callback \
       IDP_DOCTOR_POST_LOGOUT_URI=https://new.doctor.school/ \
       EMAIL_DELIVERY_MODE=real SMS_DELIVERY_MODE=real \
       ./provision.sh --pat-file /etc/ds-platform/idp-bootstrap-pat.txt'
     # copy the emitted IDP_CLIENT_ID / IDP_CLIENT_SECRET / IDP_PROJECT_ID into api.env,
     # then: docker compose up -d api   (restart to pick up the OIDC creds)
     # Step 3.bis also converges the two storefront clients (003 EARS-60, ADR-0015 §4:
     # private_key_jwt, one exact callback + post-logout URI each, base_uri = the
     # sign-in host) and prints IDP_ACADEMY_CLIENT_ID / IDP_DOCTOR_CLIENT_ID — ids
     # only, no key. They stay unused until the storefront sign-in wiring ships (#3006).
     ```

   - **`pnpm deploy:prod` runs this provision step for you (#1997).** The converge
     steps in that script are the managed owner of the prod IdP configuration too
     (login / notification / password-complexity policies, active providers, message
     texts), so the deploy pipeline owns the run: after `up -d` and before the
     truthful-success verify it executes exactly the command above on api-prod and
     then READS THE POLICY BACK from the instance (`GET
/admin/v1/policies/password/complexity` with the bootstrap PAT, on the box —
     the PAT never leaves it), comparing `minLength` against the `@ds/schemas`
     `PASSWORD_MIN_LENGTH` at the deployed SHA and requiring every character-class
     flag to be `false`. A failed converge or a rejected read-back FAILS the deploy.
     The script is idempotent read-before-write, so with **no `provision.sh` change
     since the last deploy the run is a no-op** — read the stderr converge log:
     exactly the drifted steps print «converged», everything else «already» /
     «ensured». Provisioning is **not** rolled back (`--rollback` re-tags and
     restarts only; converge steps are forward-only).
   - **The manual command above stays the recovery path** — for first-time
     provisioning, for an instance rebuild, and for repairing an IdP whose converge
     failed mid-deploy. Precedent #1994 (2026-09-07), the incident that moved the run
     into the pipeline: #1396 relaxed `@ds/schemas` and the portal hint to length-only
     (003 EARS-36) and added § 8.sexies; the code reached prod (a3ba0c4a) while the
     instance policy stayed the provider default (upper + lower + digit + symbol), so
     every registration with a plain password answered 422 behind «Проверьте
     введённые данные» for 18 days, until this step was re-run by hand.

10. **Verify (definition of done, spec §10).** Drive the auth vertical in the live
    UI (`https://academy.doctor.school`, Playwright): register → **real** verification
    email (mail.ru); email-OTP login; **one supervised paid** SMS-OTP login
    (SMS-Aero); `/me/*` behind a session; valid TLS on every routed hostname; a
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
(spec §6.4). `event-registrar` (044 EARS-17) and `congress-program-committee`
(046 EARS-26) are further project roles, seeded by the same step and granted the
same way — the registrar authorizes the congress roster surface only, the
programme committee the congress submission registry/card/decision surface only.
Both are additionally bound to their event(s) by an `event_role_grants` row
(runbooks in `apps/api/src/registration/README.md` and
`apps/api/src/congress/README.md`). Issue any of them to a user as a user grant,
via the bootstrap PAT (idempotent — re-granting an existing grant is rejected as
a no-change):

```bash
# on api-prod; USER_ID from user search, IDP_PROJECT_ID from provision.sh output
curl -sS -X POST "https://id.doctor.school/management/v1/users/$USER_ID/grants" \
  -H "Authorization: Bearer $(sudo cat /etc/ds-platform/idp-bootstrap-pat.txt)" \
  -H 'Content-Type: application/json' \
  -d "{\"projectId\":\"$IDP_PROJECT_ID\",\"roleKeys\":[\"platform_admin\"]}"
```

Staff access is granted and revoked in the admin section «Доступы»; the
[staff access runbook](../../apps/docs/content/operations/admin-onboarding.md)
covers it, the credential delivery, offboarding and the manual bootstrap of an
environment's first platform administrator.

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
them, `pnpm deploy:prod` covers steady-state redeploys (it pulls every recorded
`ds-*` image, admin included, and the migrate step picks up the wave-1
events/rooms migrations like any other). Out-of-band provider resources and
on-box values still have to satisfy the invariants below before each affected
deploy.

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
   Keep domain validation **ON**. On 2026-09-09 the owner's Yandex Cloud
   console screenshot confirmed `academy.doctor.school` and `new.doctor.school`
   in the `ds-platform-prod` allowed-host list, with domain validation enabled;
   `login.doctor.school` (the sign-in host, #3171) joins that list before its
   release — see §"Sign-in host roll-out";
   `app.doctor.school` was absent. Evidence and verification follow-up:
   [#2117](https://github.com/doctor-school/ds-platform/issues/2117), following
   the September 8 decision to retain bot protection in
   [#1959](https://github.com/doctor-school/ds-platform/issues/1959).
   This confirms the console configuration; it does not by itself prove token
   issuance or successful protected registration/resend on either host. Record
   those live results separately on the linked task.

   A domain-list-only update needs **no rebuild or deploy when the existing
   site/server keys are unchanged**. Creating or replacing the provider resource
   is **[OWNER-GATED]**;
   capture its **site key** (public, runtime env) and **server key** (secret), but
   never print or copy the server key into a repo file, command transcript, or
   issue/PR.

   **Current prod state: bot protection is ON.** On box: `api.env` has
   `BOT_PROTECTION_ENABLED=true` with the `ysc2_` server key, and the compose
   `.env` beside `compose/api-prod/compose.yml` carries the matching `ysc1_`
   site key. One compose var (`SMARTCAPTCHA_SITE_KEY`) feeds both the portal and
   the doctor containers as runtime env, so the state is all-or-nothing across
   `academy.doctor.school` and `new.doctor.school` — it cannot be ON for the
   portal alone. Rate limits are independent of the flag and stay on either way.

   Before a deploy that activates or revalidates bot protection — the
   storefront containers read `SMARTCAPTCHA_SITE_KEY` as runtime env — confirm
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

   The site key is RUNTIME env (#2981 — the images are environment-agnostic):
   the storefront server mounts read it per request, so a key change needs only a
   container recreate (`docker compose up -d portal doctor`), never a rebuild.

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
   `DEPLOY_SHA` interpolation file), ensure there is exactly one runtime site
   key entry (compose interpolates it into the portal and doctor `environment:`), preserving every other line:

   ```dotenv
   SMARTCAPTCHA_SITE_KEY=<site-key-from-step-3>
   ```

   **Flipping the toggle (either direction).** Back up both files on the box
   first, naming the state the flip moves TO —
   `sudo cp /etc/ds-platform/api.env /etc/ds-platform/api.env.bak-captcha-<on|off>-<ts>`
   and the same pattern for the compose `.env`. Then, in order:

   - **OFF** — `BOT_PROTECTION_ENABLED=false` and comment out
     `SMARTCAPTCHA_SERVER_KEY` in `api.env`; empty `SMARTCAPTCHA_SITE_KEY=` in
     the compose `.env`; `pnpm deploy:prod` (it recreates the storefront
     containers, which read the key at runtime); the clients then submit tokenless and the api guard stays wired and no-ops
     (003 design §10.1 fallback).
   - **ON** — restore `BOT_PROTECTION_ENABLED=true` plus the `ysc2_` server half
     in `api.env` and `SMARTCAPTCHA_SITE_KEY=ysc1_…` in the compose `.env`, run
     the keypair-identifier checks in step 3, then `pnpm deploy:prod`.

5. **Ship source + pull images.** Ship the merged `origin/main` tree to the boxes
   (Apply order step 5 / `pnpm deploy:prod` does this), then bring that SHA's five
   recorded images (admin included) onto api-prod and pin `DEPLOY_SHA` exactly as
   Apply order step 8 «First pull the release images and pin `DEPLOY_SHA`» does —
   api-prod builds nothing since #2981, and every compose call in steps 6–7 refuses
   without that `.env` line and those images. The captcha site key is runtime env
   (#2981 — no image bakes it); centrifugo is an upstream pull (`centrifugo/centrifugo:v6`).

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

   TLS valid on **all five** public hostnames — `api.` / `academy.` / `admin.` /
   `id.doctor.school` plus `new.doctor.school` (the doctor storefront, #1723;
   only after its A-record is live — see
   [Doctor storefront roll-out](#doctor-storefront-roll-out--newdoctorschool-1723)).

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
- `apps/doctor/Dockerfile` (#1723) — same standalone pattern, entry expected at
  `apps/doctor/server.js`, serving on 3004; it DOES carry a `public/` COPY.
- Caddy ACME issuance for all six public hostnames (needs the Beget A-records
  live first — `new.doctor.school` included, #1723; `login.doctor.school`, #3171).

## Rollback

Two independent failure classes, two independent reverts (DSO-127) — never
conflate them:

- **Bad APP build** (api/portal code regression, healthy DB) → **app-only
  rollback**, one command, no rebuild:

  ```bash
  pnpm deploy:prod --rollback <previous-sha>
  ```

  It `up -d`s the `ds-*:<sha>` images (kept by retention — the **last 3** SHAs;
  a pruned target is pulled again from its recorded `main`/`hotfix/*` manifest,
  and a target without one refuses), rewrites the `DEPLOY_SHA` `.env`, and
  re-smokes. It does **not** build, migrate, or touch the DB. Manual equivalent on
  the box, only while all five `ds-*:<sha>` tags of the target are present
  (`sudo docker image ls --filter 'reference=ds-*:<sha>'`; otherwise pull them first
  as in Apply order step 8): edit the `DEPLOY_SHA=` line
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
gone from this tree. The captcha list no longer includes `app.doctor.school`
(owner screenshot, 2026-09-09, #2117); the other live retirement steps are not
reverified by that evidence. The original manual, owner-gated sequence is:
delete the Beget `app` A-record → verify it no longer resolves → remove
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
   recorded in the SmartCaptcha production invariant above. The owner's console
   screenshot confirmed it on 2026-09-09 (#2117); this is console evidence, not
   a successful protected-auth check. The allowed-domains list is load-bearing:
   a portal host missing
   from it fails every protected auth action — registration included — for every
   user at once. In the Yandex Cloud console, **add the new
   host before the deploy that adds its vhost**, and remove a host only once it is
   fully retired. Post-#1173 the list is `academy.doctor.school` (the legacy
   `app.doctor.school` entry is dropped as part of the retirement, after its DNS
   record is gone) plus, from #1723, `new.doctor.school` — the doctor storefront
   reads the same SmartCaptcha site key as runtime env. The site key is
   unchanged either way, so **no rebuild is needed** for this step alone.

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
     IDP_POST_LOGOUT_URIS=https://academy.doctor.school,https://new.doctor.school \
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

5. **External blackbox probe — retarget it, in the `bbm` repo.** The portal's
   availability probe is **not** derived from this repository and no CI guard here
   can see it. Skipping this step is what left the probe on `app.doctor.school` for
   the twelve days after #1171 and turned the #1173 retirement into a firing
   `ExternalHttpProbeFailed` (`tenant=ds` → «DS Мониторинг»), 2026-08-15 10:02 UTC.

   Edit the **SSOT**, not the box: `sidorovanthon/bbm` →
   `infra/monitoring/prometheus/prometheus.yml`, the `tenant: ds` block — both the
   target URL and the `service:` label. `~/monitoring-deploy` on `mon-prod-tw` is a
   deployed copy (rsync + `scripts/02-deploy.sh`); an edit made there alone is lost
   on the next deploy and silently diverges from the SSOT in the meantime.

   Ships and verifies as:

   ```bash
   scp infra/monitoring/prometheus/prometheus.yml mon-prod-tw:~/monitoring-deploy/prometheus/prometheus.yml
   # validate with the version actually deployed there, not a pinned one
   ssh mon-prod-tw 'set -a; . ~/monitoring-deploy/.env; set +a
     docker run --rm -v ~/monitoring-deploy/prometheus/prometheus.yml:/tmp/p.yml:ro \
       --entrypoint promtool prom/prometheus:$PROMETHEUS_VERSION check config /tmp/p.yml'   # SUCCESS
   ssh mon-prod-tw 'cd ~/monitoring-deploy && docker compose restart prometheus'
   # read the new target back — 1 = serving; allow one scrape interval
   ssh mon-prod-tw 'curl -s http://127.0.0.1:9090/api/v1/query \
     --data-urlencode "query=probe_success{tenant=\"ds\"}"'
   ```

   `restart` is required, not cosmetic: Prometheus on `mon` runs **without**
   `--web.enable-lifecycle`, so `POST /-/reload` is unavailable. Expect the retired
   host's series to linger for up to 5 minutes after the restart — a restart emits
   no staleness markers, so the old series ages out of the lookback window rather
   than disappearing at once. Read the alert state from Grafana
   (`/api/alertmanager/grafana/api/v2/alerts`), **not** from Prometheus: its
   `rule_files` is empty, so `/api/v1/alerts` there is always empty.

   Ordering: after step 4. A probe retargeted before the deploy points at a host
   that has DNS but no Caddy site block yet — it goes red for the length of the
   gap and reports the cutover as broken while it is merely unfinished.

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
> apply at the next `deploy:prod`. The owner's 2026-09-09 screenshot (#2117)
> confirms the captcha-list removal only; it does not reverify DNS, Zitadel or
> the deployed proxy configuration. Delete this marker once all are verified.

Retiring a portal host in future follows the same shape: repo config first, then
DNS, then the captcha domain list, then the Zitadel `PUT`, then the deploy — and
then the blackbox probe (step 5). The probe is last and easiest to forget, and it
is the one step whose omission is silent at the time and loud two weeks later: the
retired host keeps answering until DNS is actually removed, so a stale probe stays
green and the miss surfaces only when the name dies.

## Doctor storefront roll-out — `new.doctor.school` (#1723)

`apps/doctor` is the doctor-facing storefront of the two-storefront topology
(ADR-0015 §2–§4). It launches on the **temporary** host `new.doctor.school`; the
root `doctor.school` cut-over is a separate later step, gated on data migration
and the retirement of the old site (owner decision on epic #1430, 2026-08-26).
The root A-record is **not** touched here.

The repo half is merged with #1723: the `doctor` compose service (image
`ds-doctor:<sha>`, `PORT=3004` pinned explicitly per the DSO-100 portal incident,
`/`-healthcheck, `depends_on: api`, and `doctor` added to `caddy.depends_on`), the
Caddy vhost `new.doctor.school → doctor:3004`, `ds-doctor` as a first-class member
of `pnpm deploy:prod` (build, pre-swap boot probe, truthful-success verify,
retention, app-only rollback) and a `new.doctor.school` render + TLS probe in
`pnpm smoke:prod`.

**`new.doctor.school` is a free name** — this is an ADD, not a repoint like the
`academy.` cutover — but the ordering constraint is identical: Caddy issues its
certificate over ACME **HTTP-01**, so a vhost for a name that does not resolve to
`api-prod` fails issuance rather than producing a working site. Steps 1 and 2 are
out-of-band console state and MUST land **before** the deploy that adds the vhost.

**Until the step-1 A-record is live, the doctor smoke probes are switched OFF.**
`tools/deploy/smoke-prod.mjs` registers a `new.doctor.school` render probe and a
TLS probe; against a name that does not resolve both fail, `smoke:prod` exits 1
and `tools/deploy/prod.mjs` `die()`s at the smoke gate — which would turn every
**unrelated** `pnpm deploy:prod`, and every `--rollback`, RED for a DNS reason
during the window this section's step-5 sequencing deliberately creates. Set
`PROD_DOCTOR_HOST` **empty or to `skip`** and both probes print a loud `SKIP`
line instead:

```bash
PROD_DOCTOR_HOST=skip pnpm deploy:prod     # or --rollback, or pnpm smoke:prod
```

The switch is an operator flag, not a code default: with `PROD_DOCTOR_HOST`
unset the probes run against `new.doctor.school`, so once the A-record is live
nobody has to remember to turn them back on — they are on unless someone opts
out. Deliberately an explicit switch rather than a live DNS lookup: a lookup
would race ACME issuance and make «is prod healthy» non-deterministic.

No user is logged out by this roll-out: nothing about `academy.doctor.school`
changes, and the two hosts hold **separate** `__Host-ds_session` cookies by
specification (ADR-0001 §6) — one account across both is delivered by OIDC silent
re-auth against the single Zitadel identity, never by widening a cookie.

Order:

1. **[OWNER-GATED] Beget DNS — add the A-record.** In the `doctor.school` zone at
   Beget (the zone is not at Timeweb and this tooling holds no Beget credentials —
   §4), add `new` → `77.233.220.222` (`api_prod_public_ip`). Verify it is live
   from two resolvers **before** deploying:

   ```bash
   nslookup new.doctor.school 8.8.8.8   # must return A 77.233.220.222
   nslookup new.doctor.school 1.1.1.1
   ```

2. **[OWNER-GATED] Yandex Cloud SmartCaptcha — allowed domains.** Add
   `new.doctor.school` to the `ds-platform-prod` SmartCaptcha resource's
   allowed-domains list. **Completed by the owner, confirmed by the 2026-09-09
   console screenshot (#2117):** both `academy.doctor.school` and
   `new.doctor.school` are listed and domain validation is ON. No rebuild or
   deploy is needed for this domain-only change when the keys are unchanged.
   Successful live registration/resend remains a separate verification result.
   The doctor container reads the same PUBLIC
   site key as the portal (`SMARTCAPTCHA_SITE_KEY` in the `.env` beside
   `compose/api-prod/compose.yml`, runtime env since #2981), so a missing domain
   entry makes the registration widget inert while the page still renders green.

3. **Zitadel post-logout URI — re-pass EVERY URI.** `provision.sh` sends one
   full-object `PUT` that **replaces** both `redirectUris` and
   `postLogoutRedirectUris`; anything omitted is deleted. Run exactly this — the
   `IDP_REDIRECT_URIS` value is unchanged (the callback is the api's own and is
   host-independent) but MUST be re-passed in the same call:

   ```bash
   cd ~/ds-platform/infra/dev-stand/idp
   sudo bash -c 'set -a; . /etc/ds-platform/api.env; set +a; \
     IDP_BASE_URL=https://id.doctor.school \
     IDP_REDIRECT_URIS=https://api.doctor.school/auth/callback \
     IDP_POST_LOGOUT_URIS=https://academy.doctor.school,https://new.doctor.school \
     EMAIL_DELIVERY_MODE=real SMS_DELIVERY_MODE=real \
     ./provision.sh --pat-file /etc/ds-platform/idp-bootstrap-pat.txt'
   ```

   Then read the set back from Zitadel's management API (the api container's own
   `IDP_REDIRECT_URI` is NOT the registered set — see the Portal host cutover
   section's read-back snippet for the exact query).

4. **Deploy.** `pnpm deploy:prod` builds `ds-doctor:<sha>` alongside the other
   three, boot-probes it before the swap, and restarts Caddy because the
   bind-mounted `Caddyfile` is stale (#1175 — `RUNTIME_CONFIG_SERVICES` already
   covers `caddy`; no manual SSH restart). Then:

   Deploy with the doctor probes **still skipped** if step 1 has not been
   verified yet, then flip them on once the host is routed:

   ```bash
   PROD_DOCTOR_HOST=skip pnpm deploy:prod           # window before the DNS flip
   # …after step 1 is verified from two resolvers:
   pnpm deploy:prod                                 # probes on (default)
   curl -sSI https://new.doctor.school/ | head -1   # 200/3xx over valid TLS
   pnpm smoke:prod                                  # doctor / + TLS probes included
   ```

   **Mail links:** no api mail carries a link (runtime contract above), so
   nothing in them needs re-pointing.

5. **Release-gate sequencing.** Both `apps/doctor` routes are still `deferred` in
   `tools/lint/prod-surface-manifest.yaml` and #1440's "no public placeholder on
   prod" criterion binds: the compose/Caddy/tooling work above may land at any
   time, but the **DNS flip (step 1) happens only once the release-3 surfaces
   (017/019/020/021) are product-ready**. Gate #1704 sequences that.

## Sign-in host roll-out — `login.doctor.school` (#3171)

`apps/login` is the one sign-in host both storefront OIDC clients carry as their
Login V2 `base_uri` (ADR-0015 §4; 003 EARS-60..71). The repo half lands with
#3171: the `login` compose service (image `ds-login:<sha>`, `PORT=3005`,
`/healthz`-healthcheck, `depends_on: api`, in `caddy.depends_on`), the Caddy vhost
`login.doctor.school → login:3005`, `ds-login` as a first-class member of
`pnpm deploy:prod` (build, digest manifest, retention, rollback), the api's
sign-in-host env (`IDP_SIGN_IN_BASE_URI`, `SIGN_IN_{ACADEMY,DOCTOR}_LOGIN_URL` in
compose; `IDP_{ACADEMY,DOCTOR}_CLIENT_ID` written into the compose `.env` from the
pre-swap IdP converge's read-back) and a `/healthz` + TLS probe in `pnpm smoke:prod`.

Like `new.` this is an ADD of a free name, and the same HTTP-01 ordering applies:
the out-of-band steps below MUST be done **before** the release that carries the
vhost. They are tracked as that release's prerequisite Issue (`Release-requires:`
on #3171's PR). Unlike `new.`, the smoke has **no** operator opt-out to bridge a
missing record: `PROD_LOGIN_HOST=skip` is set by `prod.mjs` only for a deploy
target that ships no `ds-login` image (an older rollback target, #1896).

1. **[OWNER-GATED] Beget DNS — add the A-record** `login` → `77.233.220.222`
   (`api_prod_public_ip`). Verify from two resolvers before the release:

   ```bash
   nslookup login.doctor.school 8.8.8.8   # must return A 77.233.220.222
   nslookup login.doctor.school 1.1.1.1
   ```

2. **[OWNER-GATED] SmartCaptcha allowed host.** Add `login.doctor.school` to the
   `ds-platform-prod` resource's allowed-host list (domain validation stays ON; the
   site/server keys are unchanged, so no rebuild). The form's captcha is the same
   `SMARTCAPTCHA_SITE_KEY` the storefronts use.

3. **[OWNER-PLACED] `SIGN_IN_RECORD_KEY` in `/etc/ds-platform/api.env`** (root:root
   `0600`, template `api.env.example`): `openssl rand -base64 32`, generated on the
   box, never in git or chat. `pnpm deploy:prod` refuses a target that ships
   `ds-login` before any box change unless the line is present — it counts the
   assignment over ssh (`record-key-lines=N`), never reads the value out.
   Evidence: that count, e.g.
   `ssh api-prod "sudo grep -c '^SIGN_IN_RECORD_KEY=' /etc/ds-platform/api.env"` → `1`.

4. **Deploy.** `pnpm deploy:prod` — Caddy restarts on the stale bind-mounted
   `Caddyfile` (#1175), issues the `login.` certificate on first request, and the
   smoke probes `https://login.doctor.school/healthz` (200 `ok`) + TLS.

5. **Monitoring.** The mon-prod-tw blackbox targets live in the `bbm` repo
   (`infra/monitoring/`, see «Мониторинг» below), not here: add
   `login.doctor.school/healthz` (`probe_scope=app_health`) there after step 4.

The edge keeps every app cookie host-only (ADR-0015 §4 req 4): no vhost adds or
rewrites a `Set-Cookie` `Domain`. The storefronts' `ds-theme` preference cookie is
set by the storefront itself for the parent domain — a display preference, not an
auth cookie. The api's storefront-server-only prefix `/v1/internal` answers 404 on
every public vhost (ADR-0015 §4 req 2).

## Build-cache GC on `api-prod` (#1419)

**Since #2981 nothing is built on `api-prod`**: `pnpm deploy:prod` pulls the recorded
registry digests (see «Container registry»), so a deploy adds no BuildKit cache and
the post-deploy `buildx prune` step is gone from `tools/deploy/prod.mjs`. What
remains is the cache the on-box builds left behind, reclaimed once by hand
(`sudo docker buildx prune -af` on ds-api-prod after the first pulled release), and
the daemon-level cap below, which stays as a harmless backstop.

History: when `api-prod` built the `ds-api` / `ds-portal` / `ds-admin` / `ds-doctor`
images on the box, every deploy added 1–3 GB of BuildKit cache; it reached
**54.6 GB / 77% disk** before the 2026-08-21 manual cleanup dropped the box back to
28%. (SHA-tagged _images_ were already bounded — `prod.mjs` keeps the last 3 tags per
repo, DSO-127 — the _build cache_ was the unbounded half.)

| Layer                                                 | Where                     | Applies                                       |
| ----------------------------------------------------- | ------------------------- | --------------------------------------------- |
| Daemon GC — `builder.gc.defaultReservedSpace: "10GB"` | `/etc/docker/daemon.json` | continuously, in dockerd, deploy or no deploy |

The figure is kept equal to the stage box's cap (`BUILD_CACHE_RESERVED_SPACE` in
`tools/staging/slot.mjs`, which still prunes after a converge); YAML cannot import a
JS constant, so the cloud-init value is kept in sync by hand.

`defaultReservedSpace` is the modern (docker 28+) spelling, matching the
`--reserved-space` CLI flag. **Validated on `ds-api-prod`
(docker 29.6.1) on 2026-08-21: `sudo dockerd --validate --config-file …` returns
`configuration OK` for BOTH `defaultReservedSpace` and the legacy
`defaultKeepStorage`.** The modern key is chosen for forward-compatibility, not
because the legacy one is rejected.

**`cloud-init/api-prod.yaml` writes `daemon.json` only on box (re-)creation.** It
never retro-applies to a running box — the live `api-prod` was provisioned before
this policy existed, so its daemon still has no `builder.gc` block. With nothing
built on the box any more, that gap no longer grows; the one-time apply below is
optional.

**One-time apply on the EXISTING box.** Restarting dockerd restarts every
container — do it in a deploy window, not during traffic. Brief downtime of the
whole stack (api, portal, Caddy, Zitadel) is expected; there is no way to reload
`builder.gc` without a daemon restart.

`/etc/docker/daemon.json` is **absent** on the live box (verified 2026-08-21), so
this creates it — there is no existing daemon config to merge with. Stage the
candidate in `/tmp` and **validate it there first**: a malformed
`/etc/docker/daemon.json` stops dockerd from starting, so the file must never
land at its real path unvalidated.

```bash
ssh ds-api-prod
# 0. Confirm the premise still holds — expect "no daemon.json".
sudo test -f /etc/docker/daemon.json && sudo cat /etc/docker/daemon.json || echo "no daemon.json"
# 1. Stage the candidate in /tmp — NOT at /etc/docker/daemon.json yet.
cat >/tmp/daemon.json <<'JSON'
{
  "builder": {
    "gc": {
      "enabled": true,
      "defaultReservedSpace": "10GB"
    }
  }
}
JSON
# 2. Validate the CANDIDATE. `--validate` only parses the config; it does not
#    touch the running daemon. Go on to step 3 only on `configuration OK`.
sudo dockerd --validate --config-file /tmp/daemon.json
# 3. Only now install it at the real path.
sudo install -d -m 0755 /etc/docker
sudo install -m 0644 -o root -g root /tmp/daemon.json /etc/docker/daemon.json
# 4. Restart (deploy window) + verify the stack came back.
sudo systemctl restart docker
sudo docker ps --format '{{.Names}}\t{{.Status}}'
sudo docker system df
```

Then re-run `pnpm deploy:smoke` from the workstation to confirm the stack is
serving.

Cloud-init runs the same `dockerd --validate` on first boot (a `runcmd` step
after the Docker install). It is deliberately non-blocking — it logs a loud
`WARNING (#1419)` to `/var/log/cloud-init-output.log` rather than halting and
leaving a half-provisioned box.

**Trap — never use `docker builder prune --filter until=…` here.** This daemon
runs the **containerd snapshotter** (`driver=overlayfs`), where the `until=`
filter can report success while reclaiming **0 bytes**. Use
`docker buildx prune -f --reserved-space 10GB` (verified supported on-box:
docker 29.6.1), which is what `prod.mjs` runs.

Scope: `api-prod` only. `data-prod` builds nothing and needs no build-cache GC.

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
  `ds-prod-pgbackrest` >26ч), `ExternalHttpProbeFailed` (пробы `probe_scope=user_path`)
  и `ApplicationHealthProbeFailed` (`probe_scope=app_health`), `CertExpirySoon-warning`
  /`-critical`, `HostTelemetryStale-api-prod`/`-data-prod`, `DiskFillHigh` (>85/92%).
  Правила — Grafana-managed (`grafana/provisioning/alerting/rules.yaml`), не
  Prometheus-rule-файлы: у Prometheus на mon `rule_files` пуст, поэтому
  `/api/v1/alerts` там всегда пустой — состояние алертов читается из Grafana
  (`/api/alertmanager/grafana/api/v2/alerts`).
- **Blackbox-эндпоинты** (`tenant=ds`, 4 цели): `api.doctor.school/v1/health`
  (`app_health`), `academy.doctor.school/` (`user_path`), `id.doctor.school/`
  (`user_path`), `id.doctor.school/debug/healthz` (`app_health`).
- **SSOT конфига мониторинга — репозиторий `bbm`, `infra/monitoring/`**, а не сам
  бокс: `~/monitoring-deploy` на mon-prod-tw — это выкаченная копия (`rsync` +
  `scripts/02-deploy.sh`). Менять цели только там и выкатывать; правка на боксе
  расходится с SSOT и теряется при следующем выкате. Прометей запущен без
  `--web.enable-lifecycle`, поэтому конфиг перечитывается через
  `docker compose restart prometheus`, а не POST `/-/reload`.
- **При смене публичного хоста портала пробу нужно перенацелить руками** — она
  не выводится из этого репозитория. Ретайр `app.doctor.school` (#1173) этого шага
  не включал: проба осталась на мёртвом хосте и подняла `ExternalHttpProbeFailed`
  в канал. Исправлено 2026-08-15 в рамках #1273 (bbm: `chore(monitoring):
перенацелить blackbox-пробу портала`).
