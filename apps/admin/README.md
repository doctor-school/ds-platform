# @ds/admin — admin.doctor.school

The DS Platform admin app (Next.js 16 + **Refine** CSR shell, ADR-0004 §3/§5). Wave 1 ships the **feature 007** event-admin surface: the operator/director tooling that authors the webinar aggregate the rest of the Webinars epic reads.

## Architecture

- **Refine core** (`@refinedev/core`) + `@refinedev/nextjs-router` behind a `"use client"` boundary — the admin is effectively CSR with a thin SSR layout (ADR-0004 §4 caveat).
- **Custom providers** (`providers/`): a REST **data provider** over the NestJS `/v1/admin/events` surface, an **auth provider** over the shipped 003 BFF (`/v1/auth/*`), and an **access-control provider** answering from the principal's own `GET /v1/admin/auth/session` read (`roles` + `eventGrants`, projected by `lib/admin-access.ts`). The same projection draws the chrome (`components/app-shell.tsx`, 044 EARS-20): `platform_admin` gets every section; a principal holding only `event-registrar` gets exactly its bound event's roster link and lands on that roster from the admin landings (`/`, `/events`), while every other route renders the «нет прав» message in place of the page; a registrar with no binding gets no link. Both readers share ONE cached session read (`lib/admin-session-cache.ts`), dropped on every sign-in and sign-out so the next principal in the tab never sees the last one's nav. Until the read answers, the chrome draws no link and the page body stays empty. It decides what is drawn, never what is permitted — the api refusal (044 EARS-19/38) is the authority.
- **Auth (007 EARS-8).** 007 adds **no** auth primitive — the admin principal is a `platform_admin` session issued by the shipped 003/IdP layer. The `__Host-ds_session` cookie is set/sent **same-origin** through the `/v1/*` proxy (`next.config.ts` `rewrites()` → `API_PROXY_TARGET`), identical to the portal (no CORS, no token in JS).
- **UI (007 EARS-11).** Stock Refine + `@ds/design-system` (shadcn, "Your UI" in Refine) — token-only styling, no admin canvas exists (recorded Stage-A gap). The registry has no Select/Textarea primitive, so those two are native HTML controls carrying the DS `<Input>` token classes (`components/fields.tsx`).
- **i18n (007 EARS-10).** RU-only via next-intl (`messages/ru.json`); no hardcoded user-facing string (the `no-hardcoded-display-string` ESLint gate covers `apps/admin/app|components`). Every absolute time renders in **МСК** from the canonical instant (`lib/msk.ts`).
- **Client-side form validation (#665).** The create/edit + stream-config forms validate with react-hook-form + the DS `<Form>` set, on blur (`mode: onTouched`). Rules are **derived from the `@ds/schemas` SSOT** (`lib/form-schemas.ts` reuses the create-schema field validators verbatim — never re-typed bounds); RU error copy is mapped from the **structured zod issue** (code + path, never the English message) by `lib/use-localized-resolver.ts` into the `events.validation.*` catalog, drift-guarded by `lib/use-localized-resolver.test.ts`. The server Zod DTO stays the authority. NB: `@ds/schemas` fields consumed here carry **no baked zod `message`** — a schema-level message outranks the per-parse error map and would leak English (the 003/#200 precedent).

## The 007 event surface

`events` resource: list (all states + lifecycle badge + air time in МСК + edit link), create (full aggregate + program-PDF upload), and a detail page carrying the aggregate edit (incl. PDF replace), the stream config (closed enum `rutube | youtube`), and the lifecycle action bar. The lifecycle actions are derived **only** from the server-supplied `EventAdminDetail.validTransitions` (`lib/lifecycle.ts`) — the UI offers only the transitions valid from the current state; the api guard is the authority (EARS-7).

## The 012 taxonomy surface

`projects` (#1283), `experts` (#1284) and the open curated `directions` book (#1483) are the shipped 012/017 content-taxonomy resources. They share, deliberately, one implementation:

- **One list composition** — `components/admin-data-list.tsx` (#1297, EARS-23) is the single admin list surface: the four controls the API exposes (free-text `q`, state filter, «показывать снятые с публикации» off by default, pagination) mounted on the `@ds/design-system` blocks (`FilterBar` + `DataTable` + `Pagination` + `EmptyState`, #1578). Filters apply INSTANTLY — there is no «Применить» — the applied set renders as removable chips with one «Сбросить всё», and a single-action list gets no «Действия» column because the whole row opens the record. A resource passes its record cell, its columns and its RU copy and owns nothing else. The submit-driven `admin-list-shell.tsx` it replaced is deleted; `lib/server-combobox-adoption.test.ts` fails if a second list toolbar ever reappears.
- **One data provider path** — `providers/data-provider.ts` dispatches every taxonomy call off `TAXONOMY_MEDIA_PART`, the map from resource name to its multipart file part (`projects → cover`, `experts → photo`, `directions → null` — a direction has no media, so its writes are always JSON and no variable of one can be read as a file). Writes carry a fresh `Idempotency-Key`; edits carry `If-Match: W/"<version>"`; `deleteOne` throws — the taxonomy exposes no DELETE route anywhere.
- **One error mapping** — `lib/taxonomy-errors.ts` maps the §5.3 `errorCode` to the RU sentence, reading the resource namespace off the caller's fallback key so each vertical says the refusal in its own nouns.
- **Tabbed detail, «Основное» only** — Stage-A composition B (#1282). Publication and relationship tabs arrive with their own slices; an empty placeholder tab is never rendered.

The Expert form authors required family/given names plus optional patronymic and
may explicitly link one eligible existing User through the closed, server-backed
Combobox (or unlink it later). The server owns the collision-safe slug: no slug
input exists; detail renders the generated public URL with one copy action. The
no-photo avatar still renders the **server-computed** `initials`, so the admin,
public projection (#1294) and speaker projection (#1290) cannot disagree.

The direction form is the thinnest of the three — the operator authors a title, while the retained slug/address is derived once by the API. There is no description box or dropzone because a direction has neither; event classification selects an existing, non-retired direction from `/directions`, never an inline-created value.

## The 044 congress roster surface

`app/events/[id]/roster/page.tsx` (#2315, 044 EARS-21) is one event's registrations on the `AdminDataList` composition above, unchanged: instant search `q` and the pager, the query held in component state exactly as on the taxonomy lists. It is **server**-paged — `q`, `page` and `pageSize` go to `GET /v1/admin/events/:idOrSlug/roster` (#2311) through `congressRosterUrl` in `providers/data-provider.ts`, `total` comes back from the route, and nothing is sliced client-side. The columns are EARS-25 in order (№, ФИО, специальность, место работы, город, область, телефон, email, дата регистрации, статус письма), then EARS-34's «Присутствие»; № is the `DataTable` record column and a row counter continuous across pages. `lib/congress-roster.ts` is the pure row → cells projection: a cell the read model returns `null` for renders empty, never a placeholder. It has no create button, no row link and no lifecycle facet (EARS-24). One write is the registrar's desk entry (044 EARS-35, #2382): «Добавить участника» in the page's toolbar row opens `components/desk-registration-form.tsx` in the DS `Sheet` side panel (non-modal at `lg` and up, so the roster stays usable beside it; a full cover below) holding the approved admin form rhythm (approved-non-canvas `feature-044-desk-registration-form-v1`, state `desk-entry-panel`). It posts the site form's answer set plus the paper-consent tick to `POST /v1/admin/events/:idOrSlug/registrations` (`congressRosterUrl.deskRegistration`, through the `custom` transport that owns the idempotency and CSRF headers); client validation is the SSOT `CongressDeskRegistrationRequestSchema` (`DeskRegistrationFormSchema`), and every reference field searches: «Специальность» is a DS `Combobox` over the public closed book searched server-side (`GET /v1/public/specialties/search?q=`, `lib/desk-entry-references.ts`, through the shared `useServerCombobox`); «Населённый пункт» is a `Combobox` over the bundled ОКТМО directory `lib/settlements.json` (a copy of the congress site's generated file, loader and matching rules in `lib/settlements.ts`) — a pick fills «Регион» and shows it under the field, and the «Регион» input appears only for a place taken as typed. `accepted` closes the panel, refetches the roster and names the participant; `existing` keeps the panel open with an info `Alert` at the top of its body (focused; it names the address, says no new record was made and clears when the address changes) linking to that row through the roster's `?q=<email>` (the search is seeded from the address) — an interim target; retargeting it to the registration card panel is in #2383's scope (2026-09-28); a missing tick is refused before any request. `lib/congress-roster.ts` → `deskEntryFailure` sorts refusals: a 403 grant refusal (`EVENT_REGISTRAR_REQUIRED` / `PLATFORM_ADMIN_REQUIRED` — the route re-checks the grant live, ADR-0001 A1 — or `EVENT_BINDING_REQUIRED`, the event binding withdrawn or re-pointed, EARS-38) replaces the page with the «нет прав» message and is never retried; a 503 `IDP_REVALIDATION_UNAVAILABLE` and every other refusal keep the typed values for a retry; an answer that lands after the panel was closed paints nothing onto the next open. The platform administrator reaches it from the event detail's «Реестр участников» link and gets the way back to that detail; a congress registrar reaches it from its only nav link and gets no event link (EARS-20). Sort (EARS-22), column filters (EARS-23) and print (EARS-26) are separate handlers. Driven by `e2e/congress-roster.spec.ts` (rows seeded through the platform registration path) `e2e/congress-registrar-nav.spec.ts` (registrar bound through the SQL runbook, needs `DATABASE_URL`) and `e2e/congress-desk-registration.spec.ts` (the desk entry; the api needs the `CONGRESS_SIGNUP_*` settings, as the CI `admin-e2e` job sets them, because the desk runs through the congress intake).

**Attendance per congress day (044 EARS-34, #2381).** The roster's last column «Присутствие» is `components/attendance-cell.tsx`: one design-system `Checkbox` per congress day the route returns (`congressDays`, from the api's `CONGRESS_SIGNUP_EVENT_DAYS`), labelled «23.04» with the accessible name «Присутствие 23 апреля». A click is the whole act — the box flips at once and the ONE write helper `putCongressAttendance` (`providers/data-provider.ts`) sends `PUT /v1/admin/events/:idOrSlug/registrations/:registrationId/attendance/:day { present }`; the box is disabled while it is in flight, and a refused mark reverts it with `aria-invalid` and one short line: a withdrawn grant (401/403) is never retried — the page re-reads its list, whose own refusal replaces the roster; an IdP/network outage (503 / no answer) reads as retryable; anything else as a failed save. The presence filter sits in the same filter bar (`extraFilters`): a day select and a presence select («Все» / «Присутствовал» / «Не отмечен», enabled only with a day), held in component state like `q`, sent as `attendanceDay` / `present` on the same GET, so it composes with search and paging; a change resets to page 1, and a mark under an active presence filter re-reads the list so the row leaves or joins the filtered set. The pure halves (day labels, filter → query, refusal classification) live in `lib/congress-roster.ts`. Per-day sort waits for the server sort (EARS-22). Driven by `e2e/congress-attendance.spec.ts` (a registrar bound through the SQL runbook marks, reloads, unmarks and filters; axe WCAG 2.1 AA) — the api must run with `CONGRESS_SIGNUP_EVENT_DAYS=2027-04-23,2027-04-24`, as the `admin-e2e` job sets it.

## The 046 congress intake settings surface

`app/events/[id]/congress-intake/page.tsx` (#2432, 046 EARS-2/EARS-3) is one event's congress intake settings, reached by the platform administrator from the event detail's «Приём материалов Конгресса» link beside «Реестр участников»; a congress registrar is never drawn the route (`lib/admin-access.ts` offers it only its roster) and the api answers everyone but `platform_admin` with 403. `components/congress-intake-settings-form.tsx` is the owner-approved admin form pattern of `stream-config-form.tsx` (DS `Form` rows in `Card`s, one outcome `Alert`, one submit through the Refine custom mutation; Stage A route «а», no canvas): the registration address, the first-author rule (DS `Switch`), then per kind (Устный доклад / Постерный доклад / Тезисы) the opening day, the last day, the limit and the age limit. Days are native date inputs holding Moscow calendar days; a set last day reads back as «До {дата} включительно, по московскому времени.» (EARS-3). It reads `GET /v1/admin/events/:id/congress-intake-settings` — `configured: false` prefills the server's product defaults under an info notice — and saves the whole set with `PUT` (`congressIntakeSettingsUrl`). Validation is the server's (`CongressIntakeSettingsRequestSchema`): `lib/congress-intake-settings.ts` turns the read into the form and back, and maps each 400 issue by path and machine code onto its field in Russian (`congressIntake.refusals.*`), focusing the first; any other failure is one general line. Driven by `e2e/congress-intake-settings.spec.ts` (defaults → save → read back; the closing-before-opening refusal on the kind's last day) and the axe scan in `e2e/a11y/a11y-axe.e2e.spec.ts`.

## Develop

```bash
pnpm --filter @ds/admin dev        # next dev -p 3200 (proxies /v1/* → API_PROXY_TARGET)
pnpm --filter @ds/admin typecheck
pnpm --filter @ds/admin test       # vitest — pure-TS helpers (МСК, lifecycle derivation)
pnpm --filter @ds/admin build
```

The app needs a running api (`API_PROXY_TARGET`, default `http://localhost:3000`) with a live dev stand behind it (Postgres + Zitadel + MinIO). Read endpoints from `~/.ds-platform/.env.local` — never hardcode (`.claude/rules/dev-stand.md`). It also needs `ACADEMY_PUBLIC_ORIGIN` (#2619) — the Academy origin «Публичная ссылка» on a project / partner / expert links to, read at request time by the root layout; the admin refuses to render without it (local: `apps/admin/.env.example`; stage slot: rendered by `tools/staging/slot.mjs`; production: `/etc/ds-platform/api.env`).

## Browser E2E (playwright-bdd, dev-stand-gated)

`e2e/` translates `007-scenarios.feature` to the admin surface via **playwright-bdd** — the full operator arc (create → publish → configure stream → open → close → hide) plus the invalid-transition, closed-provider-enum, МСК-no-drift, non-admin-refusal, and client-side-validation branches (#665: rendered RU errors for required/datetime/duration/speaker/PDF rejects and the URL-shaped embed reference). Like the portal e2e (#131) it is a **manual, dev-stand-gated** gate (NOT in CI): the session bootstrap `throw`s without the stand env.

```bash
# Boot an api whose bot-protection is OFF (dev-stand recipe) so the 003
# register/login provisioning is not captcha-gated, then:
E2E_ADMIN_URL=http://localhost:3200 \
IDP_ISSUER=… IDP_SERVICE_TOKEN=… IDP_PROJECT_ID=… \
pnpm --filter @ds/admin test:e2e     # bddgen && playwright test
```

The suite pins a **non-Moscow** `timezoneId` for every scenario, so the МСК assertions (EARS-10) prove no operator-local drift.

The `taxonomy` project reads the spec-owned
`../docs/content/specs/features/012-content-taxonomy/012-scenarios.feature`
directly. Its bound journeys cover the EARS-2/19/20 standalone Expert path and
the EARS-9/17 project roster path: create a project and two Experts, assign one
curator, refuse a second curator, then atomically replace the curator while
retaining the former curator as a member. The EARS-9/14 relationship-restore path
links an Expert as a member, retires and reveals that link, restores the same
retained row, then reads the project from the Expert side. The EARS-9/14/16
occupied-curator path retires the first curator relationship, assigns a second
curator, then proves from the first Expert side that the retained row cannot be
restored into the occupied seat and directs the operator to curator replacement.
The EARS-9/22 reverse-authoring path creates a member relationship from the
Expert detail, records its retained row identity, and proves that the project
and Expert endpoints both show that same row and role exactly once. Run all five
slices with `pnpm --filter @ds/admin test:e2e --project taxonomy --grep "standalone Expert retains|project roster keeps exactly one curator|Expert-side authoring creates one retained member relationship|retired project Expert relationship returns|retired curator relationship stays retired"`.
The selected taxonomy journeys also run in the `admin-e2e` CI job against its
real Admin/API/database/MFA stack. Unbound 012 contracts remain visible as skipped; the existing `chromium`
project keeps strict generation for its 007/011 scenarios. Validation, editing,
media, User linking, list filtering and publication checks remain in
`e2e/taxonomy-experts.spec.ts` until their own scenarios replace them.
