# @ds/doctor — Doctor.School storefront (`doctor.school`)

The doctor-facing storefront of the two-storefront topology (ADR-0015 §2): the
public + authenticated surface a doctor lands on. Its sibling `@ds/portal` serves
`academy.doctor.school` (the Academy backstage). This app is the **scaffold** for
that host — the shell, the build/boot/CI wiring and the session plumbing exist;
the product routes do not yet (ADR-0015 §2 stage 3 migrates the marketing routes
here out of `apps/promo`).

**Not publicly routed.** There is no compose service and no Caddy vhost pointing
at it; ADR-0015 §7 makes the `doctor.school` cut-over a release-time step. The
`Dockerfile` here is the container that step will start.

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
    layout.tsx       # <html lang="ru">, Inter bound into --font-sans
    page.tsx         # storefront root: header / main+h1 / footer shell
  lib/
    session.ts       # server-side BFF session read (host-only cookie, ADR-0001 §6 fingerprint)
    session.test.ts  # vitest units for the above
    auth-client.ts   # client-side same-origin session probe
  e2e/
    a11y-axe.e2e.spec.ts   # WCAG 2 A/AA + one-h1 shell scan (CI: playwright-axe-doctor)
    shell-smoke.e2e.spec.ts# landmarks render; /v1/* rewrite is in the built manifest
  Dockerfile         # standalone image, PORT 3004 (not wired into compose yet)
  playwright.ci.config.ts  # backend-free tier, DOCTOR_CI_PORT (default 3211)
```

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
pnpm --filter @ds/doctor build
pnpm --filter @ds/doctor test:e2e:ci  # backend-free Playwright (needs the build)
pnpm ci:standalone-boot doctor        # boots the artifact the image runs
```

Parallel sessions must probe ports with `pnpm dev:ports` (prints an
`api`/`portal`/`doctor` triple) instead of binding 3000/3001/3004 blindly — see
`.claude/rules/dev-stand.md` → Parallel sessions.

`API_PROXY_TARGET` (default `http://localhost:3000`) points the `/v1/*` rewrite at
the api. It is frozen into the build, so it must be present at **build** time, not
only at runtime.
