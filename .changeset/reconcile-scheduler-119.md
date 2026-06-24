---
"@ds/api": minor
---

Auth identity-sync hardening (#119, 003-design §11): wire the periodic reconciliation sweep and harden the Zitadel webhook.

- **Reconcile scheduler** — `ReconcileScheduler` registers a config-driven `@nestjs/schedule` interval that calls `ReconcileService.sweep()` (the EARS-19 eventual-consistency backstop). Period is `RECONCILE_SWEEP_INTERVAL_MS` (default 15 min; `0` disables); the scheduler guards against overlapping ticks and is fail-soft.
- **Manual ops trigger** — `pnpm --filter @ds/api reconcile:sweep` boots an HTTP-less Nest context and runs one sweep (`{ reconciled: N }`). Not an HTTP endpoint: v1 has no admin-auth surface.
- **Constant-time webhook secret check** — the `IDP_WEBHOOK_SECRET` comparison now uses `crypto.timingSafeEqual` (no length oracle, fail-closed preserved), removing a timing side-channel in the prior string compare.
- **Sweep skips machine/service accounts** — `listUsers()` enumerates Zitadel users without email/phone (e.g. the BFF service user); those are skipped so the `users_email_or_phone` CHECK no longer fails the sweep, and `reconciled` counts only human identities.
