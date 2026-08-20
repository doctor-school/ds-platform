# `@ds/api`

The DS Platform **backend API** — the BFF that fronts every product surface.
**NestJS 11 + Fastify**, Zod-validated REST, generated openapi-typescript SDK
(ADR-0002). Deployed as `api.doctor.school` alongside the portal; the 003 auth
vertical (registration + passwordless email/SMS-OTP login) is the live scope.

## Public surface

HTTP routes, grouped by NestJS feature module under `src/` — each module owns its
controllers, providers, and a per-module `README.md` (the `module-readme` guard):

```
src/
├── main.ts            # Fastify bootstrap
├── app.module.ts      # root module wiring
├── auth/              # sessions, OIDC, OTP login
├── authz/             # Cerbos policy enforcement
├── registration/      # new-account registration
├── bot-protection/    # abuse / rate limiting
├── feature-flags/     # Unleash-backed flags
├── mailer/            # transactional-email channel (distinct from Zitadel emails)
├── delivery-reconcile/# email/SMS delivery reconciliation
├── events/ · room/    # webinar events + rooms
├── storage/           # S3/MinIO objects
├── health/ · readiness/ · observability/
```

The wire contract is the Zod SSOT in `@ds/schemas`; the data layer is `@ds/db`
(Drizzle). Auth-related endpoints are `endpoint-authz`-guarded (BLOCK guard).

## Build / test

```bash
pnpm --filter @ds/api dev              # nest start --watch
pnpm --filter @ds/api build            # nest build → dist/
pnpm --filter @ds/api start            # node dist/main.js
pnpm --filter @ds/api test             # vitest run (api e2e uses real Postgres)
pnpm --filter @ds/api typecheck        # tsc --noEmit
pnpm --filter @ds/api drizzle:generate # drizzle-kit generate (schema in @ds/db)
pnpm --filter @ds/api drizzle:migrate  # snapshot + drizzle-kit migrate
```

`@ds/api` tests run only in the `api-e2e` CI job (real Postgres), not the shared
unit job — see the CI test topology.

Running the e2e suites locally against the dev stand needs two env facts beyond
the endpoints in `~/.ds-platform/.env.local`:

- `BOT_PROTECTION_ENABLED=false` in the **vitest process env**. With it on,
  `POST /v1/auth/register` answers 403 and every suite that registers a
  principal (all the admin/auth e2e) fails inside its `adminSession()` helper —
  the 403 surfaces as an unrelated-looking assertion, not as a captcha error.
- A per-branch database rather than the shared `ds_dev`:
  `pnpm dev:db:branch <issue-N>` creates and migrates one, and prints the
  `DATABASE_URL` to export for that session.

Suites that drive the IdP **bind** their `FakeIdpClient` with
`.overrideProvider(IDP_CLIENT).useValue(fake)`; they never read it back off the
container. `IdpModule` selects the real `ZitadelIdpClient` whenever `IDP_ISSUER`
and `IDP_SERVICE_TOKEN` are configured — which is the normal state of a dev
stand — so a suite that reads `IDP_CLIENT` is green on CI and red on every
developer machine. `test/auth/idp-fake-seam.spec.ts` pins both that rule and the
fake↔real port parity.

## Owning ADRs

- **ADR-0002** — backend core stack (NestJS + Zod + REST + SDK).
- **ADR-0003** — data layer (Postgres 17 + Drizzle + pgvector), via `@ds/db`.
- Feature specs live in `apps/docs/content/specs/features/` (003 auth, webinars).
