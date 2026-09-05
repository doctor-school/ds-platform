# `tools/deploy/` — prod deploy tooling (DSO-126/127/128/129)

Idempotent, one-command production deploy for the always-on Timeweb environment
(api-prod public + data-prod private). Formalises the on-box runbook in
[`infra/deploy/README.md`](../../infra/deploy/README.md) §5–§10 — that README is
the operational SSOT; this directory is the executable form of its steady-state
steps. The **per-redeploy** path (`deploy:prod`) is **agent-run** (off-CI SSH,
ADR-0012), driven by the D+B trigger policy (release-cycle spec §10);
**first-time provisioning** (Terraform, DNS, secrets, Zitadel first-boot
bootstrap) is a one-time human setup, out of the steady-state loop.

| File                       | `pnpm` alias           | Role                                                                                                                                                               |
| -------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `prod.mjs`                 | `deploy:prod`          | Full deploy pipeline + `--rollback <sha>` (app-only revert).                                                                                                       |
| `smoke-prod.mjs`           | `deploy:smoke`         | Live prod HTTP + TLS smoke; also called by `prod.mjs` post-`up -d`.                                                                                                |
| `release-notes.mjs`        | `deploy:release-notes` | Aggregated PROD release note to Mattermost (#868); render+POST seam fired from CI on `deployment_status: success` (`release-digest.yml`, #968).                    |
| `live-broadcast-check.mjs` | `deploy:check-live`    | Read-only live-эфир probe (`GET /v1/public/events`, spec §10.4 item 7): `CLEAR` exit 0 / `LIVE`+`UNKNOWN` exit 1 (fail-closed); also a `prod.mjs` pre-flight hold. |
| `deploy-probe.mjs`         | `deploy:probe`         | One-line box-reality probe (#905): health SHA + running api/portal/admin images/status over ssh; the STALLED watchdog message routes here.                         |
| `release-gate.mjs`         | —                      | Release-blocker + open-batched-Stage-B pre-flight hold (#1662): probe + pure verdict consumed by `prod.mjs` (see below).                                           |
| `rollback-floor.mjs`       | —                      | Rollback compatibility-floor guard (012 EARS-24, #1633): reads the prod cutover marker and refuses a `--rollback` target older than the floor (see below).         |

## `pnpm deploy:prod`

```bash
pnpm deploy:prod                    # deploy origin/main (default)
pnpm deploy:prod --ref <sha>        # HOTFIX: ship exactly <sha>, not all of main (#1881)
pnpm deploy:prod --rollback <sha>   # app-only rollback to a prior SHA-tagged image
pnpm deploy:prod --skip-ci-check    # escape hatch (loud warning)
pnpm deploy:prod --allow-live-broadcast  # эфир-hold escape hatch (owner-approved urgent ship only)
pnpm deploy:prod --release-gate-exempt "<reason>"  # release-gate escape hatch (reason mandatory, printed)
```

Pipeline, fail-closed, stops at the first red step and prints a rollback pointer:

1. **Pre-flight (DSO-126)** — clean working tree · `HEAD == origin/main` · **green
   CI** for that SHA (latest check-run per name via
   `gh api …/commits/<sha>/check-runs`) · **no live broadcast**
   (`live-broadcast-check.mjs`, fail-closed — #1000, spec §10.4 item 7; the
   `--rollback` path skips this hold) · **release gate** (`release-gate.mjs`,
   #1662 — below). Refuses otherwise. Fixes the deployed commit to
   `origin/main`'s SHA — or, under `--ref <sha>`, to that commit (below).
2. **Ship** — `git archive <sha>` streamed over SSH to both boxes (no registry,
   no deploy key). Streams are piped in-process → Windows-safe.
3. **data-prod** — `docker compose up -d --build` (idempotent).
4. **Checkpoint (DSO-129)** — pgbackrest **pre-migrate `incr` backup** (the same
   `backup.sh` cron runs) **before** `migrate`, so a restore anchor exists at the
   pre-migrate state. Pairs with the **expand/contract** prod migration rule
   (README) so an app rollback never needs a DB rollback.
5. **api-prod** — `build` → **pre-swap boot verify (#1410)** → `migrate --build`
   (the migrate image is rebuilt from the freshly shipped tree — a reused stale
   image would apply old migrations) → `up -d`; images SHA-tagged
   **`ds-api:<sha>` / `ds-portal:<sha>` / `ds-admin:<sha>` / `ds-doctor:<sha>`**
   (DSO-127) via a `DEPLOY_SHA` `.env` the script writes beside `compose.yml`.
   Then compare the shipped `Caddyfile` and `centrifugo/config.json` with the
   files visible through the running containers and **restart only consumers
   whose bind mount is stale**. Both mounts are compared again after apply, so
   a mismatch fails the deploy instead of requiring a manual SSH step (#1175).
   5a. **Pre-swap boot verify (#1410)** — between `build` and `migrate`/`up -d`, the
   freshly built **`ds-portal:<sha>`, `ds-admin:<sha>` and `ds-doctor:<sha>`**
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
6. **Truthful-success verify** — the script polls `docker inspect` on-box until
   the RUNNING api + portal + admin + doctor containers carry exactly
   `ds-*:<sha>` **and** report
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

**Stall detector (#905).** Every ssh channel carries keepalive flags
(`ServerAliveInterval=15` / `ServerAliveCountMax=4`), so a half-open TCP
connection (NAT flush, VPN flap) dies loudly in ~60s instead of hanging the
deploy forever. On top of that, every streamed remote step (`sshScript`) runs
under a per-step **no-output watchdog**: **5 min** for build-class steps
(data-prod `up -d --build`, api-prod `build` and `migrate → up`), **2 min** for
everything else. Output flowing resets the timer — a normal long build is
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
build/up swap — the deploy record is the running image itself, no separate state
file. (The CI digest resolves its own prev-sha from the previous `release-*` tag —
see "Release digest → Mattermost" below, #975.)

The **deployed SHA is queryable over HTTP**: `GET /v1/health` → `{"version":…}`
(from the api's `DEPLOY_SHA` env). `--rollback` `up -d`s an already-present prior
image tag with **no** rebuild / migrate / DB change.

### Hotfix deploy (`--ref <sha>`)

`pnpm deploy:prod` ships the WHOLE `deployedSha..origin/main` range: one fix
cannot be shipped without everything else merged since. When prod needs a single
already-merged fix and the rest of `main` is not ready, `--ref <sha>` ships
exactly that commit instead (#1881, release-cycle spec §10.11).

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
   `git cherry origin/main <target> <deployed>`; any `+` line names the offending
   commit and refuses. This is what keeps "prod runs reviewed, merged code" true.
5. Green CI for the target SHA, the live-эфир hold and the release gate run
   unchanged. The release gate's range is already `<live deployed>..<target>`, i.e.
   exactly the hotfix range, because its basis is the LIVE prod SHA.

CI for a hotfix branch comes from `gh workflow run ci.yml --ref hotfix/<N>-<slug>`
(the `workflow_dispatch` trigger takes the same non-PR path as `push: main`); wait
for that run to go green before deploying. Ship/banner lines read
`hotfix @ <sha> (base <deployed>)`, never `origin/main`, and the release is cut
with a `— Hotfix` title plus the cherry-picked PR list.

What stays forbidden: deploying an arbitrary branch, a feature preview, or any
commit not yet merged to `main`. `--ref` narrows the range; it does not widen what
is deployable.

## Rollback compatibility floor (`rollback-floor.mjs`, 012 EARS-24 / #1633)

`--rollback` swaps the app image while the database stays where it is. That is
safe only while the older image can still read what the newer one wrote. The
legacy-speaker cutover breaks that symmetry once and for all: after the source
set is closed, a pre-cutover image would happily write to `event_speakers`
again, so **some prior SHAs stop being valid rollback targets permanently**.

The floor is DB state, not a constant in this repo — production is the only
thing that knows which release closed the source. `speaker_migration_cutover`
(migration 0032) retains `minimum_compatible_release_sha` / `_ordinal`, and this
guard is the **first step inside `rollback()`**, before the image-presence probe
and before any `.env` rewrite or `up -d`. Nothing on the box is touched until it
returns.

The ordinal is the authoritative comparison key, not the SHA and not the tag
name: `release-YYYY.MM.DD-<n>` restarts `<n>` each day, so `<n>` is not globally
monotonic. `releaseOrdinalFor()` ranks the release tags chronologically and uses
the 1-based rank.

It **fails closed** — every refusal aborts the rollback with its code:

| Code                        | Meaning                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `FLOOR_UNREADABLE`          | The marker could not be read or did not parse as exactly one row. An unknown floor is never treated as "no floor". |
| `FLOOR_METADATA_MISMATCH`   | The recorded floor SHA and ordinal disagree with the release tags — the marker is not trustworthy.                 |
| `TARGET_ORDINAL_UNRESOLVED` | The requested SHA carries no `release-*` tag, so it has no position relative to the floor.                         |
| `TARGET_BELOW_FLOOR`        | The target predates the floor. Roll **forward** instead; this rollback cannot be made safe.                        |

Three cases are allowed, each named in the verdict: `no-floor-table` (the prod
DB predates migration 0032), `no-floor-recorded` (still `review_open` — nothing
has been closed, so every target is fair game) and `at-or-above-floor`.

`rollback-floor.test.mjs` (`node --test`, run by `pnpm test:tools`) covers the
whole decision table against injected readers — no ssh, psql or provider calls.

## Release gate (`release-gate.mjs`, #1662)

`main` is deployable **by default** (release-cycle spec §10): a merged PR found
broken ahead of its fix is REVERTED from `main`; when a revert is
disproportionate, its Issue carries `release-blocker` instead. The pre-flight
turns that norm into a machine check and **holds the deploy** while either
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

## `pnpm deploy:smoke`

Probes the public origins end to end over real TLS: `api.doctor.school`
`/v1/health` (+ optional `--expect-sha` assertion) & `/v1/ready`,
`academy.doctor.school/`, `admin.doctor.school/`, `new.doctor.school/` (the
doctor storefront, #1723), `id.doctor.school/ui/v2/login/loginname` (the login entry —
the bare `/ui/v2/login` 404s per Caddy's sub-path routing), and cert
validity/expiry on all five hosts. Exit non-zero on any failure. Hostnames default to the prod
vhosts and are env-overridable (`PROD_API_HOST` / `PROD_PORTAL_HOST` /
`PROD_ADMIN_HOST` / `PROD_DOCTOR_HOST` / `PROD_ID_HOST`) for a staging clone.

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
`> log 2>&1` and check `$?` if a transcript is needed. A watchdog `STALLED` exit
is non-zero like any other failure — but it means "channel went quiet", not
"remote work failed": run `pnpm deploy:probe` before deciding re-run vs rollback.
