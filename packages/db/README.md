# `@ds/db`

The DS Platform **data layer** — the **Drizzle ORM** schema (SSOT) plus the
`createDrizzle` connection factory (ADR-0003). **Postgres 17 + pgvector**.
Consumed by `@ds/api`; the schema here is the single source of truth for
migrations (`drizzle-kit` in `apps/api` points at this package's config).

## Public surface

Two subpath exports (see `package.json` `exports`), compiled to `dist/`:

```ts
import { createDrizzle } from "@ds/db"; // connection factory
import * as schema from "@ds/db/schema"; // Drizzle table definitions (SSOT)
```

- `.` — the `createDrizzle` factory (and re-exports), plus the edit-audit registries
  `AUDIT_PD_COLUMNS` / `AUDIT_CAPTURE_ALLOWLIST` (`src/audit.ts`) — the TS mirrors of the
  SQL-side lists baked into the spec-010 `audit_pd_columns()` / trigger-attach migration;
  parity between the two is pinned by an e2e test (`apps/api/test/db/universal-edit-audit.e2e-spec.ts`).
- `./schema` — the table/column definitions consumed by migrations and the API.

`drizzle.config.ts` is the migration config `@ds/api`'s `drizzle:generate` /
`drizzle:migrate` scripts resolve against.

## Build / test

```bash
pnpm --filter @ds/db build      # tsc -b → dist/
pnpm --filter @ds/db typecheck  # tsc --noEmit
pnpm --filter @ds/db test       # vitest run
pnpm --filter @ds/db clean      # rm -rf dist .tsbuildinfo
```

## Owning ADR

- **ADR-0003** — data layer stack (Postgres + Drizzle + pgvector).
