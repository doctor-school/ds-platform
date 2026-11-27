# `@ds/portal`

The DS Platform **user portal** — `academy.doctor.school` (ADR-0004 §3). The
multi-role cabinet surface (doctor / expert / clinic / investor), built as a
Next.js 16 App Router app with custom React on the shared design system — **not**
Refine (Refine is `apps/admin` only; ADR-0004 §5.3 / §7).

The app owns both the public Academy home and the authenticated cabinet. Public
`/` is the Feature 029 Academy home; cabinet, webinar, and authentication
routes keep their existing application behavior.

## Stack (ADR-0004)

| Concern       | Choice                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------- |
| Framework     | Next.js 16 App Router + RSC, `output: 'standalone'` (self-host, no Vercel runtime — §2.3) |
| Design system | `@ds/design-system`, transpiled as source via `transpilePackages` (§6)                    |
| Forms         | React Hook Form + `@hookform/resolvers/zod` + shadcn `<Form>` (§9)                        |
| Styling       | Tailwind CSS 4 (tokens from `@ds/design-system/globals.css`)                              |
| Data fetching | Tanstack Query v5 + RSC hybrid — added when the first data-bound cabinet lands (§8)       |

## Layout

```
app/
├── @chrome/
│   ├── page.tsx                 # persistent AcademyShellHeader on public /
│   └── [...catchAll]/page.tsx   # persistent AcademyShellHeader elsewhere
├── globals.css                  # shared tokens + Tailwind
├── layout.tsx                   # root providers, theme baseline, chrome slot, shell footer
├── page.tsx                     # Academy home (Feature 029)
└── login/page.tsx               # sign-in surface

components/
└── academy-shell-header.tsx     # server component: `shell` catalogue + request auth → StorefrontHeader

lib/
├── shell-auth.ts                # server read: @ds/auth-flow/server + self-profile → the shell's `auth` DATA prop
└── shell-config.ts              # the host-config VALUES the shared shell renders
```

The header and footer are `@ds/storefront-shell` (#2180), built from the
owner-approved `design-source/ds-shell.dc.html` canvas and shared with the
Doctor showcase; this app contributes configuration values and the auth slot
only. The footer mounts from the root layout, so it appears on every route the
config does not hide (`/login`, `/register`, `/verify`, `/reset` and
`/webinars/*/room`).

The Academy hThe Academy home (Feature 029, `app/academy-home-view.tsx`) is a server
composition built from the owner-approved `design-source/academy-home.dc.html`
canvas: the host-only hero, «Кто мы» and persona entries, plus the mounted owner
blocks — the shared `EventsFeed` of `@ds/events-storefront/feed` (`limit: 3`)
and the 048 materials rail (`app/materials-feed-section.tsx`). The hero's count
lines (`app/academy-home-counts.ts`) read `GET /v1/public/projects`,
`GET /v1/public/experts/count` and `GET /v1/public/organisations/count` per
request, each settled on its own: a failed or zero read drops only its own
segment. The home carries no fixture data and no form; its expert entries lead
to `/apply` (033) and its partner entries to `/investors` (034).

```bash
pnpm --filter @ds/portal dev        # next dev (local)
pnpm --filter @ds/portal build      # next build → .next/standalone
pnpm --filter @ds/portal typecheck  # tsc --noEmit
pnpm --filter @ds/portal test:e2e:ci # backend-free production-build browser checks
```
