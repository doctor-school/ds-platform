---
"@ds/design-system": minor
"@ds/portal": minor
---

feat(frontend): scaffold apps/portal + graduate packages/design-system (auth-form set)

Graduates `@ds/design-system` from a stub to the Tailwind CSS 4 + shadcn/ui
owned-code component set the 003 inline auth forms need (ADR-0004 §6): a single
token sheet (`globals.css`) whose one `--radius` derives the whole radius scale
via `@theme inline`, plus `Button`, `Input`, `Label`, `Card`, the RHF `<Form>`
binding (ADR-0004 §9), and `InputOTP`. Components ship as source and are
transpiled by consumers (`transpilePackages`).

Scaffolds `@ds/portal` as a Next.js 16 App Router app (`output: 'standalone'`,
no Vercel runtime — ADR-0004 §2.3/§3/§7): app shell + a sign-in page wiring the
RHF + `@hookform/resolvers/zod` + `<Form>` + `<InputOTP>` stack end to end. The
BFF calls and the OIDC silent-re-auth middleware land with feature 003. Closes
#82.
