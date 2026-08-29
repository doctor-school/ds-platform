# `storefront` — the doctor storefront's server side (feature 017)

The API half of the doctor site (`apps/doctor`). Spec:
`apps/docs/content/specs/features/017-doctor-shell-specialties/` (§2 data model,
§7 read contracts). Opened by #1479 (EARS-3) with the closed Минздрав specialty
reference book; the catalog UI (#1481) and the choose-specialty write (#1482)
follow and consume what is here.

## What it owns

- `specialties_minzdrav` — the closed Минздрав specialty reference book: one row
  per entry of Раздел I of the nomenclature order in force, plus the single
  `is_other` row «Другое».
- `GET /v1/public/specialties` — the whole book plus its `total`.
- `GET /v1/public/specialties/frequent` — the ordered frequent subset the
  search-first catalog renders beneath its search field.
- `SpecialtiesService.resolveMember()` — the closed-book membership mechanism
  every specialty-accepting path consumes.
- `GET /v1/public/statistics` — the ONE computed read behind the home hero's
  four scale counters (#1480, EARS-2 / LD-3): `doctors`, `specialties`,
  `lessons`, `eventsPerYear` plus a required `computedAt`.

## EARS-8 targeting resolver

`TargetingService.resolve()` is the read-through resolver from one remembered
specialty through active `direction_specialties` and directed
`direction_adjacency` rows. It is exported for #1485/#1487 and has no separate
public route, cache or per-page configuration.

An own direction enters only through an active specialty link; an adjacent
direction enters only through an active edge whose source is one of those own
directions. Edges are ordered by authored weight and stable id, de-duplicated
strongest-first, and never read in reverse. An own direction cannot be
re-labelled adjacent. «Другое» returns the explicit general-selection statement
under `mode: general`, never an empty `targeted` answer.

## Exported symbols

`StorefrontModule` (exports `SpecialtiesService` + `StatisticsService` +
`TargetingService`),
`SpecialtiesService`, `SpecialtiesRepository`, `SpecialtiesPublicController`,
`SpecialtyError` + `SPECIALTY_ERROR_STATUS`, `SpecialtyProblemFilter`,
`StatisticsService`, `StatisticsRepository`, `StatisticsPublicController`. Wire
contracts live in `@ds/schemas` (`SpecialtyRef`, `SpecialtyBook`,
`FrequentSpecialties`, `SPECIALTY_ERROR_CODES`, `isSpecialtyBookMember`,
`ScaleStatistics` + `buildScaleStatistics`); the seed and its
provenance-stamped data file live in `@ds/db` (`packages/db/src/seed/`).

## The scale statistics (LD-3)

One read, already-computed figures, a bounded staleness window, no counter an
operator can type in. The refresh mechanism is explicitly NOT spec-level, so it
is stated here rather than in the spec: an in-process snapshot warmed at boot and
refreshed on a timer, served from cache on every request, single-flighted on a
cold start, and still served (with its honest older `computedAt`) when a refresh
is failing.

Two properties are structural rather than remembered:

- **A counter with no source is OMITTED, never zeroed.** Each counter has its own
  source resolver and the resolvers settle independently, so one unavailable
  source drops one key and leaves the neighbours rendering (017-design §6). A `0`
  on the wire is therefore always a measured zero. `lessons` has no source today
  — the platform has no lesson table — and is consequently absent from every
  response rather than stubbed; giving it a source is a one-line change with no
  contract impact.
- **«Врачей уже с нами» counts an ENUMERATED role set.** `DOCTOR_ROLES` in
  `statistics.repository.ts` lists the roles the figure includes — today the
  single `doctor_guest`, the v1 self-service role granted on self-registration —
  so the public figure means **registered doctor accounts** that are active and
  not deactivated in the identity mirror. That is a product statement, which is
  why it is written down rather than left implicit: a prefix match over the
  free-text `users.role` column would enrol a future `doctor*` role into a
  headline figure, and drop it again on a rename, with nothing but the home page
  to show for it. Staff roles (`platform_admin`, `pd_officer`) are not counted.
- **A failing refresh is logged, never fatal.** Every fire-and-forget refresh
  goes through `refreshInBackground()`, and the cold-start path catches too: a
  source outage degrades to omitted counters with the previous (or an empty)
  snapshot served, and can neither 500 the public read nor take the process down
  through an unhandled rejection.
- **The specialties counter is the book total.** It reads
  `SpecialtyBook.total` through `SpecialtiesService`, so the hero and the
  catalog's «Показать весь список — N» cannot disagree and no count literal
  exists (017-design §7).

Nothing commercial can appear here: `ScaleStatisticsSchema` is a strict object of
four counts and a timestamp, which is EARS-2's «no price, cart, subscription or
financing statement» enforced by the contract rather than by review.

## Five properties worth stating

1. **The book has no write path, by construction.** Only `@Get` handlers are
   declared, the repository has no insert/update/delete method, and the sole
   writer is the seed. A mutating request finds no route at all rather than a
   403 — there is nothing that could be authorized. EARS-3.6 tests exactly that.
2. **The size of the book is never a literal.** It lives in the seed data file
   and nowhere else. The read computes `total` from what it actually served,
   every count surface binds to `SpecialtyBook.total`, and the e2e suite derives
   its expectations from `buildSpecialtyBookSeed().length`. A re-seed against an
   amended order moves every surface by itself (017-design §2).
3. **Seeded at boot, not by a data migration.** `StorefrontModule.onModuleInit`
   runs the idempotent upsert inside one transaction holding
   `pg_advisory_xact_lock`, so concurrent replicas serialize instead of racing
   the `code` unique index. A SQL data migration would fork the row set into a
   second, immutable copy that drifts from the data file the first time an
   amended order is transcribed. The seed is a boot PRECONDITION: if it fails the
   process refuses to start rather than serve a partial book.
   `code` — not the ordinal of the order — is the upsert key, so a specialty a
   doctor already holds keeps its `id` across a re-seed; the seed never deletes.
4. **Membership is fail-closed and lives in ONE place.** A reference resolves
   through `resolveMember()` or it is refused with the stable
   `SPECIALTY_NOT_IN_BOOK` code (422 RFC 7807, `traceId`, no database key on the
   wire) — never coerced to a nearby entry, never created on the fly.
   `@ds/schemas` carries the same rule as a pure predicate for the client, so the
   storefront cannot offer what the API would refuse.
5. **Three distinct read models.** Specialties, directions (#1483) and schools
   are never merged into one list and never re-labelled with a shared word. This
   path serves specialty rows and nothing else (EARS-3.7).

`SpecialtyProblemFilter` is controller-scoped, not global — for the same reason
012's is: reshaping responses on live routes this feature does not own would be
an unrequested behaviour change.

Every constructor dependency carries an explicit `@Inject` token: the
`endpoint-authz` gate boots this graph under `tsx`, which emits no
`design:paramtypes`. That same gate declares route-scan mode
(`apps/api/src/authz/route-scan.ts`), which is what lets it enumerate these
routes without a database while the seed stays a boot step of a serving process.
