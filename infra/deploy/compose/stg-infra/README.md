# `stg-infra` — the shared service set of the STAGE stand

The one long-lived compose project on `stage-1`. It carries Postgres, Redis, MinIO,
Cerbos, Mailpit, the SMS sinks, Zitadel (+ its Login V2 UI) and the box's Caddy;
every preview slot (`main`, `pr-<N>`) is a _separate_ compose project that joins the
`stg-infra` network with its `api` container only.

Plan of record: `apps/docs/content/specs/tech/2026-09-08-staging-previews-and-regression-contour-en.md`
(§3 topology, §8 steps 1-2, §9 recovery). Issue #2061 (Phase A, this directory) and
#2062 (the edge — «Edge (#2062)» below);
Phase B — the owner's `terraform apply`, the first bring-up and
the live acceptance below — is tracked in **#2095**.

Everything here is Phase B: nothing in this file runs on a developer machine.

## What is deliberately absent

| Absent                    | Why                                                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| pgbackrest / WAL archive  | The box holds no unique state. `terraform apply` recreates it; `stg-infra` and `ds_golden` rebuild from the repo (spec §9 «Box down»). |
| Centrifugo                | It is part of the `api-prod` service set and runs inside every slot (spec §3).                                                         |
| Unleash                   | A second stateful admin service is a §2 non-goal; staging reads flags from env, as production does today.                              |
| Any production credential | `stage.env` carries sinks, vendor TEST keys and secrets generated on this box — see AC4 below.                                         |

## Prerequisites (owner, once)

1. `terraform apply` in `infra/deploy/terraform/` creates `stage-1` (own VPC, no
   route to `twc_vpc.ds`). Provider write actions are owner-gated — AGENTS.md §6.
2. `ssh deploy@$(terraform output -raw stage_1_public_ip)` works and the bootstrap
   finished. The provider reboots a fresh server once during its first minutes
   (#2121); that is expected and harmless now that `cloud-init/stage-1.yaml` is
   prod-length — it completes inside the window. Reconnect after the reset and
   assert:

   ```bash
   cloud-init status --wait          # expected: status: done
   docker --version                  # expected: a version line, not "command not found"
   systemctl is-active docker        # expected: active
   ```

3. The repo is checked out on the box at `/srv/ds-platform` (the `main` tree the
   slot script clones from).
4. `/etc/ds-platform/stage.env` written from `infra/deploy/stage.env.example`, mode
   `0600`, owner `root:root`. Any value containing `$` — above all
   `STAGE_BASIC_AUTH_HASH` — MUST be single-quoted: the box sources the file with
   `set -a; . stage.env`, which expands `$2a`/`$14` and silently truncates a bcrypt
   hash (see the comment above that key in `infra/deploy/stage.env.example`).

## Bring-up order

The order matters twice: Zitadel refuses to boot before Postgres is healthy, and the
converge refuses to run before Zitadel is ready.

```bash
cd /srv/ds-platform/infra/deploy/compose/stg-infra

# HOW COMPOSE IS INVOKED ON THIS BOX. Compose *interpolation*
# (${POSTGRES_PASSWORD:?}, ${IDP_SECRET_KEY:?}, ${IDP_BOOTSTRAP:+...}) resolves from the
# invoking SHELL or a `.env` beside the compose file — never from `env_file:`, which
# only populates the container. `sudo` also drops the caller's environment. So every
# compose command on this box sources the box env first, exactly as production does
# (`infra/deploy/README.md` step 9, `tools/deploy/prod.mjs`):
#
#     sudo bash -c 'set -a; . /etc/ds-platform/stage.env; set +a; docker compose ...'
#
# A plain `sudo docker compose up -d` aborts with "required variable
# POSTGRES_PASSWORD is missing"; and had it started, ${IDP_BOOTSTRAP:+...} would have
# resolved EMPTY, the first init would never create `ds-bootstrap`, and the converge
# chain below (and AC5) would be unreachable.

# 0. A /etc/ds-platform/stage.env generated from an EARLIER copy of
#    infra/deploy/stage.env.example carries EMAIL_DELIVERY_MODE=sink, which is not a
#    value provision.sh or the api env schema accepts (mailpit | real — Mailpit IS the
#    email sink) and which aborts the converge. Edit it to EMAIL_DELIVERY_MODE=mailpit
#    before the converge; SMS_DELIVERY_MODE=sink is unchanged.
#
# 1. FIRST bring-up ONLY: set IDP_BOOTSTRAP=1 in /etc/ds-platform/stage.env BEFORE
#    this step — the FIRSTINSTANCE_* block is read only on a fresh init — and unset
#    it again in step 3.
sudo bash -c 'set -a; . /etc/ds-platform/stage.env; set +a; \
  docker compose up -d --build postgres redis minio cerbos mailpit sms-sink sms-aero-adapter'
sudo bash -c 'set -a; . /etc/ds-platform/stage.env; set +a; docker compose ps'  # all healthy first

sudo bash -c 'set -a; . /etc/ds-platform/stage.env; set +a; docker compose up -d idp'
sudo bash -c 'set -a; . /etc/ds-platform/stage.env; set +a; docker compose logs -f idp'  # init migrations

# 2. Copy the bootstrap PAT out of the container tmpfs to a root-only file, and place
#    the login client's PAT where idp-login expects it (both OUTSIDE the repo
#    checkout, so a slot sync never wipes them).
#
#    The Zitadel image is DISTROLESS — no shell, no coreutils — so
#    `docker compose exec -T idp cat /pat/pat.txt` fails with
#    `exec: "cat": executable file not found`. Read the file through the HOST view of
#    the container rootfs, as both existing recipes do
#    (`infra/dev-stand/idp/bootstrap.md`, `infra/deploy/README.md` step 9).
PID=$(sudo docker inspect stg-infra-idp-1 --format '{{.State.Pid}}')
sudo cat /proc/$PID/root/pat/pat.txt | sudo tee /etc/ds-platform/idp-bootstrap-pat.txt >/dev/null
sudo chmod 600 /etc/ds-platform/idp-bootstrap-pat.txt

#    idp-login-client.pat permissions are LOAD-BEARING (#866): zitadel-login runs as
#    uid 1001 (`nextjs`), so the copy MUST be owner uid 1001, mode 400. A root:root
#    0600 file bind-mounts fine but is unreadable inside the container -> empty
#    service token -> EVERY cookie-less (cold) login 500s while sessions with existing
#    cookies keep working; that was a 9-day silent production outage, #866
#    (`infra/deploy/README.md`). idp-bootstrap-pat.txt itself stays 600 root:root ON
#    PURPOSE — its only consumers are sudo ops steps; no container mounts it.
sudo install -m 400 -o 1001 /etc/ds-platform/idp-bootstrap-pat.txt /etc/ds-platform/idp-login-client.pat
sudo stat -c '%a %u %n' /etc/ds-platform/idp-login-client.pat
# MUST print: 400 1001 /etc/ds-platform/idp-login-client.pat

# 3. Unset IDP_BOOTSTRAP in /etc/ds-platform/stage.env (so a restart never re-inits),
#    then start the rest.
#
#    Removing IDP_BOOTSTRAP changes the INTERPOLATED env of `postgres` and `idp`
#    (${IDP_BOOTSTRAP:+...} now resolves empty), so this `up -d` RECREATES both of
#    them even though only idp-login and caddy are named. That is expected and not a
#    data loss: `pgdata` is a named volume and survives the replacement. WAIT for
#    `idp` to report healthy again (~10 s) before running the converge below.
sudo bash -c 'set -a; . /etc/ds-platform/stage.env; set +a; docker compose up -d idp-login caddy'
sudo bash -c 'set -a; . /etc/ds-platform/stage.env; set +a; docker compose -p stg-infra ps idp'
# expected: `running (healthy)` before continuing to the converge.
```

## Edge (#2062)

`Caddyfile` is the whole C2 deliverable: one wildcard site `*.stage.doctor.school`
behind the owner-managed wildcard A record (added in the Beget zone 2026-09-10,
→ `200.169.178.154`).

- **On-demand TLS.** No certificate is pre-issued. Caddy asks
  `http://127.0.0.1:2020/ask` before every ACME order, and the allow list is the
  generated `ask.caddy` include — the shared `id` host plus every host of every
  registered slot (see «Slots (#2064)» below). An unregistered name under the
  wildcard therefore fails the TLS handshake instead of burning a Let's Encrypt
  issuance slot. The site is bound to `127.0.0.1:2020`, not `:2020`: this container
  is attached to every slot network, so an unbound listener would hand the registry
  to code running inside a preview.
- **noindex.** The `(staging_guard)` snippet sets `X-Robots-Tag: noindex, nofollow`
  on the wildcard site, so it rides every response — 200, 401, 404 alike.
- **Basic auth.** ONE pair for the whole stand, `STAGE_BASIC_AUTH_USER` +
  `STAGE_BASIC_AUTH_HASH` (bcrypt, `caddy hash-password`). The values come from
  `/etc/ds-platform/stage.env` and are handed to the container by the `environment:`
  block of the `caddy` service in `compose.yml` — `env_file:` alone would not reach
  Caddy's `{$VAR}` placeholders in a way the config reload keeps stable. The
  cleartext pair the operator types lives beside it in
  `/etc/ds-platform/stage-basic-auth.txt`, **`0600 root:root`**, the same mode and
  owner as `stage.env`: it is a live credential, not a note.
- **Base domain.** The site address `*.{$STAGE_BASE_DOMAIN}`, the `id` vhost and the
  `(slot)` snippet all read `STAGE_BASE_DOMAIN` from `stage.env` via the `caddy`
  service's `environment:` block. `tools/staging/slot.mjs` reads the SAME variable to
  derive the literal hosts it writes into the generated includes — one variable, two
  consumers, one value. Change it in `stage.env` and both sides follow.
- **`(slot)` snippet + the generated `import slot <name>` lines.** One `import` line
  = four vhosts (`academy-`, `doctor-`, `admin-`, `api-<slot>`). Those lines are
  never typed: they live in `slots.caddy`, rendered from the slot registry by
  `slot up` / `slot down`, which then reload through the loopback admin API.
- **`id` vhost.** The shared Zitadel: `/ui/v2/login/*` → `idp-login:3000`, everything
  else → `h2c://idp:8080`, the production shape of `id.doctor.school`.

**Alias contract — satisfied since #2064 part 1.** The `(slot)` snippet proxies to the
container names `<slot>-portal:3001`, `<slot>-doctor:3004`, `<slot>-admin:3002`,
`<slot>-api:3000`, `<slot>-centrifugo:8000`. `infra/deploy/compose/slot/compose.yml`
publishes exactly those as `container_name: ${SLOT}-<service>` on the slot's own
network `slot-<slot>`, which `slot up` attaches this Caddy container to; the same five
names are derived and unit-tested as `containerAliases()` in `tools/staging/slot.mjs`.
Changing either side alone silently 502s the whole slot.

**The two basic-auth exemptions** — and only two, both because the caller carries no
browser credentials and authenticates by its own mechanism:

1. the two Centrifugo path families on `api-<slot>` (`/connection/websocket` and
   `/api/*`), guarded by Centrifugo's HMAC token and its API key, exactly as in
   production (`infra/deploy/compose/api-prod/Caddyfile`);
2. the whole shared IdP host `id.stage.doctor.school`. Every slot api reaches the IdP
   machine-to-machine through the PUBLIC issuer origin (`IDP_ISSUER` is the public URL
   in production too, `infra/deploy/api.env.example`), and converge form (b) does the
   same. A challenge there breaks OIDC discovery and token exchange while protecting
   nothing — Zitadel authenticates every caller on its own. `noindex` still applies to
   `id`.

**Never `curl --resolve` an unregistered or unresolving host.** Each attempt makes
Caddy start an ACME order that fails validation, and failed validations count against
the Let's Encrypt rate limit for the whole zone. Test only names the `ask` stub
already answers 200 for.

### Acceptance (observed 2026-09-10, from an external client unless noted)

```bash
curl -sI https://academy-main.stage.doctor.school/
# observed: 401, Www-Authenticate: Basic realm="restricted",
#           X-Robots-Tag: noindex, nofollow
# doctor-main, admin-main -> 401; api-main /v1/health -> 401
# api-main /connection/websocket unauthenticated -> 502 (reaches the Centrifugo
#   route, NOT a Caddy 401 — the slot is not up yet, #2065)

curl -sI https://id.stage.doctor.school/.well-known/openid-configuration
# observed: 200 with X-Robots-Tag: noindex, nofollow and NO basic auth (exemption 2)

openssl s_client -connect academy-main.stage.doctor.school:443 \
  -servername academy-main.stage.doctor.school </dev/null 2>/dev/null | \
  openssl x509 -noout -issuer -subject -dates
# observed: issuer C=US, O=Let's Encrypt, CN=YE1
#           subject CN=academy-main.stage.doctor.school
#           notBefore 2026-09-10 02:21:32 GMT, notAfter 2026-12-09

openssl s_client -connect api-pr-0.stage.doctor.school:443 \
  -servername api-pr-0.stage.doctor.school </dev/null
# observed: handshake refused, no certificate issued — `ask` answered 404.
# (This host RESOLVES via the wildcard; that is why probing it is safe.)
```

On the box, with the pair from `/etc/ds-platform/stage-basic-auth.txt`: `academy-main`
→ 502 and `api-main /v1/health` → 502 (authenticated, no slot upstream yet), a wrong
password → 401. The pair was rotated 2026-09-10. The `ask` stub answered 200 for `id`,
`academy-main`, `api-main` and 404 for `api-pr-0`; `/healthz` by IP → 200; `Host:
academy-main…` on `:80` → 308 to https; `Host: foo.example` → 404.

## Zitadel converge

The same idempotent read-before-write converge the dev stand and production use
(`infra/dev-stand/idp/provision.sh` + `idp-policy.mjs`, #1997) — no staging-specific
script exists or should. Run it after every bring-up and after any PR that changes
provisioning.

`provision.sh` REQUIRES a base URL — `IDP_BASE_URL` or `--base-url`; without one it
aborts with `set IDP_BASE_URL or --base-url`. `stage.env` carries no `IDP_BASE_URL`,
so every invocation below passes it explicitly. Which value is correct depends on
whether the edge (#2062) exists yet, so there are two forms.

**(a) Before #2062 — no `id.stage` vhost and no public DNS yet.** Zitadel answers only
for its own configured external domain: from inside the `stg-infra` network the same
management request returns 404 with `Host: idp:8080` and 200 with
`Host: id.stage.doctor.school` (or `id.stage.doctor.school:8080`). The `idp` service
also publishes no host port. So the converge runs in a throwaway container ON that
network, with the external domain pointed at the `idp` container by `--add-host`:

```bash
# stage.env is root:root 0600 and carries values with spaces (IDP_SMTP_SENDER_NAME),
# so source it AS ROOT with `set -a` — the invocation production uses for
# provision.sh (`infra/deploy/README.md` step 9). `env $(grep ... | xargs)` word-splits
# those values and silently passes a truncated env.
sudo bash -c 'set -a; . /etc/ds-platform/stage.env; set +a; \
  IDP_IP="$(docker inspect stg-infra-idp-1 \
    --format "{{(index .NetworkSettings.Networks \"stg-infra\").IPAddress}}")" && \
  docker run --rm --network stg-infra \
    --add-host "id.stage.doctor.school:$IDP_IP" \
    -e IDP_BASE_URL=http://id.stage.doctor.school:8080 \
    -e EMAIL_DELIVERY_MODE -e SMS_DELIVERY_MODE \
    -e IDP_PROJECT_NAME -e IDP_APP_NAME -e IDP_SEED_ROLE \
    -e IDP_BOOTSTRAP_USERNAME -e IDP_LOGIN_BASE_URI \
    -e IDP_REDIRECT_URIS -e IDP_POST_LOGOUT_URIS \
    -e IDP_NOTIFICATION_LANGUAGE -e IDP_RESTRICT_LANGUAGES \
    -e IDP_SMTP_HOST -e IDP_SMTP_SENDER_ADDRESS -e IDP_SMTP_SENDER_NAME \
    -e IDP_SMTP_REAL_PROVIDER -e IDP_SMTP_REAL_HOST -e IDP_SMTP_REAL_PORT \
    -e IDP_SMTP_REAL_USER -e IDP_SMTP_REAL_PASSWORD \
    -e IDP_SMTP_REAL_SENDER_ADDRESS -e IDP_SMTP_REAL_SENDER_NAME \
    -e IDP_SMS_SINK_ENDPOINT -e IDP_SMS_AERO_ENDPOINT \
    -v /srv/ds-platform/infra/dev-stand/idp:/idp:ro \
    -v /etc/ds-platform/idp-bootstrap-pat.txt:/pat.txt:ro \
    -w /idp alpine:3.20 \
    sh -c "apk add --no-cache bash curl jq >/dev/null && \
      ./provision.sh --pat-file /pat.txt"'
```

`alpine:3.20` plus `apk add bash curl jq` is used because no one-shot image carrying
that trio is vendored anywhere under `infra/`, and bash + curl + jq are exactly what
`provision.sh` declares it needs.

The `-e` list is not a selection: the container inherits NOTHING from the sourced
shell, so it mirrors `provision.sh`'s whole env contract, re-derivable with

```bash
grep -oE '\$\{(IDP_[A-Z0-9_]+|EMAIL_DELIVERY_MODE|SMS_DELIVERY_MODE|PAT)[:}]' \
  infra/dev-stand/idp/provision.sh | sort -u
```

minus `IDP_BASE_URL` (set explicitly above) and `PAT` (supplied by `--pat-file`). Each
is passed BARE, so it takes the value `stage.env` exports and an unset one falls
through to the script's own default — exactly as it does on the host in form (b). Keep
the list in step with that grep whenever `provision.sh` gains a variable: a name left
out is not a no-op, it silently converges the script's DEV default onto the shared
stage instance (`IDP_PROJECT_NAME`/`IDP_APP_NAME` fall back to `ds-platform-dev`, and
both objects are looked up BY NAME — an omission creates a second project and a second
OIDC app rather than converging the stage pair).

Because both forms therefore read the same values, they converge the same project, the
same app, the same providers — and, as observed on the box on 2026-09-10, the same
login URI. Switching to form (b) after #2062 re-converged nothing: form (b) was run
twice from the host and BOTH runs printed only `already ...` lines, the login URI step
included, with no `converged` write on the first one. AC5's «only `already ...`»
idempotency therefore holds across the form switch as well as across two consecutive
runs of one form.

**(b) After #2062 — the `id.stage` vhost exists.** Then the production shape applies
(`infra/deploy/README.md` step 9): run it straight on the host against the public base
URL, no container and no `--add-host`.

```bash
sudo bash -c 'set -a; . /etc/ds-platform/stage.env; set +a; \
  cd /srv/ds-platform/infra/dev-stand/idp && \
  IDP_BASE_URL=https://id.stage.doctor.school \
  ./provision.sh --pat-file /etc/ds-platform/idp-bootstrap-pat.txt'
```

Two standing rules come with the shared instance (spec §3 «Identity»):

- A PR that changes `provision.sh` or `idp-policy.mjs` is **serialized repo-wide like
  a migration** — one in flight; its preview converges the shared IdP and every other
  slot sees the change. The PR body says so.
- **Re-pass every redirect / post-logout URI**, never just the new one: the converge
  sends the URI set as a whole, so a partial list silently drops the others. This has
  bitten production twice (`infra/deploy/README.md`).

## Slots (#2064)

A **slot** is one deployed copy of the platform: `main` (the persistent staging copy
of `origin/main`) or `pr-<N>` (a preview of one open PR). Its compose project is
`infra/deploy/compose/slot/compose.yml`, one file for every slot, driven only by
`tools/staging/slot.mjs` — the box has no workspace checkout, so the script runs on
the pinned host Node under `/opt/node`.

```bash
node /opt/ds-platform/tools/staging/slot.mjs render            # write both Caddy includes
node /opt/ds-platform/tools/staging/slot.mjs up   main <sha>   # first bring-up / converge
node /opt/ds-platform/tools/staging/slot.mjs sync pr-2064 <sha>  # re-converge to a new SHA
node /opt/ds-platform/tools/staging/slot.mjs down pr-2064      # tear down, drop the database
node /opt/ds-platform/tools/staging/slot.mjs status            # the registry, as a table
node /opt/ds-platform/tools/staging/slot.mjs gc                # reclaim unregistered images
```

`reset main` and `reset-identities <slot>` are part 2 of #2064; the CLI **refuses**
them today with an explicit «not implemented until part 2» error rather than
silently doing nothing.

**One registry, two rendered includes.** `/var/lib/ds-platform/slots.json` is the
single source of truth (`{ slots: { "<name>": { sha, redisDb, hosts, updatedAt } } }`).
From it the script renders, and Caddy mounts read-only from
`/etc/ds-platform/caddy` → `/etc/caddy/slots`:

| file          | what it carries                                  | consumed by                   |
| ------------- | ------------------------------------------------ | ----------------------------- |
| `ask.caddy`   | the on-demand-TLS allow list (`id` + slot hosts) | the `127.0.0.1:2020` ask site |
| `slots.caddy` | one `import slot <name>` line per live slot      | the wildcard HTTPS site       |

The two move in **lockstep** because they come from the same registry, and neither is
ever edited by hand — a hand-added vhost whose host is not in `ask.caddy` cannot get a
certificate, and a certificate for a host with no vhost is a wasted issuance.

**`slot render` before the first bring-up.** Caddy fails to start if either include is
missing, so run `slot render` once (an empty registry yields comment-only files that
parse fine) before `docker compose up -d caddy` on a fresh box. `up` / `sync` / `down`
call the same renderer and then reload Caddy through the loopback admin API — never
`restart caddy`, which would drop live connections and re-read certificates.

**What a converge does, in order.** Write the per-slot env file → clone the database
from `ds_golden` (never for `main`, which is persistent and forward-migrated) → pull
the five images → migrate → branch seed → `up -d` → attach this Caddy to the slot
network → register the slot → re-render both includes → reload. Registration happens
strictly AFTER the containers are up, and de-registration strictly BEFORE teardown, so
a registered host always has an upstream.

**Secrets stay in one file.** `/etc/ds-platform/slots/<slot>.env` is generated and
carries only non-secret values (`SLOT`, `SLOT_SHA7`, `SLOT_DB`, `DEPLOY_SHA`,
`REDIS_URL`, the public URLs, `IDP_ISSUER`, `MAILER_SMTP_FROM`). `DATABASE_URL` is
**not** written there: the slot compose assembles it from `stage.env`'s
`POSTGRES_PASSWORD` and the slot's `SLOT_DB`, so `POSTGRES_PASSWORD` exists in exactly
one file on the box.

**Sizing.** `main` plus at most **3** previews (`up` refuses the fourth). Redis
databases are exclusive: `main` owns 0, a preview starts at `1 + (N % 15)` and linear-
probes to the next free database — two slots never share one, and a collision moves the
newcomer instead of dead-ending its converge.

**Building images.** The box never builds. Dispatch
`.github/workflows/preview.yml` («Preview images») with the full SHA and the slot
name; it pushes `ghcr.io/doctor-school/ds-platform/{api,api-migrate,portal,doctor,admin}:<slot>-<sha7>`,
which is exactly what `slot up` pulls. The SmartCaptcha SITE key is baked at build
time from the repository variable `STAGE_SMARTCAPTCHA_SITE_KEY` (empty until the owner
provisions it with the separate stage-captcha task — empty renders the inactive
placeholder, and an image built before it was set must be rebuilt).

**Disk.** `slot gc` removes slot-tagged images whose slot is not in the registry, and
only then, if free space on `/var/lib/docker` is below **10 GB**, additionally runs
`docker image prune -af --filter until=24h`. That is the same figure production uses
as `BUILD_CACHE_RESERVED_SPACE` in `tools/deploy/prod.mjs`, by a **different
mechanism**: on api-prod it is a BuildKit cache cap (`buildx prune --reserved-space`),
here it is a free-disk floor, because this box never builds and has no BuildKit cache
to cap. `slot gc` never calls `buildx`.

## Slot deployer — not part of this bring-up

No CI agent runs on this box. The repository is **public**, so no job of it may ever
execute here; images are built and the regression suite runs on GitHub-hosted runners
(spec §5). What converges slots is a pull-based deployer: the systemd unit pair
`ds-slot-deployer.service` and `ds-slot-deployer.timer`, which wrap the `slot`
commands above. They are **part 2 of step 4 (#2064)** and are installed then — not by
`cloud-init` and not here; part 1 landed only `tools/staging/slot.mjs` and the compose
project it drives, both usable by hand. Part 2 also installs the box's only host runtime, a pinned Node
LTS from the official `nodejs.org` tarball under `/opt/node` (no `pnpm`, no workspace
checkout on the host). Every 60 s the timer reads the open non-draft PRs and the `main`
head from GitHub, checks the GHCR tags exist, and brings slots up, in sync or down.

The one thing to provision now, so the owner writes `stage.env` once:
`STAGE_GH_READ_TOKEN` — a fine-grained **read-only** token («Pull requests: read»,
«Metadata: read»), scoped to this repository. It grants nothing an anonymous visitor
of a public repository lacks; its only job is lifting the unauthenticated rate limit.
Nothing on this box holds a write credential to GitHub.

**Trust boundary.** Outbound only: the box exposes no inbound CI path, needs no deploy
key and no CI-facing port 22. What is in reach here: the box env
(`/etc/ds-platform/stage.env`, sinks and test keys) and the box's Docker daemon. What
can put code inside that reach: only images the preview workflow built from a branch
of this repository — a fork PR's `GITHUB_TOKEN` is read-only, cannot push to GHCR, and
therefore gets no slot at all, by construction rather than by a maintainer withholding
approval. What is out of reach: production Postgres and Redis (no route — separate
VPC) and every repository secret, which never leaves the hosted runners. The PR-job
side of the contract is step 6 (#2066).

## Day-to-day

```bash
# Same rule as the bring-up: source the box env, or interpolation aborts the command.
srv() { sudo bash -c "set -a; . /etc/ds-platform/stage.env; set +a; docker compose $*"; }

srv ps                       # health of the shared set
srv logs -f idp              # the usual suspect
srv restart caddy            # after a Caddyfile edit (a slot reload uses the admin API)
srv up -d --build postgres   # after a postgres/Dockerfile change
```

`stg-infra` is never brought down to recycle a slot; slot lifecycle is
`tools/staging/slot.mjs` (step 4, #2064).

## Phase B acceptance (#2095)

The C1 acceptance criteria of spec §8 step 1, with the exact command for each. Run on
the box after `terraform apply` and the bring-up above; the output is pasted into
#2095 and cross-linked from the Phase A PR.

**AC1 — every shared service healthy.**

```bash
sudo bash -c 'set -a; . /etc/ds-platform/stage.env; set +a; docker compose -p stg-infra ps --format "{{.Service}}\t{{.State}}\t{{.Status}}"'
# expected: every row `running` and `(healthy)`; no `restarting`, no `unhealthy`
```

**AC2 — production Postgres is UNROUTABLE from the box.** The box's own VPC
(`twc_vpc.stage`, `stage-1.tf` L19-40) is `192.168.10.0/24` and is NOT peered with the
production VPC `192.168.0.0/24`. The isolation signal is therefore the ABSENCE of any
route into `192.168.0.0/24`: the box still holds a default route, so a packet addressed
to `192.168.0.10` leaves on the public path and is simply never answered.

```bash
ip -4 route show | grep -c '192\.168\.0\.'   # expected: 0 — no route into the prod VPC
ip -4 -br addr show eth1                     # expected: only 192.168.10.20/24 (own VPC)
timeout 5 bash -c 'cat < /dev/null > /dev/tcp/192.168.0.10/5432' ; echo "exit=$?"
# expected: exit=124 — the probe runs out its timeout unanswered. `exit=0` is red.
```

Negative check — what a WRONGLY peered box would print instead: a `192.168.0.0/24 dev
ethN` route (so the first command prints 1 or more), a second private address on the
interface facing production, and a TCP probe that returns promptly rather than running
out the 5-second timeout (`exit=0` when Postgres answers).

**AC3 — no CI agent on the box, and the bootstrap completed.**

```bash
cloud-init status --wait                     # expected: status: done
systemctl is-active docker                   # expected: active
ls /opt | grep -i runner ; echo "exit=$?"    # expected: no output, exit=1
systemctl list-units --all --no-legend | grep -i runner ; echo "exit=$?"   # same
# expected: nothing named like a CI agent, on disk or in systemd — slots are converged
# by the pull-based deployer step 4 (#2064) installs, and CI never executes here.
```

**AC4 — no production credential on the box.** Two halves, defined in
`infra/deploy/stage.env.example` → «C1 ACCEPTANCE»: names that may only ever be
empty here, and names that MUST carry this box's own value. The second half is
asserted POSITIVELY — a single must-be-empty grep red-lights on a correctly
provisioned box (staging legitimately sets a captcha test key and its own secrets),
and blanking those to make it pass would silently stop exercising what they protect.

```bash
# HALF A — production-only names: absent or empty everywhere on the box.
# The `*.env` glob MUST expand inside the sudo shell: /etc/ds-platform is 0700 root, so
# the caller's own shell cannot expand it and a bare
# `sudo grep ... /etc/ds-platform/*.env` only prints `No such file or directory` — a
# non-check that reads like a pass.
sudo bash -c "grep -nE '^(RESEND_API_KEY|SMSAERO_EMAIL|SMSAERO_API_KEY|SMSAERO_SIGN|PGBACKREST_REPO1_S3_KEY|PGBACKREST_REPO1_S3_KEY_SECRET|PGBACKREST_REPO1_CIPHER_PASS|IDP_SMTP_REAL_HOST|IDP_SMTP_REAL_USER|IDP_SMTP_REAL_PASSWORD|IDP_SMTP_REAL_SENDER_ADDRESS|IDP_SMTP_REAL_SENDER_NAME)=.+' /etc/ds-platform/*.env" ; echo "exit=$?"
# expected: NO output and exit=1 — grep matching nothing IS the pass here.

# HALF B — this box's own values: set, and never still a template placeholder.
sudo grep -nE '^(POSTGRES_PASSWORD|MINIO_ROOT_PASSWORD|IDP_SECRET_KEY|IDP_BOOTSTRAP_ADMIN_PASSWORD|AUDIT_IDENTIFIER_PEPPER|LIFECYCLE_IMPACT_TOKEN_SECRET|IDP_WEBHOOK_SECRET|CENTRIFUGO_API_KEY|CENTRIFUGO_TOKEN_HMAC_SECRET|SMARTCAPTCHA_SERVER_KEY|STAGE_BASIC_AUTH_HASH)=(CHANGE_ME|$)' /etc/ds-platform/stage.env
# expected: NO output — each is set and none is still a `CHANGE_ME_` placeholder.

# HALF B — the sinks are what is actually selected.
sudo grep -E '^(EMAIL_DELIVERY_MODE|SMS_DELIVERY_MODE|IDP_SMTP_HOST|IDP_SMS_SINK_ENDPOINT)=' /etc/ds-platform/stage.env
# expected exactly: mailpit / sink / mailpit:1025 / http://sms-sink:8090/sms
# (`mailpit` IS the email sink — the only values provision.sh and the api env schema
# accept are `mailpit` and `real`; `EMAIL_DELIVERY_MODE=sink` aborts the converge.)

# HALF B — the captcha key is the vendor TEST pair, not the production pair. The box
# holds no copy of the production key and no route to it, so the check prints the pair
# id for the owner to compare against api-prod's — the same 20-char pair-id comparison
# `infra/deploy/README.md` step 3 uses. The comparison is recorded in #2095.
sudo sed -n 's/^SMARTCAPTCHA_SERVER_KEY=ysc2_\([^[:space:]]\{20\}\).*/stage captcha pair id: \1/p' /etc/ds-platform/stage.env
# expected: exactly one line, and that pair id is NOT the production one.
```

**AC5 — the Zitadel converge is idempotent** (it will be re-run by every preview that
touches provisioning).

Run the converge TWICE, using the form from «Zitadel converge» above that matches the
current state of the edge: form (a) (throwaway container on the `stg-infra` network,
`--add-host`, `IDP_BASE_URL=http://id.stage.doctor.school:8080`) before #2062, form (b)
(`IDP_BASE_URL=https://id.stage.doctor.school` from the host) after it. Either way
`IDP_BASE_URL` is mandatory — `provision.sh` aborts without it.

```text
# expected on the SECOND run: only "already ..." lines, no converge writes
```
