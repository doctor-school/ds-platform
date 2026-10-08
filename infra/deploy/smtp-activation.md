# Transactional SMTP configuration and controlled activation

Release blocker [#2116](https://github.com/doctor-school/ds-platform/issues/2116)
owns activation and received-artifact evidence. The native-profile contract is:
[EN design](../../apps/docs/content/specs/tech/2026-09-10-postbox-native-smtp-profile-design-en.md) /
[RU design](../../apps/docs/content/specs/tech/2026-09-10-postbox-native-smtp-profile-design-ru.md).
Production writes require the landed implementation and applicable release authorization.

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

Zitadel can persist a password update while its SMTP projection fails with
SQLSTATE 42601 (duplicate password assignment): reproduced on v4.15.0 and still
present in the v4.17.3 source running in production (2026-10-08). The old ID's by-ID test
reads the event write model, whereas actual native delivery uses the query
projection. Therefore `_test` of that ID cannot certify mail.ru rollback. Prove
the native notification itself. The isolated rehearsal reproduces delayed
projection progress and why immediate CREATE/activate success is unsafe.

Do not update existing-profile metadata/passwords, replay/reset the projection,
toggle fields to manufacture an event, blindly retry CREATE or upgrade the IdP.
The one sanctioned existing-profile update is the credential rotation below, whose
user-then-password split avoids that duplicate assignment.
An exhausted readback deadline stops the deploy; it never disables the API guard.

Record SMTP acceptance, received authentication headers and mailbox placement
separately, with no recipient addresses, OTPs, subjects/bodies or secrets in
published evidence. Microsoft remains #1120; allow-list-assisted Inbox placement
is not a pass. Approved quota/headroom precedes mass registration. #2144/#2145
are independent and are not implemented by this procedure.

## Credential rotation (Postbox API key)

The credential is a Yandex Cloud API key of service account `postbox-sender`
(scope `yc.postbox.send`): SMTP user = key ID, SMTP password = key secret. The
pair lives in `/etc/ds-platform/api.env` (`IDP_SMTP_REAL_USER` /
`IDP_SMTP_REAL_PASSWORD`) and in the Zitadel profile
`real transactional sender:postbox`. The current key expires **2030-01-01**;
rotate before that. An expired key fails every send with `535` in
`mailer_relay_failure` logs and there is no failover (#2144) — the previous key
expired 2026-10-07 00:00 MSK and caused a mail outage.

Order is mandatory: the API startup reconciler compares the Zitadel profile
`user` with `IDP_SMTP_REAL_USER`, so changing `api.env` first breaks API start.

1. The owner creates the new key in the console and hands it over in a local
   protected file — never chat or GitHub.
2. Pre-flight: SMTP AUTH only, from the api-prod box, credentials over stdin;
   expect `235`.
3. Zitadel: `PUT /admin/v1/smtp/{id}` with the new `user` and **no** password,
   then a separate `PUT /admin/v1/smtp/{id}/password`. Both in one change event
   emit a duplicate password column (SQLSTATE 42601, still present in v4.17.3
   `reduceSMTPConfigChanged`). Read back via `POST /admin/v1/smtp/_search` and
   check `projections.failed_events2` for SMTP rows. The secret never appears
   on a command line or in argv (`jq --arg` puts it in jq's argv): build each
   PUT body from stdin, e.g. `jq -Rn '{password: input}' < <secret-line file>`
   (a `0600` temp file) piped to `curl --data @-`; build the user PUT body the
   same way for consistency.
4. Back up `api.env`, replace both values, keep it `0600` root, then run
   `sudo docker compose up -d --no-deps api` in
   `/home/deploy/ds-platform/infra/deploy/compose/api-prod`. The replacement
   reads the new values from stdin/environment into `awk` or an editor — never
   `sed -i 's/…secret…/'`, which puts the secret in argv.
5. Verify: container healthy, public `/v1/health` 200, no new `535`, and a real
   message received.
6. Delete the local key file.
7. Once the new key is verified, revoke the old `postbox-sender` API key in the
   Yandex Cloud console (a rotation before expiry leaves it valid) and delete the
   `/etc/ds-platform/api.env.bak-*` backup that holds the old secret.

Never log the key ID/secret pair. Postbox quotas (2026-10-08): 200 emails per
24 h and 1 per second; an increase is requested.
