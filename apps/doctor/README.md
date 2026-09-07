# @ds/doctor — Doctor.School storefront (`new.doctor.school`, later `doctor.school`)

The doctor-facing storefront of the two-storefront topology (ADR-0015 §2): the
public + authenticated surface a doctor lands on. Its sibling `@ds/portal` serves
`academy.doctor.school` (the Academy backstage). The shell, the build/boot/CI
wiring, the session plumbing and the public routing exist; the product routes are
still landing (ADR-0015 §2 stage 3 migrates the marketing routes
here out of `apps/promo`).

**Publicly routed on the temporary host `new.doctor.school` (#1723).** The
`doctor` compose service (`infra/deploy/compose/api-prod/compose.yml`, image
`ds-doctor:<sha>`, port 3004) sits behind the Caddy vhost `new.doctor.school`,
ships and rolls back with `pnpm deploy:prod` alongside `ds-api` / `ds-portal` /
`ds-admin`, and is probed by `pnpm smoke:prod`. The host is **temporary**: the
root `doctor.school` cut-over is a separate later step gated on data migration
and the retirement of the old site (owner decision on epic #1430, 2026-08-26).
Runbook: `infra/deploy/README.md` → «Doctor storefront roll-out».

## Stack

| Layer      | Choice                                                                         | Source        |
| ---------- | ------------------------------------------------------------------------------ | ------------- |
| Framework  | Next.js 16 App Router, `output: "standalone"` (self-hosted Node container)     | ADR-0004 §2.3 |
| UI         | `@ds/design-system` (tokens + owned shadcn primitives), transpiled as source   | ADR-0004 §6   |
| Styling    | Tailwind CSS 4, CSS-first config; this app owns **no** tokens of its own       | ADR-0004 §6.3 |
| API access | Same-origin BFF proxy — Next `rewrites()` `/v1/*` → `API_PROXY_TARGET`         | ADR-0015 §4   |
| Contracts  | `@ds/schemas` (Zod SSOT); no app-local re-declaration                          | ADR-0002      |
| Locale     | RU only, literal `lang="ru"` (no `next-intl` until there is copy to translate) | —             |

## Layout

```
apps/doctor/
  app/
    globals.css      # imports @ds/design-system/globals.css — tokens SSOT
    layout.tsx       # <html lang="ru">, Inter bound into --font-sans, pre-paint theme guard
    (storefront)/
      layout.tsx     # 017 EARS-1 — THE shell: header / main / footer, defined once
      page.tsx       # storefront root page (content only; the shell is the layout)
  components/
    storefront-header.tsx  # logo, empty search slot (LD-6), theme control, ONE action cluster
    storefront-footer.tsx  # «Документы и контакты» + the single Academy link (EARS-12)
    theme-toggle.tsx       # DS Button ghost/icon; <html class="dark"> is the source of truth
  lib/
    session.ts       # server-side BFF session read (host-only cookie, ADR-0001 §6 fingerprint)
    session.test.ts  # vitest units for the above
    shell-auth.ts    # server-resolved guest/doctor branch feeding the shell header
    theme.ts         # theme apply/persist + the inline pre-paint FOUC guard
    auth-client.ts   # client-side same-origin session probe
  e2e/
    a11y-axe.e2e.spec.ts   # WCAG 2 A/AA + one-h1 shell scan (CI: playwright-axe-doctor)
    shell-smoke.e2e.spec.ts# landmarks render; /v1/* rewrite is in the built manifest
    shell.spec.ts          # 017 EARS-1/EARS-12 shell contract in the browser
  Dockerfile         # standalone image, PORT 3004 (not wired into compose yet)
  playwright.ci.config.ts  # backend-free tier, DOCTOR_CI_PORT (default 3211)
```

## Registration success state (021 EARS-10)

After the doctor submits the emailed code, `components/registration-screen.tsx`
calls the single storefront command `POST /v1/storefront/doctor/confirm` (it
verifies the code and decides the landing in one round trip) and replaces the
confirm card with the shared `RegistrationSuccessCard`
(`@ds/design-system` — see the capability registry). The card's PRIMARY action is
the landing: the server's `primaryAction.href` when the carried return target is
still live, or when the server degraded it to the nearest honest destination
(`reason: ended | full | unpublished | missing`, stated in RU above the actions);
with nothing carried it is the `landing` prop the register page computed from the
specialty read (LD-4 — `/events`, else `/`). The personal cabinet (`/account`) is
always the SECONDARY action, never the default destination. Points are shown as a
pending promise, not an accrued fact, while the API returns `credited: null`, and
the profile-motivation line is absent until `profileCompletion` carries a string.
The RU copy map and the pure landing composition live in
`lib/registration-success.ts`; every href reaching a navigation comes from the
server response or that `landing` prop — never assembled on the client.

## Sessions on two hosts (ADR-0015 §4)

One Zitadel identity, but the BFF session cookie is `__Host-ds_session` — the
`__Host-` prefix carries **no `Domain`**, so the cookie is locked to the exact
origin that set it. `doctor.school` and `academy.doctor.school` therefore hold
**separate** session cookies of the same name; continuity between them is OIDC
silent re-auth, never a shared cookie. The host is not an authorization boundary
either way: the api re-checks roles on every request. This is why `lib/session.ts`
lives here rather than being imported from the portal.

## How to run

```bash
pnpm install
pnpm --filter @ds/doctor dev          # http://localhost:3004
pnpm --filter @ds/doctor test         # vitest units
API_PROXY_TARGET=http://127.0.0.1:3214 pnpm --filter @ds/doctor build
pnpm --filter @ds/doctor test:e2e:ci  # all four Playwright tiers (need the build)
pnpm ci:standalone-boot doctor        # boots the artifact the image runs
```

Parallel sessions must probe ports with `pnpm dev:ports` (prints an
`api`/`portal`/`doctor` triple) instead of binding 3000/3001/3004 blindly — see
`.claude/rules/dev-stand.md` → Parallel sessions.

`API_PROXY_TARGET` (default `http://localhost:3000`) points the `/v1/*` rewrite at
the api. It is frozen into the build, so it must be present at **build** time, not
only at runtime — including before the Playwright tiers, whose 019 events tier
polls `/v1/storefront/doctor/events/live` from the browser and therefore needs the
baked destination to be that tier's stand-in (`DOCTOR_EVENTS_FAKE_API_PORT`, 3214).

## Events mobile and accessibility matrix (019 EARS-13)

`e2e/events-mobile.spec.ts` always checks 390/1440 × light/dark, loaded/empty
feeds, live presence/absence, labelled card links, horizontal overflow, keyboard
focus and horizon navigation, and desktop month day/month navigation. Full-page
axe includes contrast with no exclusions. Screenshot attachments accompany each
presentation. The events CI tier runs serially because its upstream live scenario
is mutable and shared between files.

```bash
# After the matching build above; ports must be free.
pnpm --filter @ds/doctor exec playwright test --config=playwright.events.config.ts
```

This is coverage of the existing R1 feed and desktop month pane. Filter mounting
and final route composition (#1516), the calendar page (#1520), past (#1525) and
mine (#1526) remain R1.1 deliverables with their own mobile/axe obligations.

For real API/DB verification, build and start doctor with the same real
`API_PROXY_TARGET`, seed an isolated branch DB with `pnpm --filter @ds/api
seed:events`, and supply the complete ENV SET documented in the spec:

```bash
export E2E_DOCTOR_URL=<running-doctor-origin>
export E2E_EVENTS_LOADED_PATH='/events?specialty=all'
export E2E_EVENTS_EMPTY_PATH='/events?specialty=all&q=1528-no-matching-event'
export E2E_EVENTS_EXPECT_LIVE=present
pnpm --filter @ds/doctor exec playwright test --config=playwright.events-live.config.ts
# DATABASE_URL must already name YOUR isolated ds_dev_<issue> database.
node apps/doctor/e2e/support/events-live-phase.mjs <issue>
export E2E_EVENTS_EXPECT_LIVE=absent
pnpm --filter @ds/doctor exec playwright test --config=playwright.events-live.config.ts
pnpm --filter @ds/api seed:events # restore the present phase for owner review
```

The live config fails on missing/partial environment instead of skipping or
falling back to the upstream double. Each phase executes the same substantive
assertions; the real live read is independent of feed query facets, so an empty
feed can legitimately still have a live strip. The loaded fixture must contain
both current-horizon cards and a further event reached by «Показать ещё».
The lifecycle helper ends only six exact `seed:events` live fixtures, checks the
branch database name before connecting and again inside the transaction, and
never deletes data. Its refusal checks run with
`node --test apps/doctor/e2e/support/events-live-phase.test.mjs`.
