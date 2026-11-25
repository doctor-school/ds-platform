# `tools/staging` — the STAGE stand's operator-side scripts

Node scripts that an operator runs **from a worktree on their own machine**, never in CI.
The operator ships a committed tree over SSH, and the box **pulls the images
`runtime-images.yml` recorded for that commit, by digest** — it never builds a product
image (#2981). The one run on the box itself is the stage `main` converge of the release
driver, which runs this same `slot.mjs` with `--local` (below); there is no timer, and the
box's only Node runtime is the pinned one `infra/deploy/bin/install-node.sh` installs.

| script           | what it owns                                                                                                            | Issue        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------ |
| `golden-db.mjs`  | builds and rebuilds `ds_golden`, the template every slot database is cloned from                                        | #2063        |
| `slot.mjs`       | the lifecycle of one slot: `up`, `sync`, `down`, `reset`, `reset-identities`, `status`, `gc`, `agent-admin-code`        | #2064, #2531 |
| `idp.mjs`        | the two shared-Zitadel converges (whole redirect-URI set; golden identities + agent admin TOTP)                         | #2064, #2531 |
| `e2e-stage.mjs`  | the regression run over a CONVERGED slot: the C6 suite (+ the a11y suites) from your machine                            | #2067        |
| `live-tiers.mjs` | the registry of storefront live-tier Playwright configs `e2e-stage.mjs` runs as legs, and the env each gated spec needs | #3168        |

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

## Reading OTP mails

Open `https://mailpit.stage.doctor.school` with the same stage gate credentials as
the slot hosts. The shared `ds_stage_gate` cookie also admits Mailpit, so a browser
already admitted on a slot needs no second prompt. One Mailpit holds mail for all
slots: use the slot-tagged sender and test recipient to find the right message.
Shared Zitadel OTP mail has no sender slot tag; find the newest mail for the
registration recipient used on your slot.

## Reading SMS codes (#2878)

The stand's SMS sink (the SMS analogue of Mailpit, one for all slots) publishes its
read API at `https://sms-sink.stage.doctor.school` behind the same gate:
`GET /api/messages?to=<phone>&after=<iso>&event=<substr>` (newest first) and
`GET /healthz`. Every other request — above all `POST /`, the IdP webhook that
stores a message — is refused at the edge with 405, so nothing outside the box can
plant a code. `pnpm e2e:stage <slot>` hands the suite
`E2E_SMS_SINK_URL=https://sms-sink.<base domain>`, and `packages/e2e/lib/sms-sink.ts`
sends the stage basic-auth pair, so the `@sms-reset` scenarios run on a slot instead
of skipping. Use a fresh number per run (EARS-14 per-phone budget).

## Driving captcha-gated auth on a slot (#2605)

Registration, the login-OTP request, verification resend and password reset are
bot-protected, and Yandex SmartCaptcha has no vendor test keypair, so the agent
drives them with the box's non-production test token instead of handing them to
the owner. stage-1 carries `BOT_PROTECTION_TEST_TOKEN` in `stage.env` (generated
on the box with `openssl rand -hex 32`, never committed; `up`/`sync` refuse it
while bot protection is off, shorter than 32 characters, or without
`SENTRY_ENVIRONMENT=stage`). The api accepts it only there (result reason
`test-token`, not written to the audit ledger); production refuses it at boot and in `pnpm deploy:prod`.

`pnpm e2e:stage <slot>` hands it to the suite as `E2E_CAPTCHA_TEST_TOKEN`. An
ad-hoc drive reads it from the box the way `STAGE_BASIC_AUTH_PASS` is read —
never invent one:

```sh
export E2E_CAPTCHA_TEST_TOKEN="$(ssh -o BatchMode=yes ds-stage-1 'sudo sed -n "s/^BOT_PROTECTION_TEST_TOKEN=//p" /etc/ds-platform/stage.env' | tr -d '[:space:]')"
```

and calls `installCaptchaStub(page)` from `@ds/e2e/captcha-stub` before the first
navigation: it routes only Yandex's `captcha.js` to a stub that resolves the real
widget with the token, so the `x-smartcaptcha-token` header, the api guard and the
provider all run for real. The owner's Stage-B judges only how the widget looks.

## Storefront redeem secrets per slot (#3172)

The slot's root-only `/etc/ds-platform/slots/<slot>.sign-in.env` also carries the
storefront clients' `private_key_jwt` keys `IDP_{ACADEMY,DOCTOR}_CLIENT_KEY` (Zitadel
JSON application keys: kept while the key id is still listed on the slot's app,
re-minted when revoked or absent) and the slot's `INTERNAL_API_TOKEN` (32 random bytes,
kept across converges), written by the «converge the slot's sign-in host clients and
env» step; only key ids and kept/minted verdicts are logged, and a key the IdP cannot
produce refuses the converge before the file or the api changes. Only the api mounts
that file. The same converge writes the root-only `/etc/ds-platform/slots/<slot>.internal.env`
(0600) with `INTERNAL_API_TOKEN` alone — the api's value, sliced from the same rendering —
and the portal and doctor containers mount only that one, so a storefront server never
holds a client key or the record key. The two storefronts call the slot api at
`INTERNAL_API_URL=http://api:3000` (compose network, never a public host). `down`
touches both files (compose loads every env_file) and a preview's `down` removes both.

## API mail transport and safe configuration recovery (#2274)

`renderSlotEnv` always emits `MAILER_SMTP_HOST=mailpit`,
`MAILER_SMTP_PORT=1025` and the slot-tagged `MAILER_SMTP_FROM`. These are
non-secret topology, regenerated on every `up`/`sync`; the shared `stage.env`
provides `EMAIL_DELIVERY_MODE=mailpit`. The API joins `stg-infra`, where Mailpit
accepts unauthenticated SMTP on 1025 (the API enables implicit TLS only on 465).
`IDP_SMTP_HOST=mailpit:1025` configures Zitadel and does **not** configure the API.

The environment renderer comes from the **operator's checkout**, not the shipped
`--ref`. Use a checkout containing this fix; an older renderer can remove these
keys even when deploying an image built from a branch that already has the fix.

For an existing slot needing only this configuration repair, coordinate with its
owner and preserve the running image ID/SHA, slot database, Redis allocation and
golden subjects. Back up its generated env, regenerate with `renderSlotEnv` using
those existing inputs, and require that the only delta is the two SMTP keys.
Check that the image tag still resolves to the running image ID and that neither
the container nor env changed since the snapshot. Then use the slot's existing
Compose file and both env files (the invocation in
`infra/deploy/compose/slot/compose.yml`) with `up -d --no-deps --no-build api`.
Do not run a full preview `sync` for this repair: it re-clones the preview database.
Verify health, the unchanged image/database and other container IDs. Request a
real API auth email through the normal CAPTCHA-protected flow and find the new
slot-tagged message in Mailpit; repeat after API recreation. Opening Mailpit or
reading an old message alone does not prove delivery.

## Telegram connector on a slot (#4159, #4165)

A slot api runs the 048 Telegram connector against the stand's own test bot, never a
production bot. The connector has one variable, `TELEGRAM_BOT_TOKEN`; with it set the
api long-polls `getUpdates` (048 EARS-24) — an outbound call only, so the edge needs no
exemption and Telegram never calls the slot.

**One slot polls the bot at a time.** Telegram serves a bot's updates to one long poll
at a time and each poll confirms what it fetched, so two slots polling one token split
the channel posts between them. The api's single-poller lock is a Postgres advisory
lock, and every slot has its own database, so it cannot span slots. The token
therefore never goes into the box-wide `stage.env`: it lives in the optional,
root-only file `/etc/ds-platform/slots/<slot>.telegram.env` of the ONE slot that runs
the connector (the slot compose mounts it with `required: false` — absent means the
connector is off on that slot: the source admin shows «Telegram не подключён на
сервере», nothing fails).

```bash
SLOT=pr-<N>   # or main
sudo install -m 600 /dev/null /etc/ds-platform/slots/$SLOT.telegram.env
sudoedit /etc/ds-platform/slots/$SLOT.telegram.env   # TELEGRAM_BOT_TOKEN=<the stand bot's token>
# recreate the slot api with the slot's existing compose invocation (above):
#   ... up -d --no-deps --force-recreate api
```

**History import on a slot (048 EARS-30).** The one-off import runs from the slot's
own api image — its entry is compiled into `dist/`, so no tsx and no repo checkout are
needed — in a one-off container of the api service, with the Telegram Desktop export
folder mounted read-only. The image runs as `node`, so the folder must be
world-readable. A source must already show «Работает» (an unbound source is refused):

```bash
sudo chmod -R a+rX <export folder>
# the slot's existing compose invocation (above), with `run` instead of `up`:
#   ... run --rm --no-deps -v <export folder>:/export:ro api \
#     node dist/materials/telegram/telegram-import-history.main.js \
#     --source t.me/<address> --export /export/result.json
```

Stdout is one JSON line of counts; a second run prints `written: 0`.

Moving the connector to another slot: remove the file from the old slot and recreate
its api first, then place it on the new slot. On its first poll the api deletes any
webhook the bot still has (keeping its pending updates), so no separate registration
step exists. `slot down` of a preview removes the file with the slot's other env
files; `main` keeps its own across a down.

## The box must stay logged into Docker Hub (#2240)

`up`/`sync` no longer builds product images — those come from the project registry
(«`slot.mjs` in one paragraph» below). Docker Hub is still pulled for the third-party
images: the slot's `centrifugo`, and the `stg-infra` services, whose `postgres` is the
one image still built on the box (its base image comes from Docker Hub). Anonymous pulls are capped at **100/h keyed on the source
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
gh pr edit <N> --add-label stage-slot   # once per PR, then wait for the Runtime images run it starts
pnpm stage:slot up pr-<N> --ref "$(git rev-parse <branch>)"
# → https://academy-pr-<N>.stage.doctor.school  (basic auth: stage / $STAGE_BASIC_AUTH_PASS)
#   https://doctor-pr-<N>.stage.doctor.school
#   https://admin-pr-<N>.stage.doctor.school
#   https://api-pr-<N>.stage.doctor.school/v1/health
```

Four prerequisites the commands do NOT solve for you, in the order they bite:

0. **The PR must carry the `stage-slot` label** (#3701). An unlabelled PR's Runtime
   images run builds and boots from a tar and pushes nothing, so its head has no
   `pr/<N>` images record and `slot up` refuses, naming the label. Adding the label
   starts a pushing run for the current head; every later head of the PR pushes too.
   Remove the label with the slot's teardown.
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
— the edge a reviewer uses, basic auth included. Tech spec C4 / §8 step 7. **A PR-slot
run executes in GitHub Actions by default, not on this machine** (#4202): Playwright
browsers on the operator workstation ran it out of memory with several sessions at once,
and a public repository's GitHub-hosted runners cost nothing.

- **A PR slot** — `pnpm e2e:stage pr-<N>` dispatches `.github/workflows/stage.yml`
  on PR N's own head branch (`gh workflow run stage.yml --ref <head branch> -f
slot=pr-<N> -f sha=<head SHA>` plus the filters you passed; branch and SHA come from
  `gh pr view <N> --json headRefName,headRefOid,isCrossRepository`), waits for the run,
  prints the compact verdict it posted on PR N, and exits 0 only for a green run (1 red,
  2 when nothing was dispatched). No browser starts here. A cross-repository PR is
  refused before dispatching. The run never runs under `main`'s ref: it executes the
  branch's code, and a `main`-ref run would hold `main`'s Actions cache scope, which
  `main`'s privileged workflows restore; on the branch's ref the cache scope is that
  branch, which `main` never reads. The whole run is therefore the branch's code, so
  **the branch must contain this workflow's PR-slot jobs — rebase it on `main`**; a
  branch without them is refused by `gh workflow run` and the CLI says to rebase. A
  branch outside the `stage-pr` policy (below) never reaches `slot-suite`, rebased or
  not: the CLI refuses it before dispatching and the verdict names the policy.
  A `slot-gate` job (no environment, no secret) refuses a run under `main`'s ref, a ref
  that is not PR N's head branch, a short or non-hex SHA, a closed PR, a fork's commit
  and a stale SHA, each as a red run naming the reason, before `slot-suite` starts. It
  is branch code, so it is a correctness check, not a security boundary. The
  boundary for the **`stage-pr`** secrets is repository write access: any code that
  can push a same-repo branch the environment's deployment-branch policy admits
  (`*/*` — a `*` never matches `/`, so `main`, unprefixed refs and refs with two or
  more `/` are excluded) can reach them through a workflow of its own on that branch,
  not only through this dispatch, so dispatch rights are not the boundary. What
  bounds the exposure is that `stage-pr` holds only the suite's stage-only secrets,
  never `stage`'s ssh key, and a branch-ref run has no `main` cache scope. `slot-suite` takes its secrets from
  `stage-pr`, checks out the dispatched SHA and runs that tree's suite — no
  `statuses` permission, so a PR-slot run never posts or changes the `stage-suite`
  status. A `slot-verdict` job (`GITHUB_TOKEN` with `pull-requests: write` only)
  renders the comment as plain text — passed / failed / flaky / skipped counts, the
  failing titles (≤20), the e2e:stage verdict block and the run link — and posts it on
  PR N; link it in the PR body. The full HTML/JSON report
  is not kept: never an Actions artifact (this repository's artifacts are public,
  release-pipeline spec §4), and not shipped to the box either, since that needs the CI
  ssh key on a runner that executed PR code. `--local` reproduces it.
- **`--local`** keeps the workstation run, for debugging a single spec
  (`pnpm e2e:stage pr-<N> --local --grep "…"`); it is also what the Actions job itself
  runs. `--report-dir` / `--verdict-file` need it. `--grep` narrows the live-tier legs
  as well as the suite: every live-tier config spreads `standRunFilter()`
  (`packages/e2e/lib/stand-run-filter.ts`), so a targeted run executes only the matching
  tests instead of whole legs.
- **The `main` slot** is the release check: the `stage.yml` suite job runs it in Actions
  for every `main` target and posts the `stage-suite` status the Actions release
  pre-flight requires; `pnpm deploy:prod` runs it on the PC only for a break-glass hotfix
  `--ref` target (below, «The release check»).

**Not yet in Actions.** The converge: the CI key's forced command
(`infra/deploy/bin/ds-deploy-entrypoint`) has no verb that raises a PR slot (its release
driver refuses `stage-pr-<N>`: «PR slots stay operator-driven»), so raise or sync the
slot with `pnpm stage:slot up pr-<N> --ref <sha>` before dispatching; the run asserts
the slot's `/v1/health` serves the dispatched SHA before any scenario (`--slot-sha`)
and is red with «slot serves <x>, PR head is <y> — re-sync the slot» otherwise. And the
box-observing tests (#3119): the CI key's `observe` verb serves the `main` slot only, and
no ssh key reaches PR code, so the Actions run leaves them out by name
(`--no-box-observe`). The one source list is `box-observing.mjs` (its test fails when a
file reaches a box-observing lib and is not listed); the verdict comment names each one
left out, and the CLI prints the exact `pnpm e2e:stage pr-<N> --local --grep "…"` that
runs just them here (one browser is enough).

**One pending run per slot.** The dispatch's concurrency group is `stage-slot-<slot>`
with `cancel-in-progress: false`: a running run finishes, but Actions keeps at most one
PENDING run per group, so a third dispatch on the same slot cancels the second, and the
CLI waiting on that one exits 1 on its `cancelled` conclusion. Dispatch again once the
running one is done.

```bash
pnpm e2e:stage pr-123                     # dispatch: both storefronts, in Actions
pnpm e2e:stage pr-123 --project login     # the door scenarios bound to the sign-in host
pnpm e2e:stage pr-123 --project sign-in-host  # the sign-in host's own plain specs
pnpm e2e:stage pr-123 --no-axe            # skip the a11y leg explicitly
pnpm e2e:stage pr-123 --no-live           # skip the storefront live-tier legs (#3168)

# --local: the workstation run, one spec at a time
export STAGE_BASIC_AUTH_PASS="…"          # same variable the converge needs, see above
E2E_WORKERS=1 pnpm e2e:stage pr-123 --local --no-live --no-axe --project academy --grep "витрина"
E2E_WORKERS=1 pnpm e2e:stage main --no-live --no-axe --project academy --grep "<one journey>"  # `main` runs here, narrowed
# the full `main` run, walks included, is the automatic stage.yml main run in Actions — never the workstation
```

**The sign-in host's two projects (#3345).** `login` is a Gherkin project: every
`NNN-scenarios.feature` scenario tagged `@host:login` — the binding
`tools/lint/scenario-coverage-lint.ts` requires for each `@door:<name>` scenario whose
door the route-mount registry marks `mounted` on `apps/login` — generated from
`.features-gen/login` with `missingSteps: "fail-on-gen"`, so a bound scenario without
steps fails generation rather than skipping. Its journeys start on the Academy entry and
do their credential work on `login-<slot>`; the storefront projects leave those scenarios
to it. A door scenario that has no steps yet is parked with `@quarantine:login(#N)` (open
Issue) and stays on its storefront project; so is a `@default-auth-limits` one, which only
the loopback Academy contour runs (#3780) — the lint refuses `@host:login` on it, since
the `login` project never selects that tag. `sign-in-host` is the host's own plain specs
(`packages/e2e/sign-in-host`). Neither selects a host axe or live leg.

**Which run executes a binding (#3345 item 4).** The `login` project here runs every
`@host:login` binding. Each binding also names its PR-CI fate with exactly one tag, which
the same lint requires: `@pr-ci:login` — the `apps/login` PR-CI tier (`playwright-axe-login`,
project `door-scenarios` of `apps/login/playwright.ci.config.ts`) runs it on every PR that
touches the host, the 003 catalog, the shared steps or the lint, against that tier's API
double — or `@stage-only:login(<class>)`, run here only, for a class from the fixed list
`live-idp` (real accounts, sessions or IdP state), `mail`, `sms` (a code read from the
stand's sinks), `captcha` (the stage-1 test token) or `cross-host-session` (a session shared
by both storefronts). A free-text reason is a finding.

The runner builds `@ds/e2e`'s workspace dependencies before BDD generation, so a clean
worktree needs no hand-built `packages/db/dist` or `packages/legal-content/dist` artifact.

**It never raises a slot.** A converged slot is the PRECONDITION: the command makes one
`/v1/health` read of `api-<slot>.<base domain>` and **exits 2** naming that URL when it
does not answer — a suite pointed at a half-raised slot reports topology as product
regressions. Raise the slot with `pnpm stage:slot up <slot> --ref <sha>` first.

### Academy partnership storage failure (#4121)

The Academy live tier submits the real form on the guest portal. Its acceptance
case checks that a retry after a lost response leaves one private synthetic
record. For the failure case the slot runs the same portal image as
`<slot>-portal-partnership-unavailable` with `ACADEMY_SUBMISSIONS_DIR=/dev/null`
and no submissions volume or credentials. Its own healthcheck requires the guest
home to respond and the storage target to be a character device. The normal slot
health gate checks both portals against the same SHA-tagged image.

The shared stage edge routes `academy-partnership-unavailable-<slot>.<domain>`
through the usual staging gate for the home and its assets. All other routes
return 404. The browser test observes an actual POST response, checks retained
form values, and requires one new persistence failure in the fixture. The normal
portal's store must have zero records for that run's synthetic contact both
before and after. The fixture observation returns an exact fixed-marker count
from at most 200 recent log lines with a 20-second CI read timeout.

A PR preview does not update the shared edge. Before the new static edge config
is on stage, an authorized operator can verify the preview's real fixture over
an SSH tunnel. Read the fixture container's address on the owned slot network
and keep the local port bound to IPv4 loopback:

```sh
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:<port>:<fixture-ip>:3001 ds-stage-1
```

Set `E2E_ACADEMY_PARTNERSHIP_UNAVAILABLE_LOOPBACK=http://127.0.0.1:<port>` only
for that PR slot's `pnpm e2e:stage pr-<N>` run. This exercises the real preview
portal and owning-layer observations. The shared TLS, gate and path checks use
the normal HTTPS route after main converge. The release run refuses the override
for `main`.

### Storefront sign-in entry unavailability (#4128)

The Academy default and doctor shell live tiers each open a guest login door on
the corresponding slot fixture. The fixtures run the slot's recorded portal and
doctor images. Their transaction destination is an unused port in each
container's own loopback namespace, with a fixture-only bearer. The containers
have no stage env files, volumes or published ports. A healthcheck uses document
navigation headers and requires the real door to return 503.

The stage edge exposes `academy-entry-unavailable-<slot>.<domain>` and
`doctor-entry-unavailable-<slot>.<domain>` through the stage gate for GET/HEAD
login, home and assets. The browser checks that the original door URL returns
503, the retry navigates to that same URL and receives 503 again, and the home
link takes the visitor back to that storefront. No ordinary slot sign-in is
modified. Main convergence installs the stage edge config before the release
suite runs, and both cases are required by the D13 register.

A PR slot does not install the shared edge. Before the fixture routes are
present there, use the same preview procedure as the partnership fixture:
inspect the owned slot's `portal-entry-unavailable` and
`doctor-entry-unavailable` addresses, then tunnel to ports 3001 and 3004
respectively. The operator's listener must bind to IPv4 loopback. In a shell
with the existing stage storefront origins exported as `E2E_PORTAL_URL`
and `E2E_DOCTOR_URL`, run one focused test per config:

```sh
E2E_PORTAL_ENTRY_UNAVAILABLE_LOOPBACK=http://127.0.0.1:<portal-port> \
  pnpm --filter @ds/portal exec playwright test --config=playwright.config.ts --project=e2e --workers=1 e2e/storefront-entry-refusal-live.spec.ts
E2E_DOCTOR_ENTRY_UNAVAILABLE_LOOPBACK=http://127.0.0.1:<doctor-port> \
  pnpm --filter @ds/doctor exec playwright test --config=playwright.shell.config.ts --project=chromium --workers=1 e2e/storefront-entry-refusal-live.spec.ts
```

The override accepts a plain IPv4 loopback origin for a PR slot only. A
main run always uses the normal HTTPS staging route.

### The release check: `--expect-sha`

`pnpm e2e:stage main --expect-sha <40-char sha>` is the release check (tech spec C7,
#2701). It is the full run and nothing less: it refuses any slot but `main`, any
`--project` / `--grep` / `--no-axe` / `--no-live`, an `E2E_GREP` in the env (the config would compile
it into a filter) and a missing `CI` (without it Playwright's `forbidOnly` is off). It
then asserts the slot's `/v1/health` serves exactly that SHA before a scenario runs, and
exits **2** on any of these refusals. It runs the storefront live-tier legs (below) like
every other leg (#3191) — all of them since #3229; a leg `live-tiers.mjs` excludes with
a reason is named instead of run — `--no-live` is refused like the other narrowing
flags — and a red live leg fails it. You do not normally run it by hand. For a
target from `main` the `stage.yml` suite job runs it in Actions and posts the
`stage-suite` status the release pre-flight reads (below). For a `--ref` hotfix target,
which is no `main` push, `pnpm deploy:prod` runs it on the PC as its last pre-flight step,
from a clean detached checkout of the target SHA, right after `stage:slot up main --ref
<sha>` converged the slot (`tools/deploy/README.md` → «Stage `main` check»); that run
writes nothing to GitHub.

The same command enforces the key-journey register (§6.7, #4129). The adjacent
[`2026-09-08-key-journey-tests.json`](../../apps/docs/content/specs/tech/2026-09-08-key-journey-tests.json)
lists exact leg/file/project/title identities, including outline examples, for the
register's positive citations. Each must execute successfully; a skip, missing test,
missing report or never-launched leg fails with exit `1` and names the row and test.
Missing or invalid list data fails closed. A reused `--report-dir` is safe: each leg's
old JSON is removed before launch. Update the list with a key action's shipping PR;
it is not regenerated from whichever tests happen to run today. Focused runs without
`--expect-sha` keep their existing semantics.

### The same check in Actions: `.github/workflows/stage.yml` (#2985)

Every successful `runtime-images.yml` run of a push to `main` triggers
`.github/workflows/stage.yml` (one run at a time, group `stage-main`, never cancelled).
`pnpm bootstrap` shows the newest main commit's `stage-suite` and the newest green SHA (a
`## Warnings` row when main is red, or the newest commit has no verdict > 1 h after it), and
`pnpm pr:land` prints a WARNING naming the first red commit of a red streak
(`tools/staging/stage-suite.mjs`, #3269). The run:

1. **`converge`** (environment `stage`) sets the commit status `stage-suite` to
   `pending`, downloads `images-<sha>.json` from the triggering run and sends it over
   ssh to the box's forced command, `release stage-main <sha>`. The release driver on
   the box runs the converge in its own `systemd-run` unit, so the job dying never
   kills it; the job then polls `status stage-main <sha>` every 15 s (45 min limit),
   printing one line per poll: driver state, exit code, release step, release state.
2. **`suite`** (environment `stage`) checks out the SHA and runs
   `node tools/staging/e2e-stage.mjs main --expect-sha <sha>` with `STAGE_BASE_DOMAIN`,
   `E2E_HTTP_USER` and the stage secrets (basic-auth password, captcha test token, the
   four golden passwords) exported — the no-SSH mode above, so `e2e-stage.mjs` itself
   never reads the box — plus `CI=1` and **`E2E_PUBLIC_LOG=1`**. The box-observing
   scenarios (the owned mirror count, consent, phone, congress and wrong-verification
   snapshots, the live password policy, the synthetic partnership submission) read
   stage `main` only through the CI key's
   forced command, `observe <name>`: the job writes the key and the pinned host key into
   `$RUNNER_TEMP/stage-ssh/` before the suite and exports `E2E_STAGE_OBSERVE_SSH`
   (`deploy@<box>`), `E2E_STAGE_OBSERVE_KEY` and `E2E_STAGE_OBSERVE_KNOWN_HOSTS` (two
   paths, never the key), and `packages/e2e/lib/stage-observe.ts` then sends each read as
   one named, read-only observation with its parameters as JSON on stdin. The box runs
   only the observations defined in `infra/deploy/bin/ds-deploy-entrypoint`, validates
   every parameter and answers only what the lib parses. Database observations use
   a `BEGIN READ ONLY` transaction (release-pipeline spec §5, «Stage suite box reads»).
   The existing Academy slot URL selects the partnership browser test. The observer
   verifies the configured stage domain before the form is opened.
   The partnership observation runs in the stage portal as its runtime user. It returns
   only the synthetic contact's matching record count and whether the sole match
   has the expected fields and private file metadata. It bounds reads to 10,000
   directory entries, 16 KiB per record and 20 seconds per CI observation. Each
   completed test uses one synthetic record in its slot's volume.
   Without those three variables the same libs read the box with the operator's own
   ssh. A preview reads its own portal with the same fixed partnership predicate
   from the checked-out source. A preview never installs the box-wide entrypoint
   (#3125); the first stage-main converge on the merged SHA installs the CI observation.
   In public-log mode the console reporter is
   `packages/e2e/reporters/summary.ts` (one line per test: status, project, title path,
   duration, retry — no error text, no test output, no URL), the two axe legs get the
   same reporter, and the HTML + JSON report is written only into the report dir. The
   step summary records the run's peak memory (`/usr/bin/time -v` max RSS and sampled
   `free -m`), the number `E2E_WORKERS` is set from.
3. Always, pass or fail, the report dir is streamed as a tar to
   `upload-report <sha> attempt-<N>-run-<id>` (`GITHUB_RUN_ATTEMPT`, `GITHUB_RUN_ID`;
   `reportAttemptKey` / `boxReportDir` in `e2e-stage.mjs`): it lands on the box at
   `/var/lib/ds-platform/e2e-reports/<sha>/attempt-<N>-run-<id>/`, so a re-run on the
   same SHA keeps the failed attempt's report beside its own; the box refuses an
   attempt dir that already exists (#4250). The latest attempt is the highest run id,
   then the highest attempt (`latestReportAttempt`); a SHA dir is pruned 14 days after
   its newest attempt.
   The axe legs write their own JSON + HTML + traces under `axe-<host>/` in the same dir.
   A failed upload is a warning and a step-summary line, never the suite verdict.
   Nothing is uploaded as an Actions artifact — the repository's logs and artifacts are
   public (release-pipeline spec §4).
4. The commit status `stage-suite` becomes `success` / `failure` with counts only
   (`412 passed, 3 failed, 12 skipped`). A failed converge sets it to `failure` and the
   suite does not run; a run cancelled between the two jobs is closed as `failure` by
   the `close-status` job, so the status is never left pending.

Every slot (incl. `main`) runs the api with the CI test-runner auth ceilings (`RATE_LIMIT_*`
in `infra/deploy/compose/slot/compose.yml`): the suite signs in hundreds of times from one
runner address, which the production per-IP window throttles into a false 429; the rate
limits themselves are proven by the `apps/api` unit and api-e2e suites (#2683).

Everything it needs comes from the same places the converge reads: the hostnames from
`slotHostnames()`, the base domain and the basic-auth user from `/etc/ds-platform/stage.env`
over SSH, the password from `STAGE_BASIC_AUTH_PASS` on THIS machine. An operator without
SSH to the box can export `STAGE_BASE_DOMAIN`, `E2E_HTTP_USER` and `E2E_HTTP_PASS` instead
and the box is never contacted. The password is passed to Playwright as `httpCredentials`
and never printed.

**The signed-in leg needs the golden passwords too**, and they are NOT covered by
`STAGE_BASIC_AUTH_PASS`. With SSH access, `e2e:stage` reads them in the same single
`/etc/ds-platform/stage.env` read it already uses for topology and forwards exactly the
four live allowlisted names to Playwright; it never forwards the rest of the box's secret
set and never prints a value. An explicit `DS_GOLDEN_PASSWORD_*` on THIS machine wins over
the box value, which is also how an operator in the no-SSH mode supplies credentials.

The registry (`packages/e2e/lib/golden.ts`) turns the feature file's seed name into the env
var `packages/db/src/seed/golden/idp.ts` declares for that account, and an unavailable one
is a named failure, never a silent sign-in attempt with `undefined`. The seed declares five names —
`DS_GOLDEN_PASSWORD_DOCTOR_UNVERIFIED`, `DS_GOLDEN_PASSWORD_DOCTOR_VERIFIED`,
`DS_GOLDEN_PASSWORD_DOCTOR_MFA`, `DS_GOLDEN_PASSWORD_DOCTOR_DELETED` and
`DS_GOLDEN_PASSWORD_ADMIN` — but only FOUR are exportable. The box deliberately carries no
`DS_GOLDEN_PASSWORD_DOCTOR_DELETED`: the soft-deleted doctor is ensure-**absent** on the
shared IdP by contract (see `reset-identities` below), so it has no live account to sign in
as, and a scenario asking for that seed name to sign in is a scenario defect rather than a
missing secret. `DS_GOLDEN_PASSWORD_ADMIN` is read only by the admin suite: the `admin` host
tag is deliberately selected by NO storefront project (`packages/e2e/lib/host-tags.ts`), so a
`--project academy`/`doctor` run never reaches for it. The four are the same owner-placed
values `reset-identities` converges from. An operator without SSH to the box exports only
the values the selected suite needs; they are secrets, and like the basic-auth password the
suite never prints them.

The **a11y leg** (§6.6) joins the run only once #1692 — the contrast fix — is on `main`;
while it is open the command prints
`axe leg skipped: #1692 open` and runs the suite alone, because a known-red axe leg would
train the operator to ignore the leg.

### One run owns slot `main` (#4259)

Slot `main` is driven by one run at a time: either the automatic `stage.yml` converge
plus its suite, or a workstation `pnpm e2e:stage main` run. A converge recreates the
containers and flushes the slot's redis, so an overlap renders false server errors in the
other run (#4096). `tools/staging/slot-hold.mjs` holds the decision:

- **The automatic side** is held by its `stage.yml` run itself — the `stage-main` Actions
  concurrency group already serialises those runs, so any run of a `main` push that is not
  `completed` (queued, pending or in progress) holds the slot for both its jobs.
- **A workstation run of `main`** records its hold on the box,
  `/var/lib/ds-platform/slot-holds/main.json` (root-owned, written through `sudo` over the
  operator's ssh): the holder (`operator <user>@<host> e2e:stage main (pid N)`), since when,
  and a stale bound. It takes the hold first, then reads `gh run list`; it refuses with
  exit 2, naming the holder and since when, while another operator's hold is live or a
  `stage.yml` run of `main` is not completed, and drops its hold when it ends (Ctrl-C too).
  The Actions suite job (`GITHUB_ACTIONS=true`) takes no hold: it runs inside its own run.
- **The converge** (`slot.mjs up|sync|reset main`, the release driver's unit included)
  refuses while an operator hold is live, naming it.
- **Stale holders** never wedge the slot: an operator hold is stale 2 h after it was taken,
  a `stage.yml` run 160 min after it was created (its two job limits, 55 + 90 min, plus
  15 min); a stale or unreadable record is reclaimed with a line naming whose hold it was.

A run that cannot read the box or `gh run list` refuses rather than guessing. PR slots
(`pr-<N>`) take no hold.

### The live-tier legs (#3168)

The storefronts own Playwright configs that boot **no** `webServer` and drive a real
api + IdP + Mailpit at `E2E_PORTAL_URL` / `E2E_DOCTOR_URL`. On a bare CI runner their
specs can only skip, so a slot is the only place they run. `tools/staging/live-tiers.mjs`
is their registry, and `e2e-stage.test.mjs` holds it against the tree: every
`apps/{portal,doctor}/playwright*.config.ts` is either a **live** leg (no `webServer`),
an **axe** leg, or **hermetic** (owns a `webServer`, CI's), and a config in none of
them — or a live one that grew a `webServer` — fails `pnpm test:tools`.

| Leg                          | Config (`apps/<app>/…`)                                                                                                                  | Release check |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `live/admin/event-lifecycle` | `admin/playwright.flows.config.ts` (`stage-event-lifecycle.spec.ts`, `stage-congress-review.spec.ts`, `stage-recording-publish.spec.ts`) | yes           |
| `live/academy/default`       | `portal/playwright.config.ts` (`e2e` + `bdd`)                                                                                            | yes           |
| `live/academy/account-live`  | `portal/playwright.account-live.config.ts`                                                                                               | yes           |
| `live/academy/event-page`    | `portal/playwright.event-page.config.ts` (event page, narrow hero plate, canvas structure, archive)                                      | yes           |
| `live/doctor/register-live`  | `doctor/playwright.register-live.config.ts`                                                                                              | yes           |
| `live/doctor/congress`       | `doctor/playwright.congress.config.ts`                                                                                                   | yes           |
| `live/doctor/event-page`     | `doctor/playwright.event-page.config.ts`                                                                                                 | yes           |
| `live/doctor/event-register` | `doctor/playwright.event-register.config.ts`                                                                                             | yes           |
| `live/doctor/events-live`    | `doctor/playwright.events-live.config.ts`                                                                                                | yes           |
| `live/doctor/learning`       | `doctor/playwright.learning-live.config.ts` (`learning-path-live.spec.ts`, golden course)                                                | yes           |
| `live/doctor/feed-live`      | `doctor/playwright.feed-live.config.ts` (`feed-adjacent.spec.ts`, `specialty-feed-pick-live.spec.ts` with Mailpit)                       | yes           |
| `live/doctor/room`           | `doctor/playwright.room.config.ts` (`room-player-chat-live`, `room-canvas-structure-live`; axe runs separately)                          | yes           |
| `live/doctor/shell`          | `doctor/playwright.shell.config.ts`                                                                                                      | yes           |

Each leg gets the suite env plus `IDP_ISSUER=https://id.<base domain>` and
`MAILPIT_URL=https://mailpit.<base domain>` (hostnames, never `127.0.0.1`: Playwright
sends no `__Host-` cookie there); the doctor configs answer the basic-auth challenge
through `@ds/e2e/stand-http-credentials`. `--project academy|doctor` selects legs like
the axe legs (`walks` selects none); `--no-live` drops them. The admin leg runs on a
full slot run without a storefront project filter. The release check
(`--expect-sha`) runs every leg the table marks «yes» (#3191) — every leg since #3229. A
leg kept out carries `releaseCheck: { excluded: "<reason>" }` in `live-tiers.mjs` and
reads «no» here: the release check prints `live: <leg> not in the release check —
<reason>` and does not run it, while a plain slot run still does.

**Derived for the slot (#3191).** The release check runs in Actions (`stage.yml` job
`suite`, «The same check in Actions» above), which never reads the box: its env is the
base domain, the basic-auth pair, the captcha test token, the four golden passwords
and the dedicated stage agent admin credentials. The rest of a leg's env is derived from those and from repo data
only — `slotLiveStandEnv` (`e2e-stage.mjs`), one derivation for both modes (over ssh the
golden passwords come from the box's `stage.env` under the same `DS_GOLDEN_PASSWORD_*`
names, and no other box key is handed over); an operator export wins over each value:

- `E2E_DOCTOR_EMAIL`/`_PASSWORD` and `E2E_DOCTOR2_*` — the golden verified doctor and
  its first worker-pool copy (`idp.mjs` GOLDEN_IDP_ACCOUNTS), with
  `DS_GOLDEN_PASSWORD_DOCTOR_VERIFIED`;
- the golden event slugs and `/events` paths per storefront (`GOLDEN_LIVE_ENV` in
  `live-tiers.mjs`, held against `packages/db/src/seed/golden/ids.ts`), and
  `E2E_API_URL` = the slot's api origin.

The admin leg uses dedicated stage staff with pre-enrolled TOTP. Pass these keys
through the existing Actions **Stage suite** step or the operator's in-memory
environment:

- `DS_STAGE_AGENT_ADMIN_PASSWORD` and `DS_STAGE_AGENT_ADMIN_TOTP_SECRET` for event
  lifecycle and roster access.
- `DS_STAGE_AGENT_COMMITTEE_PASSWORD` and `DS_STAGE_AGENT_COMMITTEE_TOTP_SECRET` for
  the committee decision on the doctor congress.

The runner forwards the staff keys only to the admin leg. Both specs disable
trace, screenshot and video capture. The runner sets
`PLAYWRIGHT_NO_COPY_PROMPT=1` to keep the MFA form out of Playwright's error-time
accessibility snapshot.

The event lifecycle spec retires the event it creates through the admin
lifecycle. The recording publish spec takes its own event to ended, attaches
and publishes a recording, checks it plays for the signed-in stage doctor on
both storefronts, and retires that event the same way. The congress review spec creates a fresh doctor and submission,
checks the decision in the doctor's cabinet, and finds that doctor on the roster.

Event slugs come from the golden set the slot was seeded with (#2996): a tier's
`seededEnv` (`live-tiers.mjs` → `GOLDEN_SLUGS`) names the golden event carrying each shape
its specs assert, only that tier's leg receives them, and a value the operator exported
wins; it also wins over the host-wide
`GOLDEN_LIVE_ENV` slug for that leg. `apps/api/test/scripts/stage-event-page-slugs.spec.ts` builds the golden dataset and
fails when a mirrored slug stops carrying its shape.

The doctor event-page tier uses `E2E_DOCTOR_RECORDING_BOTH_CUTS_SLUG` for the
signed-in recording journey (014 EARS-6/8). The golden event carries a public
RuTube montage and its distinct original. The journey follows the recording
gate through real sign-in and requires a presented video frame from RuTube.

An IdP management token (`IDP_SERVICE_TOKEN`/`IDP_PROJECT_ID`), the api's
`CONGRESS_SIGNUP_*` block and a `DATABASE_URL` are **not** derived and not added to the
Actions env (a management token in a public repo's Actions env widens the blast radius;
congress intake is closed): the specs that need them carry a `slotReason`.

**Workers.** `live/academy/default` honours `E2E_WORKERS` (the suite job sets 4): its
spec files run in parallel, each journey registering its own address and reading Mailpit
by that recipient; the files signed in as the one golden doctor pair form the
`golden-account` project, held to one worker (`apps/portal/playwright.config.ts`). The
doctor live configs stay on one worker.

Raw Node `fetch`es (Mailpit reads) carry the basic-auth pair through
`standBasicAuthHeaders`, and raw api calls on a captcha-gated route carry the test token
through `captchaTestTokenHeaders` (`@ds/e2e/captcha-stub`).

A spec gated through `requireLiveStandEnv` on a variable the leg does not have would read
a slot run as an _intended_ tier and fail loudly, so the registry declares what each gated
spec requires and the leg keeps it out (`--test-list-invert`), printing it as `not run:
<spec> (missing <names>)`. A spec a slot **cannot** run carries a `slotReason` and prints
as `not run: <spec> (by design: <reason>)`: the provider-variant room specs (the golden
dataset seeds only rutube streams), the heartbeat-cadence specs (a slot api runs the
production 60 s cadence), the congress-submission specs (they write fixture rows straight
into a database a slot keeps inside the box's docker network) and the one-tap
registration (005 registration is append-only, so a run consumes its эфиры), the
signed-in landing spec (an IdP management token; permanently out — a box verb holding the token would need the ssh the Actions release check does not have) and the congress login hand-off (the
`CONGRESS_SIGNUP_*` block). A config that throws at load without its env is not launched at all.
Export the variable on this machine and the spec runs. The verdict block prints
one `live:` line per config:

- `PASS — ran N passed / 0 failed / M skipped` — at least one test passed;
- `FAIL — ran …` — a test failed or the run exited non-zero: **fatal** (exit `1`);
- `FAIL — runner exited <code> before any test ran` — the runner (or the leg's `prepare`,
  e.g. `bddgen`) died before its report held a single test: **fatal**;
- `SKIPPED — ran 0 passed / 0 failed / M skipped` — every test skipped, never green;
- `skipped — missing env <names>` — the config was not launched.

A skipped leg is loud but **not fatal on its own** (a key the release check does not carry);
the release check still fails if that leg owes any register-cited test. Otherwise the verdict
reads `PASS — <n> live legs skipped`. Each leg writes `results.json` (and in public-log
mode the summary reporter, HTML and traces) under `live-<host>-<config>/` in the report dir.

Reports land under `packages/e2e/playwright-report/<slot>-<timestamp>/` (HTML +
`results.json`, gitignored, local only) so a second run cannot overwrite the evidence.
Stdout ends with a fenced **verdict block** — slot, the SHA `/v1/health` reports, the
per-project passed/failed/skipped counts, the axe verdict, one line per live-tier config
and the report path. That block is the artefact you paste. Exit `0` no leg failed (skipped
live legs included only when they owe no required test), `1` a failing leg or required
test, `2` pre-flight or invalid manifest.

A scenario whose steps have no definition in the shared step vocabulary reports as
**skipped** — `missingSteps: "skip-scenario"`, the
deliberate choice `packages/e2e/playwright.config.ts` records. The verdict block prints
the skipped count rather than hiding it, so «0 passed / N skipped» is a truthful reading
of what this run executed, not a defect of this command. Regression coverage is the
key-journey register (regression-contour tech spec §6.7): each key user action mapped to
the binding or live tier this run executes, with each positive citation required by the
release check's machine list. Unlisted skips remain gaps. `pnpm scenarios:inventory` is a record of
scenario proof, headlined journeys bound / journeys total; a `@rule` may
also count by a verified `@proof:<level>` tag, a `@journey` only by binding here or in
`apps/admin/e2e` (regression-contour tech spec §6.1/§6.4).

## `slot.mjs` in one paragraph

A slot is `main` or `pr-<N>`, and every name it touches — compose project, network,
database, hostnames, container aliases, tree directory under `$HOME/ds-platform.slots` —
is DERIVED from it, so a slot can never be addressed two ways. `docker ps` on the box is
the single authority on which slots are live; there is no registry file and nothing is
cached. `up`/`sync` first resolve, **on the operator's machine**, the images
`.github/workflows/runtime-images.yml` recorded for `--ref <sha>`: `gh run list --workflow
runtime-images.yml --commit <sha>` → `gh run download <run> -n images-<sha>` → validate
`images-<sha>.json` (its `sha` is the ref; all six of `api`, `api-migrate`, `portal`,
`admin`, `doctor`, `login` are `ds-platform.registry.twcstorage.ru/[pr/]<image>@sha256:…`). Slot
`main` accepts only a release build — `main`, or the `hotfix/<N>-<slug>` build a `--ref`
release pre-flight converges it to; `pr-<N>` accepts its own `pr/<N>` build or a `main`
one for the same SHA. A `pr/<N>` build is pushed and recorded only while the PR carries
the `stage-slot` label (`PR_IMAGES_LABEL`, `tools/deploy/lib/registry.mjs`); a PR run
without it records nothing and the refusal names the label. No run, a run still in
progress, a failed run or an expired artifact stops the converge **before the box is touched** — there is no build fallback
(«the PR head changes no image input, so runtime-images did not run — nothing to stage»).
Then they ship the tree (a `main` converge of a SHA on `main` then installs the stg-infra
edge config from it — the Caddyfile the stg-infra compose mounts into caddy, validated
and swapped onto with a restart of caddy only if it is stale, the SHA recorded in
`.ds-edge-config`: [stg-infra README → Edge config apply](../../infra/deploy/compose/stg-infra/README.md#edge-config-apply)),
log the box into the registry with the root-only
`/etc/ds-platform/registry-pull-token` (read by the box's own shell; the token is in no
argv, log or plan), pull each recorded digest and tag it `ds-<image>:<sha>`, log the box
out again (a failed pull included — the token file stays the only registry credential at
rest), assert every
tag's `RepoDigests` carries exactly the recorded digest, boot-probe, clone the slot database from
`ds_golden` (never for `main`, which is persistent), run migrate and the golden seed
through the containerized `migrate` one-shot, start
`infra/deploy/compose/slot/compose.yml`, converge the shared IdP and assert
`/v1/health`; `down` reverses it. The slot's **object storage** follows its database
exactly: `up`/`sync` ensure the MinIO bucket `ds-<slot>` is present (before migrate, so
the branch seed can write objects) and a preview's `down` drops it with
`mc rb --force`; `main` keeps its bucket, and `reset main` re-clones rows without
touching a single object. `reset-identities` is folded into every `up`/`sync` and
is idempotent, so a converge needs no second operator command.

Local image tags are per full commit SHA and shared between slots. A second slot at
the same ref reuses an existing `ds-<image>:<sha>` only when its `RepoDigests` carry the
recorded digest; a tag with any other digest is re-pulled and re-tagged. One SHA staged
both as a preview from its `pr/` digests and as `main` from the `main` digests therefore
re-pulls on every converge of either slot, as the tag moves between the two digests;
running containers keep their image IDs, so nothing breaks. `down`, `gc`
and retention preserve other containers' original requested tags (`Config.Image`), even
when `docker ps` displays an image ID after a tag was moved. Retention also keeps
the full image bundle for each live commit, including the one-shot migration image
whose container is removed after use; image timestamps do not evict it. It also keeps
the tags of every slot release still on the box — the SHA in each `ds-stage-<slot>-<sha12>-*`
`ds-release` unit — so a slot whose `up` has pulled but not yet run `up -d` (no
container yet) keeps its images while another slot's converge prunes (#3459). While any
`pull-*` unit still runs, no registry digest record is removed: that pull's record has no
`ds-*` tag until its `docker tag`. A box whose units cannot be listed fails the prune
rather than pruning blind. The images
carry no environment (#2995): stage's captcha site key and contour flag are runtime
env, so the same digest serves every slot and, later, production. The BuildKit cache
cap in the converge's prune stays: `stg-infra`'s `postgres` is still built on the box.

**Box entrypoints (#3125).** `/usr/local/bin/ds-release`, `/usr/local/bin/ds-deploy-entrypoint`
and `/usr/local/lib/ds-platform/release-driver` are box-global, so on ds-stage-1 only the
stage `main` converge of a SHA contained in `main` installs them from the tree it just
shipped: an operator `up main` / `reset main` after `git fetch origin main` and
`git merge-base --is-ancestor <sha> origin/main`, and the release driver's `--local` unit,
whose provenance check already proved it. A PR slot run and a `main` converge at a hotfix
ref install nothing: they first check the box has all three (absent ⇒ the run fails
with «converge `main` first») and print once that they use the box's installed
entrypoints. So a PR that changes the box entrypoints cannot exercise them on its PR
slot; their live proof is the post-merge `main` converge. Prod runs install from the
tree they ship.

**Durable box steps (#2982).** Every long box step of a converge — each image pull
(`pull-<image>`), `migrate`, `seed`, `up` and `prune` — runs as its own systemd unit
`ds-stage-main-<sha12>-<step>` / `ds-stage-pr-<N>-<sha12>-<step>` instead of a streamed ssh
command. The operator starts it, then polls `ds-release status`, one status line per
poll; the step's log stays in its journal on the box (`sudo journalctl -u <unit>`). A
killed operator session leaves the unit running, and a re-run at the same SHA — while
that converge's release is still open — returns each recorded verdict (never re-running a
succeeded step) or reattaches; a step recorded as failed re-runs only with
`--retry-failed` on `up` / `sync` / `reset`. The converge closes its release (`finish`) as
its last step, or as failed when it throws; until it is closed, a converge of the same
slot at another SHA is refused and names the open one. A closed release answers for
nothing: the next converge at that SHA archives it and runs every step again, and a
converge at a new SHA marks the previous one `superseded` (so `main` B → C → B converges
for real). `down` drops the slot's verdicts (`ds-release forget`) as its first step —
refused while a step unit still runs, before anything is torn down — and `reset main`
drops them before the re-cloned database is migrated again. Spec: `apps/docs/content/specs/tech/2026-10-16-release-pipeline-off-workstation-en.md` §5.

`up main --ref <sha> --local --images-file <path|->` is the same converge run **on the box**
by its release driver (`infra/deploy/bin/release-driver`, #2985), from the codeload tarball
of exactly that SHA: every ssh script, capture and ship goes through a local `bash -c`
instead of `ssh` (same stdin, quoting and watchdog — `LOCAL_EXECUTOR` in
`tools/deploy/lib/remote.mjs`), the ship installs the tree the run came from as the slot
tree, the digests come from the `images-<sha>.json` file (`-` reads it from the inherited stdin,
fd 0, without opening a path — the driver's manifest is root-only; validated strictly; which
`runtime-images.yml` run it came from is the caller's check) instead of `gh`, and the
health check takes the basic-auth plaintext from the `password=` line of
`/etc/ds-platform/stage-basic-auth.txt` (as the operator's `sed` does; the user stays
`STAGE_BASIC_AUTH_USER` from `stage.env`), refusing by name when that line is absent or empty.
The plan and its steps are the operator's, which `slot-local.test.mjs` pins. Only `up main`
takes `--local`: PR slots stay operator-driven. Spec: release-pipeline spec §5.

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

The golden dataset's live accounts (two doctors, the MFA doctor, the admin, and the #2805
worker pool `golden.doctor.verified.w1…w5@example.test`, which reuses
`DS_GOLDEN_PASSWORD_DOCTOR_VERIFIED`) and the
soft-deleted doctor live on the SHARED stage Zitadel, not per slot, and nothing else
provisions them — without this command `slot up` refuses at its `seed:golden` one-shot.
One run does four things, in order (plus the agent admin, below):

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
2. **Write the subjects.** Every `DS_GOLDEN_SUB_*` (the five named accounts and the
   worker pool's `…_VERIFIED_W1`…`_W5`) is written idempotently to
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

The same run converges two dedicated stage staff accounts through the golden
identity writers. The **agent admin** `golden.admin.agent@example.test` holds
`doctor_guest` and `platform_admin`. The **agent committee member**
`golden.committee.agent@example.test` holds `doctor_guest` and
`congress-program-committee`. Before changing the committee account, converge
checks that its subject differs from the golden subjects and the agent admin.
An existing email hit must be the expected human with the exact username and
email in the stage organization. Converge also refuses unexpected stage-project
roles.

Both accounts' TOTP factors follow the same probe, write and read-back sequence:

| Factor at the IdP                       | Secret stored on the box | Action                                                                                                                        |
| --------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| absent, or provisional (never verified) | any                      | register (`POST /v2/users/{id}/totp`), store the secret, verify with the derived code, re-read READY                          |
| READY                                   | yes                      | keep — logs `TOTP already enrolled` for that account                                                                          |
| READY                                   | no                       | remove THIS account's factor (`DELETE /management/v1/users/{id}/auth_factors/otp`, proven by re-read), then register as above |

The tool mints the credentials in root-owned `0600` files under
`/etc/ds-platform/`: `stage-agent-admin.env` and
`stage-agent-committee.env`. The password is stored before the first IdP write
and the TOTP secret before verification, so converge can resume after a failure.
After an external factor reset, remove that account's stored TOTP line and rerun
`reset-identities` to re-enroll it.

The API heals the agent admin's mirror on first sign-in. Slot converge passes the
committee's opaque `DS_STAGE_AGENT_COMMITTEE_SUB` to `seed:golden`, which writes
its mirror and one event-role grant for the golden doctor congress. The ordinary
golden seed omits both rows when the subject is absent.

The TOTP factors of the golden `doctorMfa` and `admin` are NOT converged and never touched
by this command: they are enrolled in the owner's authenticator. The command guarantees
their existence, password and email state only.

### Agent admin sign-in recipe

1. `pnpm stage:slot up pr-<N> --ref <sha>` (or `reset-identities pr-<N>`) — the log shows
   either `TOTP enrolled for golden.admin.agent@example.test` or `TOTP already enrolled …`.
2. `pnpm stage:slot agent-admin-code` prints the current six-digit code and how many seconds
   it stays valid; `pnpm stage:slot agent-admin-code --json` prints
   `{username, password, code, secondsLeft}` for a Playwright drive. Run it at the moment
   of the challenge, not ahead of it — and wait for the next window when `secondsLeft` is
   under ~5.
3. Open `https://admin-pr-<N>.<base-domain>/` (Basic-auth gate first), sign in with the
   username and password, enter the code at `/mfa/challenge`; the admin home follows.

The output goes to your terminal only — never paste the password or the code into a PR,
a comment or a log.

## Redirect-URI convergence

The shared Zitadel app accepts only registered redirect URIs and that registration is a
**whole-set** write — a partial list silently unregisters every other slot. `slot.mjs`
renders the full ordered set for every LIVE slot with `renderIdpRedirectUris(slotNames,
baseDomain)` (printed by `pnpm stage:slot status`) and converges it onto the shared app
through the same management API and PAT path `infra/dev-stand/idp/provision.sh` uses: the
PAT is read from `/etc/ds-platform/idp-bootstrap-pat.txt` on the box, the origin from
`resolveIdpBaseUrl` (see above).

The converge runs as the LAST step of the `up`, `sync`, `down` and `reset` plans, after
the slot's containers have reached their new state. Parallel sessions converge the same
app, so the set is never the snapshot the command took at start: the live slots are
re-read from `docker ps` immediately before the write (`desiredRedirectSetAt` — the
command's own slot forced in for `up`/`sync`, out for `down`), the current `oidc_config`
is probed and the `PUT` skipped when the sets already match (order-insensitive compare),
and the app is read back afterwards against a fresh live read. A read-back that lacks a
live slot's callback or still holds a removed one re-reads and re-converges — at most 3
attempts, 2 s then 4 s backoff — and still wrong fails the command naming every missing /
extra URI; it never succeeds silently. Any URIs
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

`pnpm stage:slot gc` reclaims Docker disk on the box: slot images no live slot runs, the
registry digest records no kept `ds-*` tag shares, and — below the 10 GB free-space floor —
every unused slot tag past the newest four per repo plus the 24h dangling-image prune. The box runs no unit of ours, so there is nothing nightly about it: an
operator runs it. The floor itself does not wait for an operator: every `up`/`sync` holds it
before anything is shipped or pulled, and refuses to pull when reclaiming cannot restore it.

Operating detail — the compose projects, Redis allocation, the preview cap and the `gc`
free-disk floor — lives in
[`infra/deploy/compose/stg-infra/README.md`](../../infra/deploy/compose/stg-infra/README.md)
→ «Slots (#2064)». Production deploy tooling is a separate story:
[`tools/deploy/README.md`](../deploy/README.md).
