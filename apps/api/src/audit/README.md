# `audit/` — request-scoped audit context (010 EARS-3/EARS-5)

The API half of spec [010 universal edit audit](../../../docs/content/specs/features/010-universal-edit-audit/). The DB capture trigger (`audit_row_change()`, migration `0013`, #1087) records WHO/SOURCE for every mutation by reading two per-transaction GUCs — `app.actor_sub` and `app.source`. This module sets them for API-originated writes, so the trail attributes the real caller instead of degrading to `db-direct`.

## Pieces

- **`audit-context.ts`** — `auditContextStore`, an `AsyncLocalStorage<AuditContext>`, and `getAuditContext()`. The request context lives here, not in method signatures — so a new mutating endpoint is attributed automatically (the "every caller must remember the wrapper" failure mode 010-design §6 rejects).
- **`audit-context.interceptor.ts`** — `AuditContextInterceptor` (`APP_INTERCEPTOR`, sibling of `TimingEqualizationInterceptor`). Runs every request handler inside the store, carrying `{ actorSub: req.user?.sub ?? null, source }`. `deriveSource` maps `/v1/admin/**` → `admin-ui`, every other route → `portal-api`.
- **`audit-context.tx.ts`** — `withRequestAuditContext(db, fn)`. The repo-layer transaction seam: with a request context it delegates to `@ds/db`'s `withAuditContext` (issues `SET LOCAL` **inside** the mutating tx — an interceptor alone can't own the tx); with none (background job, migration, psql) it runs a plain transaction and the row honestly degrades to `source = 'db-direct'`, actor NULL (EARS-4).
- **`audit.module.ts`** — `@Global` module registering the interceptor.

## Adoption contract

Every mutating write to an **audited** domain table (schema minus the design §5 allowlist: `audit_ledger`, `idempotency_keys`, `presence_beats`) MUST run through `withRequestAuditContext` instead of `db.transaction(...)` / a bare `db.insert|update|delete`. Current adopters: `events` (create / update / stream / lifecycle transitions), `me` (display-name), `registration` (register), `auth` (register mirror+consent), `user-mirror` (upsert / soft-delete / verified-flag flips). EARS-5 is enforced by the endpoint sweep in `test/audit/api-actor-guarantee.e2e-spec.ts` — a new mutating endpoint that skips the seam surfaces as `db-direct` and fails it.
