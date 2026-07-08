# @ds/admin — admin.doctor.school

The DS Platform admin app (Next.js 16 + **Refine** CSR shell, ADR-0004 §3/§5). Wave 1 ships the **feature 007** event-admin surface: the operator/director tooling that authors the webinar aggregate the rest of the Webinars epic reads.

## Architecture

- **Refine core** (`@refinedev/core`) + `@refinedev/nextjs-router` behind a `"use client"` boundary — the admin is effectively CSR with a thin SSR layout (ADR-0004 §4 caveat).
- **Custom providers** (`providers/`): a REST **data provider** over the NestJS `/v1/admin/events` surface, an **auth provider** over the shipped 003 BFF (`/v1/auth/*`), and an **access-control provider** gating on the `platform_admin` role.
- **Auth (007 EARS-8).** 007 adds **no** auth primitive — the admin principal is a `platform_admin` session issued by the shipped 003/IdP layer. The `__Host-ds_session` cookie is set/sent **same-origin** through the `/v1/*` proxy (`next.config.ts` `rewrites()` → `API_PROXY_TARGET`), identical to the portal (no CORS, no token in JS).
- **UI (007 EARS-11).** Stock Refine + `@ds/design-system` (shadcn, "Your UI" in Refine) — token-only styling, no admin canvas exists (recorded Stage-A gap). The registry has no Select/Textarea primitive, so those two are native HTML controls carrying the DS `<Input>` token classes (`components/fields.tsx`).
- **i18n (007 EARS-10).** RU-only via next-intl (`messages/ru.json`); no hardcoded user-facing string (the `no-hardcoded-display-string` ESLint gate covers `apps/admin/app|components`). Every absolute time renders in **МСК** from the canonical instant (`lib/msk.ts`).
- **Client-side form validation (#665).** The create/edit + stream-config forms validate with react-hook-form + the DS `<Form>` set, on blur (`mode: onTouched`). Rules are **derived from the `@ds/schemas` SSOT** (`lib/form-schemas.ts` reuses the create-schema field validators verbatim — never re-typed bounds); RU error copy is mapped from the **structured zod issue** (code + path, never the English message) by `lib/use-localized-resolver.ts` into the `events.validation.*` catalog, drift-guarded by `lib/use-localized-resolver.test.ts`. The server Zod DTO stays the authority. NB: `@ds/schemas` fields consumed here carry **no baked zod `message`** — a schema-level message outranks the per-parse error map and would leak English (the 003/#200 precedent).

## The 007 event surface

`events` resource: list (all states + lifecycle badge + air time in МСК + edit link), create (full aggregate + program-PDF upload), and a detail page carrying the aggregate edit (incl. PDF replace), the stream config (closed enum `rutube | youtube`), and the lifecycle action bar. The lifecycle actions are derived **only** from the server-supplied `EventAdminDetail.validTransitions` (`lib/lifecycle.ts`) — the UI offers only the transitions valid from the current state; the api guard is the authority (EARS-7).

## Develop

```bash
pnpm --filter @ds/admin dev        # next dev -p 3200 (proxies /v1/* → API_PROXY_TARGET)
pnpm --filter @ds/admin typecheck
pnpm --filter @ds/admin test       # vitest — pure-TS helpers (МСК, lifecycle derivation)
pnpm --filter @ds/admin build
```

The app needs a running api (`API_PROXY_TARGET`, default `http://localhost:3000`) with a live dev stand behind it (Postgres + Zitadel + MinIO). Read endpoints from `~/.ds-platform/.env.local` — never hardcode (`.claude/rules/dev-stand.md`).

## Browser E2E (playwright-bdd, dev-stand-gated)

`e2e/` translates `007-scenarios.feature` to the admin surface via **playwright-bdd** — the full operator arc (create → publish → configure stream → open → close → archive) plus the invalid-transition, closed-provider-enum, МСК-no-drift, non-admin-refusal, and client-side-validation branches (#665: rendered RU errors for required/datetime/duration/speaker/PDF rejects and the URL-shaped embed reference). Like the portal e2e (#131) it is a **manual, dev-stand-gated** gate (NOT in CI): the session bootstrap `throw`s without the stand env.

```bash
# Boot an api whose bot-protection is OFF (dev-stand recipe) so the 003
# register/login provisioning is not captcha-gated, then:
E2E_ADMIN_URL=http://localhost:3200 \
IDP_ISSUER=… IDP_SERVICE_TOKEN=… IDP_PROJECT_ID=… \
pnpm --filter @ds/admin test:e2e     # bddgen && playwright test
```

The suite pins a **non-Moscow** `timezoneId` for every scenario, so the МСК assertions (EARS-10) prove no operator-local drift.
