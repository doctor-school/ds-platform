# `tools/staging` — the STAGE stand's operator-side scripts

Node scripts that an operator runs **from a worktree on their own machine**, never in CI
and never on the stage box. They follow the delivery shape `tools/deploy/prod.mjs` uses
for production: the operator ships a committed tree over SSH and **the box builds its own
images**. There is no registry anywhere in the path, no on-box deployer, no timer, and no
Node runtime of ours on the host — the box runs containers and nothing else.

| script          | what it owns                                                                                 | Issue |
| --------------- | -------------------------------------------------------------------------------------------- | ----- |
| `golden-db.mjs` | builds and rebuilds `ds_golden`, the template every slot database is cloned from             | #2063 |
| `slot.mjs`      | the lifecycle of one slot: `up`, `sync`, `down`, `reset`, `reset-identities`, `status`, `gc` | #2064 |
| `idp.mjs`       | the two shared-Zitadel converges (whole redirect-URI set; golden identities)                 | #2064 |
| `e2e-stage.mjs` | the regression run over a CONVERGED slot: the C6 suite (+ the a11y suites) from your machine | #2067 |

Both entry points ship as package scripts, so nothing is invoked by path:

```bash
pnpm stage:slot up pr-123 --ref <40-char sha>
pnpm stage:slot status
pnpm stage:slot gc
pnpm staging:golden-db --dry-run
pnpm e2e:stage pr-123
```

SSH transport, tree shipping and the remote-script primitives are NOT duplicated here:
they are `tools/deploy/lib/remote.mjs`, the same module production deploys through.

They all follow the same shape, and a new script here should too: **pure planner functions
plus an injected executor**. Every decision — a name, a SQL statement, a command array, a
rendered env file — is an exported pure function with a unit test; the CLI `main()` is the
only place that opens an SSH session. That is what makes the whole converge testable on a
machine that has neither Docker nor Postgres nor a reachable box.

```bash
pnpm test:tools            # runs tools/**/*.test.mjs, this directory included
node --test tools/staging/slot.test.mjs
```

## Variables this machine must carry

The box's own configuration lives in `/etc/ds-platform/stage.env` (template:
[`infra/deploy/stage.env.example`](../../infra/deploy/stage.env.example)) and the scripts
read it over SSH. Bot protection on this box has been **ON since 2026-09-17** with the
stand's own dedicated staging captcha (both halves in `stage.env`, never the production
pair) — see `infra/deploy/stage.env.example` → «Bot protection»; `up`/`sync` refuse an
incoherent trio by name. Two variables are the exception and belong to the **operator
machine**:

| variable                                                      | why it is not a box variable                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STAGE_BASIC_AUTH_PASS`                                       | the stand sits behind one basic-auth pair and the box stores only the bcrypt hash (`STAGE_BASIC_AUTH_HASH`). The post-converge health assertion has to authenticate, so the plaintext must be exported here. The box keeps the plaintext for the operator at `/etc/ds-platform/stage-basic-auth.txt` (`user=stage`) — read it, never invent one: `export STAGE_BASIC_AUTH_PASS="$(ssh -o BatchMode=yes ds-stage-1 'sudo sed -n "s/^password=//p" /etc/ds-platform/stage-basic-auth.txt' \| tr -d ' |
| ')"`. Absent ⇒ a named refusal, never a skipped verification. |
| `DS_STAGE_SSH`                                                | the SSH destination, default `ds-stage-1` — an alias in your own `~/.ssh/config`.                                                                                                                                                                                                                                                                                                                                                                                                                  |

## The box must stay logged into Docker Hub (#2240)

Every `up`/`sync` builds the slot's service set **on stage-1**, and each build pulls its
base images from Docker Hub. Anonymous pulls are capped at **100/h keyed on the source
IP**, and Timeweb gives every tenant on the host the same shared IPv6 /64
(`2a03:6f00:a::`) — so a converge can die on `429 Too Many Requests` without this stand
having pulled anything (observed 2026-09-15/16/17; the same hour killed a production
deploy). A 429 mid-build is this, not a broken slot: nothing in `slot.mjs` retries it.

stage-1 is logged in as the project Docker Hub account, which re-keys the quota to the
account (200/h):

```bash
ssh -t ds-stage-1 'sudo docker login -u bbmacademy'   # Read-only PAT, typed at the prompt
```

The token is a Read-only Docker Hub Personal Access Token with no expiry, typed at the
prompt by the owner; it lives only in `/root/.docker/config.json` on the box (the slot
scripts run docker through `sudo`, so the login must belong to root) and never in this
repo, in `stage.env` or in chat. Check it with `ssh ds-stage-1 'sudo docker pull
node:24-slim'` — it must succeed, and a registry token request with the box's
credentials reads `ratelimit-limit: 200;w=3600` / `docker-ratelimit-source: bbmacademy`
rather than the anonymous `100;w=3600`. Recreating the box loses the login; repeat it
before the first converge (`infra/deploy/README.md` → «Docker Hub login on every box»).

## Stage-B: the owner-facing stand

**A per-PR slot is the stand the owner judges at Stage-B** (AGENTS.md §6; canonical
procedure: `apps/docs/content/skills/build-ui-from-design-system/design-approval.md`). The
local dev stand (`pnpm dev:ports`, `.claude/rules/dev-stand.md`) is the agent's own
iteration loop and is never handed to the owner: it dies with the lead's session, has no
HTTPS and no real IdP, and cannot be opened from a phone.

```bash
export STAGE_BASIC_AUTH_PASS="$(ssh -o BatchMode=yes ds-stage-1 'sudo sed -n "s/^password=//p" /etc/ds-platform/stage-basic-auth.txt' | tr -d '
')"
pnpm stage:slot up pr-<N> --ref "$(git rev-parse <branch>)"
# → https://academy-pr-<N>.stage.doctor.school  (basic auth: stage / $STAGE_BASIC_AUTH_PASS)
#   https://doctor-pr-<N>.stage.doctor.school
#   https://admin-pr-<N>.stage.doctor.school
#   https://api-pr-<N>.stage.doctor.school/v1/health
```

Three prerequisites the commands do NOT solve for you, in the order they bite:

1. **`ds_golden` must already exist on the box.** `slot up` only CLONES the template; it
   never builds it. On a box where it was never built the converge dies at
   `[clone database]` with a raw `ERROR: template database "ds_golden" does not exist` —
   run `pnpm staging:golden-db` once (see below) and repeat the converge.
2. **`--ref` takes the FULL 40-character lowercase SHA**, never the short form a `git log`
   prints. `--ref 42be0e92` is refused, `--ref "$(git rev-parse 42be0e92)"` is accepted.
3. **`STAGE_BASIC_AUTH_PASS` must be exported** from the box file above, or the converge
   refuses at its health assertion.

**Lifetime is the verdict, not a clock.** A slot goes up only together with a
**Stage-B request** — a comment on the PR, and the same message to the owner in chat,
carrying the host URLs, the head SHA, who to sign in as and what to walk (shape:
`apps/docs/content/skills/build-ui-from-design-system/design-approval.md`). A handoff
prompt is never its carrier: pr-2229 stood for days because the ask lived only inside one.
The slot then stays up until the owner answers, and the closeout tail takes it down with
`pnpm stage:slot down pr-<N>` alongside the worktree teardown. If the owner defers
acceptance behind a prerequisite, the slot comes down NOW and the PR records
«re-raise after X» — a deferred verdict is not a pending one, and pr-2205 sat live on a
stale head that way. An active findings loop keeps the slot; rework taken up in another
session means down now and a re-raise on the new head with a NEW request. Nothing sweeps a
slot on a timer — `gc` is an operator subcommand and reclaims disk, not live slots — so
`pnpm bootstrap` prints a `## Stage slots` section that lists every live slot and flags
(⚠) the ones standing with no current request comment.

## Regression run: `pnpm e2e:stage <slot>`

The C6 regression contract (`packages/e2e`) driven against a slot's **public** hostnames
— the edge a reviewer uses, basic auth included. Tech spec C4 / §8 step 7: the verdict is
pasted into the PR body or the release record **by hand**; there is deliberately no CI
check-run, because staging is operated by hand like production (#2202) and a runner would
have to hold the stand's credentials to reach the slot at all.

```bash
export STAGE_BASIC_AUTH_PASS="…"          # same variable the converge needs, see above
export DS_GOLDEN_PASSWORD_DOCTOR_UNVERIFIED="$(ssh -o BatchMode=yes ds-stage-1 'sudo sed -n "s/^DS_GOLDEN_PASSWORD_DOCTOR_UNVERIFIED=//p" /etc/ds-platform/stage.env' | tr -d '\r')"
export DS_GOLDEN_PASSWORD_DOCTOR_VERIFIED="$(ssh -o BatchMode=yes ds-stage-1 'sudo sed -n "s/^DS_GOLDEN_PASSWORD_DOCTOR_VERIFIED=//p" /etc/ds-platform/stage.env' | tr -d '\r')"
export DS_GOLDEN_PASSWORD_DOCTOR_MFA="$(ssh -o BatchMode=yes ds-stage-1 'sudo sed -n "s/^DS_GOLDEN_PASSWORD_DOCTOR_MFA=//p" /etc/ds-platform/stage.env' | tr -d '\r')"
export DS_GOLDEN_PASSWORD_ADMIN="$(ssh -o BatchMode=yes ds-stage-1 'sudo sed -n "s/^DS_GOLDEN_PASSWORD_ADMIN=//p" /etc/ds-platform/stage.env' | tr -d '\r')"
pnpm e2e:stage pr-123                     # both storefronts
pnpm e2e:stage main --project academy --grep "витрина"
pnpm e2e:stage main --project walks       # only the derived walks (§6.3), no axe leg
pnpm e2e:stage pr-123 --no-axe            # skip the a11y leg explicitly
```

**It never raises a slot.** A converged slot is the PRECONDITION: the command makes one
`/v1/health` read of `api-<slot>.<base domain>` and **exits 2** naming that URL when it
does not answer — a suite pointed at a half-raised slot reports topology as product
regressions. Raise the slot with `pnpm stage:slot up <slot> --ref <sha>` first.

Everything it needs comes from the same places the converge reads: the hostnames from
`slotHostnames()`, the base domain and the basic-auth user from `/etc/ds-platform/stage.env`
over SSH, the password from `STAGE_BASIC_AUTH_PASS` on THIS machine. An operator without
SSH to the box can export `STAGE_BASE_DOMAIN`, `E2E_HTTP_USER` and `E2E_HTTP_PASS` instead
and the box is never contacted. The password is passed to Playwright as `httpCredentials`
and never printed.

**The signed-in leg needs the golden passwords too**, and they are NOT covered by
`STAGE_BASIC_AUTH_PASS`. A scenario that signs a golden doctor in reads that
account's password from a `DS_GOLDEN_PASSWORD_*` variable on THIS machine: the registry
(`packages/e2e/lib/golden.ts`) turns the feature file's seed name into the env var
`packages/db/src/seed/golden/idp.ts` declares for that account, and an unset one is a named
failure, never a silent sign-in attempt with `undefined`. The seed declares five names —
`DS_GOLDEN_PASSWORD_DOCTOR_UNVERIFIED`, `DS_GOLDEN_PASSWORD_DOCTOR_VERIFIED`,
`DS_GOLDEN_PASSWORD_DOCTOR_MFA`, `DS_GOLDEN_PASSWORD_DOCTOR_DELETED` and
`DS_GOLDEN_PASSWORD_ADMIN` — but only FOUR are exportable. The box deliberately carries no
`DS_GOLDEN_PASSWORD_DOCTOR_DELETED`: the soft-deleted doctor is ensure-**absent** on the
shared IdP by contract (see `reset-identities` below), so it has no live account to sign in
as, and a scenario asking for that seed name to sign in is a scenario defect rather than a
missing secret. `DS_GOLDEN_PASSWORD_ADMIN` is read only by the admin suite: the `admin` host
tag is deliberately selected by NO storefront project (`packages/e2e/lib/host-tags.ts`), so a
`--project academy`/`doctor` run never reaches for it. The four are the same owner-placed
values `reset-identities` converges from, so they come out of `/etc/ds-platform/stage.env`
over SSH in exactly the shape the basic-auth recipe above uses — one quoted `export` per
variable. Read them one at a time like that, never by `eval`-ing the matching lines of
`stage.env` in bulk: a password containing a space or a quote is truncated or dies on an
unbalanced quote, and the box's file content would be executing on your machine. An operator
without SSH to the box exports the four by hand; they are secrets, and like the basic-auth
password the suite never prints them.

The **a11y leg** (§6.6) joins the run only once #1692 — the contrast fix — is on `main`;
while it is open the command prints
`axe leg skipped: #1692 open` and runs the suite alone, because a known-red axe leg would
train the operator to ignore the leg.

Reports land under `packages/e2e/playwright-report/<slot>-<timestamp>/` (HTML +
`results.json`, gitignored, local only) so a second run cannot overwrite the evidence.
Stdout ends with a fenced **verdict block** — slot, the SHA `/v1/health` reports, the
per-project passed/failed/skipped counts, the axe verdict and the report path. That block
is the artefact you paste. Exit `0` every leg green, `1` a failing leg, `2` pre-flight.

Until the §8 backfill (#2068) rewords the spec feature files in the shared step
vocabulary, every scenario reports as **skipped** — `missingSteps: "skip-scenario"`, the
deliberate choice `packages/e2e/playwright.config.ts` records. The verdict block prints
the skipped count rather than hiding it, so «0 passed / N skipped» is a truthful reading
of the suite's coverage today, not a defect of this command.

## `slot.mjs` in one paragraph

A slot is `main` or `pr-<N>`, and every name it touches — compose project, network,
database, hostnames, container aliases, tree directory under `$HOME/ds-platform.slots` —
is DERIVED from it, so a slot can never be addressed two ways. `docker ps` on the box is
the single authority on which slots are live; there is no registry file and nothing is
cached. `up`/`sync` ship the tree at `--ref <sha>`, build the service set on the box
(image tag = the full commit SHA, global per commit), clone the slot database from
`ds_golden` (never for `main`, which is persistent), run migrate and the golden seed
through the containerized `migrate` one-shot, start
`infra/deploy/compose/slot/compose.yml`, converge the shared IdP and assert
`/v1/health`; `down` reverses it. The slot's **object storage** follows its database
exactly: `up`/`sync` ensure the MinIO bucket `ds-<slot>` is present (before migrate, so
the branch seed can write objects) and a preview's `down` drops it with
`mc rb --force`; `main` keeps its bucket, and `reset main` re-clones rows without
touching a single object. `reset-identities` is folded into every `up`/`sync` and
is idempotent, so a converge needs no second operator command.

`reset main --yes --ref <sha>` drops `ds_main` and re-clones it from `ds_golden`, then
re-runs the ordinary converge on that SHA — the escape hatch for a staging database
someone has poisoned. It is the **only** resettable slot (a preview's database is
re-cloned by its every converge, so `sync` already is its reset), the `--yes` flag is
mandatory, `ds_golden` is never touched, and every run appends one audit line to
`/var/log/ds-platform/slot.log` before it drops anything.

## The IdP origin every IdP step uses

Every command with an `idp` step — `up`, `sync`, `down`, `reset` (whole-set redirect
converge) and `reset-identities` (golden identities) — builds its management client through
one seam, `resolveIdpBaseUrl` in `slot.mjs`. It resolves the shared Zitadel's origin from
what `/etc/ds-platform/stage.env` ACTUALLY carries:

- `IDP_EXTERNAL_DOMAIN` / `IDP_EXTERNAL_PORT` / `IDP_EXTERNAL_SECURE` — the default route.
  The scheme is `https` when `IDP_EXTERNAL_SECURE` is `true`/`1`, else `http`; the port is
  appended only when it is not that scheme's default. So the live stage trio
  (`id.stage.doctor.school` + `443` + `true`) gives `https://id.stage.doctor.school`.
  This trio is authoritative by construction: `IDP_EXTERNAL_DOMAIN` must equal the Caddy
  `id` vhost or OIDC discovery advertises a wrong issuer.
- `IDP_BASE_URL` — an explicit override, honoured when non-empty, for an ad-hoc run against
  another Zitadel. `stage.env` deliberately does NOT carry this key (`stg-infra`'s
  `provision.sh` is passed the base URL explicitly), so a hand-placed value here could
  drift from the issuer Caddy serves.

With neither route resolvable the command refuses, naming both.

## `reset-identities <slot>` — the golden accounts on the shared IdP

The golden dataset's four live accounts (two doctors, the MFA doctor, the admin) and the
soft-deleted doctor live on the SHARED stage Zitadel, not per slot, and nothing else
provisions them — without this command `slot up` refuses at its `seed:golden` one-shot.
One run does four things, in order:

1. **Converge the accounts** through `idp.mjs`: each `idpAccountExpected: true` account is
   created when absent, then always has its password set from the `DS_GOLDEN_PASSWORD_*`
   variable the owner placed in `/etc/ds-platform/stage.env` and its email-verified state
   converged; the soft-deleted doctor is ensure-**absent** — probed first, deleted only
   when a live account carries that username. Its GRANT on the shared project is converged
   the same way: a created account is always granted its catalogue role, a live one only
   when its role keys drift (a re-grant on the existing authorization, never a second one),
   and an already-correct grant is logged as «already holds» rather than passing in
   silence — an admin who signs in without `platform_admin` fails the walkthrough exactly
   the way a broken login does. Every step is probe-then-act and a failing
   act is a hard failure: there is no blanket tolerated-failure flag in this path.
2. **Write the subjects.** All five `DS_GOLDEN_SUB_*` are written idempotently to
   `/etc/ds-platform/golden-subjects.env` (root, 0644 — opaque ids, not secrets), and
   `renderSlotEnv` merges that file into every rendered slot env, so `seed:golden`
   resolves them with no human step. Rendering a slot env before this command has ever
   run fails closed naming `ds-slot reset-identities`, never with blank values. The
   deleted doctor's subject is synthetic and deterministic (a `golden-deleted-` marker
   over a hash of its username), so it is stable across runs and can never collide with a
   real Zitadel id.
3. **`FLUSHDB` the slot's Redis logical database** (the index `allocateRedisDatabase`
   assigns), so no session or rate-limit key survives an identity reset.
4. **Append one audit line** to `/var/log/ds-platform/slot.log`.

MFA/TOTP enrolment for `doctorMfa` and `admin` is deliberately NOT converged: TOTP secrets
are minted by Zitadel at enrolment and belong to the scenario runner's secret set, which
step 7 (#2067) owns. The command guarantees existence, password and email state.

## Redirect-URI convergence

The shared Zitadel app accepts only registered redirect URIs and that registration is a
**whole-set** write — a partial list silently unregisters every other slot. `slot.mjs`
renders the full ordered set for every LIVE slot with `renderIdpRedirectUris(slotNames,
baseDomain)` (printed by `pnpm stage:slot status`) and converges it onto the shared app
through the same management API and PAT path `infra/dev-stand/idp/provision.sh` uses: the
PAT is read from `/etc/ds-platform/idp-bootstrap-pat.txt` on the box, the origin from
`resolveIdpBaseUrl` (see above).

The converge runs as the LAST step of the `up`, `sync`, `down` and `reset` plans, after
the slot's containers have reached their new state, so the set it writes matches the live
state the command just produced — the slot names come from `docker ps`, not from a file
anyone could leave stale. It is ensure-present: the current `oidc_config` is read first
and the `PUT` is skipped when the sets already match (order-insensitive compare). Any URIs
pinned in `IDP_REDIRECT_URIS` / `IDP_POST_LOGOUT_URIS` are unioned in, so non-slot callers
keep their registration — both must be FILLED in `/etc/ds-platform/stage.env` (see
`infra/deploy/stage.env.example`): left empty, `provision.sh` substitutes its localhost dev
defaults and registers those instead. A failing converge fails the command loudly — a slot
whose callback is unregistered fails login with `invalid redirect_uri`, which is worse than
a refused `up`.

## `golden-db.mjs` — the template database

`ds_golden` is built and rebuilt from the deployed tree, never from the host: the migrate
and the golden seed both run through the slot's containerized `migrate` one-shot
(`docker compose … --profile migrate run --rm migrate …`), the production shape. The host
has no `pnpm` and no workspace, and that is a spec §8 step-4 acceptance criterion — a
command array in this file that shells `pnpm` directly is a bug.

The build is guarded: it rebuilds only when `apps/api/drizzle/**` or
`packages/db/src/seed/golden/**` actually changed at the deployed SHA, and it builds into
`ds_golden_next`, renames the live template to `ds_golden_prev` and the new one into place,
so a failed build never leaves the template half-written (tech spec §4).

```bash
pnpm staging:golden-db --dry-run   # print the plan and every remote command, run nothing
```

## The edge is static

`infra/deploy/compose/stg-infra/Caddyfile` derives the upstream from the matched host name
with ONE regexp over the `<app>-<slot>.<base domain>` convention, so **a slot coming up or
going down never reloads Caddy** and nothing under `/etc/ds-platform/caddy` is generated or
mounted. The on-demand-TLS `ask` endpoint answers from that same regexp plus the shared IdP
host: a well-formed name with nothing behind it gets a certificate and then a 502, and a
malformed name is refused before any ACME order starts. `tools/staging/stage-edge.test.mjs`
asserts the two copies of the regexp agree and that nothing generated is imported.

## `gc` — an operator subcommand, not a timer

`pnpm stage:slot gc` reclaims Docker disk on the box down to a free-space floor. The box
runs no unit of ours, so there is nothing nightly about it: an operator runs it, and
`status` prints the free-space figure that tells them to.

Operating detail — the compose projects, Redis allocation, the preview cap and the `gc`
free-disk floor — lives in
[`infra/deploy/compose/stg-infra/README.md`](../../infra/deploy/compose/stg-infra/README.md)
→ «Slots (#2064)». Production deploy tooling is a separate story:
[`tools/deploy/README.md`](../deploy/README.md).
