# `stg-infra` — the shared service set of the STAGE stand

The one long-lived compose project on `stage-1`. It carries Postgres, Redis, MinIO,
Cerbos, Mailpit, the SMS sinks, Zitadel (+ its Login V2 UI) and the box's Caddy;
every preview slot (`main`, `pr-<N>`) is a _separate_ compose project that joins the
`stg-infra` network with its `api` container only.

Plan of record: `apps/docs/content/specs/tech/2026-09-08-staging-previews-and-regression-contour-en.md`
(§3 topology, §8 step 1, §9 recovery). Issue #2061 (Phase A, this directory);
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
   `0600`, owner `root:root`.

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
sudo bash -c 'set -a; . /etc/ds-platform/stage.env; set +a; docker compose up -d idp-login caddy'
```

## Zitadel converge

The same idempotent read-before-write converge the dev stand and production use
(`infra/dev-stand/idp/provision.sh` + `idp-policy.mjs`, #1997) — no staging-specific
script exists or should. Run it after every bring-up and after any PR that changes
provisioning:

```bash
# stage.env is root:root 0600 and carries values with spaces (IDP_SMTP_SENDER_NAME),
# so source it AS ROOT with `set -a` — the invocation production uses for
# provision.sh (`infra/deploy/README.md` step 9). `env $(grep ... | xargs)` word-splits
# those values and silently passes a truncated env.
sudo bash -c 'set -a; . /etc/ds-platform/stage.env; set +a; \
  cd /srv/ds-platform/infra/dev-stand/idp && \
  ./provision.sh --pat-file /etc/ds-platform/idp-bootstrap-pat.txt'
```

Two standing rules come with the shared instance (spec §3 «Identity»):

- A PR that changes `provision.sh` or `idp-policy.mjs` is **serialized repo-wide like
  a migration** — one in flight; its preview converges the shared IdP and every other
  slot sees the change. The PR body says so.
- **Re-pass every redirect / post-logout URI**, never just the new one: the converge
  sends the URI set as a whole, so a partial list silently drops the others. This has
  bitten production twice (`infra/deploy/README.md`).

## Slot deployer — not part of this bring-up

No CI agent runs on this box. The repository is **public**, so no job of it may ever
execute here; images are built and the regression suite runs on GitHub-hosted runners
(spec §5). What converges slots is a pull-based deployer — `ds-slot-deployer.service`

- `.timer`, delivered together with `tools/staging/slot.mjs` by **step 4 (#2064)** and
  installed then, not by `cloud-init` and not here. Every 60 s it reads the open
  non-draft PRs and the `main` head from GitHub, checks the GHCR tags exist, and brings
  slots up, in sync or down.

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
srv restart caddy            # after step 2 edits the Caddyfile
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

**AC2 — production Postgres is UNROUTABLE from the box** (no route, _not_ a timeout
on an open path — that distinction is the whole isolation claim of `stage-1.tf`).

```bash
ip route get 192.168.0.10        # expected: "RTNETLINK answers: Network is unreachable"
timeout 5 bash -c 'cat < /dev/null > /dev/tcp/192.168.0.10/5432' ; echo "exit=$?"
# expected: an immediate "Network is unreachable" and exit=1 — NOT exit=124 (timeout)
```

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
sudo grep -nE '^(RESEND_API_KEY|SMSAERO_EMAIL|SMSAERO_API_KEY|SMSAERO_SIGN|PGBACKREST_REPO1_S3_KEY|PGBACKREST_REPO1_S3_KEY_SECRET|PGBACKREST_REPO1_CIPHER_PASS|IDP_SMTP_REAL_HOST|IDP_SMTP_REAL_USER|IDP_SMTP_REAL_PASSWORD|IDP_SMTP_REAL_SENDER_ADDRESS|IDP_SMTP_REAL_SENDER_NAME)=.+' /etc/ds-platform/*.env
# expected: NO output.

# HALF B — this box's own values: set, and never still a template placeholder.
sudo grep -nE '^(POSTGRES_PASSWORD|MINIO_ROOT_PASSWORD|IDP_SECRET_KEY|IDP_BOOTSTRAP_ADMIN_PASSWORD|AUDIT_IDENTIFIER_PEPPER|LIFECYCLE_IMPACT_TOKEN_SECRET|IDP_WEBHOOK_SECRET|CENTRIFUGO_API_KEY|CENTRIFUGO_TOKEN_HMAC_SECRET|SMARTCAPTCHA_SERVER_KEY|STAGE_BASIC_AUTH_HASH)=(CHANGE_ME|$)' /etc/ds-platform/stage.env
# expected: NO output — each is set and none is still a `CHANGE_ME_` placeholder.

# HALF B — the sinks are what is actually selected.
sudo grep -E '^(EMAIL_DELIVERY_MODE|SMS_DELIVERY_MODE|IDP_SMTP_HOST|IDP_SMS_SINK_ENDPOINT)=' /etc/ds-platform/stage.env
# expected exactly: sink / sink / mailpit:1025 / http://sms-sink:8090/sms

# HALF B — the captcha key is the vendor TEST pair, not the production pair. The box
# holds no copy of the production key and no route to it, so the check prints the pair
# id for the owner to compare against api-prod's — the same 20-char pair-id comparison
# `infra/deploy/README.md` step 3 uses. The comparison is recorded in #2095.
sudo sed -n 's/^SMARTCAPTCHA_SERVER_KEY=ysc2_\([^[:space:]]\{20\}\).*/stage captcha pair id: \1/p' /etc/ds-platform/stage.env
# expected: exactly one line, and that pair id is NOT the production one.
```

**AC5 — the Zitadel converge is idempotent** (it will be re-run by every preview that
touches provisioning).

```bash
sudo bash -c 'set -a; . /etc/ds-platform/stage.env; set +a; \
  cd /srv/ds-platform/infra/dev-stand/idp && \
  ./provision.sh --pat-file /etc/ds-platform/idp-bootstrap-pat.txt'
# expected on the SECOND run: only "already ..." lines, no converge writes
```
