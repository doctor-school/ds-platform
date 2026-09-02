---
"@ds/schemas": minor
"@ds/api-client": minor
---

021 EARS-4 — the mandatory medical-worker declaration.

Adds the `RegisterDoctor` command contract (`DoctorRegisterRequestSchema`) with
`medicalWorkerDeclaration: z.literal(true)`, the `medical-worker-declaration`
consent purpose and the stable refusal code, plus the generated client types for
`POST /v1/storefront/doctor/register`.
