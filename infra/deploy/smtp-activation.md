# Transactional SMTP configuration and controlled activation

Release blocker [#2116](https://github.com/doctor-school/ds-platform/issues/2116)
owns activation and received-artifact evidence. The native-profile migration is a
**draft pending owner decision and implementation**:
[EN design](../../apps/docs/content/specs/tech/2026-09-10-postbox-native-smtp-profile-design-en.md) /
[RU design](../../apps/docs/content/specs/tech/2026-09-10-postbox-native-smtp-profile-design-ru.md).
Do not execute production writes from this documentation before those gates.

Keep coherent mail.ru selection in the protected production environment while
preparing: `IDP_SMTP_REAL_PROVIDER=mail.ru`, `IDP_SMTP_REAL_HOST=smtp.mail.ru:465`
and existing credentials/sender. Postbox uses `postbox` and
`postbox.cloud.yandex.net:465`, sharing existing API key credentials between BFF
and its separate native profile. No new Yandex account/key is required.
Keep certificate verification enabled and `RESEND_ENABLED=false`.

## Required implementation before activation

1. Land the owner-chosen profile contract, implement it with TDD, and complete
   independent review plus canonical landing. Preserve #2151 protection: native
   convergence must be proved before migration/application replacement.
2. Make the existing native reconciler select the profile matching
   `IDP_SMTP_REAL_PROVIDER`, using the same settings as the BFF. Preserve runtime
   flag handling and nonproduction intercept; no intermediate ownership release
   or separate deployment system is required.
3. Record deployment/release readiness and applicable owner authorization.
   Previous single-use release exceptions do not authorize another release.

## Controlled sequence after implementation

Use only the committed canonical deployment entry point. Securely preserve the
complete old environment, original active SMTP ID and public metadata; never log
secrets. Existing mail.ru keeps `real transactional sender`.

Search all SMTP pages for exactly one `real transactional sender:postbox` profile.
Create it inactive only if absent; reuse an exact match without PUT. Duplicate,
mismatched or ambiguously created profiles fail closed. Read exact candidate
metadata before a controlled by-ID test. A successful response alone is not
convergence; use the design's absolute 120-second readiness budget.

Activate the candidate without first deactivating mail.ru. Verify intended active
ID and metadata before migration/replacement, then check again after application
readiness. During replacement the old BFF may still use mail.ru and its reconciler may
reselect mail.ru. The switch is not atomic and is not complete until the new
application and projected native selection agree. Verify controlled register/resend/reset and actual native login OTP.

On failed or uncertain activation, inspect actual state before another attempt.
Restore the coherent previous BFF environment before canonical rollback to the
previous application, reactivate the original ID and verify readback and receipt
through both actual send paths. Incomplete restoration is a failed activation. Retain
both profile IDs after success or rollback; do not delete/recreate profiles.

## Projection failure and evidence

Pinned Zitadel v4.15.0 can persist a password update while its SMTP projection
fails with SQLSTATE 42601 (duplicate password assignment). The old ID's by-ID test
reads the event write model, whereas actual native delivery uses the query
projection. Therefore `_test` of that ID cannot certify mail.ru rollback. Prove
the native notification itself. The isolated rehearsal reproduces delayed
projection progress and why immediate CREATE/activate success is unsafe.

Do not update existing-profile metadata/passwords, replay/reset the projection,
toggle fields to manufacture an event, blindly retry CREATE or upgrade the IdP.
An exhausted readback deadline stops the deploy; it never disables the API guard.

Record SMTP acceptance, received authentication headers and mailbox placement
separately, with no recipient addresses, OTPs, subjects/bodies or secrets in
published evidence. Microsoft remains #1120; allow-list-assisted Inbox placement
is not a pass. Approved quota/headroom precedes mass registration. #2144/#2145
are independent and are not implemented by this procedure.
