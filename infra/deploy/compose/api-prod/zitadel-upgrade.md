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

Reuse the same-major isolated restore procedure already demonstrated below by the
synthetic 4.15.0 → 4.17.3 → restored 4.15.0 proof. For the exact release, record
its SHA, running core/Login digests and retained old images, configuration,
Postgres version, roles/ownership requirements, and an explicit recovery
destination and recovery point objective (RPO). Securely retain a consistent
pre-upgrade backup of the **zitadel database** with the matching masterkey,
database credentials, Login PAT and mounted configuration.

Check backup completion, integrity/checksum, capture time and readability by the
recovery operator; check access to the matching keys, configuration and old images.
Verify that the selected recovery destination can provide a new empty instance
of the same Postgres major with the required roles and capacity. Record the
accepted data-loss window and reconciliation plan. Keep secrets and database
bytes out of Git and public evidence. The exact-release backup capture and
recovery-destination verification remain open in #2166; this preparation does not
claim they have happened.

The completed synthetic restore/auth proof establishes the recovery procedure;
there is no blanket requirement to copy production data or repeat the complete
auth suite before every minor update. Additional rehearsal must address a named
uncovered risk, such as a changed recovery procedure, Postgres major or backup
format, under the portable discipline's proportionality rule. When actual recovery
is needed, use the procedure and service checks below before reopening traffic.

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

## Current technical Console proof

The [2026-09-10 TLS staging verification](https://github.com/doctor-school/ds-platform/pull/2169#issuecomment-5616121502)
completed the native `/ui/console/` → RU Login → password → authenticated Console
round-trip with a representative operator. No extra factor/reset prerequisite
arose for that account. No injected request headers or cookies were used; the
observed core/Login manifests match the target digests above. Stage core was
already at the target; only the existing Login was selected through the documented
`IDP_LOGIN_IMAGE` override. This evidence supplements the existing 12-PASS
headless-client proof and successful candidate API e2e checks.

The [latest review](https://github.com/doctor-school/ds-platform/pull/2169#pullrequestreview-5165163960)
identifies successful Console access plus headless token exchange as the bounded
technical contract. Exhaustive upstream OTP/enrollment journeys and an authored
canvas are not minimum requirements for this unmodified operator UI update.
Technical Console proof is **PASS**. The [recorded owner scope decision](https://github.com/doctor-school/ds-platform/issues/2165#issuecomment-5616293469)
accepts this unmodified operator UI update as technical maintenance without a
separate product-design approval. This is limited to this update: platform UI
approval requirements remain intact, upstream visible changes remain acknowledged,
and no visual Stage-B GO or no-render-delta certification is claimed.

Historical fixture limitations and adaptations:

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
- One stand-log row was reconstructed after a missed append; it does not prove
  original command timing. The task command log and private artifacts remain
  outside Git; the PR/checkpoint names their locations.
- The earlier native HTTP LAN fixture could not retain its Secure session cookie
  for OTP context; a local preview-proxy startup was rejected by tool policy and
  was not retried. This was a historical fixture limitation, not an established
  production or target-version regression. The TLS Console proof above supersedes
  the earlier incomplete operator-access evidence.
- [Upstream PR 12668](https://github.com/zitadel/zitadel/pull/12668) changes RU/EN
  authentication-method labels, OTP challenge/verification fallback errors and
  resend accessibility text. Those visible changes remain explicit under the
  recorded operator-maintenance scope. The PR remains draft until its remaining
  review/checks are handled; real SMS and production release remain gated by #2166.
  An unchanged entry screenshot does not establish no render delta.
