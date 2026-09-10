# Native delivery reconciliation

`DeliveryReconcileModule` reconciles the `email-delivery-real` and
`sms-delivery-real` flags onto Zitadel notification providers. Verified-account
login email OTP remains generated, rendered and sent by Zitadel. BFF verify/reset
and account-exists emails use `MailerModule` and its separate send chain.

`DeliveryReconcileService` subscribes to flag changes and initial SDK synchronization
before the bounded startup reconcile. It uses env defaults until flags synchronize.
Intercept defaults remain Mailpit/sms-sink. The optional module is absent when no
live IdP issuer/service token is configured.

For real SMTP, the shared `config/real-smtp.ts` validator requires explicit
`IDP_SMTP_REAL_PROVIDER=postbox|mail.ru`, matching host, port 465 and complete shared
credentials/sender. The current implementation preserves `real transactional sender`.
The [profile migration draft](../../../docs/content/specs/tech/2026-09-10-postbox-native-smtp-profile-design-en.md)
requires provider-scoped identities selected by `IDP_SMTP_REAL_PROVIDER`;
that behavior is pending implementation and does not exist in this module yet.
Before activation, including an already-active provider, reconcile requires exactly
one matching identity and checks its host, sender, username and TLS metadata against
the configured selection. It never reads or compares the stored SMTP password:
Zitadel does not return it. Provisioning owns credential convergence.

Missing, duplicate or mismatched real SMTP configuration rejects reconciliation.
Startup exhausts its bounded retries and fails when real email is selected. A later
flag failure logs a sanitized error and retries on the next signal; it never
activates a fallback. **This cannot stop independently scheduled Zitadel sends or
retract already queued mail**: the previous active provider can still send until
operations correct the configuration. Native failures must be monitored in Zitadel.
BFF Resend fallback, per-send deadlines and acceptance metrics do not cover native
sends. SMTP acceptance is not mailbox delivery evidence.

`ZitadelDeliveryAdmin` reads the Admin SMTP/SMS search endpoints and activates by ID.
Its SMTP metadata shape follows [ListSMTPConfigs](https://zitadel.com/docs/reference/api/admin/zitadel.admin.v1.AdminService.ListSMTPConfigs).
Provider response bodies and SMTP credentials are never included in its errors.
`stop()` removes both signal subscriptions. SMS/intercept retains its existing
missing-provider warning and transient startup recovery behavior.

Tests: from the repo root, `node apps/api/node_modules/vitest/vitest.mjs run apps/api/src/delivery-reconcile`.
Provisioning fixtures execute isolated shell sections with a fake API and synthetic
credentials; they need Bash and jq, never a running stand or provider connection.

Controlled activation, readback, rollback and received-artifact proof are tracked in
[#2116](https://github.com/doctor-school/ds-platform/issues/2116), using the
[SMTP activation runbook](../../../../infra/deploy/smtp-activation.md).
