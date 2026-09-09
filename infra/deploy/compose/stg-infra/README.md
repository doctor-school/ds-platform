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
| Any production credential | `stage.env` carries sinks and vendor test keys only — see the acceptance grep below.                                                   |

## Prerequisites (owner, once)

1. `terraform apply` in `infra/deploy/terraform/` creates `stage-1` (own VPC, no
   route to `twc_vpc.ds`). Provider write actions are owner-gated — AGENTS.md §6.
2. `ssh deploy@$(terraform output -raw stage_1_public_ip)` works; cloud-init has
   finished (`cloud-init status --wait`).
3. The repo is checked out on the box at `/srv/ds-platform` (the `main` tree the
   slot script clones from).
4. `/etc/ds-platform/stage.env` written from `infra/deploy/stage.env.example`, mode
   `0600`, owner `root:root`.

## Bring-up order

The order matters twice: Zitadel refuses to boot before Postgres is healthy, and the
converge refuses to run before Zitadel is ready.

```bash
cd /srv/ds-platform/infra/deploy/compose/stg-infra

# 1. First bring-up ONLY: create the ds-bootstrap machine user + console admin.
#    Set IDP_BOOTSTRAP=1 in /etc/ds-platform/stage.env, then unset it afterwards —
#    the FIRSTINSTANCE_* block is read only on a fresh init.
sudo docker compose up -d --build postgres redis minio cerbos mailpit sms-sink sms-aero-adapter
sudo docker compose ps            # all healthy before continuing

sudo docker compose up -d idp
sudo docker compose logs -f idp   # wait for the init migrations to finish

# 2. Copy the bootstrap PAT out of the container tmpfs to a root-only file, and
#    place the login client's PAT where idp-login expects it (both OUTSIDE the repo
#    checkout, so a slot sync never wipes them).
sudo docker compose exec -T idp cat /pat/pat.txt | sudo tee /etc/ds-platform/idp-bootstrap-pat.txt >/dev/null
sudo install -m 0600 -o root -g root /etc/ds-platform/idp-bootstrap-pat.txt /etc/ds-platform/idp-login-client.pat

sudo docker compose up -d idp-login caddy
```

## Zitadel converge

The same idempotent read-before-write converge the dev stand and production use
(`infra/dev-stand/idp/provision.sh` + `idp-policy.mjs`, #1997) — no staging-specific
script exists or should. Run it after every bring-up and after any PR that changes
provisioning:

```bash
cd /srv/ds-platform/infra/dev-stand/idp
sudo env $(grep -v '^#' /etc/ds-platform/stage.env | xargs) \
  ./provision.sh --pat-file /etc/ds-platform/idp-bootstrap-pat.txt
```

Two standing rules come with the shared instance (spec §3 «Identity»):

- A PR that changes `provision.sh` or `idp-policy.mjs` is **serialized repo-wide like
  a migration** — one in flight; its preview converges the shared IdP and every other
  slot sees the change. The PR body says so.
- **Re-pass every redirect / post-logout URI**, never just the new one: the converge
  sends the URI set as a whole, so a partial list silently drops the others. This has
  bitten production twice (`infra/deploy/README.md`).

## Runner registration — the one manual, owner-gated step

`cloud-init` installs the GitHub Actions runner package and a systemd unit
(`ds-actions-runner.service`) but leaves it **disabled**, because a registration
token is a live credential and cloud-init cannot hold one. The unit reads
`/etc/ds-platform/runner.env`, a root-only file cloud-init deliberately does not
create, and `ExecStartPre=/opt/actions-runner/ensure-configured.sh` registers on
first start and is a no-op afterwards.

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
sudo docker compose ps                       # health of the shared set
sudo docker compose logs -f idp              # the usual suspect
sudo docker compose restart caddy            # after step 2 edits the Caddyfile
sudo docker compose up -d --build postgres   # after a postgres/Dockerfile change
```

`stg-infra` is never brought down to recycle a slot; slot lifecycle is
`tools/staging/slot.mjs` (step 4, #2064).

## Phase B acceptance (#2095)

The C1 acceptance criteria of spec §8 step 1, with the exact command for each. Run on
the box after `terraform apply` and the bring-up above; the output is pasted into
#2095 and cross-linked from the Phase A PR.

**AC1 — every shared service healthy.**

```bash
sudo docker compose -p stg-infra ps --format '{{.Service}}\t{{.State}}\t{{.Status}}'
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

**AC4 — no production credential on the box.**

```bash
sudo grep -nE '^(RESEND_API_KEY|SMSAERO_EMAIL|SMSAERO_API_KEY|SMARTCAPTCHA_SERVER_KEY|PGBACKREST_REPO1_S3_KEY|PGBACKREST_REPO1_S3_KEY_SECRET|PGBACKREST_REPO1_CIPHER_PASS|IDP_SMTP_REAL_HOST|IDP_SMTP_REAL_USER|IDP_SMTP_REAL_PASSWORD|IDP_SMTP_REAL_SENDER_ADDRESS|IDP_SMTP_REAL_SENDER_NAME)=.+' /etc/ds-platform/*.env
# expected: NO output (every one of these names is absent or empty).
# Then confirm the sinks are what is actually selected:
sudo grep -E '^(EMAIL_DELIVERY_MODE|SMS_DELIVERY_MODE|IDP_SMTP_HOST|IDP_SMS_SINK_ENDPOINT)=' /etc/ds-platform/stage.env
# expected: sink / sink / mailpit:1025 / http://sms-sink:8090/sms
```

**AC5 — the Zitadel converge is idempotent** (it will be re-run by every preview that
touches provisioning).

```bash
cd /srv/ds-platform/infra/dev-stand/idp
sudo env $(grep -v '^#' /etc/ds-platform/stage.env | xargs) ./provision.sh --pat-file /etc/ds-platform/idp-bootstrap-pat.txt
# expected on the SECOND run: only "already ..." lines, no converge writes
```
