# Zitadel 4.17.3 preparation and recovery

Preparation: [#2165](https://github.com/doctor-school/ds-platform/issues/2165).
Release gate: [#2166](https://github.com/doctor-school/ds-platform/issues/2166).
This document authorizes no production or shared-service cutover.

The core and Login images move together from 4.15.0 to the unmodified upstream
[4.17.3 release](https://github.com/zitadel/zitadel/releases/tag/v4.17.3).
Dev/stage/CI core images now have an explicit pin instead of `latest`; existing
Login image overrides remain available. ADR-0001 sections 7–8 and its companion
sections 4.1–4.2 remain unchanged: credential flows use the headless Session API.
The production HTTP client deny list matches dev/stage/CI's private IPv4 SMS
adapter route while retaining `169.254.0.0/16,fe80::/10,fc00::/7` protections.
This setting permits private IPv4 destinations generally, not only the adapter.

## Before an authorized release

Record the release SHA, exact running core/Login image digests, configuration,
Postgres version, and a tested recovery destination. Securely retain a consistent
pre-upgrade dump of the **zitadel database**, its roles/ownership requirements,
and the matching masterkey, database credentials, Login PAT and mounted config.
Keep these secrets and database bytes out of Git and public evidence.
Validate the dump by restoring into a new empty database server of the same
Postgres major, with the required roles and matching credentials. Check restore
exit status and authenticate against that restored instance with the old images.
Record the snapshot checksum, capture time, and the recovery point/data-loss window.

Core `start-from-init` performs IdP setup migrations. Replacing only the image tag
with 4.15.0 does **not** reverse them. The application-only `deploy:prod --rollback`
does not restore IdP state either. Whole-cluster pgBackRest recovery would also
rewind unrelated application databases and is not an IdP-only rollback.

If recovery is required, stop IdP writers under the authorized maintenance plan,
retain the failed upgraded database for diagnosis, restore the pre-upgrade dump
to the verified empty recovery destination, and point both old core and old Login
at that restored state using the matching secrets/configuration. Verify discovery,
retained-user password/session, email/SMS OTP, token issuance/refresh and Login
before reopening traffic. Do not run old core against the migrated database or
restore over a shared cluster. Any identities or changes after the snapshot need
an explicit reconciliation decision before reopening.

The exact-release recovery assets, supervised real SMS delivery through the
production adapter/provider, and separate production authorization are mandatory
open work in #2166. Synthetic SMS sink success does not satisfy that gate.

## Preparation evidence (2026-09-10)

An isolated synthetic PostgreSQL 17 instance ran core/Login 4.15.0, upgraded to
4.17.3, and restored a pre-upgrade `pg_dump --create` into a **new empty** PG17
container using `psql -v ON_ERROR_STOP=1`. Old core with the matching masterkey/PAT
then authenticated the retained users. The upgraded database was retained and
isolated; no shared database was restored or reset.

The actual repository `ZitadelIdpClient` passed 11 checks before upgrade and 12
after upgrade and recovery (the latter runs add an explicit retained-user check):
exact discovery issuer, password/session, wrong password, subject/role in issued
tokens, refresh and invalid refresh, rejected email/SMS OTP, native email delivery
to Mailpit and native HTTP SMS delivery to the existing sink, OTP-to-token exchange,
and accepted session termination. This is direct-client compatibility evidence,
not a full application test, production rehearsal, or resolution of #2085.
The PR carries the final clean-candidate SHA and redacted verification results.

Target manifest digests observed during preparation:

- Core: `sha256:2ec2a42551862ca59dc752c321c7041358dea8b33b63ea5e021ec499ad5e2d9f`
- Login: `sha256:07ae03bd1aa49dbc015617a0c1bc9e6abd956616856f0bb374269fae7da79059`

Retained limitations and adaptations:

- SSH local forwarding returned `administratively prohibited`; bounded probes
  stopped. Authorized task-only LAN ports supplied the test transport, with no
  SSH policy/firewall change. Native Node fetch did not preserve the synthetic
  Host; native `http.request` preserved it and returned real response bytes/status.
- Immediately after upgrade, discovery succeeded but the first password attempt
  failed. Later retained-user readiness and the same credentials passed; the
  initial failure's cause is unconfirmed. No production readiness fix is claimed.
- Login health returned 200 while both old and target rendered `LOGIN ERROR` due
  to the synthetic request-host mismatch. Identical task-only instance/public-host
  headers corrected that mismatch for comparison; no product Host patch was made.
- Two stand-log rows were reconstructed after missed appends; they do not prove
  original command timing. The task command log and private artifacts remain
  outside Git; the PR/checkpoint names their locations.
- Matching real RU Login entry screenshots cover only `/ui/v2/login/loginname`.
  [Upstream PR 12668](https://github.com/zitadel/zitadel/pull/12668) changes RU/EN
  authentication-method labels, OTP challenge/verification fallback errors and
  resend accessibility text. Full hosted OTP/enrollment journeys and owner render
  approval remain **pending**. An unchanged entry screen is not a no-render-delta
  certification; the preparation PR stays draft pending the applicable gates.
