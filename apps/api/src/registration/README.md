# `registration` — webinar event registration (005 write side + per-user read)

The webinar-registration module — the **write side** of feature 005 (Event
registration & «мои события»), plus the per-user registration-state read. These
are the **first authenticated `doctor_guest`** endpoints in the webinar domain
(004 added the public ones; 007 the `platform_admin` authoring ones).

**EARS-1** lands the foundation of the write side:

- `RegisterForEvent` (`POST /v1/events/:idOrSlug/registration`) — an
  authenticated doctor activates «Участвовать» on a `published` (upcoming) or
  `live` event and a registration is recorded against their account in **one
  action** (no confirmation round-trip). The response is the registered
  `EventRegistrationState`, so the event page flips to the registered state
  immediately.
- `EventRegistrationState` read (`GET /v1/events/:idOrSlug/registration`) — the
  caller's own `{ registered, registeredAt? }` state; it flips from
  `{registered:false}` to `{registered:true, registeredAt}` the moment the write
  lands. Per-user and private (never a shared-cacheable projection), returning
  only the caller's own state.

Both carry the **EARS-10** cross-cutting classification `authenticated` /
`doctor_guest` / `fast-path` in the endpoint-authz matrix (ADR-0001 §2): the
global `AuthzGuard` refuses an unauthenticated caller (401) and any
non-`doctor_guest` role (403) before the handler runs — never a silent success.
Gating reads the single `EventLifecycleState` (owned by 007, read-only): a
non-`published`/`live` state is a 409, a missing event a 404.

**EARS-6** adds the `MyEvents` «Мои события» read; **014 EARS-9** splits it across
the surface's two canvas tabs (014-design §8.3):

- `MyEvents` (`GET /v1/me/events?tab=upcoming|recordings`) — ONE tab of the
  authenticated doctor's «Мои события» plus BOTH tabs' counts:
  `{ tab, data, counts }`, each row `{ eventId, slug, title, school, startsAt,
state, recording, participationFormat, roomHref }`. `roomHref` is the CALLING
  host's room path for a `live` row (the participation policy's `enter-room`
  rule), else `null`: the host is the controller — this route passes the
  Academy route table, the doctor storefront's twin
  `GET /v1/storefront/doctor/me/events` (`DoctorMyEventsMeController`, same
  posture, one shared handler `serveMyEvents`) passes the doctor table
  (`apps/api/src/events/host-routes.ts`). `?tab=` is optional and defaults to `upcoming`, so the bare
  call 005 shipped keeps returning the Предстоящие side; anything outside the
  closed two-value set is a 400, never coerced to the default.
  - **`upcoming`** — `published`/`live` inside the 004 upcoming window
    (`starts_at ≥ now − AIR_WINDOW_MS`), **nearest `startsAt` first**, `recording`
    always `null`.
  - **`recordings`** — the doctor's **full** `ended` history, **newest first**,
    with NO temporal window: an эфир from two years ago is still listed. Each row
    carries feature 014's source-free `RecordingProjection`, resolved through
    014's own `RecordingsProjectionService` (#1340) in one batched statement —
    never re-derived here, so the badge on a doctor's own row and the badge on the
    public card have one implementation. An `ended` event with nothing published
    resolves to `preparing`, which is why it is still listed and still badged.
  - `hidden` registrations are in **neither** tab and **neither** count
    (feature 004's visibility policy). Tab membership is one SQL predicate
    (`tabMembership`) shared by the row query and the count query, so a listed row
    and a counted row can never be different sets.

  An empty `data` is a valid result (the surface renders the canvas empty-state).
  The read returns ONLY the caller's own registrations, never another doctor's
  (EARS-10); a just-registered event appears on the next read (EARS-7).

**EARS-8** adds the durable `EventRoster` read model on top of the record:

- `EventRoster` (`RegistrationService.eventRoster(idOrSlug)`) — the set of
  **current** registrations for one event, each carrying no more than the
  `(doctor, event, registeredAt)` fact (`{ userId, eventId, registeredAt }`).
  Wave 1 has **no** cancelled state and no soft-delete (owner decision), so the
  roster is every registration row for the event — no filter, every entry
  current. It is the durable basis **consumed** by feature 006 (room admission)
  and the wave-2 sponsor report; 005 owns and tests it here (cross-feature wiring
  is not done here). It is an **internal** read with **no HTTP route** — never
  exposed on a 004 public surface, and it selects only the three record columns
  (no join to the `users` mirror), so no registrant PII is ever read or leaked
  (EARS-8, EARS-10; cross-checked against the public projection).
- **044 EARS-30 — `possibleDuplicate`.** The entry carries one DERIVED boolean
  beside the three record columns: `true` when another registration of the same
  event holds the same normalised contact phone (the comparison key 044 EARS-29
  writes onto `registrations.answers`). It is computed per read by a window
  count inside `findEventRoster`, never stored and never swept — so when the
  team removes one of the sharing registrations on request, the survivor's
  marker clears by itself with **no write** to the surviving row. Only the
  boolean leaves the query: the phone is neither selected nor returned, so the
  no-PII invariant above is unchanged. A platform-origin row (EARS-16, `answers
IS NULL`) has no phone and is never marked, and several such rows never group
  with one another. The roster INDICATOR and its filter live in 044 (#2328),
  not here.

**044 EARS-18** puts an HTTP route over that read model — a SECOND, widened read,
never a widening of the one above:

- `GET /v1/admin/events/:idOrSlug/roster`
  (`EventRosterAdminController` → `RegistrationService.eventRosterPage`) — one
  paged page of the registrar's desk roster. Its query state is exactly the
  `AdminDataList` baseline (`q`, `page`, `pageSize`); sorting and per-column
  filters are EARS-22/EARS-23 and the «возможный дубль» marker on this row is
  EARS-30/EARS-31, none of them here.
- The row carries the answers the registrar identifies a person by — ФИО,
  specialty NAME (resolved through `specialties_minzdrav`, EARS-25), место
  работы, город, область, телефон as typed (EARS-29), email, `registeredAt` and
  the confirmation-letter outcome. Every answer-derived cell is nullable and
  falls back to the account mirror (EARS-16) — `users.display_name`,
  `users.email`, `users.phone`: a platform-origin registration carries no
  answers, and a cell with neither stays EMPTY rather than inventing a
  placeholder. Reading `users.phone` back is not the write EARS-29 forbids.
- The `q` search is one case-insensitive «contains» term over the concatenated
  identifying cells, with the caller's own `%`/`_`/`\` escaped. The
  NORMALISED contact phone (EARS-29) is in the searched set although it is
  never rendered, so `89001112233` finds the row that shows
  `+7 (900) 111-22-33`.
- `eventRoster()` above is untouched by this: feature 006's room gate keeps
  reading the PII-free `(doctor, event, registeredAt)` fact, and the two reads
  are separate methods precisely so a change to one can never widen the other.
- Authorization is `event-registrar` **or** `platform_admin`
  (`@Authz({ access: "authenticated", roles: [...], check: "policy" })`, no
  `objectAttrs`), on its own controller rather than on the 007
  `platform_admin` events surface, so the registrar's reach stays readable as a
  file rather than a grep. The role is necessary, not sufficient (044 EARS-38):
  the handler runs `EventGrantPolicy.assertEventAccess`
  (`apps/api/src/authz/event-grant.policy.ts`), which admits a registrar only
  for the event its `event_role_grants` row binds it to — another event, an
  unknown one, or no binding row at all is the same
  `403 EVENT_BINDING_REQUIRED` (a credential refusal: the admin console shows
  no-access and offers no retry) — and does not limit
  `platform_admin`. `total` counts the filtered set over the WHOLE event — the
  pager's denominator — and, for the administrator, an unknown event is a 404,
  never an empty page.

- `POST /v1/admin/events/:idOrSlug/registrations`
  (`DeskRegistrationAdminController` → `CongressSignUpService.signUp` with
  `{ origin: "desk", eventKey, consentOrigin: "paper" }`, 044 EARS-35) — the
  registrar enters a walk-in participant at the congress desk (admin entry:
  «Добавить участника» on the roster screen,
  `apps/admin/components/desk-registration-form.tsx`, #2382). The body is the
  congress-site answer set (`CongressDeskRegistrationRequestSchema`, composed
  from the public request) with `paperConsent: true` instead of the online
  acceptance and no captcha token; a body without the tick is a 400 from the
  Zod pipe before any write or email.
  - **One intake, not two.** The handler calls the congress intake use-case
    itself, so the desk gets the site form's rules by construction: one
    credential-less account per email, one registration per (account, event),
    one consent row per published version, the same confirmation email with
    its outcome recorded. The registration carries
    `registrations.intake_origin = 'desk'` (the site form writes `site`, the
    signed-in platform path takes the default `platform`), and a NEW consent
    row carries `consent_records.origin = 'paper'` (online consents are `NULL`).
    A participant whose account already accepted the current version online
    gets no second consent row.
  - **No captcha, no rate limit, no timing floor, no window.** Those defend the
    UNAUTHENTICATED public door against bots, floods and the «is this email
    known?» oracle. This route sits behind an MFA admin session bound to one
    event, and the registration window is the public form's — walk-ins arrive
    on the congress days, after it has shut.
  - **Response.** `{ status: "accepted", registrationId }` for a new
    registration, `{ status: "existing", registrationId }` when the participant
    was already registered for this event (EARS-8: nothing new is written, no
    second email) — so the registrar can open the card. Nothing in it says
    whether the ACCOUNT existed before (`account_created_by_intake` stays on
    the row).
  - **Authorization** exactly as the roster: `check: "policy"`, roles
    `platform_admin` / `event-registrar`, the handler runs
    `EventGrantPolicy.assertEventAccess` before the use-case (a registrar bound
    to another event gets 403 and nothing is looked up or written). An unknown
    event is the administrator's 404; a non-registrable one is the intake's
    generic 422.
  - **Who did it.** The 010 interceptor attributes the registration, consent
    and account rows to the acting registrar (`actor_sub`) with source
    `admin-ui`; the desk writes no author column of its own.

- `PUT /v1/admin/events/:idOrSlug/registrations/:registrationId/attendance/:day`
  (`AttendanceAdminController` → `CongressAttendanceService.mark`, 044 EARS-34)
  — the registrar marks one participant present on one congress day, or clears
  the mark. Body `{ present: boolean }`; response
  `{ registrationId, day, present }` (`CongressAttendance*Schema`).
  - **Storage.** `registration_attendance(registration_id, day, present)`,
    PK `(registration_id, day)` — 23 April and 24 April are independent rows,
    and a day nobody marked has no row (it reads «not present»). No author or
    time column: who marked it, and when, is the 010 ledger's
    `data.registration_attendance.insert|update` row (actor = the registrar,
    source `admin-ui`), appended by the table's `audit_row_change()` trigger.
  - **Idempotent; a no-op writes no ledger row.** `present: true` is an upsert
    whose `DO UPDATE` fires only when the stored value differs;
    `present: false` updates only an existing `true` row. Writing the value the
    day already holds answers 200 and touches nothing — so the ledger records
    changes, not clicks.
  - **Days source.** The allowed days are the deployment's
    `CONGRESS_SIGNUP_EVENT_DAYS` (read per call through the congress module's
    env reader, `apps/api/src/congress/README.md`), not a DB CHECK. Any other
    date is 422 `CONGRESS_DAY_UNKNOWN`; a malformed date, id or body is 400; the
    key unset or malformed is 503 `CONGRESS_DAYS_UNCONFIGURED` (server log
    names the reason).
  - **Scope.** The registration must belong to the route's event — another
    event's registration (or an unknown id / event) is 404, never revealed.
    Authorization is the desk registration's row: `check: "policy"` +
    `assertEventAccess` first, `audit: "high-stakes"`, `revalidate: "live"`.
  - **Roster.** `GET …/roster` returns `congressDays` (the configured days) and
    each row's `attendance: [{ day, present }]` for those days, and filters by
    `attendanceDay=<day>&present=marked|unmarked` — an `EXISTS` over
    `registration_attendance` composed with `q` and paging. `present` without
    `attendanceDay` is 400; a non-congress `attendanceDay` is 422.

- `GET /v1/admin/events/:idOrSlug/registrations/:registrationId`
  (`EventRosterAdminController.card`) — 044 EARS-36 (#2383): the participant
  card the registrar opens from a roster row.
  - **Contents.** Every stored answer (name parts, full name, specialty name,
    workplace, city, region, phone as typed, email — with the roster's EARS-16
    account fallback), `registeredAt`, `intakeOrigin`, the participant's
    congress consent rows (`consent_records`: purpose, version, captured-at,
    `paper` origin), `confirmationMail { status, at }`, the read-time
    `possibleDuplicate` (the SAME window expression as `findEventRoster`,
    computed over the event and then narrowed to the row) and, per configured
    congress day, the current mark (`null` = never marked) plus its `history`
    of changes.
  - **History = the 010 audit.** The first reader of `audit_ledger`: the
    `data.registration_attendance.*` rows whose `metadata.pk.registration_id`
    is this registration, from `registeredAt` on (partition pruning), oldest
    first; the actor is the ledger's `subject_id` resolved to the `users`
    display name, else the raw `sub`; `source` as stored.
  - **Never** `account_created_by_intake` (EARS-35/EARS-36; the schema is
    strict).
  - **Scope + authorization** exactly as the roster: `check: "policy"` +
    `assertEventAccess` first, `audit: "low-stakes"`, `revalidate: "none"`;
    another event's registration through this path is 404 (the shared
    `registrationOfEvent` predicate the attendance write uses).

### Binding a registrar to an event (runbook, until #2378)

There is no grants screen yet (#2378). On the product owner's request the tech
lead binds a registrar by hand, after the registrar's account exists and holds
the `event-registrar` project role in Zitadel:

```sql
-- Outside any API request, so the 010 audit trigger records the row as
-- `db-direct` — which is exactly what happened. One registrar grant per user
-- (partial unique index): to re-bind, DELETE the old row first.
INSERT INTO event_role_grants (user_id, role, event_id)
SELECT u.id, 'event-registrar', e.id
FROM users u, events e
WHERE u.email = '<registrar email>' AND e.slug = '<event slug>';
```

The registrar sees the bound roster on the next `GET /v1/admin/auth/session`
read (its `eventGrants` field); no re-login is needed, because the binding is
read from the table on every request rather than baked into the session.
Deleting or re-pointing the row takes effect on the next request the same way:
every desk route then answers `403 EVENT_BINDING_REQUIRED`.

The programme committee (046 EARS-26) is bound the same way, with role
`congress-program-committee` and one row per event — a member may sit on
several congresses; its runbook is in
[`../congress/README.md`](../congress/README.md) («Programme committee»).

## Exported symbols

- `RegistrationModule` — the Nest module (both controllers + service +
  repository).
- `RegistrationService` — the `RegisterForEvent` command, the
  `EventRegistrationState` read, the `MyEvents` list, and the internal
  `EventRoster` read (`eventRoster`, consumed in-process by 006 + the report)
  and the 044 EARS-18 `eventRosterPage` read behind the registrar's HTTP route;
  resolves the acting doctor's `user_id` from the authenticated Zitadel `sub`
  (003 mirror) and the target event from its slug/id (007 read model). Domain
  errors: `EventNotRegistrableError` (→ 409), `RegistrationEventNotFoundError`
  (→ 404), `UnknownSubjectError` (→ 401).
- `RegistrationController` — the `/events/:idOrSlug/registration` write + state
  read; `MyEventsController` — the `/me/events` list (`/me` path prefix, the
  caller's own resources). Both `doctor_guest`-authenticated (EARS-10).
  `EventRosterAdminController` — the 044 registrar desk reads: the EARS-18
  roster and the EARS-36 participant card (`event-registrar` /
  `platform_admin`).
- `RegistrationRepository` — Drizzle access: writes the `registrations` record;
  reads `events` (007) and `users` (003) read-only, including the `MyEvents` join
  and the `findEventRoster` roster read (record columns only, no PII join). The
  044 EARS-18 `findEventRosterPage` is its widened sibling: it joins `users`
  (003) and `specialties_minzdrav` (017) read-only for the registrar's desk row.

**EARS-3** layers the one-registration invariant on top of that record:

- The DB `UNIQUE (user_id, event_id)` constraint (migration
  `0008_registrations_unique.sql`, which dedups any pre-existing duplicate rows
  keeping the earliest `registered_at` before adding the constraint) is the
  structural guard — at most one registration per `(doctor, event)` (ADR-0003
  §5), not client discipline.
- `RegisterForEvent` is an idempotent `INSERT … ON CONFLICT (user_id, event_id)
DO NOTHING` upsert + read-back: a repeat via **any** path (one-tap,
  guest-through-auth, «мои события» re-entry) returns the existing row and
  creates no duplicate; the insert-race resolves on the constraint.
- On the **first insert only**, one terminal `audit_ledger` row
  (`webinar.registration.created`) is appended in the same transaction — the
  durable `DoctorRegisteredForEvent`; an idempotent repeat emits none (the
  exactly-one-then-none invariant, EARS-3/EARS-8; design §5).

## Boundaries & tracked seams

- The durable `registrations` record shape is `(id, user_id, event_id,
registered_at)` — no cancelled state in wave 1 (owner decision). The
  `EventRoster` read model (the roster's membership basis, **EARS-8**, consumed
  by 006 + the wave-2 sponsor report) is "every registration row for the event" —
  landed here as `eventRoster` / `findEventRoster`; the cross-feature consumers
  are 006 (admission) and the report vertical, not wired here.
- The broader per-user reads — the event-page overlay that leaves 004's public
  cache untouched (**EARS-4**), `MyEvents` / «мои события» (**EARS-6**) — and the
  guest-through-auth event-context carry (**EARS-2**) build on this command.
- **Seam → feature 007.** Registration gating reads the `EventLifecycleState`
  owned by 007; until 007's authoring/transitions land, the surface is built and
  E2E-driven against **seeded fixture events** in each lifecycle state (tracked on
  parent #564). "Done against the real dependency" = registration gates on events
  authored + transitioned through 007, not only seeds.
