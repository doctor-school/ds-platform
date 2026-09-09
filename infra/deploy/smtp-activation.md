# Transactional SMTP configuration and controlled activation

Release blocker [#2116](https://github.com/doctor-school/ds-platform/issues/2116)
owns production secret injection and activation of the merged
[003 contract](../../apps/docs/content/specs/features/003-user-authentication/003-design.md#143-transport-chain--explicit-postbox-primary-dormant-optional-resend-10592115).
Code merge does not switch production. Complete the required owner release gate
before any production configuration or provisioning write.

## Deployment preparation

Before deploying this configuration revision, explicitly select the intended
provider in `/etc/ds-platform/api.env` (root:root 0600). Keeping mail.ru selected
is supported: `IDP_SMTP_REAL_PROVIDER=mail.ru`, `IDP_SMTP_REAL_HOST=smtp.mail.ru:465`
and the existing complete credentials/sender. An absent provider now fails in real
mode; updating the example does not update existing production files. Record this
compatibility migration under #2116 before the next deployment.

For Postbox set `IDP_SMTP_REAL_PROVIDER=postbox` and
`IDP_SMTP_REAL_HOST=postbox.cloud.yandex.net:465`. Shared `IDP_SMTP_REAL_USER` and
`IDP_SMTP_REAL_PASSWORD` carry the API key ID and secret; `IDP_SMTP_REAL_SENDER_ADDRESS`
is the authorized sender. Keep TLS certificate/hostname verification enabled. Do
not add a second Zitadel credential set. Leave `RESEND_ENABLED=false`; a stored
Resend key alone is inert. Enabling that BFF-only fallback requires the recorded
data-processing decision and valid credentials.

## Controlled converge and evidence

1. Securely retain the deliberate previous env configuration for rollback, without
   printing secrets or attaching them to logs/issues. Record the current stable
   SMTP provider ID and public configuration privately. No DB reset is required.
2. Inject the complete coherent selected env through the normal secret contract.
   Run the committed `infra/dev-stand/idp/provision.sh` using the root-sourced env
   and existing bootstrap PAT, following the general deploy runbook's provisioning
   command. It updates `real transactional sender` in place, never creates a new
   provider merely because its host changed. Provisioning updates may take effect
   immediately on an active provider; use the controlled activation window.
3. Read back the SMTP identity: exactly one stable description, same ID, intended
   host:465/sender/username, TLS enabled and active state. The API never returns the
   password; do not interpret an omitted secret as proof of equality. Deploy the
   API through `pnpm deploy:prod` under the release gate and confirm reconciliation.
4. Exercise controlled BFF register/resend/reset and native verified-account login
   OTP. Verify unchanged UTF-8, expiry and link-free BFF artifacts. Observe native
   failures in Zitadel separately: Resend failover and BFF deadlines do not cover it.
   An API reconcile error cannot stop independently scheduled IdP messages.
5. Record provider acceptance, received authentication headers and mailbox placement
   separately. Never publish OTPs, recipient addresses, subjects/bodies or secrets.
   Microsoft evidence remains #1120; allow-list-assisted Inbox placement is not a pass.
   Approved quota and measured headroom are prerequisites for the mass-registration
   ramp; pilot acceptance alone does not close #1059.

Rollback restores the complete previous provider/host/credentials/sender selection,
re-runs the same provisioner to converge the same identity, then confirms public
readback and both native/BFF journeys through the approved deployment procedure.
Never use Mailpit as a real-delivery fallback, create duplicate provider identities,
or disable certificate validation to complete rollback.
