# `tools/deploy/` — prod deploy tooling (DSO-126/127/128/129)

Idempotent, one-command production deploy for the always-on Timeweb environment
(api-prod public + data-prod private). Formalises the manual on-box runbook in
[`infra/deploy/README.md`](../../infra/deploy/README.md) §5–§10 — that README is
the operational SSOT; this directory is the executable form of its steady-state
steps. **First-time provisioning** (Terraform, DNS, secrets, Zitadel first-boot
bootstrap) stays manual; these scripts are the **per-redeploy** path.

| File             | `pnpm` alias   | Role                                                                |
| ---------------- | -------------- | ------------------------------------------------------------------- |
| `prod.mjs`       | `deploy:prod`  | Full deploy pipeline + `--rollback <sha>` (app-only revert).        |
| `smoke-prod.mjs` | `deploy:smoke` | Live prod HTTP + TLS smoke; also called by `prod.mjs` post-`up -d`. |

## `pnpm deploy:prod`

```bash
pnpm deploy:prod                    # deploy origin/main (default)
pnpm deploy:prod --rollback <sha>   # app-only rollback to a prior SHA-tagged image
pnpm deploy:prod --skip-ci-check    # escape hatch (loud warning)
```

Pipeline, fail-closed, stops at the first red step and prints a rollback pointer:

1. **Pre-flight (DSO-126)** — clean working tree · `HEAD == origin/main` · **green
   CI** for that SHA (latest check-run per name via
   `gh api …/commits/<sha>/check-runs`). Refuses otherwise. Fixes the deployed
   commit to `origin/main`'s SHA.
2. **Ship** — `git archive <sha>` streamed over SSH to both boxes (no registry,
   no deploy key). Streams are piped in-process → Windows-safe.
3. **data-prod** — `docker compose up -d --build` (idempotent).
4. **Checkpoint (DSO-129)** — pgbackrest **pre-migrate `incr` backup** (the same
   `backup.sh` cron runs) **before** `migrate`, so a restore anchor exists at the
   pre-migrate state. Pairs with the **expand/contract** prod migration rule
   (README) so an app rollback never needs a DB rollback.
5. **api-prod** — `migrate --build` (the migrate image is rebuilt from the
   freshly shipped tree — a reused stale image would apply old migrations) →
   `build` → `up -d`; images SHA-tagged **`ds-api:<sha>` / `ds-portal:<sha>`**
   (DSO-127) via a `DEPLOY_SHA` `.env` the script writes beside `compose.yml`.
   Then **`caddy reload`** (fallback: `restart caddy`) — the Caddyfile is a bind
   mount `up -d` never re-reads, so Caddyfile-only changes go live without a
   manual restart (#751).
6. **Truthful-success verify** — the script polls `docker inspect` on-box until
   the RUNNING api + portal containers carry exactly `ds-*:<sha>` **and** report
   healthy (≤ 4 min); otherwise the deploy is FAILED, never "OK". (Added after
   the DSO-127 rework: a stdin-swallowed `bash -s` script silently skipped
   `build`/`up -d` while the deploy still printed success — all remote scripts
   now drain stdin fully before executing.)
7. **Retention (DSO-127)** — keeps the last **3** SHA-tagged images per repo.
8. **Smoke (DSO-128)** — `smoke-prod.mjs --expect-sha <sha>`; the health probe
   requires `version` to be **present and equal** to the deployed SHA (an absent
   version is a FAIL — it means the expected build is not what's live).

The **deployed SHA is queryable over HTTP**: `GET /v1/health` → `{"version":…}`
(from the api's `DEPLOY_SHA` env). `--rollback` `up -d`s an already-present prior
image tag with **no** rebuild / migrate / DB change.

## `pnpm deploy:smoke`

Probes the three public origins end to end over real TLS: `api.doctor.school`
`/v1/health` (+ optional `--expect-sha` assertion) & `/v1/ready`,
`app.doctor.school/`, `id.doctor.school/ui/v2/login/loginname` (the login entry —
the bare `/ui/v2/login` 404s per Caddy's sub-path routing), and cert
validity/expiry on all three hosts. Exit non-zero on any failure. Hostnames default to the prod
vhosts and are env-overridable (`PROD_API_HOST` / `PROD_PORTAL_HOST` /
`PROD_ID_HOST`) for a staging clone.

SSH host aliases (`ds-api-prod`, `ds-data-prod` via ProxyJump) resolve from
`~/.ssh/config`; overridable via `DS_API_PROD_SSH` / `DS_DATA_PROD_SSH`.
