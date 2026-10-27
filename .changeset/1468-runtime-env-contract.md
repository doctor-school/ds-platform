---
"@ds/schemas": minor
"@ds/api": patch
---

#1468: one runtime-env contract (`@ds/schemas/runtime-env`) lists the variables production's `api.env` must set. A production api boot (`NODE_ENV=production`) now refuses at env load, naming every missing contract variable (`DATABASE_URL`, `AUDIT_IDENTIFIER_PEPPER`, `LIFECYCLE_IMPACT_TOKEN_SECRET`; blank or `<placeholder>` counts as missing), instead of crash-looping later in DI construction; the prod release checks the same contract on the box before any state change.
