---
"@ds/doctor": patch
"@ds/portal": patch
"@ds/storefront-shell": patch
---

The storefronts' footer crossing to the sibling storefront (017 EARS-12 / LD-4,
#3147) is built from the configured origin instead of a hardcoded production
URL, so a stage slot's doctor storefront links to its own `academy-<slot>.…`
host and its Academy to its own `doctor-<slot>.…` host. Both are read at request
time by one shared reader (`@ds/storefront-shell/sibling-origin`) and refuse to
render without the value. The doctor container reads the EXISTING
`ACADEMY_PUBLIC_ORIGIN` (already in production `/etc/ds-platform/api.env` for the
admin, #2619). The portal needs a NEW REQUIRED key: production
`/etc/ds-platform/api.env` needs the line `DOCTOR_PUBLIC_ORIGIN=https://doctor.school`
BEFORE this ships; a local `apps/portal/.env.local` needs
`DOCTOR_PUBLIC_ORIGIN=http://localhost:3004` and `apps/doctor/.env.local`
`ACADEMY_PUBLIC_ORIGIN=http://localhost:3001` (see the apps' `.env.example`).
Stage slots get both from `tools/staging/slot.mjs`.
