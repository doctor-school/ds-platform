---
"@ds/admin": patch
---

Admin «Публичная ссылка» on a project, partner and expert (#2619) is built from
the configured Academy origin instead of a hardcoded production URL, so a stage
slot links to its own `academy-<slot>.…` host. New REQUIRED admin key
`ACADEMY_PUBLIC_ORIGIN`, read at request time (the admin refuses to render
without it): production `/etc/ds-platform/api.env` needs the line
`ACADEMY_PUBLIC_ORIGIN=https://academy.doctor.school` BEFORE this ships; a local
`apps/admin/.env.local` needs `ACADEMY_PUBLIC_ORIGIN=http://localhost:3001`
(see `apps/admin/.env.example`). Stage slots get it from `tools/staging/slot.mjs`.
