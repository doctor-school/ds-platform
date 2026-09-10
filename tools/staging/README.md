# `tools/staging` — the STAGE stand's box-side scripts

Two Node scripts that run **on the stage box**, never in CI and never on a developer
machine. The box carries no workspace checkout and no `pnpm`: it has one pinned Node
LTS under `/opt/node` (tech spec §3 «Host runtime»), so everything here is dependency-
free ESM with `node --test` unit tests beside it.

| script          | what it owns                                                                     | Issue |
| --------------- | -------------------------------------------------------------------------------- | ----- |
| `golden-db.mjs` | builds and rebuilds `ds_golden`, the template every slot database is cloned from | #2063 |
| `slot.mjs`      | the lifecycle of one slot: `up`, `sync`, `down`, `status`, `gc`, `render`        | #2064 |

Both follow the same shape, and a new script here should too: **pure planner functions
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
`reset` and `reset-identities` are part 2 of #2064 and refuse loudly until then.

**Part 2 owns the redirect-URI convergence.** The shared Zitadel app accepts only
registered redirect URIs and that registration is a whole-set write, so part 1 ships
only the pure seam `renderIdpRedirectUris(registry, base)` — the full ordered set for
every registered slot, printed by `slot status`. Part 2 makes `slot up|down` converge
that set onto the shared app through the same management API and PAT path
`infra/dev-stand/idp/provision.sh` uses; until then a slot's `IDP_REDIRECT_URI` is
emitted but not registered and login on that slot fails.

Operating detail — registry paths, the `slot render` step before the first Caddy
bring-up, the preview cap, Redis allocation and the `gc` free-disk floor — lives in
[`infra/deploy/compose/stg-infra/README.md`](../../infra/deploy/compose/stg-infra/README.md)
→ «Slots (#2064)». Production deploy tooling is a separate story:
[`tools/deploy/README.md`](../deploy/README.md).
