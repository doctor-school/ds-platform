# `tools/staging` — the STAGE stand's box-side scripts

Node scripts that run **on the stage box**, never in CI and never on a developer
machine. The box carries no workspace checkout and no `pnpm`: it has one pinned Node
LTS under `/opt/node` (tech spec §3 «Host runtime»), so everything here is dependency-
free ESM with `node --test` unit tests beside it. One script is the exception and runs
on the workstation: `install.mjs`, which puts the others on the box.

| script            | what it owns                                                                       | Issue |
| ----------------- | ---------------------------------------------------------------------------------- | ----- |
| `golden-db.mjs`   | builds and rebuilds `ds_golden`, the template every slot database is cloned from   | #2063 |
| `slot.mjs`        | the lifecycle of one slot: `up`, `sync`, `down`, `status`, `gc`, `render`, `reset` | #2064 |
| `deployer.mjs`    | one converge tick: desired slots from GitHub → `ds-slot up`/`sync`/`down`          | #2064 |
| `install-host.sh` | the idempotent root-side install on the box (Node pin, payload, wrappers, units)   | #2064 |
| `install.mjs`     | workstation side: ships the payload over one SSH session and runs the install      | #2064 |

They all follow the same shape, and a new script here should too: **pure planner functions
plus an injected executor**. Every decision — a name, a SQL statement, a command array,
a rendered file — is an exported pure function with a unit test; `main()` is the only
place that touches `execFileSync`, `psql` or the filesystem. That is what makes the box
behaviour testable on a machine that has neither Docker nor Postgres.

```bash
pnpm test:tools            # runs tools/**/*.test.mjs, this directory included
node --test tools/staging/slot.test.mjs
```

## `slot.mjs` in one paragraph

A slot is `main` or `pr-<N>`. `/var/lib/ds-platform/slots.json` is the registry and the
single source of truth; from it the script renders the two Caddy include files
(`ask.caddy`, `slots.caddy`) that the stg-infra edge mounts read-only, and it reloads
Caddy through the loopback admin API. `up`/`sync` clone the slot database from
`ds_golden` (never for `main`, which is persistent), pull the five GHCR images that
`.github/workflows/preview.yml` built, migrate, seed, start
`infra/deploy/compose/slot/compose.yml` and register the slot; `down` reverses it.

`reset main --yes` drops `ds_main` and re-clones it from `ds_golden`, then re-runs the
ordinary `up` plan on the SHA the registry already holds — the escape hatch for a
staging database someone has poisoned. It is the **only** resettable slot (a preview is
cheaper to `down`/`up`), the `--yes` flag is mandatory, `ds_golden` is never touched, and
every run appends one audit line to `/var/log/ds-platform/slot.log` before it drops
anything.

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
renders the full ordered set for every registered slot with `renderIdpRedirectUris(registry,
base)` (printed by `slot status`) and converges it onto the shared app through the same
management API and PAT path `infra/dev-stand/idp/provision.sh` uses: the PAT is read from
`/etc/ds-platform/idp-bootstrap-pat.txt`, the origin from `IDP_BASE_URL`.

The converge runs as the LAST step of the `up`, `sync`, `down` and `reset` plans, after the
registry write, so the set it writes matches the registry state the command just produced.
It is ensure-present: the current `oidc_config` is read first and the `PUT` is skipped when
the sets already match (order-insensitive compare). Any URIs pinned in `IDP_REDIRECT_URIS` /
`IDP_POST_LOGOUT_URIS` are unioned in, so non-slot callers keep their registration — both
must be FILLED in `/etc/ds-platform/stage.env` (see `infra/deploy/stage.env.example`): left
empty, `provision.sh` substitutes its localhost dev defaults and registers those instead. A failing
converge fails the command loudly — a slot whose callback is unregistered fails login with
`invalid redirect_uri`, which is worse than a refused `up`.

## `deployer.mjs` — one converge tick

The box pulls; nothing pushes into it (spec §5 — the repository is public, so no job of
it may ever run here). `ds-slot-deployer tick` fires every 60 s from
`ds-slot-deployer.timer` and does exactly one pass:

1. **Desired state** from GitHub with `STAGE_GH_READ_TOKEN` — the open, non-draft,
   same-repository PRs (a fork PR gets no slot, by construction) plus the `main` head.
   When `/var/lib/ds-platform/main-pin.json` holds a valid `{ sha, pinnedAt }`, that pin
   wins over the `main` head; an unparsable pin is a hard failure naming the file, never
   a silent fall-back.
2. **Capacity** — `main` plus at most `PREVIEW_SLOT_CAP` (3) previews. Already-registered
   desired slots keep their seat; free seats go to the newest PRs by `updated_at`; the
   rest are logged `waiting for capacity: pr-N`. An incumbent is never evicted for a
   newer PR, so a converge in flight is never cut off.
3. **Image probe** — an **anonymous** GHCR check per image (`ghcr.io/token` → manifest);
   only HTTP 200 counts as present. A missing package, a 401, a 404 or a network error
   all mean «tags missing», which is a `skip pr-N: images not published`, never a fatal —
   the first ticks on a fresh box run before `preview.yml` has ever pushed anything.
4. **Plan and run** — downs before ups, so capacity frees before it is claimed; `main` is
   never `down`ed; a desired slot whose images are missing leaves any existing slot
   untouched. Each entry spawns `/usr/local/bin/ds-slot <action> <slot> <sha>` as a child:
   the deployer owns orchestration, `slot.mjs` owns the plan. One slot's failure does not
   stop the others — the tick finishes the rest and then exits 1, and the journal line
   names the slot and the step.

Every one of those is an exported pure function (`desiredSlots`, `capDesired`, `planTick`,
`ghcrTagProbePlan`, `tagsPresentFromResponses`, `slotCommandArgv`) with a unit test; the
tick itself takes an injected executor, so the whole matrix — PR closed, PR turned draft,
head moved, images missing, pin present, cap under pressure, one child failing — is
covered offline in `deployer.test.mjs`.

## Installing on the box

```bash
node tools/staging/install.mjs deploy@<box>            # from the worktree, over one SSH session
node tools/staging/install.mjs deploy@<box> --dry-run  # print the payload and the remote command
```

`install.mjs` tars the payload (`slot.mjs`, `golden-db.mjs`, `deployer.mjs`,
`install-host.sh`, `infra/deploy/compose/slot/`, `infra/deploy/systemd/`) onto the SSH
stdin of a single session and runs `sudo bash install-host.sh` from the unpacked temp
directory. It is a transport and nothing else — every decision lives in `install-host.sh`,
which runs as root on the box and is **probe-then-act at every step**: each step prints
exactly one line, `ensured <thing>` or `already <thing>`. A second run therefore prints
only `already` lines and changes no file on disk; that is the acceptance criterion, not a
nicety. It refuses on a non-x86_64 host, off root, and without `/etc/ds-platform/stage.env`.

What it lands (tech spec §3 «Host runtime»):

| path                                 | what                                                                        |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `/opt/node`                          | the pinned Node tarball, only `bin/node` symlinked to `/usr/local/bin/node` |
| `/opt/ds-platform/*.mjs`             | `slot.mjs`, `golden-db.mjs`, `deployer.mjs`                                 |
| `/opt/ds-platform/compose/slot/`     | the slot compose project                                                    |
| `/usr/local/bin/ds-slot{,-deployer}` | the two wrappers                                                            |
| `/etc/systemd/system/ds-slot-*`      | the four units                                                              |
| `/var/lib/ds-platform`               | the registry (and later the `main` pin)                                     |
| `/var/log/ds-platform`               | the `reset` audit log                                                       |

**The wrappers are the only env-sourcing path.** Each is a three-line bash script that
does `set -a; . /etc/ds-platform/stage.env; set +a` and `exec /opt/node/bin/node
/opt/ds-platform/<script>.mjs "$@"`. The units `ExecStart=` the wrapper and carry **no**
`EnvironmentFile=`: systemd's parser and bash disagree about quoting in that file, and the
box has exactly one env file, so it is read by bash or not at all. A human runs
`sudo ds-slot status` — same code path as the timer, same environment.

Both scripts run as **root**, deliberately: the `docker` group is root-equivalent on this
box anyway and `/etc/ds-platform` is root-0700 by design, so a second user buys no
boundary and costs a second permission model.

**No `npm`.** Only `bin/node` is symlinked — no `npm`, `npx` or `corepack`. Nothing on
the box installs a package, and `command -v pnpm` on the host stays empty (that is a spec
§8 step-4 acceptance criterion).

### Bumping the Node pin

The tarball is pinned by version **and** SHA-256, and verified with `sha256sum -c` before
it is unpacked. To move it:

1. Take the hash of `node-v<X>-linux-x64.tar.xz` from `https://nodejs.org/dist/v<X>/SHASUMS256.txt`.
2. Edit `NODE_VERSION` and `NODE_SHA256` at the top of `install-host.sh` — those two
   constants are the whole pin.
3. Re-run `node tools/staging/install.mjs deploy@<box>`. The install unpacks to
   `/opt/node.new` and swaps it into place by rename, so the box is never left without a
   Node between the two steps.

Operating detail — registry paths, the `slot render` step before the first Caddy
bring-up, the preview cap, Redis allocation and the `gc` free-disk floor — lives in
[`infra/deploy/compose/stg-infra/README.md`](../../infra/deploy/compose/stg-infra/README.md)
→ «Slots (#2064)». Production deploy tooling is a separate story:
[`tools/deploy/README.md`](../deploy/README.md).
