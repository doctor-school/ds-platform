# `stg-infra` — the shared service set of the STAGE stand

The one long-lived compose project on `stage-1`. It carries Postgres, Redis, MinIO,
Cerbos, Mailpit, the SMS sinks, Zitadel (+ its Login V2 UI) and the box's Caddy;
every preview slot (`main`, `pr-<N>`) is a _separate_ compose project that joins the
`stg-infra` network with its `api` container only.

Plan of record: `apps/docs/content/specs/tech/2026-09-08-staging-previews-and-regression-contour-en.md`
(§3 topology, §8 step 1, §9 recovery). Issue #2061 (Phase A, this directory);
Phase B — the owner's `terraform apply`, the first bring-up, the runner token and
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
2. `ssh deploy@$(terraform output -raw stage_1_public_ip)` works; cloud-init has
   finished (`cloud-init status --wait`) **and** the first-boot bootstrap unit has
   completed: `systemctl is-active ds-stage-bootstrap` prints `inactive` and
   `test -f /var/lib/ds-platform/stage-bootstrap.done` succeeds. `activating` means it
   is still downloading; `failed` ⇒ read `journalctl -u ds-stage-bootstrap`. At least
   one provider-side reboot in the first minutes is expected on Timeweb (the floating
   IP and firewall attach while the box is still booting) — `cloud-init` does not
   resume its `runcmd` after that reboot, which is precisely why the slow steps live
   in this unit: it re-runs on every boot until the marker exists (#2121).
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

## Runner registration — the one manual, owner-gated step

`cloud-init` installs the GitHub Actions runner package (via the
`ds-stage-bootstrap` unit) and a systemd unit (`ds-actions-runner.service`) but
leaves the latter **disabled**, because a registration token is a live credential and
cloud-init cannot hold one. The unit reads `/etc/ds-platform/runner.env`, a root-only
file cloud-init deliberately does not create, and
`ExecStartPre=/opt/actions-runner/ensure-configured.sh` registers on first start and
is a no-op afterwards. `ds-actions-runner` also refuses to start until
`/var/lib/ds-platform/stage-bootstrap.done` exists, so run the step-2 bootstrap check
above first — otherwise `enable --now` reports a failed start condition.

```bash
# Owner, on the box. The token is short-lived (~1 h): GitHub → repo Settings →
# Actions → Runners → New self-hosted runner → the `--token` value shown there.
sudo install -m 0600 -o root -g root /dev/null /etc/ds-platform/runner.env
sudo tee /etc/ds-platform/runner.env >/dev/null <<'EOF'
RUNNER_URL=https://github.com/<owner>/ds-platform
RUNNER_TOKEN=<registration token from repo Settings -> Actions -> Runners>
RUNNER_NAME=ds-stage-1
RUNNER_LABELS=self-hosted,staging
EOF

sudo systemctl enable --now ds-actions-runner
systemctl status ds-actions-runner --no-pager
```

**Trust boundary.** The runner registers **outbound** (it long-polls github.com), so
the box exposes no inbound CI path, needs no deploy key and no CI-facing port 22 —
that is the whole reason it was chosen over SSH-from-CI (spec §10, lead decision
2026-09-08). What it can reach: the box env (`/etc/ds-platform/stage.env`, sinks and
test keys) and the box's Docker daemon. What it cannot reach: production Postgres and
Redis (no route — separate VPC), and any repository secret beyond the job's own
`GITHUB_TOKEN` — staging jobs are written to request nothing else. The repository is
private with outside-collaborator workflow approval on, so a fork PR never runs code
on this box without a maintainer's approval; the PR-job side of that contract is
step 6 (#2066).

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

**AC3 — the runner is online with the staging labels.**

```bash
systemctl is-active ds-actions-runner        # expected: active
gh api repos/<owner>/ds-platform/actions/runners \
  --jq '.runners[] | select(.name=="ds-stage-1") | {status, busy, labels: [.labels[].name]}'
# expected: status "online", labels contain "self-hosted" and "staging"
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
