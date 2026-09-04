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
