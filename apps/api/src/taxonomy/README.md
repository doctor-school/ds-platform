# `taxonomy` — feature 012 content taxonomy (admin write surface)

Spec: [`specs/features/012-content-taxonomy`](../../../docs/content/specs/features/012-content-taxonomy/012-design.md) · ADRs 0001 (authz), 0002 (REST/OpenAPI/idempotency), 0003 (retained-row data layer), 0009 (retained-row value erasure).

The module owns the `platform_admin` authoring surface for the four retained taxonomy entities and the three protocol services every taxonomy handler shares. #1283 (EARS-1) opened it with the **project** vertical; #1284–#1286 add expert / topic / partner controllers against the same three services, and #1287/#1294–#1297 add publication, lifecycle and public reads.

## What is here today

| File                              | Role                                                                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `projects.admin.controller.ts`    | `GET/POST /v1/admin/projects`, `GET/PATCH /v1/admin/projects/:id` — realizes the §5.1 failure ORDER.                   |
| `projects.service.ts`             | The create/edit commands: slug resolution, media swap, cleanup enqueue, fenced record completion.                      |
| `projects.repository.ts`          | Drizzle access for `projects`; every mutation inside `withRequestAuditContext` (feature 010).                          |
| `idempotency.service.ts`          | §6 retained, fenced idempotency records — key validation, fingerprint binding, replay, lease takeover, 24-hour expiry. |
| `media/still-image-normalizer.ts` | §2.2 shared still-image decoder/normalizer → canonical WebP under a pinned codec profile.                              |
| `media/media-cleanup.service.ts`  | §5.1 durable old-reference cleanup: job enqueue + fenced leased worker.                                                |
| `media/animated-fixtures.ts`      | Test support: real animated-WebP / APNG byte fixtures (`sharp` cannot write either).                                   |
| `taxonomy.errors.ts`              | §5.3 `errorCode` ⇄ status tables, `TaxonomyError`, and the scoped RFC 7807 exception filter.                           |

Exports (`index.ts`): `TaxonomyModule`, `TaxonomyError`, `TaxonomyProblemFilter`, `TAXONOMY_ERROR_STATUS`, `toProblemDetails`, `IdempotencyService`, `IdempotencyFenceError`, `IdempotencyLease`, `StillImageNormalizer`, `NormalizedImage`, `UploadedImage`, `MediaCleanupService`.

## The three properties worth knowing before editing

1. **Failure order is the contract (§5.1).** Authorization → `Idempotency-Key` shape → request shape/payload → fingerprint binding → normalization → upload → domain transaction. So a keyless upload never streams, a reused key never normalizes, and a storage outage never mutates a domain row. Moving a check earlier or later changes observable behaviour even when every individual check still passes.

2. **A committed content change is never rolled back for a storage failure.** When a replace/clear releases an object, the ref-swap transaction inserts one `media_cleanup_jobs` row (§5.1) and the leased worker finishes the deletion later, rechecking live references first. `enqueue()` therefore MUST be called with the caller's transaction handle — never on its own.

3. **The idempotency record is retained, not cached.** A key is globally reserved forever; expiry is an UPDATE that clears content and keeps the key, so a UUID can never be reused by a second actor. Completion is fenced on `lease_epoch`: a stale owner's write matches zero rows and takes its whole transaction down (`IdempotencyFenceError`).

## Authorization and errors

Admin routes inherit feature 011 exactly as 007 does — the dedicated MFA-verified `__Host-ds_admin_session`, CSRF double-submit on state changes, `platform_admin` on the route guard, all before validation/idempotency/upload (EARS-16). 012 adds **no** per-mutation live IdP revalidation and no step-up (§5.3).

Failures are `application/problem+json` with the stable `errorCode` plus `traceId`. `TaxonomyProblemFilter` is applied per controller with `@UseFilters`, not globally: 007's admin surface keeps its own established response shape.

## Operational notes

- Two `@Cron` sweeps run here: the hourly retained-record expiry (`IdempotencyService.sweepExpired`) and the 5-minute media-cleanup drain (`MediaCleanupService.sweep`). Both are idempotent and safe on several instances. `ScheduleModule.forRoot()` is registered once by `AuthModule`; a second registration installs a second explorer and aborts the boot.
- Every dependency in this module is injected with an explicit `@Inject(token)`, including the class ones — the root-level `endpoint-authz` gate boots this graph under `tsx`, whose esbuild transform emits no `design:paramtypes`, so type-inferred injection resolves to `undefined` there while working fine under `nest build`.
- Adding a media slot (#1284 photo, #1286 logo) means extending `MediaCleanupService.isStillReferenced` with that column; otherwise the worker would delete an object a live row still points at.

## Tests

- `apps/api/test/taxonomy/projects-schema.e2e-spec.ts` — DB constraints, set-once publication instant, audit attachment, the two technical-table terminal shapes.
- `apps/api/test/taxonomy/projects.e2e-spec.ts` — the authoring vertical over the real stack (reject + accept branches).
- `apps/api/test/taxonomy/idempotency-media.e2e-spec.ts` — storage-outage 503, cleanup worker fencing, record expiry, lease takeover.
- `src/taxonomy/media/still-image-normalizer.spec.ts` — normalizer fixtures (accept, strip, orient, reject).
