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

## 019 doctor events feed and month grid

`GET /v1/storefront/doctor/events` (EARS-3, #1518) and
`GET /v1/storefront/doctor/events/month` (EARS-4, #1519) are ONE host projection
with two shapes, not two features. Both are `access: public` and
session-optional, both read the remembered specialty from
`__Host-ds_specialty`, and both are served `private, max-age=30` with
`Vary: Cookie` — a shared cache must never hand one doctor's targeted read to
another visitor.

- **The month grid is navigation over the same read.** `DoctorEventsService.month()`
  resolves targeting with the same `resolveTargeting`, selects with the same
  `findFeedRows`, maps with the same `toCards` and narrows with the same
  `applyCardFacets` the day feed uses. A grid count and the feed's day-group size
  for that day are therefore the same number by construction. The month codec
  (`parseDoctorEventsMonthQuery`) delegates its facet half to the feed's codec,
  so the two routes cannot disagree about what a facet means either.
- **One aggregate query, never one per day.** The whole month is a single
  `findFeedRows` call over `[max(first-of-month, today), first-of-next-month)`,
  plus the per-event lookups `toCards` already batches.
- **Every day is emitted, `count: 0` included**, so a host renders the grid
  straight from the response — Academy's client-side month assembly
  (`apps/portal/components/month-calendar-view.tsx`) is deliberately NOT the
  Doctor shape (019-design §1.1, §3).
- **«Будущие» only in release 1** (LD-10, #1525): a day already past carries
  `count: 0` rather than a historical figure the feed beside the grid would not
  show. There is no `tense`, `day`, `from` or `to` on the month route, and no
  `view` parameter anywhere — F-019-2 Б renders grid and feed together and
  builds no «Неделя / Месяц» switch.
- **`hasLive` is 007's lifecycle state**, the same `state: "live"` the feed's
  card carries. Nothing here compares a start time to the clock.
- **The two empty reasons stay distinct** (LD-9): the grid carries the feed's own
  `targeting` envelope, so «пусто по специальности» (a targeted read with no
  adjacency rows) and «пусто по фасетам» are two different renders rather than
  one bare zero.
- **A malformed `month` is a 400.** Unlike the feed's `to=`, which is clamped, a
  month has no nearest honest value a reader could be assumed to have meant.

One contract serves two compositions (LD-3): the grid beside the feed (#1516)
and the dedicated calendar page (#1520) read the SAME endpoint.

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
