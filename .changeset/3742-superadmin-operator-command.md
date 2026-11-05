---
"@ds/api": minor
---

049 EARS-6: the superadmin operator command (`pnpm --filter @ds/api superadmin -- grant|remove --email <e> --by-admin <sub>`) — the only path that gives and removes `superadmin`, audited as `auth.role.granted` / `auth.role.revoked` through the staff-access writers.
