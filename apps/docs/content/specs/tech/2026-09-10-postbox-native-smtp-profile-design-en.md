---
title: "Postbox native SMTP profile migration"
status: Draft
lang: en
---

# Postbox native SMTP profile migration

[RU](./2026-09-10-postbox-native-smtp-profile-design-ru.md) · [003 §14.5](../features/003-user-authentication/003-design.md#145-activation-evidence-and-ramp-10592116-microsoft-1120) · [#2116](https://github.com/doctor-school/ds-platform/issues/2116)

**Production execution pending:** the owner authorized preparation, testing, contract revision and implementation. This design specifies the intended implementation; record the production profile migration choice and applicable release decision before production writes. #2144/#2145 remain independent. No new Yandex account or key is needed.

## Contract

Keep the existing mail.ru profile ID and description `real transactional sender` unchanged. Create exactly one Postbox profile named `real transactional sender:postbox`, using the same selected Postbox credentials as BFF `IDP_SMTP_REAL_*`. Stable ID means stable **within each provider**, not one ID whose credentials are rewritten across providers. Intercept keeps `dev-stand mailpit`.

Provisioning and runtime resolve the explicit provider to exactly one matching profile and verify ID, host:port, TLS, username, sender address and name. A mismatch is an error, never permission to update credentials, rename a profile, delete/recreate it or manufacture a new generation. Credential rotation requires a separately reviewed migration; metadata readback cannot prove password equality.

## Pinned API and source evidence

The following sequence is supported by the [v4.15.0 Admin proto](https://github.com/zitadel/zitadel/blob/v4.15.0/proto/zitadel/admin.proto). Its deprecated SMTP routes remain present in that pin; using a newer route does not repair the shared command/reducer.

| Operation        | HTTP path under `/admin/v1`                     | Required check                                                                                      |
| ---------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Inventory        | `POST /smtp/_search` with list query/pagination | Complete list; record original active ID and public metadata                                        |
| Create           | `POST /smtp`                                    | `senderAddress`, `senderName`, `tls`, `host`, `user`, `password`, `description`; retain returned ID |
| Read candidate   | `GET /smtp/{id}`                                | Exact metadata, inactive state, same ID as inventory                                                |
| Test candidate   | `POST /smtp/{id}/_test` with `receiverAddress`  | Sends a real test message; controlled recipient only                                                |
| Activate         | `POST /smtp/{id}/_activate`                     | Read active endpoint `GET /smtp` and full inventory; exactly one active ID                          |
| Roll back native | `POST /smtp/{originalId}/_activate`             | Same original metadata, actual native notification through mail.ru                                  |

[AddSMTPConfig](https://github.com/zitadel/zitadel/blob/v4.15.0/internal/command/smtp.go) emits an Added event; [the projection](https://github.com/zitadel/zitadel/blob/v4.15.0/internal/query/projection/smtp.go) creates that nonempty ID inactive. Activation changes states, not SMTP credentials, and deactivates other active profiles in the instance. Do not explicitly deactivate the old profile first.

The incident's failed password update left the old ID's event write model different from its query projection. `TestSMTPConfigById` reads the **write model**; a successful test of that ID cannot certify mail.ru rollback. Actual native notifications use [GetActiveEmailConfig → SMTPConfigActive](https://github.com/zitadel/zitadel/blob/v4.15.0/internal/notification/handlers/config_email.go), including the projected credential. The retained profile is therefore a **conditional rollback target**, requiring the pinned rehearsal and real native-notification proof; it is not a repaired event history. No replay, projection reset, password-only PUT, metadata toggle or blind IdP upgrade belongs to this migration.

## Idempotency and bounded readiness

Run one migration at a time under deployment serialization. Search all pages before CREATE. Zero candidate matches permits one CREATE; one exact candidate is reused without PUT; duplicates or mismatches stop before any activation. Record the returned nonsecret ID durably before proceeding. If CREATE times out, reconcile inventory and event/projection evidence; never automatically repeat CREATE when its outcome remains ambiguous. An invisible failed create is not evidence that no profile exists.

Readiness uses a **120-second absolute deadline**, 1-second polling interval and 5-second request cap (each request clipped to the remaining deadline). Require exact metadata and expected state; failure preserves or restores the old selection. This bounded budget accommodates the pinned [projection defaults](https://github.com/zitadel/zitadel/blob/v4.15.0/cmd/defaults.yaml): `RequeueEvery: 60s`, `RetryFailedAfter: 1s`, `MaxFailureCount: 5`; it is not a guarantee of convergence. A successful HTTP mutation, processed sequence or zero new failed events alone is insufficient. `_test` does not prove production recipient delivery or equivalence of a previously poisoned profile's models.

## Deployment ownership and rollback

The existing API reacts to **any** flag change and first SDK synchronization. It can reactivate its old profile after a deploy activates Postbox. Freezing only the email flag does not serialize these writers.

First ship a compatibility release with mail.ru selected that makes native SMTP in production **deployment-owned**. Runtime production reconciliation validates the selected profile and active state but never activates SMTP; nonproduction runtime flag-controlled intercept remains explicit. Production requires real email mode: a false email-real flag is a configuration error, does not activate Mailpit and causes BFF sends to fail internally without changing enumeration-safe responses. Independently queued native sends cannot be suppressed by BFF validation. Startup rejects invalid ownership/mode; later signals report sanitized errors without mutations. SMS reconciliation is unchanged. This ownership mode must be required by production configuration and verified before migration. It is an implementation prerequisite inside #2116, not a manual stop/process patch or dependency on #2144/#2145.

Then the canonical deploy prepares all build/preboot checks, snapshots the coherent old environment and records the original ID, creates/tests the inactive candidate, activates it and requires convergence before migration/application replacement (#2151). Until replacement, the compatibility API keeps serving its deliberately selected mail.ru BFF transport; native sends use Postbox. The transition has a **300-second absolute deadline from the first activation attempt**, covering convergence, migration, replacement and readiness; log output never extends it. Exhaustion or watchdog cancellation enters rollback with its own **180-second absolute budget**; exceeding rollback budget is an incident. The existing no-output watchdog alone does not implement this contract. Check active ID again after application readiness; never represent the transition as completed activation.

Every failure after the **first activation attempt**, including a lost/timeout response, pre-swap failure, deadline or cancellation, reconciles active state and restores the original native ID with verified readback. An uncertain activation is a possibly changed selection, not proof that no rollback is needed. Restore coherent old BFF configuration before starting/restarting the previous application, then prove actual native and BFF delivery. Report rollback failure as a release incident; never return success or merely roll back application images while leaving the native selection changed. Retain both profiles after success/rollback; cleanup and vendor-history repair require separate scope.

One remote supervisor owns the forward/rollback state machine and a durable nonsecret phase journal. Cancellation first stops and joins the forward actuator, or transfers finalization to that same remote supervisor; rollback must never race a still-running remote activation. Killing only the local SSH channel is insufficient. An unresolved remote actuator or interrupted journal is a blocked recovery/incident, not permission for a second migration actor. The journal records original/candidate IDs and intended phase; no credentials are persisted in it.

## Verification and acceptance

The isolated fixture uses the exact pinned IdP, its own PostgreSQL, network and two capture SMTP sinks with synthetic credentials. It reproduces the broken original-ID password PUT; demonstrates query/write-model divergence; creates the inactive Postbox candidate; tests, activates and sends a genuine native notification; reactivates the original ID and verifies which sink receives the native notification. It proves original ID retention and tests duplicate CREATE to establish that the provider does not enforce uniqueness. The implementation must enforce no duplicate creation; the fixture does not claim that behavior is already implemented. Source inspection is not a passing rehearsal.

Runtime TDD must cover profile selection, duplicate/mismatched/unknown profiles, lost CREATE response, readiness timeout, mutation rejection, validation-only production reconciliation on every flag signal, pre-swap failure rollback, post-swap active recheck, and no-secret diagnostics. Keep the #2151 pre-replacement failure test. Production acceptance separately covers controlled register/resend/reset and verified-account login OTP, provider acceptance versus received headers/placement, and quota readiness. Microsoft proof remains #1120; the prior release exception is single-use.

## Cross-reference audit

### Recorded vendor feasibility rehearsal — 2026-09-10 UTC

Two isolated fixtures used PostgreSQL 17, two Mailpit sinks and `ghcr.io/zitadel/zitadel:v4.15.0`, image `sha256:f4ab88245b0d619c533edf68d82e554c66a0b9015c2cc91d52b0a4d79deecb21`. Experimental runner SHA-256: `1ac9b317db5399b9953a256b1d395a47761f1be61e3f5fa1848d88fe98b63982`. Its machine-specific source and chronological evidence are retained outside git as `2116-smtp-rehearsal.mjs`, `2116-smtp-rehearsal.json`, `2116-smtp-rehearsal-idp.log` and `stand-ops-2116-rehearsal.log`. This record proves vendor API feasibility, not tested committed production implementation.

1. Original profile active at sequence 108; password-changing PUT accepted at 109 but query remained 108 with SQLSTATE 42601. By-ID test used changed write-model routing.
2. CREATE accepted at 110; candidate GET was absent. Immediate activation 111 and native notification still left delivery at the original sink. Failed event 109 reached failure count 5 at 03:29:26; query later advanced automatically, without manual skip/replay.
3. After candidate readback, activation 113 delivered an actual native verification notification to the Postbox sink at 03:30:03; original-ID activation 114 delivered to the mail.ru sink at 03:30:08. Native test trigger: `POST /v2/users/human` with synthetic `username`, `profile:{givenName,familyName}` and `email:{email}`, without `returnCode`; inspect only sink routing/auth metadata.
4. Clean comparator: candidate immediately inactive, native activation and rollback passed. Repeated identical CREATE generated another ID. GET-by-ID encoded inactive state as numeric `3`, while list encoded `SMTP_CONFIG_INACTIVE`; normalize supported wire forms.

Sinks accepted any password and recorded authentication usernames; TLS was false. This proves routing/retained-ID behavior, **not** stored-password validity, TLS, Yandex delivery or native login-OTP content. Actual Postbox test/auth and production login OTP remain release gates. All owned containers/networks were removed; no shared service, production state, volume or host port was changed.

### References requiring implementation follow-through

Inbound `003-design`/`003-user-authentication` references were swept across docs, infra, tools, workflows and root instructions. Unchanged auth boundaries, glossary and unrelated feature links need no rewrite; section anchors are retained. Outbound stable-description references require the same spec revision in EN/RU requirements and the native scenario. Runtime ownership/selection, `provision.sh`, delivery-reconcile README, bootstrap instructions and SMTP activation runbook must follow this contract in the implementation PR; this draft changes their procedural claims only where explicitly marked as pending implementation.
