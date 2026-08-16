# `@ds/portal`

The DS Platform **user portal** — `academy.doctor.school` (ADR-0004 §3). The
multi-role cabinet surface (doctor / expert / clinic / investor), built as a
Next.js 16 App Router app with custom React on the shared design system — **not**
Refine (Refine is `apps/admin` only; ADR-0004 §5.3 / §7).

The app owns both the public Academy home and the authenticated cabinet. Public
`/` is the static Feature 013 composition; cabinet, webinar, and authentication
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
│   ├── page.tsx                 # no app shell on public /
│   └── [...catchAll]/page.tsx   # persistent AppShellHeader elsewhere
├── globals.css                  # shared tokens + Tailwind
├── layout.tsx                   # root providers, theme baseline, chrome slot
├── page.tsx                     # static Academy home (Feature 013)
└── login/page.tsx               # sign-in surface
```

The Academy home reads local fixtures and local WEBP portraits only. Its
partnership preview deliberately has no `<form>`, endpoint, server action, or
persistence; the fieldset and button stay disabled until the tracked form
follow-up lands.

## Commands

```bash
pnpm --filter @ds/portal dev        # next dev (local)
pnpm --filter @ds/portal build      # next build → .next/standalone
pnpm --filter @ds/portal typecheck  # tsc --noEmit
pnpm --filter @ds/portal test:e2e:ci # backend-free production-build browser checks
```
