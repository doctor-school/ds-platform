---
"@ds/schemas": minor
---

Add an optional `version` field to `HealthResponseSchema` — the deployed commit
SHA the api reports at `GET /v1/health` (sourced from the `DEPLOY_SHA` env baked
into the container by `pnpm deploy:prod`, DSO-127). Additive and optional: unset
in local dev / tests where no deploy stamped a SHA.
