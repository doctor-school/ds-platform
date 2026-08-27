# `recordings` — retained event recordings (feature 014)

The operator's surface for attaching a recording to an event and running its own
publication lifecycle. Spec: `apps/docs/content/specs/features/014-event-recordings/`
(§2 data model, §3 lifecycle, §4 projection, §10 API, §11 errors). Opened by
#1339 (EARS-1, EARS-2, EARS-17); #1340 adds the derived read projection.

## What it owns

- `event_recordings` — one retained row per attached recording, at most one
  non-retired row per `(event_id, kind)` (`edited` = the montage, `raw` = the
  unedited broadcast capture).
- The four lifecycle commands of §3 — `publish`, `unpublish`, `retire`,
  `restore` — plus attach and a source correction.
- **The derived edited-over-raw projection of §4 (EARS-3, #1340)** —
  `RecordingsProjectionService`, exported by the module and injected by all four
  §4 consumers (#1341 public page, #1344 playback, #1346 «Мои события», #1347
  archive badge). A second implementation of «which cut wins» anywhere else is a
  defect, not an optimisation.

`events.recording_expected_by` (the operator's readiness date) lives on the 007
aggregate and is written through 007's own `PATCH /v1/admin/events/:id`; this
module only reads it onto the list response.

## Six properties worth stating

1. **The event is read, never written.** Publication requires the event to be
   exactly `ended` (§3, else 409 `EVENT_NOT_FINISHED`); no path here moves
   `events.state`. Publishing a recording is not an event transition.
2. **Nothing is deleted.** `retire` sets `deleted_at`, frees the `(event_id,
kind)` slot and leaves the row addressable forever; `restore` is its inverse
   and re-competes for the slot. There is no `@Delete` route, no repository
   delete method and no cascade — the event FK is `RESTRICT`. A delete-shaped
   request is a router 404.
3. **One protocol, shared with 012.** EARS-17's `Idempotency-Key` / `If-Match`
   contract is served by `TaxonomyModule`'s `IdempotencyService` and
   `TaxonomyProblemFilter` (imported, not copied): one `idempotency_keys` table,
   one fenced record, one RFC 7807 shape. The failure order is 012's unchanged —
   auth → key shape → If-Match → payload → fingerprint → domain transaction.
4. **One source validator, shared with 006.** A recording's playable source is
   the same `{provider, embedRef}` pair the live room stores, validated by
   `refineEmbedRefForProvider` in `packages/schemas/src/events`. 014 adds no
   second provider abstraction, stores no media bytes and never fetches what the
   reference points at.
5. **The display rule is derived, never stored.** There is no `is_primary`,
   `is_featured` or ordering column on `event_recordings`, and none may be added.
   The projection recomputes primary/secondary on every read from the published,
   non-retired rows alone, so publishing the montage two weeks after the raw
   capture promotes it with no operator edit and unpublishing it demotes it
   again. Its batch form resolves a whole listing page in ONE statement — a
   per-card read is the N+1 shape LD-8 refuses.
6. **Explicit `@Inject` on every ctor dep.** The `endpoint-authz` gate boots this
   graph under `tsx`, which emits no `design:paramtypes` — a type-inferred
   injection resolves to `undefined` there. Same rule as `src/taxonomy`.

## Files

| File                             | Role                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `recordings.admin.controller.ts` | Routes + the EARS-17 protocol preamble; `platform_admin` on the admin session |
| `recordings.service.ts`          | The §3 state machine, fenced by the shared idempotency lease                  |
| `recordings.repository.ts`       | Drizzle access inside `withRequestAuditContext`; no delete method exists      |
| `recordings.projection.ts`       | The §4 derived edited-over-raw projection (EARS-3) — single + batch forms     |
| `recordings.module.ts`           | Imports `TaxonomyModule` for the shared protocol mechanism                    |

Contract: `packages/schemas/src/recordings`. Schema + migration:
`packages/db/src/schema/event-recordings.ts`, `apps/api/drizzle/0016_*.sql` (the
audit trigger and the set-once `first_published_at` trigger are appended there by
hand — drizzle-kit emits neither). Tests: `apps/api/test/recordings/lifecycle.e2e-spec.ts` (EARS-1/EARS-2/EARS-17),
`apps/api/test/recordings/projection.spec.ts` (EARS-3).
