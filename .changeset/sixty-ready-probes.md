---
"@ds/api": minor
"@ds/schemas": minor
---

feat(api): GET /v1/ready with Postgres + pgvector probes

Adds a readiness endpoint that probes Postgres (`SELECT 1`) and the pgvector
extension (`to_regtype('vector')`) via `Promise.allSettled`, returning a
Zod-validated body (HTTP 200 when both pass, HTTP 503 — same shape — when any
probe fails). `@ds/schemas` gains `ReadinessResponseSchema` + `CheckStatusSchema`
(reusable building block for future Redis/MinIO/Centrifugo probes). Closes #60.
