# `@ds/portal`

The DS Platform **user portal** — `app.doctor.school` (ADR-0004 §3). The
multi-role cabinet surface (doctor / expert / clinic / investor), built as a
Next.js 16 App Router app with custom React on the shared design system — **not**
Refine (Refine is `apps/admin` only; ADR-0004 §5.3 / §7).

This is the **scaffold** (issue #82): the app shell + the wiring needed by
feature 003 (user authentication). Actual cabinet UX and the auth flows arrive in
later issues.

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
├── globals.css        # @import "@ds/design-system/globals.css" (tokens + Tailwind)
├── layout.tsx         # root <html>/<body>, theme baseline
├── page.tsx           # shell landing — proves the design-system build wiring
└── login/page.tsx     # sign-in SCAFFOLD: RHF + zodResolver + <Form> + <InputOTP>
```

`app/login/page.tsx` exercises the full form stack but does **not** call the BFF.
The real authentication — `/v1/auth/*` over the BFF, the `__Host-ds_portal_session`
cookie, and the OIDC silent-re-auth `middleware.ts` (ADR-0004 §3.2.1) — lands with
feature 003: F2 (#86) password + session, F3 (#87) email/SMS-OTP. The sign-in
schema moves to the `@ds/schemas` SSOT then; here it is local and illustrative.

## Commands

```bash
pnpm --filter @ds/portal dev        # next dev (local)
pnpm --filter @ds/portal build      # next build → .next/standalone
pnpm --filter @ds/portal typecheck  # tsc --noEmit
```
