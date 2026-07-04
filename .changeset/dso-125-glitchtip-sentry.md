---
"@ds/api": minor
---

Add GlitchTip (self-hosted Sentry-compatible) error monitoring to the api. `@sentry/node` is initialised only when `SENTRY_DSN` is set (prod only; a no-op on the dev-stand / CI), and a global exception filter reports 5xx / unexpected errors while leaving client-facing responses unchanged. PII is stripped from every event (request, user, and server context removed; breadcrumbs disabled) per ADR-0011. Self-hosted GlitchTip is the 152-ФЗ-compliant, RF-zone replacement for Sentry SaaS (ADR-0004 §15 / ADR-0005 §10) — DSO-125.
