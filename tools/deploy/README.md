# `tools/deploy/` — prod deploy tooling (DSO-126/127/128/129)

Idempotent, one-command production deploy for the always-on Timeweb environment
(api-prod public + data-prod private). Formalises the on-box runbook in
[`infra/deploy/README.md`](../../infra/deploy/README.md) §5–§10 — that README is
the operational SSOT; this directory is the executable form of its steady-state
steps. A production release runs in **Actions** (`deploy-prod.yml`, below): the
agent dispatches it on the owner's word in chat, and the box-side release driver
on ds-api-prod runs `prod.mjs --local` (release-pipeline tech spec
[`2026-10-16-release-pipeline-off-workstation-en.md`](../../apps/docs/content/specs/tech/2026-10-16-release-pipeline-off-workstation-en.md);
when to propose one: the D+B trigger policy, release-cycle spec §10). The
workstation command `pnpm deploy:prod` is **break-glass** only, run as `breakglass`
under the owner's offline key (hotfix `--ref`, `--rollback`, the gate exceptions);
**first-time provisioning** (Terraform, DNS, secrets, Zitadel first-boot
bootstrap) is a one-time human setup, out of the steady-state loop.

| File                       | `pnpm` alias           | Role                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prod.mjs`                 | `deploy:prod`          | The release pipeline: run box-local by the release driver (`--local`, the Actions path), or from the workstation as break-glass (`--ref`, `--rollback <sha>`, the gate exceptions).                                                                                                                                                                     |
| `smoke-prod.mjs`           | `deploy:smoke`         | Live prod HTTP + TLS smoke; also called by `prod.mjs` post-`up -d`.                                                                                                                                                                                                                                                                                     |
| `release-notes.mjs`        | `deploy:release-notes` | Aggregated PROD release note to Mattermost (#868); render+POST seam fired from CI on `deployment_status: success` (`release-digest.yml`, #968).                                                                                                                                                                                                         |
| `live-broadcast-check.mjs` | `deploy:check-live`    | Read-only live-эфир probe (`GET /v1/public/events`, spec §10.4 item 7): `CLEAR` exit 0 / `LIVE`+`UNKNOWN` exit 1 (fail-closed); also a `prod.mjs` pre-flight hold.                                                                                                                                                                                      |
| `deploy-probe.mjs`         | `deploy:probe`         | One-line box-reality probe (#905): health SHA + running api/portal/admin images/status over ssh; the STALLED watchdog message routes here.                                                                                                                                                                                                              |
| `rollback-floor.mjs`       | —                      | Rollback compatibility-floor guard (012 EARS-24, #1607): refuses a `--rollback` target that predates migration 0036 once prod has applied it (see below).                                                                                                                                                                                               |
| `idp-policy.mjs`           | —                      | Pure seams for the pipeline-owned IdP provision converge (#1997): the password-complexity read-back verdict and the `@ds/schemas` `PASSWORD_MIN_LENGTH` extraction consumed by `prod.mjs` (see step 5c).                                                                                                                                                |
| `release-gate.mjs`         | —                      | Release-blocker + open-batched-Stage-B pre-flight hold (#1662): probe + pure verdict consumed by `prod.mjs` (see below).                                                                                                                                                                                                                                |
| `stage-main-check.mjs`     | —                      | Stage `main` check (#2701): the last pre-flight step of a `--ref` hotfix — converge the stage `main` slot to the target and run the full stage suite from a clean checkout of it (see below). A `main` target reads the `stage-suite` status instead.                                                                                                   |
| `registry-retention.mjs`   | —                      | Container-registry retention (#3110), run only by `registry-retention.yml`: keeps the last 3 releases, the latest production deployment, the newest 3 `main` images, the newest green-`stage-suite` `main` commit (#3240; not found ⇒ deletes nothing), the open hotfix and PR heads, deletes the rest (`infra/deploy/README.md` → Container registry). |

## Release from Actions (`deploy-prod.yml`, #3158)

The normal production release runs in Actions, never from a workstation (spec
`apps/docs/content/specs/tech/2026-10-16-release-pipeline-off-workstation-en.md`
§3 item 3, §5 «Prod release driver.»). On the owner's word in chat the agent
dispatches it with that word verbatim:

```bash
gh workflow run deploy-prod.yml --ref main -f sha=<40-hex sha on main> -f owner_quote="<the owner's words>"
```

| Job         | What it does                                                                                                                                                                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `preflight` | refuses an empty / whitespace-only `owner_quote` first; then `node tools/deploy/release-runner.mjs preflight --sha <sha>`: SHA in `main` · `stage-suite` status success · CI green · release gate · live-broadcast gate · recorded `images-<sha>.json` exists                              |
| `deploy`    | Environment `production` (`deployment: false`): `ssh deploy@<api-prod> "release prod <sha>" < images-<sha>.json`, polls `status prod <sha>` (status lines only), then `release-runner.mjs record`: release cut on success + the ONE Deployment record (success or failure, with the quote) |
| `digest`    | on a newly recorded success only (`recorded=new`): calls `release-digest.yml` (`workflow_call`) with `MATTERMOST_WEBHOOK_URL` passed                                                                                                                                                       |

- **Same gates as the workstation path, no escape hatch.** The checks are the
  modules `pnpm deploy:prod` uses (`ci-gate.mjs`, `release-gate.mjs`,
  `live-broadcast-check.mjs`, `lib/registry.mjs`); `stage-suite` (set by
  `stage.yml`) replaces the operator's stage `main` check, as it does on the
  workstation path for a `main` target. `--skip-ci-check`,
  `--release-gate-exempt`, `--allow-live-broadcast` and `--ref` exist only on
  `pnpm deploy:prod` (break-glass); the rollback runs here in rollback mode
  (below), and `pnpm deploy:prod --rollback` stays its break-glass twin. The CI check drops the
  check-runs of `deploy-prod.yml` itself by workflow path (an earlier failed
  attempt on the same SHA is not CI).
- **One release at a time.** `concurrency: deploy-prod`, never cancelled — its own
  group, not the changesets workflow's `release`. A re-dispatch of the same SHA
  reattaches to the running driver unit (`attached`) or reports
  `already-succeeded`; to run a succeeded release of the live SHA again (an env
  file changed on the box) dispatch redeploy mode (below).
- **Record.** `deployment-record.mjs` `recordDeployment` writes the Deployment
  with `GITHUB_TOKEN`; the driver's `previousSha` is the basis of the
  Deployment-record notes. Events of `GITHUB_TOKEN` start no workflow, which is
  why the digest is called explicitly. A record that could not be written fails
  the job (`::error::`).
- **Lost contact.** When ssh to ds-api-prod fails four times in a row or the
  release does not finish within 60 min, the poll sets the verdict `unknown`
  before failing the job, and the record step writes the Deployment status
  `error` (GitHub's «could not determine», distinct from `failure`): the driver
  unit keeps running on the box. A re-dispatch of the same SHA records the
  verdict — it reattaches (`attached`) or answers `already-succeeded`. Before a
  success is recorded the runner reads the SHA's production Deployments: when one
  already carries a `success` status it prints `↷ already recorded` and writes
  nothing twice — no cut, no second record, no digest (`recorded=existing`); when
  only the `error` record exists it records the success, cuts and posts the
  digest as usual.
- **Secrets.** `PROD_SSH_KEY` + `PROD_SSH_KNOWN_HOSTS` live in Environment
  `production` (deployment branches `main`, no required reviewer) and reach only
  the `deploy` job.

### Redeploy mode (#3354)

When an env file on the box changed — the captcha toggle in `api.env` and the
compose `.env` (`infra/deploy/README.md`), a rotated key — the containers must be
recreated at the SHA production already runs. On the owner's word:

```bash
gh workflow run deploy-prod.yml --ref main -f mode=redeploy -f sha=<live sha> -f owner_quote="<owner word>"
```

- **Pre-flight** (`release-runner.mjs redeploy-preflight`): the `owner_quote` is
  not blank (env only, as in a release); the SHA has a production Deployment with
  a `success` status (it really was released); its `images-<sha>.json` is
  recorded. No stage-suite, CI, release-gate or live-broadcast check: the SHA
  passed them when it was released.
- **Deploy.** `ssh deploy@<api-prod> "redeploy prod <sha>" < images-<sha>.json`
  and the release's own poll of `status prod <sha>` (status lines only). The box
  driver runs the release's checks (role, manifest, on-main, registry digests,
  lock, rollback unit, lease) and refuses unless `<sha>` is the live prod SHA (the
  running `ds-api-prod-api-1`'s image tag): a newer SHA is a `release`, an older
  one a `rollback`, and the refusal names that mode. Where a release answers
  `already-succeeded`, a redeploy resets the finished unit and starts
  `ds-prod-<sha12>-driver` again — `_redeploy` runs the SHA's own
  `prod.mjs --local --redeploy` — and `ds-release` opens a fresh attempt (the
  closed, succeeded one is archived). The redeploy recreates the app tier only
  and follows the rollback's rule for box tooling and ds-data-prod (tech spec §5
  «Two trees» (a)): it **skips** `postgres-verify`, `install` (no `ds-release` /
  entrypoint / release-driver install, `installed-tree` stays the newest forward
  release's, no ds-data-prod converge), `data-prod-env`, `data-prod-up`,
  `backup`, the IdP converge and the migrate (`REDEPLOY_SKIPPED_STEPS` in
  `prod.mjs`), and ships the api-prod tree only. It **runs** the test-token
  refusal, the previous-SHA read, the runtime config backup, the api-prod ship,
  `pull`, boot verify, the edge config validate, the record-key check, the swap,
  runtime configs, `verify-running-sha`, `prune`, smoke and `finish` (ds-api-prod
  only). The swap is the durable step `recreate`,
  `docker compose up -d --force-recreate` with no migrate: Compose recreates on
  `up -d` only for a changed configuration or image, and its documentation does
  not count an `env_file`'s contents
  ([docker compose up](https://docs.docker.com/reference/cli/docker/compose/up/)).
  A redeploy while that unit runs attaches (`attached`) — and that running unit
  may be the SHA's _release_ run, which swaps with the bare `up -d` (no
  `--force-recreate`); the workflow still writes a redeploy record for it. The
  driver re-reads the live SHA under its lock, so a rollback that ended in
  between refuses the redeploy.
- **After a terminal status.** No release cut and no digest (no new code).
  `redeploy-record` writes a new Deployment record of every run —
  `redeploy @ <sha12> — «<quote>»`, payload `kind: redeploy` — even though the
  SHA's release record exists; lost contact records `error`, as a release does.
- **Fallback.** Break-glass `pnpm deploy:prod` re-ships the live SHA when Actions
  or the box driver is unavailable.

### Rollback mode (#2987)

When a release visibly broke production (failed post-deploy smoke, site or login
down) the agent rolls it off without an owner word (spec §3 item 3 «Rollback
mode», §9, §10 owner decision 2026-10-22) and reports to the owner at once:

```bash
gh workflow run deploy-prod.yml --ref main -f mode=rollback -f sha=<target sha> -f reason="<why>"
```

- **Pre-flight** (`release-runner.mjs rollback-preflight`): the `reason` is not
  blank (it reaches steps only through `env:`); the SHA is the target of one of
  the latest 3 `release-*` Releases (by date and sequence; drafts skipped); it is
  strictly behind the live SHA (the newest production Deployment with a `success`
  status; compare `<live>...<sha>` = `behind`); its `images-<sha>.json` is
  recorded. No stage-suite, release-gate or live-broadcast check. The box repeats
  the ancestry and release checks as the boundary and runs the migration floor.
- **Deploy.** `ssh deploy@<api-prod> "rollback prod <sha>" < images-<sha>.json`,
  then polls `rollback-status prod <sha>` (30 min, status lines only). The verdict
  (`release-runner.mjs rollback-verdict`) reads the `-rollback` unit state as well
  as the record: a dead, failed or absent unit is succeeded only with rc 0 and a
  `succeeded` record, so a unit that died with its record still `running` is a
  failure. Lost contact or the time-out is `unknown` → an `error` record.
- **After a terminal status.** No release cut, no digest. `rollback-record` writes
  the ONE Deployment record (`success` / `failure` / `error`) described
  `rollback to <sha12> — <reason>`, with the reason and the rolled-off SHA in its
  payload; `rollback-notice` posts «откат прода на <sha12>: <reason>» and the
  outcome to Mattermost through `release-notes.mjs` `postToMattermost`.
- **Runtime configs (#3274).** The rollback puts the target's `Caddyfile` and
  `centrifugo/config.json` (from the fetched target tree; the break-glass
  `--rollback` reads them with `git show <sha>:<path>`) into the live compose
  dir after keeping the running ones, validates them like a release before its
  `up -d` (invalid → the running configs go back on disk, nothing is rolled
  back), and applies them after the `up -d` with the same restore on failure.
  A rollback that dies between installing the target's configs and the `up -d`
  (the supersede or the `up -d` failing) puts the running configs back on disk,
  then compares the running mounts with them and reports the result: a service
  the `up -d` already (re)started serves the target's config and is named for a
  restart onto the restored file. When that restore itself fails, the target's
  configs stay on disk: the report names which service serves them and which still
  serves the running ones, and says to put the running configs back from
  `/var/lib/ds-platform/runtime-config/previous/` before any restart.
- **Break-glass stays on the workstation.** `pnpm deploy:prod --rollback`, the
  hotfix `--ref`, `--skip-ci-check`, `--allow-live-broadcast` and
  `--release-gate-exempt` are not on this path.

## Break-glass: `pnpm deploy:prod`

The workstation path, for what the release workflow deliberately does not do: a
hotfix `--ref`, a workstation `--rollback`, and the gate exceptions. It runs only
on the owner's word, under the owner's offline `breakglass` key: it connects to
ds-api-prod as `breakglass@ds-api-prod` (`deploy` there is the CI user, forced
command only), and to data-prod through that alias's ProxyJump as `breakglass` too
(`deploy` there holds only the hop key behind its forced command; SSH aliases, below). The pipeline below is the same one the release driver runs
box-local (`--local`); the workstation run adds the operator pre-flight (clean
checkout, the PC stage check of a `--ref`), the release cut and the Deployment
record.

```bash
pnpm deploy:prod                    # release origin/main (default)
pnpm deploy:prod --ref <sha>        # HOTFIX: ship exactly <sha>, not all of main (#1881)
pnpm deploy:prod --rollback <sha>   # app-only rollback to a prior SHA-tagged image
pnpm deploy:prod --skip-ci-check    # escape hatch (loud warning)
pnpm deploy:prod --allow-live-broadcast  # эфир-hold escape hatch (owner-approved urgent ship only)
pnpm deploy:prod --release-gate-exempt "<reason>"  # release-gate + stage-gate escape hatch (reason mandatory, printed)
```

Pipeline, fail-closed, stops at the first red step and prints a rollback pointer:

1. **Pre-flight (DSO-126)** — **stage `main` check prerequisites** first, `--ref`
   only (#2806 — below) · clean working tree · `HEAD == origin/main` · **green
   CI** for that SHA (latest check-run per name via
   `gh api …/commits/<sha>/check-runs`, restricted to suites of repo-owned
   `.github/workflows/*` runs — GitHub-injected `dynamic/*` workflows such as
   Dependabot Updates are dropped by workflow `path`, never by name; unknown
   provenance still blocks — see `ci-gate.mjs`, #2077) · **no live broadcast**
   (`live-broadcast-check.mjs`, fail-closed — #1000, spec §10.4 item 7; the
   `--rollback` path skips this hold) · **release gate** (`release-gate.mjs`,
   #1662 — below) · **recorded images** (#2981 — below) · **stage gate**
   (#3198, release-pipeline spec §3 item 3): a `main` target's `stage-suite`
   commit status, posted by `stage.yml` in Actions, must be `success` — missing,
   pending or red refuses; read through `readStageSuiteProblem`
   (`release-runner.mjs`, the release workflow's own check), so the PC needs no
   stage credentials. A `--ref` target is no `main` push, so Actions never runs
   the suite for it: it keeps the **stage `main` check** (`stage-main-check.mjs`,
   #2701 — below). Refuses otherwise. Fixes
   the deployed commit to `origin/main`'s SHA — or, under `--ref <sha>`, to
   that commit (below).
   **Recorded images (#2981).** Before anything touches a box, the operator's
   `gh` resolves the `runtime-images.yml` run for the target SHA and reads its
   `images-<sha>.json` manifest (`lib/registry.mjs`, shared with the stage
   slots). A release accepts only a release build: a `push`/dispatch run on
   `main` (manifest `ref: "main"`) or on the `--ref` target's
   `hotfix/<N>-<slug>` branch (manifest `ref: "hotfix/<N>-<slug>"`), six
   release-namespace digest references (five for a target that predates `login`) (never `pr/`) for exactly that SHA. No run, a run still in progress, a failed run, an expired
   artifact or a bad manifest refuses with its cause — there is no build
   fallback and no flag to build. The same step checks (read-only,
   `sudo test -s`) that api-prod holds the pull token
   `/etc/ds-platform/registry-pull-token`, and refuses with the provisioning
   pointer if it does not. A `pr/<N>` manifest never reaches production.
2. **Ship** — `git archive <sha>` streamed over SSH to both boxes (compose files
   and configs; no deploy key). Streams are piped in-process → Windows-safe.
   Right before it, the **runtime config backup (#3274)** keeps the `Caddyfile`
   and `centrifugo/config.json` the running caddy / centrifugo serve (read through
   `docker exec cat`; a container that cannot be read falls back to its file on
   disk) in `/var/lib/ds-platform/runtime-config/previous/` (root 0700/0600),
   outside the tree the ship replaces. The backup records the SHA it was taken for:
   a re-entered run of that SHA keeps it, so a re-run never overwrites it with
   already-shipped bytes; the next SHA retakes it (a rollback records its own
   `rollback-<sha>` key).
3. **data-prod** — PostgreSQL guard before shipping and before persistence-plane
   mutations, then immutable inspected server/sidecar images with
   `up -d --no-build --pull never --wait`. Redis retains its normal `up` path.
4. **Checkpoint (DSO-129)** — pgbackrest **pre-migrate `incr` backup** (the same
   `backup.sh` cron runs) **before** `migrate`, so a restore anchor exists at the
   pre-migrate state. Pairs with the **expand/contract** prod migration rule
   (README) so an app rollback never needs a DB rollback.
5. **api-prod** — **pull** (#2981: nothing is built on the box; one `next build`
   beside live production on the swapless 8 GB box stalled the site for ~17 min
   on 2026-09-18, #2283): the box logs in with the pull token read from its
   root-only file inside its own shell, pulls each of the six recorded digests
   (five for a target that predates `login`), tags it **`ds-api:<sha>` /
   `ds-api-migrate:<sha>` / `ds-portal:<sha>` / `ds-admin:<sha>` /
   `ds-doctor:<sha>` / `ds-login:<sha>`** and logs out (trap + explicit); a tag
   that already carries its recorded digest is reused. Every tag's RepoDigests
   must then contain its manifest digest, or the deploy stops →
   **pre-swap boot verify (#1410)** → **IdP convergence/readback (#2149)** →
   `migrate` (`compose run`, no `--build`: the migrate image is the recorded
   `api-migrate` digest of the same SHA) → `up -d`. The compose
   (`infra/deploy/compose/api-prod/compose.yml`) has no `build:` and tags every
   `ds-*` image `${DEPLOY_SHA:?}` from the `DEPLOY_SHA` `.env` the script writes
   beside `compose.yml` (DSO-127) — a compose call without it is an error, never
   a build.
   Then compare the shipped `Caddyfile` and `centrifugo/config.json` with the
   files visible through the running containers and **restart only consumers
   whose bind mount is stale**. Both mounts are compared again after apply, so
   a mismatch fails the deploy instead of requiring a manual SSH step (#1175).
   A failed apply (restart or post-restart compare) puts the backed-up configs
   back, restarts caddy + centrifugo onto them, compares again and fails the
   release with that restore result (#3274).
   5a. **Pre-swap boot verify (#1410)** — between `pull` and `migrate`/`up -d`, the
   freshly pulled **`ds-portal:<sha>`, `ds-admin:<sha>` and `ds-doctor:<sha>`**
   (#1723) are each started as a
   throwaway detached container (`ds-bootcheck-<svc>`, no published port, no
   compose network, always removed) with the SAME `env_file` production uses, and
   must answer **non-5xx on `/`** from inside the container within 2 min — the
   same probe shape as the compose healthcheck. A non-booting image **aborts the
   deploy while the OLD containers are still up and serving**, and before the DB
   is migrated. This is the gap #1407 fell through: `next` 16.3.1 built cleanly,
   the containers swapped, and the public surface 502'd on a crash-loop until a
   human rolled back. The **api is deliberately not probed here** — it needs
   Postgres/Redis/Zitadel on the compose network, so a detached one-shot would go
   red for reasons unrelated to the image; it keeps its compose healthcheck plus
   step 6. CI's static twin is the `standalone-boot` job
   (`tools/ci/standalone-boot-check.mjs`), which boots the same standalone entry
   on every PR.
   5b. **Pre-swap edge config validate (#3274)** — right after the boot verify,
   before IdP, `migrate` and `up -d`: `caddy validate` of the shipped
   `Caddyfile` on the caddy image the shipped `compose.yml` pins (the command of
   `tools/ci/validate-caddyfiles.sh`, no published port), and the shipped
   `centrifugo/config.json` must parse as a JSON object (a JSON parse, not
   `centrifugo checkconfig`: its secrets come from the env file). Invalid →
   the backed-up configs go back on disk, so the tree matches what still runs,
   and the deploy stops: nothing was swapped, prod still serves the previous config.
   5c. **IdP provision converge + read-back (#1997/#2149)** — before migration
   and application replacement, while the previous application is serving, the pipeline runs
   `infra/dev-stand/idp/provision.sh` on api-prod with the `infra/deploy/README.md`
   step 9 environment (`api.env` sourced as root inside `sudo bash -c`; the script
   is idempotent read-before-write, so an unchanged script is a no-op that prints
   `already` / `no changes` per step). It then READS THE POLICY BACK on-box —
   `GET /admin/v1/policies/password/complexity` with the bootstrap PAT, which never
   leaves the box — and asserts `minLength` equals `@ds/schemas`
   `PASSWORD_MIN_LENGTH` **at the deployed SHA** (read via
   `git show <sha>:packages/schemas/src/auth/auth.schema.ts`, never a literal) with
   every character-class flag `false` — and because Zitadel's grpc-gateway/protojson
   surface omits proto3 defaults, an ABSENT flag reads as `false`, the same
   defaulting `provision.sh` step 8.sexies uses. It then reads back the code
   secret generators (`GET /admin/v1/secretgenerators/<type>`, step 8.septies,
   #2555/#2636) against the shape the TARGET commit's own `provision.sh`
   converges — `git show <sha>:infra/dev-stand/idp/provision.sh`. A target with
   `EMAILED_CODE_LENGTH` converges all four generators whose codes reach a user
   (`SECRET_GENERATOR_TYPE_VERIFY_EMAIL_CODE`, `…_PASSWORD_RESET_CODE`,
   `…_OTP_EMAIL`, `…_OTP_SMS`) to digits only; a pre-#2636 target with only
   `LOGIN_OTP_CODE_LENGTH` converges the `…_OTP_EMAIL` / `…_OTP_SMS` pair to upper
   letters + digits. The length must equal `@ds/schemas` `VERIFY_CODE_LENGTH` at
   the same SHA; the deploy asserts that length, the target's alphabet and an
   expiry present on every generator. The verify-email, password-reset and
   `…_OTP_EMAIL` expiries must also equal the lifetimes the code emails state —
   `VERIFY_EMAIL_CODE_LIFETIME_SECONDS`, `PASSWORD_RESET_CODE_LIFETIME_SECONDS`,
   `LOGIN_EMAIL_CODE_LIFETIME_SECONDS` in `apps/api/src/mailer/code-emails.ts` at
   the same SHA, which also render the email copy (#2814); `provision.sh` keeps
   the live expiry, so a drifted lifetime fails here. A target whose `provision.sh` has neither
   constant (a `--ref` hotfix to a commit before step 8.septies) never converges
   the generators, so the deploy prints the line
   `skipped: target provision.sh does not converge the code generators` and
   checks nothing there. The provisioner also compares SMTP
   public metadata (stable ID, description, host, TLS, sender and username) and
   reads back the active identity. HTTP success does not prove projection convergence.
   A failed converge, an unreadable read-back or a mismatch FAILS before the
   application is swapped. IdP writes are forward-only and may already have taken
   effect; an app-only rollback does not restore them. Closes the #1994 class: a converge step that lands in code and
   never reaches the instance (18 days of 422 registrations). The pure decision
   table lives in `idp-policy.mjs`; `--rollback` re-runs NO provisioning — converge
   steps are forward-only.
6. **Truthful-success verify** — the script polls `docker inspect` on-box until
   the RUNNING api + portal + admin + doctor containers carry exactly
   `ds-*:<sha>` **and** report
   healthy (≤ 4 min); otherwise the deploy is FAILED, never "OK". (Added after
   the DSO-127 rework: a stdin-swallowed `bash -s` script silently skipped
   `build`/`up -d` while the deploy still printed success — all remote scripts
   now drain stdin fully before executing.)
7. **Retention (DSO-127)** — keeps the last **3** SHA-tagged images per repo
   (`ds-api`, `ds-api-migrate`, `ds-portal`, `ds-admin`, `ds-doctor`) and drops
   the registry digest references (`<registry>/<image>@sha256:…`) a pull left
   behind once no kept tag shares their image — on the containerd image store
   they are records of their own and would keep pruned content on disk.
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

**Durable box steps (#2982).** Right after the ship, both boxes install
`/usr/local/bin/ds-release` from the shipped tree — together with
`/usr/local/bin/ds-deploy-entrypoint`, the forced command of the CI keys (#2984,
`infra/deploy/README.md` → SSH access model), by the same install step on the forward
run, the `--rollback` and every slot run — and the long box steps — data-prod
`up`, the pgbackrest pre-migrate `backup`, api-prod `pull`, `migrate` (migrate → up -d)
and the retention `prune` — each run as their own transient systemd unit
`ds-prod-<sha12>-<step>` instead of a streamed ssh command, so killing the operator
session no longer kills the step. The deploy starts (or attaches to) the unit, then polls
`sudo ds-release status prod <sha>` every 10 s and prints one status line per poll; the
full step log stays in the box's journal (`sudo journalctl -u ds-prod-<sha12>-<step>`).
Each box keeps its status file `/var/lib/ds-platform/release/prod/<sha>.json` (tech spec
2026-10-16 release pipeline §5) and takes its env lock `/run/ds-platform/ds-prod.lock` in
a root-owned 0755 directory, never the world-writable `/run/lock` (#3297); the release
driver locks `ds-release-driver-<env>.lock` there too when it runs as root (ds-api-prod),
in its own `/run/lock/ds-platform-deploy` as `deploy` on ds-stage-1. A lock directory that
is a symlink, foreign-owned or group/other-writable, or a lock file that cannot be opened,
is refused (exit 3) naming the path and its owner. The release stays open from the first
box step until it is closed after the smoke; any failure exit closes it as `failed`. Recorded verdicts
answer only within that open attempt: a re-run of the same SHA whose run never closed it
(the operator session died) returns each recorded verdict — backup and migrate are never
repeated — or reattaches to a step still running, and a step recorded as `failed` re-runs
only under `pnpm deploy:prod --retry-failed`. A closed attempt is archived
(`<sha>.<startedAt>.json`) and the next deploy of that SHA runs every step again; a deploy
of a new SHA marks the previous one `superseded`. While a release is open, a deploy of
another SHA is refused and names the open SHA; if a failed run could not close it (the box
was unreachable), close it by hand: `ssh ds-api-prod 'sudo ds-release finish prod <sha>
failed'` and, on ds-data-prod, its `finish` verb: `ssh ds-data-prod "sudo -n env
SSH_ORIGINAL_COMMAND='finish <sha> failed' /usr/local/bin/ds-deploy-entrypoint"`.
`--rollback` ships no tree, so it first installs `/usr/local/bin/ds-release` on ds-api-prod
from the operator checkout's `infra/deploy/bin/ds-release` (streamed over ssh,
sha256-checked); ds-data-prod keeps the entrypoint and `ds-release` its last release installed. It takes no lease, but it refuses,
naming the unit, while any `ds-prod-*` step unit still runs on either box
(`ds-release check prod`), and its `up -d` runs through `ds-release supersede prod`, under
the env lock, marking the recorded attempts `superseded` — so deploying the rolled-off SHA
again runs every step. The IdP converge, the boot and running-SHA verifies, runtime
configs and the smoke are unchanged.

**Stall detector (#905).** Every ssh channel carries keepalive flags
(`ServerAliveInterval=15` / `ServerAliveCountMax=4`), so a half-open TCP
connection (NAT flush, VPN flap) dies loudly in ~60s instead of hanging the
deploy forever. On top of that, every streamed remote step (`sshScript`) runs
under a per-step **no-output watchdog**: **5 min** for build-class steps
(the IdP converge), **2 min** for everything else. The durable steps above are
not streamed and so carry no watchdog: their poll tolerates six failed reads in a row,
then stops waiting — the unit keeps running and a re-run reattaches. Output flowing resets the timer — a normal long pull is
untouched. A step whose channel goes quiet past its budget is killed and the
deploy exits non-zero with a loud
`STALLED: <step> — no output for <N>m; remote work MAY have completed.` line.
A stall proves only the LOCAL channel went silent — the remote docker work may
have finished — so before any re-run or rollback, check box reality:

```bash
pnpm deploy:probe   # → LIVE health=<sha> api=ds-api:<sha>(Up_…_(healthy)) portal=… admin=…
```

One machine-parseable line: `LIVE` (health endpoint + ssh both answered),
`DEGRADED` (one answered; the dead source prints `health=UNREACHABLE` /
`containers=UNREACHABLE`), `UNREACHABLE` (neither). Bounded timeouts (10s
fetch, 30s ssh) — the probe itself can never hang; exit 0 for every verdict
(the exit code reflects whether the probe ran, not box health). Hand fallback:
`curl -fsS https://api.doctor.school/v1/health ; ssh ds-api-prod docker ps`.

The **previous prod SHA** the Deployment-record digest ranges from is read from the
running `ds-api-prod-api-1` container's image tag (`ds-api:<sha>`) **before** the
pull/up swap — the deploy record is the running image itself, no separate state
file. (The CI digest resolves its own prev-sha from the previous `release-*` tag —
see "Release digest → Mattermost" below, #975.)

The **deployed SHA is queryable over HTTP**: `GET /v1/health` → `{"version":…}`
(from the api's `DEPLOY_SHA` env). `--rollback` `up -d`s a prior image tag with
**no** build / migrate / DB change. The tag is normally still on the box
(retention keeps 3); a target older than that is pulled from **its** recorded
`main`/`hotfix/*` manifest exactly as a deploy pulls (same token check, digest proof and
logout), and a target without one refuses with that cause.

### Hotfix deploy (`--ref <sha>`, break-glass)

`pnpm deploy:prod` ships the WHOLE `deployedSha..origin/main` range: one fix
cannot be shipped without everything else merged since. When prod needs a single
already-merged fix and the rest of `main` is not ready, `--ref <sha>` ships
exactly that commit instead (#1881, release-cycle spec §10.11).

**Images come from the hotfix branch's own `runtime-images` run (#2981).** api-prod
builds nothing; `runtime-images.yml` also runs on every push to `hotfix/**`, pushes
the six images under the release namespace (no `pr/` prefix) and records
`images-<sha>.json` with `ref: "hotfix/<N>-<slug>"` (a branch name of any other
shape fails that run). The release pre-flight — and the stage `main` check, which
converges slot `main` to the same target — accepts that manifest for exactly the
target SHA. The manifest proves the images; the `--ref` invariants below still
prove the cherry-pick ancestry, independently.

The target is a `hotfix/<N>-<slug>` branch cut FROM the deployed SHA carrying
cherry-picks of already-merged squash commits — never a feature branch. On top of
the normal pre-flight, `--ref` mode asserts (`tools/deploy/hotfix-ref.mjs`, pure
seams + `hotfix-ref.test.mjs`):

1. **`--ref` takes a SHA**, not a branch name or tag, and never combines with
   `--rollback` — both fail before any network call.
2. **The commit exists on `origin`** — resolvable after `git fetch origin` AND
   reachable from some `origin/*` branch (`git branch -r --contains`). A local-only
   commit can never reach prod.
3. **Strict descendant of the LIVE deployed SHA** (`/v1/health → {version}`, the
   same ground truth the release gate uses — not the Deployment record). Rewinding
   prod is `--rollback`, not `--ref`.
4. **Every commit in `deployed..target` is a cherry-pick of `origin/main`** —
   Native `git cherry` equivalence is the fast path. Otherwise one canonical
   `git cherry-pick -x` receipt must name a single-parent source on `origin/main`.
   Git must cleanly replay it onto the target parent and produce EXACTLY the
   target tree. Conflicts, extra edits, merge commits, missing/ambiguous receipts
   and Git errors refuse. The proof uses `merge-tree --write-tree --merge-base`
   without changing the checkout/index; unsupported Git versions fail closed.
5. Green CI for the target SHA, the live-эфир hold and the release gate run
   unchanged. The release gate's range is already `<live deployed>..<target>`, i.e.
   exactly the hotfix range, because its basis is the LIVE prod SHA.

CI for a hotfix branch comes from `gh workflow run ci.yml --ref hotfix/<N>-<slug>`
(the `workflow_dispatch` trigger takes the same non-PR path as `push: main`); wait
for that run to go green before deploying. Pushing the branch starts its
`runtime-images` run on its own; wait for it to succeed too (`gh run list
--workflow runtime-images.yml --branch hotfix/<N>-<slug> --limit 1`) — until it
has, the pre-flight refuses with «retry when it completes». Ship/banner lines read
`hotfix @ <sha> (base <deployed>)`, never `origin/main`, and the release is cut
with a `— Hotfix` title plus the cherry-picked PR list.

**The per-service verify set comes from the TARGET tree** (`service-set.mjs`,
#1896). Which SHA-tagged images the deploy boot-probes before the swap
(#1410), asserts running afterwards (`verifyRunningSha`) and smokes is parsed out
of `git show <target>:infra/deploy/compose/api-prod/compose.yml` — the same
compose the on-box `up` consumes — not out of the local checkout (a profiled
one-shot such as `migrate` is not in the set). A hotfix based
on a SHA that predates a service therefore verifies only the services that exist
there: a base older than the `ds-doctor` storefront (#1860) verifies
`api + portal + admin` and skips the doctor smoke probes, instead of demanding a
fourth image that cannot exist at that SHA (the first live `--ref` run died on
exactly that: `doctor=NOSTART`). The derivation is fail-closed — an unreadable,
empty or port-less set dies before any ssh, never "probe nothing". Image
retention stays box-wide on purpose: it must reclaim old tags of every repo the
box has ever pulled, including one absent from the hotfix target's compose.

What stays forbidden: deploying an arbitrary branch, a feature preview, or any
commit not yet merged to `main`. `--ref` narrows the range; it does not widen what
is deployable.

One case still needs the full train rather than `--ref`: **removing a service.**
The pre-flight only lets the target be a strict descendant of the live SHA, so a
shrinking service set means the service was deliberately deleted — its container
then survives as a compose orphan while the shipped older Caddyfile stops routing
it, and the derived smoke no longer probes it. The deploy goes green with a public
vhost dark. Ship a service removal on `origin/main`, never as a hotfix.

## Box-local release (`--local`, the prod release driver, #3157)

Tech spec `apps/docs/content/specs/tech/2026-10-16-release-pipeline-off-workstation-en.md`
§5 «Prod release driver». The release workflow does not run `pnpm deploy:prod`: it sends
`release prod <sha>` with the recorded `images-<sha>.json` on stdin to ds-api-prod, whose
release driver (`infra/deploy/bin/release-driver`, see `infra/deploy/README.md` → SSH
access model) checks the manifest and both provenances, takes the `ds-release` lease and
starts the unit `ds-prod-<sha12>-driver`. The unit downloads the codeload tree of exactly
that SHA and runs

```bash
node <tree>/tools/deploy/prod.mjs --local --images-file -   # `-`: the unit's stdin
```

`--local` takes no other flag: a hotfix (`--ref`), `--rollback` and every escape hatch
stay on the operator path above.

- **The same plan.** `deploy()` walks `DEPLOY_PLAN` (`prod.mjs`) with a cursor that
  refuses any other order; `--local` runs every phase of it minus `OPERATOR_ONLY_STEPS`
  — the pre-flight (checkout, `gh`, CI, gates, the stage check), the release cut and the
  Deployment record, which the release workflow runs before and after the box. The smoke
  stays inside the run before `finish`: a red smoke ends the release `failed`.
- **Transport.** api-prod is the box itself (`LOCAL_EXECUTOR`, `lib/remote.mjs`);
  data-prod is `deploy@<data-prod VPC IP>` (`DS_DATA_PROD_VPC_IP`, default `192.168.0.10`)
  with `-i /home/deploy/.ssh/data-prod-hop`, `IdentitiesOnly`, `BatchMode` and
  `StrictHostKeyChecking=yes` (`hopDestination`) — the hop the operator's ProxyJump takes.
  Both reach ds-data-prod only through the data verbs of `ds-deploy-entrypoint`
  (`lib/data-prod.mjs`; spec §5 «Data-prod verbs.», #3313): `postgres-probe`,
  `postgres-checkpoint`, `ship`, `install`, `data-env`, `data-up`, `backup`,
  `backup-info`, `rollback-floor`, `finish`, `check`, `supersede`, `converge`,
  `capabilities`. A
  payload is one JSON object or the tree archive on stdin, checked box-side; no script
  travels. Each run mode takes one command form (`DATA_PROD_FORM`): the `--local` run
  sends the verb as the ssh command, to the forced command of the hop key; the
  workstation path's `breakglass` shell login sends it through `sudo -n`. The client asks
  `capabilities` once per run in that form only; a form that does not answer refuses the
  run (the other form is never tried) — `capabilities` must name every verb.
  **Converge (#3320):** right after its data `install` and before `data-prod-env`, the
  `--local` run converges ds-data-prod itself (`client.converge()`), every release: the
  `converge <sha>` verb, through the forced command, installs the shipped box entrypoints
  and runs the root-owned `harden-ssh.sh --role data --from-release`; the run then asks
  `capabilities` again and goes on only when the verb exited 0 and the forced command
  answers. The forced command answering alone is no proof — a converge stopped after the
  hop rewrite is finished by the next one. A refused or failed converge fails the run
  before any data-prod state change, after a re-probe so `finish … failed` still lands.
  The log shows `↻ ds-data-prod: converge <sha12>: …` then `✓ … converged`; a
  converged box prints `nothing to change`. The workstation path never converges. No owner
  server step is in the path.
- **No downgrade.** The driver (before it starts the unit) and the run itself (right
  after its previous-SHA read) refuse a SHA that does not descend from the live prod SHA,
  the running `ds-api:<sha>` tag: GitHub `compare <live>...<sha>` must answer `ahead` or
  `identical`. A downgrade is a rollback (`--rollback` and its migration floor); an
  unknown live SHA (no running api) releases from the workstation path.
- **The target from the tree.** The service set, the IdP expectations and the PostgreSQL
  target are read from the extracted tree instead of `git show` (codeload honours
  `export-ignore` as `git archive` does), and the ship tars that tree to both boxes.
- **`previousSha`.** The previous-SHA read also records the running SHA through
  `release-driver record-previous prod <sha> <prev|none>` (the first basis recorded for
  a SHA is kept); `status prod <sha>` reports it as `driver.previousSha`, the
  basis of the Deployment-record notes the runner writes (spec §5).

The unit's whole output stays in its journal (`journalctl -u ds-prod-<sha12>-driver`);
the runner sees status lines only.

## Docker Hub login on the boxes (#2240)

Since #2981 step 5 builds nothing on `api-prod`: our own images come from the
project registry (`ds-platform.registry.twcstorage.ru`, pull token
`/etc/ds-platform/registry-pull-token`, `infra/deploy/README.md` → «Container
registry»). Docker Hub is still where the upstream pins come from — `caddy`,
`centrifugo`, `zitadel`, `node` for the sms-aero adapter, and data-prod's base
images — whenever one of them is bumped. When the boxes built on-box, every deploy
also pulled base images from Docker Hub. Anonymous pulls are capped at **100/h keyed on the source IP**, and
Timeweb hands every tenant the same shared IPv6 /64 (`2a03:6f00:a::`) — the budget is
spent by strangers. `release-2026.09.16-1` died mid-`build` on `429 Too Many Requests`
(also seen on stage-1, 2026-09-15/16/17). `deploy:prod` has no retry for it and should
not have one: the box is simply expected to be logged in.

Both boxes are logged in as the project Docker Hub account, which re-keys the quota to
the account (200/h):

```bash
ssh -t <box> 'sudo docker login -u bbmacademy'   # Read-only PAT, typed at the prompt
```

The token is a Read-only Docker Hub Personal Access Token with no expiry; it lives only
in `/root/.docker/config.json` on each box (docker runs via `sudo`, so the login belongs
to root) and never in this repo, an env file or a chat. Pre-flight check when an
upstream pull dies on 429: `ssh <box> 'sudo docker pull node:24-slim'` must succeed, and a
registry token request with the box's credentials reads `ratelimit-limit: 200;w=3600` /
`docker-ratelimit-source: bbmacademy` instead of the anonymous `100;w=3600`. A recreated
box starts anonymous again — see `infra/deploy/README.md` → «Docker Hub login on every
box». The Docker Hub login and the project-registry pull token are separate
credentials: the first lives in root's docker config for upstream pins, the second
only in its root-only file, used and logged out within each pull.

## PostgreSQL deployment guard (#2141)

Ordinary releases retain the initialized same-major cluster. Before the first
remote write, `prod.mjs` verifies the committed target contract against read-only
SQL, Docker image/mount inspection, both `PG_VERSION`/control files and the active
pgBackRest stanza identity. Unknown or stopped evidence, a different major,
missing PGDATA, changed volume, replacement cluster or inconsistent sidecar
refuses deployment. The check runs again before each guarded step. No environment
override authorizes a major migration; that procedure remains #2101.

Unchanged data inputs and currently running images need no certificate. A first
successful guard adopts the exact inspected running immutable image IDs and
records the accepted input snapshot hash and system identifier in
`~/ds-platform-postgres-state.json`, outside the archive replacement boundary.
This bootstrap is not evidence that the remote Dockerfile built legacy images:
those images carry no historical build-source label. Their actual runtime and
pending configuration paths must pass the guard, and activation reuses their
exact IDs without building or pulling. Any later input change needs certification.
The record advances only after the target images start and pass read-back. An
interrupted tree shipment therefore cannot be mistaken for a completed image
update on re-entry. An interrupted/stopped or drifted cluster fails closed;
diagnose it through read-only evidence and resume the reviewed operation. Do not
delete or hand-edit the record to clear a refusal.

Changed data build/configuration requires a generated same-major artifact
certificate. The source hash covers the committed data compose and all files in
its postgres/pgbackrest build contexts. Preparation sends only those infra
contexts to an explicitly selected Docker host, labels the resulting images,
executes their real PostgreSQL version and UID commands without a cluster,
checks image PGDATA and matching UIDs, and exports the exact built images:

```bash
node tools/deploy/postgres-artifact-prepare.mjs --host <approved-build-host> --ref <commit> --output <certificate.json> --export <images.tar> --audit-log <commands.jsonl>
```

The data compose is JSON in a `.yml` path (#3157): Compose reads JSON as YAML, and
the guard parses it with `JSON.parse`, so the box-local release from a bare tree
needs no npm parser. The rewrite to JSON kept every value but changed the bytes, so
the source hash: the first release carrying it needs this one-time certification,
on the operator path (`prod.mjs --local` takes no `--postgres-artifacts`).

This is a separate, audited build operation, not permission to mutate production.
The exported images must already be available on the deployment host through the
authorized artifact delivery operation; a missing image is a refusal, never an
implicit pull or rebuild. Preserve the certificate with the exported image
archive. Image IDs, source labels, declared major, measured version and PGDATA
must all match. The preparation images use the `org.doctor-school.task=2141`
label and remain available for export; remove only those owned image IDs when
their retention is no longer needed. Probe containers use `--rm`, no network,
read-only roots and no live mounts.

```bash
node tools/deploy/postgres-artifact-check.mjs --ref <commit> --certificate <certificate.json> --audit-log <commands.jsonl>
pnpm deploy:prod --postgres-artifacts <certificate.json>
```

Omit `--certificate` for read-only validation of the unchanged deployment. The
check command uses the normal `DS_DATA_PROD_SSH`/SSH alias, reaches ds-data-prod only
through its `postgres-probe` verb (the box's installed probe; any release after #3313
installed it) and never calls deploy,
build, init, stanza-create or SQL writes. The deploy writes an image-ID-only
compose overlay after the guard, disabling PostgreSQL build/pull at activation;
this prevents an uninspected on-box rebuild from replacing a verified artifact.
Certificates are evidence generated from approved code/build access, not a
signature or a replacement for release authorization. Arbitrary alternate
entrypoints, external data volumes and unknown build contracts fail closed.

## The app-only rollback boundary (`--rollback`, #1896)

A rollback ships **no tree**: it re-points `DEPLOY_SHA` and restarts, so
`docker compose up -d` runs against the compose the LAST DEPLOY left on the box —
newer than the rollback target. A service the target predates is still declared
there as `ds-<svc>:${DEPLOY_SHA:?}`, and no image of it exists for the rollback
SHA (no recorded digest serves it), so a «ROLLBACK OK» would be untrue for that
surface.
So `rollback()` derives two sets — the target's compose (`git show`) and the compose
file **on the box** (`cat …/api-prod/compose.yml` over one read-only ssh channel —
the very file `up -d` consumes) — and refuses before any state change when the box
declares a service the target lacks, naming it (`rollbackBoundaryVerdict`). The
live set is deliberately NOT read from `/v1/health`: an emergency rollback runs
exactly when the api is down, so the guard must not depend on it. An unreadable
box compose is a refusal too. Crossing a service-introduction boundary backwards
is a forward fix or a `--ref` deploy of a tree that actually declares the wanted
state, never an app-only rollback.

## Rollback compatibility floor (`rollback-floor.mjs`, 012 EARS-24 / #1607)

`--rollback` swaps the app image while the database stays where it is. That is
safe only while the older image can still read what the newer one wrote. The
speaker cutover breaks that symmetry once and for all: migration
`0036_speaker_cutover.sql` DROPS `event_speakers`, so a pre-cutover image reads a
table that no longer exists and **some prior SHAs stop being valid rollback
targets permanently**.

The floor is keyed on that migration, on both sides of the comparison — the
earlier design keyed it on a database singleton (`speaker_migration_cutover`)
that the same migration drops, so that SSOT cannot survive its own cutover:

- **prod side** — `public.event_speakers` is ABSENT ⇔ 0036 has been applied
  (one read-only `to_regclass` probe on data-prod);
- **target side** — the rollback target's tree carries
  `apps/api/drizzle/0036_speaker_cutover.sql` ⇔ its image knows the post-cutover
  schema (`git cat-file -e <sha>:<path>`, resolved at deploy time — no constant
  to update by hand).

No release-tag ranking is involved: an untagged but post-cutover target is judged
on the property that actually matters. The guard is the **first step inside
`rollback()`**, before the image-presence probe and before any `.env` rewrite or
`up -d`. Nothing on the box is touched until it returns.

It **fails closed** — every refusal aborts the rollback with its code:

| Code                      | Meaning                                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `FLOOR_UNREADABLE`        | The prod probe could not answer whether `event_speakers` still exists. An unknown state is never treated as "no floor". |
| `TARGET_STATE_UNRESOLVED` | The target commit could not be inspected locally, so it cannot be proven at or above the floor.                         |
| `TARGET_BELOW_FLOOR`      | The target's tree has no migration 0036. Roll **forward** instead; this rollback cannot be made safe.                   |

Two cases are allowed, each named in the verdict: `cutover-not-applied` (prod
still has `event_speakers` — the floor does not exist there yet) and
`at-or-above-floor`.

`rollback-floor.test.mjs` (`node --test`, run by `pnpm test:tools`) covers the
whole decision table against injected readers — no ssh, psql or provider calls.

## Release gate (`release-gate.mjs`, #1662)

`main` is deployable **by default** (release-cycle spec §10): a merged PR found
broken ahead of its fix is REVERTED from `main`; when a revert is
disproportionate, the fix Issue is a scoped prerequisite of that PR. Reserve
`release-blocker` for evidenced hazards to ANY deployment, including unrelated
hotfixes. Record the universal risk, why narrower controls are insufficient,
and the exit condition. Reassess before each release and after new evidence;
remove an obsolete global label with an evidence comment, keeping unfinished
work open. Deferred work or a CI flake alone does not justify a global hold.
The pre-flight turns that norm into a machine check and **holds the deploy** while any
signal stands:

1. **`release-blocker`** — any OPEN Issue carrying the label holds every deploy.
   The failure names each blocking Issue number + title.
   (`gh issue list --label release-blocker --state open`.)
2. **Open batched Stage-B gate** — a **merged-but-not-yet-deployed** PR carrying
   `Stage-B: batched at #<gate>` (the AGENTS.md §6 batched carve-out) has by
   construction NOT been live-verified by the product owner; shipping it would
   consume a deferral granted only for _merging_. The failure names each
   **PR → gate** pair. The marker is read from the **same accepted-source set
   the merge guard enforces** (`tools/lint/stage-b-lint.ts`): the **PR body OR a
   comment on any Issue the body links with a `Closes #N` keyword** — a
   body-only read would print "clear" for a PR that legitimately merged on a
   linked-Issue record. The merged-undeployed delta is enumerated the way the
   `## Project reality` bootstrap section does it (`tools/project-reality.ts`
   step 4): basis = the **live** deployed SHA (`GET /v1/health → {version}`,
   ground truth) falling back to the latest `production` GitHub Deployment SHA
   (recorded intent) — `healthSha ?? deploymentSha`, the same rule as step 4 —
   range `<basis>..origin/main`, PR numbers via the shared `extractPrNumbers`
   seam of `release-notes.mjs`, never a bespoke re-implementation. Health first
   matters: an app-only `--rollback` records no Deployment, so a
   Deployment-only basis can be NEWER than what runs and would narrow the range
   past undeployed PRs.

   **Dark-on-prod slices (#3233).** A sliced feature can merge a slice whose
   surface is reachable on prod only through a later PR #M (an app nothing
   routes to yet, a refactor into a shared package). Its author records
   `Stage-B-dark-until: #M` (exactly one PR number) next to the batched
   marker, with the same line tolerance; the record IS the author's
   certification that the slice alone makes no visible prod difference. It is
   read from the PR body or from a comment on a `Closes`-linked Issue — but,
   because it removes a hold and the repository is public, a comment counts
   only when its `authorAssociation` is `OWNER`, `MEMBER` or `COLLABORATOR`
   (any other author's marker is ignored and the pair holds). Such a pair
   holds only while #M is merged and reachable at the target — inside this
   release range, or (an authoring error the gate still catches) already
   deployed. #M open, closed unmerged or merged after the target clears the
   pair, and the gate output lists it as
   `not holding: PR #<n> → gate #<g> …: dark until #M — not in this release`.
   A malformed value, two different numbers for one PR, a #M that cannot be
   resolved, or a #M whose body has no `Stage-B:` line at all HOLDS. The
   reaching PR #M carries its own `Stage-B:` record (a GO, `pending`, or
   `batched at #<gate>`), so the release that makes the surface visible is
   still held until it is accepted. A PR without the
   marker holds exactly as above. This keeps one unfinished sliced feature
   from holding every parallel session's release.

3. **Selected release prerequisites** — PR-body `Release-requires: #123, #456`
   lines name Issues that must be CLOSED before that PR ships. The gate checks
   only PRs in `<live deployed>..<selected target>` (including cherry-picked
   squash PR numbers in a hotfix); an unrelated open prerequisite holds nothing.
   Multiple lines are unioned/deduplicated per PR. Omit the marker or use
   `Release-requires: none` when none exist; template HTML comments are ignored.
   Invalid declarations, unreadable PRs/Issues and unknown Issue states hold
   closed. The failure names **PR → prerequisite** pairs.

Every deferred production action still needs a linked Issue with affected change,
timing, execution/check plan and completion evidence. Use `Release-requires`
only for conditions needed BEFORE shipping: do not auto-close an unfinished
prerequisite in the same PR. Rollout actions and post-release acceptance are
linked in prose, never circular preconditions of their own activation. If the
pipeline owns the action, cite its `file:line`. Review rejects missing tracking
and omitted real prerequisites; it does not assign the global label by default.

**Fail-closed**, like the эфир probe: an UNKNOWN HOLDS rather than waving the
deploy through — a `gh` call errored (including an unreadable linked Issue, i.e.
an accepted marker source that could not be checked), the delta basis fell back
to the Deployment record because the live health probe failed (a DEGRADED
basis), or there is no deployed SHA at all to anchor the delta. Every `gh`/`git`
call is bounded at 15 s (the health probe at 8 s), so a hung call degrades to
that hold instead of stalling the pre-flight with no output. The **only** bypass
is explicit and loudly printed — never a silent auto-detection, mirroring
`--mode-a-exempt` in `tools/gh/merge-gate.mjs`:

```bash
pnpm deploy:prod --release-gate-exempt "owner go — the fix ships in this very range"
```

A bare `--release-gate-exempt` (or one followed by another flag) is a usage
error, not an exemption — caught at start-up, before any probe runs. The printed
line IS the audit record.

Unit cover: `tools/lint/guard-tests/release-gate.spec.ts` (pure flag parser,
marker parser, evaluator and formatters over fabricated probes — no subprocess).

## Stage `main` check (`stage-main-check.mjs`, #2701)

Environment-level risk — the production build, the real IdP, real-shaped data —
is covered once per release on the shared stage `main` slot (staging tech spec
C7, release-cycle spec §10.4 item 9). For a target from `main`, Actions covers it
(`stage.yml`, the `stage-suite` status the pre-flight reads — above). A `--ref`
hotfix target is no `main` push, so the deploy runs the check **itself**, as the
last pre-flight step:

1. `git worktree add --detach <tmp>/tree <target>` under the OS temp dir — a
   clean checkout of exactly the target SHA, so the scenarios executed are the
   ones the target carries, never the operator's working tree — then
   `pnpm install --frozen-lockfile` in it.
2. `node tools/staging/slot.mjs up main --ref <target>` from that checkout — the
   ordinary converge (`tools/staging/README.md`), which itself asserts the slot's
   public `/v1/health` serves the target.
3. `node tools/staging/e2e-stage.mjs main --expect-sha <target>` — the full
   suite, the axe legs and every storefront live-tier leg (#3191). `--expect-sha`
   re-asserts the served SHA before any scenario runs and refuses `--project` /
   `--grep` / `--no-axe` / `--no-live`, an inherited `E2E_GREP` and a
   missing `CI` (Playwright `forbidOnly`); the deploy's child env clears
   `E2E_GREP` and sets `CI=1`.
4. `git worktree remove --force` the checkout, pass or fail.

Any failure refuses the deploy, fail-closed; nothing is written to GitHub — the
stand is operated by hand (#2202) and the deploy log is the record.

**Prerequisites on the operator's machine** (#2806), `--ref` only — probed as the FIRST
pre-flight step, before the clean-tree check and long before the checkout, so a
missing one refuses the deploy in seconds and names itself:

- `STAGE_BASIC_AUTH_PASS` exported — the stand's basic-auth plaintext (the box
  holds only its bcrypt hash; same refusal text as `stage:slot`).
- ssh to the stage box (`ds-stage-1`, or `DS_STAGE_SSH`) — one `ssh … true`
  with `ConnectTimeout=5` / `BatchMode=yes` (the `slot-probe.mjs` options),
  bounded at 15 s wall-clock.

Both are reported together when both are missing. The only bypass — of the
check and its prerequisites alike, and of the `stage-suite` read — is the
owner-approved `--release-gate-exempt "<reason>"`, printed as the audit record.
Unit cover: `tools/deploy/stage-main-check.test.mjs` (every spawn and the ssh
probe injected), the release-check cases in `tools/staging/e2e-stage.test.mjs`,
and `tools/deploy/prod-stage-gate.test.mjs` (which target takes which check, the
status read injected).

## `pnpm deploy:smoke`

Probes the public origins end to end over real TLS: `api.doctor.school`
`/v1/health` (+ optional `--expect-sha` assertion) & `/v1/ready` (every check
ok — postgres, pgvector, objectStorage; a 503 names each failing check, so a
storage outage reads apart from a DB outage),
`academy.doctor.school/`, `admin.doctor.school/`, `new.doctor.school/` (the
doctor storefront, #1723), `id.doctor.school/ui/v2/login/loginname` (the login entry —
the bare `/ui/v2/login` 404s per Caddy's sub-path routing), and cert
validity/expiry on all five hosts. Exit non-zero on any failure. Hostnames default to the prod
vhosts and are env-overridable (`PROD_API_HOST` / `PROD_PORTAL_HOST` /
`PROD_ADMIN_HOST` / `PROD_DOCTOR_HOST` / `PROD_ID_HOST`) for a staging clone.

SSH host aliases resolve from `~/.ssh/config`; overridable via `DS_API_PROD_SSH` /
`DS_DATA_PROD_SSH`. The break-glass run connects to ds-api-prod as
`breakglass@ds-api-prod` (`BREAKGLASS_API_PROD`): on ds-api-prod `deploy` is the CI user
with a forced command and no shell, so the operator's offline `breakglass` key is the
only interactive login there. The alias names the address and that key; the `ds-data-prod`
alias jumps through it (`ProxyJump breakglass@ds-api-prod`) and logs in to data-prod as
`breakglass` too: once a release has converged ds-data-prod, `deploy` holds only the hop
key behind the forced command (#3313, #3320). The run calls the same data verbs through
`sudo -n`. This alias is break-glass documentation: the release path needs no alias and
no owner step.

Both prod boxes keep the live tree at the fixed `/home/deploy/ds-platform`
(`PROD_LIVE_TREE`), never a `~`-relative path: the box-local run is root (HOME=/root)
and the break-glass run is `breakglass`, and both address the tree deploy's runs always
used, with `compose/api-prod/.env` carried forward inside it. On ds-api-prod the ship
runs as root (`sudo -n bash -c`, `asRoot`), so its files are root-owned; on data-prod it
is the `ship` verb, whose entrypoint checks every archive path before it extracts.

## Release digest → Mattermost (`release-notes.mjs`, #868 / #968)

```bash
node tools/deploy/release-notes.mjs --prev-sha <sha|none> --new-sha <sha> [--dry-run]
```

Posts ONE aggregated **Russian, product-language** release note to the **same**
`MATTERMOST_WEBHOOK_URL` the per-PR notes use (`tools/ci/post-product-note.mjs`,
#654) — reusing its `extractNote` / `noteIsReal` / `envFooter` seams so the guard,
the per-PR note, and this digest read one source of truth. The note section ends at
the next heading, a thematic break, or the first machine-marker line (`key: …`,
#2489), so a PR's evidence tail never reaches the digest. The digest deliberately
does NOT reuse `labelsAreProductKind`: inclusion here is note-driven (#2241 — see
"Note-driven inclusion" below), while the kind-label gate stays a per-PR-post rule.

**Fired from CI, not from `deploy:prod` (#968).** The digest is a DEPLOY event, and
`deploy:prod` ships from the operator workstation, not CI, where `secrets.MATTERMOST_WEBHOOK_URL` does
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

The message lists the `## Product note (RU)` section of every PR in the
`<prev-sha>..<new-sha>` range that carries a **REAL** note, carrying the same
**PROD** environment footer (#657); a valid range with no noted PR posts a one-line
«технический релиз».

**Inclusion is note-driven, not label-driven (#2241).** The digest keeps a PR when
`noteIsReal(extractNote(body))` — whatever its kind label. A `refactor` / `tooling`
PR whose author wrote a real Product note IS product-visible by that author's own
declaration (PR #2198 and #2229 shipped the shared header/footer and the unified
login and were silently dropped by the old `feature|bug` gate); a `feature`/`bug`
PR whose note is `none` still stays out. The per-PR poster
(`tools/ci/post-product-note.mjs`) keeps its own `labelsAreProductKind` gate — only
the DIGEST is note-driven.

**The range is computed by PATCH ID, not by ancestry (#2241).**
`git cherry -v <prev-sha> <new-sha>` marks every commit that already has a
patch-equivalent commit in `<prev-sha>` with `-`; only the `+` subjects feed the PR
extraction. This is what keeps a `pnpm deploy:prod --ref <sha>` **hotfix** from
being announced twice: the hotfix branch ships cherry-picks of commits that also
live on `main`, so a plain `prev..new` commit walk re-listed all of them (the
2026-09-16 post repeated nine already-live notes). From the surviving subjects the
rule is unchanged: the **LAST** `(#N)` per subject (the squash-merge number) →
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
  (`git cherry` non-zero) → log + **skip green** — never a fabricated all-history
  range, never a broken deploy.

## IdP prod-parity obligation — MFA login policy (011 EARS-8)

**Not a code change and not part of `deploy:prod`.** The admin tier's mandatory
TOTP (spec 011, ADR-0001 §4) needs a _capability_ the IdP provides, and that
capability lives in Zitadel's **instance login policy** — configuration on the
box, not in an image. `infra/dev-stand/idp/provision.sh` step 9 converges it on
the dev stand; **prod Zitadel must carry the identical posture**, or an admin who
can enrol on the stand cannot enrol in prod — a shipped outage that no deploy
step would surface.

The same script is the prod instrument (`infra/deploy/README.md` §5–§10 runs it
against the prod issuer with the prod bootstrap PAT), so parity is applied by
re-running it, never by clicking the Console. What must match:

| Login-policy field               | Required value                        | Why                                                                                                                                                                                                                                                     |
| -------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| second factors                   | must include `SECOND_FACTOR_TYPE_OTP` | The TOTP capability itself. Additive — U2F and anything else already registered stay.                                                                                                                                                                   |
| `mfaInitSkipLifetime`            | `60s`                                 | An MFA-setup skip must not carry into the next login. **Never `0s`** — a zero skip-lifetime means "never prompt for setup at all" in Zitadel.                                                                                                           |
| `secondFactorCheckLifetime`      | `300s`                                | A satisfied factor check must not survive across logins (the Zitadel default of 18 h does).                                                                                                                                                             |
| `multiFactorCheckLifetime`       | `300s`                                | Same, for the multi-factor check (Zitadel default 12 h).                                                                                                                                                                                                |
| `forceMfa` / `forceMfaLocalOnly` | **`false`**                           | Load-bearing. Zitadel login policies are **organisation-scoped**, so the org-wide switch would impose TOTP on every `doctor_guest`. The MFA _mandate_ is our backend's `role → mfa_required` policy (011 EARS-3); the IdP supplies only the capability. |

Verification after a prod (re)provision: the script's own `mfa sweep:` verdict
lines echo all four values from the converged policy. The dev-stand equivalent is
asserted by `apps/api/test/auth/idp-mfa-config.e2e-spec.ts`, which reads the same
fields over the Admin API and fails on any drift.

## Release record cycle

A successful deploy leaves a durable, queryable trail. Every record step is
**non-fatal by contract** — it runs only once the deploy has already succeeded,
so a `gh`/webhook hiccup prints a warning and the deploy exit code stays 0.

| Record                | When                                                                                                    | Source / how                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GitHub Deployment** | end of a release: `release-runner.mjs record` in `deploy-prod.yml`, or break-glass `deploy:prod` (#942) | `deployment-record.mjs` posts a `Deployment(production, sha)` + its status carrying the release-notes digest (and, on the Actions path, the owner quote); `log_url` = `/v1/health`.                                                                                                                                                                                                                                                                             |
| **Git tag + Release** | release success, before the Deployment record (#996/§10.5)                                              | The release is the release **initiator** (Option A): it cuts `release-YYYY.MM.DD-n` + a GitHub Release with auto-generated notes (`--generate-notes` since the previous release) at the **deployed SHA** via `cut-release.mjs` → `cutDeployRelease`. Skipped green on a redeploy of an already-released SHA (non-empty-range guard). The `Version Packages` merge no longer cuts a repo-level release — it maintains per-package version + `CHANGELOG.md` only. |
| **Mattermost digest** | `deploy-prod.yml` `digest` job; break-glass: CI `deployment_status: success` (#868/#968)                | `release-digest.yml`, called by `deploy-prod.yml` (`workflow_call`) on a newly recorded success, or fired by the break-glass Deployment's `success` status (or a manual `workflow_dispatch`); `tools/ci/post-release-digest.mjs` anchors `<prev>` on the previous `release-*` tag (repo-root baseline if none, #975) and posts via `release-notes.mjs`. Webhook = `secrets.MATTERMOST_WEBHOOK_URL` (CI only).                                                   |

**`## Project reality` reads these at SessionStart.** The bootstrap (#939)
derives the latest release (from Releases/tags), the currently deployed SHA (the
latest production **Deployment** ⋈ the live `/v1/health` `version`), and the
**merged-not-deployed** delta (product PRs merged into `main` but not yet
present in the deployed SHA). A non-empty delta is the cue to propose a release
(runbook: skill `run-prod-deploy` / `/deploy`).

**Exit-code hygiene.** `gh workflow run`, `deploy:prod` (and any deploy/merge/migrate command) runs
as its **own statement** — never `pnpm deploy:prod | tee log`: a pipe returns the
pipe's exit code (`tee`'s 0) and masks a non-zero deploy failure. Redirect with
`> log 2>&1` and check `$?` if a transcript is needed. A watchdog `STALLED` exit
is non-zero like any other failure — but it means "channel went quiet", not
"remote work failed": run `pnpm deploy:probe` before deciding re-run vs rollback.
