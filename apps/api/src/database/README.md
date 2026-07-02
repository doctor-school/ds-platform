# `database` — Drizzle connection pool provider

The api's single database access seam. It owns the `pg` connection pool and the
Drizzle handle over it, built once from env and shared process-wide, so every
other module injects a ready query interface instead of opening its own
connection. The Drizzle TS schemas themselves are the SSOT in `packages/db`
(ADR-0003 §4); this module only wires a **live handle** to them for `apps/api`.

## What's here

| Concern                                    | File                 |
| ------------------------------------------ | -------------------- |
| `@Global` module + pool lifecycle          | `database.module.ts` |
| DI tokens for the pool + Drizzle db handle | `database.tokens.ts` |

## Exported symbols

- **`DatabaseModule`** (`database.module.ts`) — a `@Global()` module so any
  feature module injects the handle without re-importing. Its factory calls
  `createDrizzle(env.DATABASE_URL, …)` from `@ds/db` once (bounded by
  `DATABASE_POOL_MAX` and `DATABASE_STATEMENT_TIMEOUT_MS` from the env schema),
  then re-exposes the two halves of the returned `DrizzleHandle` as separate
  providers. It implements `OnModuleDestroy` and calls `pool.end()` on teardown
  (design §9 pattern (a)), so neither the process nor the e2e suite leaks
  connections. Shutdown hooks are enabled in `main.ts`.
- **`DRIZZLE_POOL`** (`database.tokens.ts`) — DI token for the raw `pg.Pool`.
  Injected where a caller needs SQL below the ORM (e.g. `ReadinessService`'s
  `SELECT 1` / `pgvector` probe).
- **`DRIZZLE_DB`** (`database.tokens.ts`) — DI token for the typed Drizzle
  database handle, the ORM query surface bound to the `packages/db` schema.

Both tokens are `Symbol`s (never string-injected) and are `exports` of the
module so consumers depend on the token, not the concrete handle.
