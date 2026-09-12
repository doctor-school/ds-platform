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

Both entry points ship as package scripts, so nothing is invoked by path:

```bash
pnpm stage:slot up pr-123 --ref <40-char sha>
pnpm stage:slot status
pnpm stage:slot gc
pnpm staging:golden-db --dry-run
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
read it over SSH. Two variables are the exception and belong to the **operator machine**:

| variable                | why it is not a box variable                                                                                                                                                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STAGE_BASIC_AUTH_PASS` | the stand sits behind one basic-auth pair and the box stores only the bcrypt hash (`STAGE_BASIC_AUTH_HASH`). The post-converge health assertion has to authenticate, so the plaintext must be exported here. Absent ⇒ a named refusal, never a skipped verification. |
| `DS_STAGE_SSH`          | the SSH destination, default `ds-stage-1` — an alias in your own `~/.ssh/config`.                                                                                                                                                                                    |

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
`/v1/health`; `down` reverses it. `reset-identities` is folded into every `up`/`sync` and
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
   when a live account carries that username. Every step is probe-then-act and a failing
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
