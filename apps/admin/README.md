# @ds/admin — admin.doctor.school

The DS Platform admin app (Next.js 16 + **Refine** CSR shell, ADR-0004 §3/§5). Wave 1 ships the **feature 007** event-admin surface: the operator/director tooling that authors the webinar aggregate the rest of the Webinars epic reads.

## Architecture

- **Refine core** (`@refinedev/core`) + `@refinedev/nextjs-router` behind a `"use client"` boundary — the admin is effectively CSR with a thin SSR layout (ADR-0004 §4 caveat).
- **Custom providers** (`providers/`): a REST **data provider** over the NestJS `/v1/admin/events` surface, an **auth provider** over the shipped 003 BFF (`/v1/auth/*`), and an **access-control provider** answering from the principal's own `GET /v1/admin/auth/session` read (`roles` + `eventGrants`, projected by `lib/admin-access.ts`). The same projection draws the chrome (`components/app-shell.tsx`, 044 EARS-20): `platform_admin` gets every section; a principal holding only `event-registrar` gets exactly its bound event's roster link, and every other route renders the «нет прав» message in place of the page; a registrar with no binding gets no link. It decides what is drawn, never what is permitted — the api refusal (044 EARS-19/38) is the authority.
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

`app/events/[id]/roster/page.tsx` (#2315, 044 EARS-21) is one event's registrations on the `AdminDataList` composition above, unchanged: instant search `q` and the pager, the query held in component state exactly as on the taxonomy lists. It is **server**-paged — `q`, `page` and `pageSize` go to `GET /v1/admin/events/:idOrSlug/roster` (#2311) through `congressRosterUrl` in `providers/data-provider.ts`, `total` comes back from the route, and nothing is sliced client-side. The columns are EARS-25 in order (№, ФИО, специальность, место работы, город, область, телефон, email, дата регистрации, статус письма); № is the `DataTable` record column and a row counter continuous across pages. `lib/congress-roster.ts` is the pure row → cells projection: a cell the read model returns `null` for renders empty, never a placeholder. The screen is view-only (EARS-24): no create button, no row link, no lifecycle facet. The platform administrator reaches it from the event detail's «Реестр участников» link and gets the way back to that detail; a congress registrar reaches it from its only nav link and gets no event link (EARS-20). Sort (EARS-22), column filters (EARS-23) and print (EARS-26) are separate handlers. Driven by `e2e/congress-roster.spec.ts` (rows seeded through the platform registration path) and `e2e/congress-registrar-nav.spec.ts` (registrar bound through the SQL runbook, needs `DATABASE_URL`).

## Develop

```bash
pnpm --filter @ds/admin dev        # next dev -p 3200 (proxies /v1/* → API_PROXY_TARGET)
pnpm --filter @ds/admin typecheck
pnpm --filter @ds/admin test       # vitest — pure-TS helpers (МСК, lifecycle derivation)
pnpm --filter @ds/admin build
```

The app needs a running api (`API_PROXY_TARGET`, default `http://localhost:3000`) with a live dev stand behind it (Postgres + Zitadel + MinIO). Read endpoints from `~/.ds-platform/.env.local` — never hardcode (`.claude/rules/dev-stand.md`).

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
