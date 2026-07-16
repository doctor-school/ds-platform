# `tools/deploy/` — prod deploy tooling (DSO-126/127/128/129)

Idempotent, one-command production deploy for the always-on Timeweb environment
(api-prod public + data-prod private). Formalises the on-box runbook in
[`infra/deploy/README.md`](../../infra/deploy/README.md) §5–§10 — that README is
the operational SSOT; this directory is the executable form of its steady-state
steps. The **per-redeploy** path (`deploy:prod`) is **agent-run** (off-CI SSH,
ADR-0012), driven by the D+B trigger policy (release-cycle spec §10);
**first-time provisioning** (Terraform, DNS, secrets, Zitadel first-boot
bootstrap) is a one-time human setup, out of the steady-state loop.

| File                | `pnpm` alias           | Role                                                                                                                                            |
| ------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `prod.mjs`          | `deploy:prod`          | Full deploy pipeline + `--rollback <sha>` (app-only revert).                                                                                    |
| `smoke-prod.mjs`    | `deploy:smoke`         | Live prod HTTP + TLS smoke; also called by `prod.mjs` post-`up -d`.                                                                             |
| `release-notes.mjs` | `deploy:release-notes` | Aggregated PROD release note to Mattermost (#868); render+POST seam fired from CI on `deployment_status: success` (`release-digest.yml`, #968). |

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
9. **GitHub Deployment record (#942)** — after a successful deploy, record a
   `Deployment(production, sha)` + `success` status, persisting the release-notes
   digest into the Deployment payload. **Non-fatal**: it runs only once the deploy
   has already succeeded, so a `gh` failure prints a warning and the deploy exit
   code stays 0. The **Mattermost digest itself is no longer posted here** — the
   `success` status fires the `release-digest.yml` CI workflow, which posts it (see
   below, #968).

The **previous prod SHA** the Deployment-record digest ranges from is read from the
running `ds-api-prod-api-1` container's image tag (`ds-api:<sha>`) **before** the
build/up swap — the deploy record is the running image itself, no separate state
file. (The CI digest resolves its own prev-sha from the previous `release-*` tag —
see "Release digest → Mattermost" below, #975.)

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

## Release digest → Mattermost (`release-notes.mjs`, #868 / #968)

```bash
node tools/deploy/release-notes.mjs --prev-sha <sha|none> --new-sha <sha> [--dry-run]
```

Posts ONE aggregated **Russian, product-language** release note to the **same**
`MATTERMOST_WEBHOOK_URL` the per-PR notes use (`tools/ci/post-product-note.mjs`,
#654) — reusing its `extractNote` / `noteIsReal` / `labelsAreProductKind` /
`envFooter` seams so the guard, the per-PR note, and this digest read one source of
truth.

**Fired from CI, not from `deploy:prod` (#968).** The digest is a DEPLOY event, and
`deploy:prod` ships off-CI (ADR-0012) where `secrets.MATTERMOST_WEBHOOK_URL` does
not exist — so it never fired locally (the #950 `.env.local` fallback was a crutch,
now retired). Instead, `.github/workflows/release-digest.yml` triggers on
`deployment_status: success` for `environment: production` (the very Deployment the
deploy records, #942); `tools/ci/post-release-digest.mjs` resolves the
`<prev-sha>..<new-sha>` range and spawns this script with the CI secret in env. The
workflow also carries a manual **`workflow_dispatch`** trigger (optional `sha`
input; empty → the current prod deployed SHA, else HEAD) to re-fire a missed
digest. `--dry-run` renders offline for a local sanity check (no webhook needed).

**prev-sha is anchored on the previous RELEASE TAG (#975).** `post-release-digest.mjs`
resolves `prev-sha` to the commit of the latest `release-*` tag that is a **strict
ancestor** of `new-sha` (a tag AT `new-sha` is excluded), ordered by the tag's
`release-YYYY.MM.DD-<n>` date + same-day ordinal (`git tag --list 'release-*'
--merged <new-sha>`). With **no prior release tag**, the baseline is the repo-root
first commit (`git rev-list --max-parents=0`) so the range is the full history —
matching the GitHub Release's `--generate-notes`. This is the fix for the inaugural
empty digest: anchoring on the previous _Deployment_ instead made the first
release's range tooling-only (the prior deploy already carried all the product
work), so the digest wrongly said "no user-facing changes" while the Release notes
listed the full history. The digest a release announces must describe that release.

The message lists the `## Product note (RU)` section of every **product-kind**
(`feature` | `bug`) PR merged in the `<prev-sha>..<new-sha>` range, carrying the
same **PROD** environment footer (#657); a valid range with no product PR posts a
one-line «технический релиз». The range is deterministic from git + PR data:
commit subjects → the **LAST** `(#N)` per subject (the squash-merge number) →
`gh pr view`. Notes are embedded **verbatim** via `JSON.stringify({ text })` — no
shell, no interpolation — so a `$(...)`/backtick in a note cannot execute.

- **`MATTERMOST_WEBHOOK_URL`** — `process.env`-only, injected by the
  `release-digest.yml` workflow step from `secrets.MATTERMOST_WEBHOOK_URL` (#968).
  There is no `.env.local` fallback (the #950 crutch is retired). Unset → log +
  **skip green** (exit 0), same posture as the per-PR delivery.
- **`DELIVERY_ENV`** unknown/unset → **fail loud** (exit 1); the deploy passes
  `DELIVERY_ENV=prod`. For a standalone `--dry-run`, pass `DELIVERY_ENV=prod`.
- **`--dry-run`** — compose and print the `{ text }` to stdout; never POST, no
  webhook required.
- First deploy (`--prev-sha none`) / redeploy (`prev == new`) / a bad anchor
  (`git log` non-zero) → log + **skip green** — never a fabricated all-history
  range, never a broken deploy.

## Release record cycle

A successful deploy leaves a durable, queryable trail. Every record step is
**non-fatal by contract** — it runs only once the deploy has already succeeded,
so a `gh`/webhook hiccup prints a warning and the deploy exit code stays 0.

| Record                | When                                                             | Source / how                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **GitHub Deployment** | end of `deploy:prod` (#942)                                      | `deployment-record.mjs` posts a `Deployment(production, sha)` + `success` status carrying the release-notes digest; `log_url` = `/v1/health`.                                                                                                                                                                                                                                                                                                                            |
| **Git tag + Release** | `deploy:prod` success, before the Deployment record (#996/§10.5) | The agent-run deploy is the release **initiator** (Option A): it cuts `release-YYYY.MM.DD-n` + a GitHub Release with auto-generated notes (`--generate-notes` since the previous release) at the **deployed SHA** via `cut-release.mjs` → `cutDeployRelease`. Skipped green on a redeploy of an already-released SHA (non-empty-range guard). The `Version Packages` merge no longer cuts a repo-level release — it maintains per-package version + `CHANGELOG.md` only. |
| **Mattermost digest** | CI `deployment_status: success` (#868/#968)                      | `release-digest.yml` fires on the production Deployment's `success` status (or a manual `workflow_dispatch`); `tools/ci/post-release-digest.mjs` anchors `<prev>` on the previous `release-*` tag (repo-root baseline if none, #975) and posts via `release-notes.mjs`. Webhook = `secrets.MATTERMOST_WEBHOOK_URL` (CI only).                                                                                                                                            |

**`## Project reality` reads these at SessionStart.** The bootstrap (#939)
derives the latest release (from Releases/tags), the currently deployed SHA (the
latest production **Deployment** ⋈ the live `/v1/health` `version`), and the
**merged-not-deployed** delta (product PRs merged into `main` but not yet
present in the deployed SHA). A non-empty delta is the cue to `pnpm deploy:prod`
(runbook: skill `run-prod-deploy` / `/deploy`).

**Exit-code hygiene.** `deploy:prod` (and any deploy/merge/migrate command) runs
as its **own statement** — never `pnpm deploy:prod | tee log`: a pipe returns the
pipe's exit code (`tee`'s 0) and masks a non-zero deploy failure. Redirect with
`> log 2>&1` and check `$?` if a transcript is needed.
