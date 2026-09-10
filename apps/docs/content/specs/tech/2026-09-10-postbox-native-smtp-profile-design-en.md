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

The incident's failed password update left the old ID's event write model different from its query projection. `TestSMTPConfigById` reads the **write model**; a successful test of that ID cannot certify mail.ru rollback. Actual native notifications use [GetActiveEmailConfig → SMTPConfigActive](https://github.com/zitadel/zitadel/blob/v4.15.0/internal/notification/handlers/config_email.go), including the projected credential. The retained profile is therefore a **conditional rollback target**, requiring real native-notification proof; it is not a repaired event history. No replay, projection reset, password-only PUT, metadata toggle or blind IdP upgrade belongs to this migration.

## Idempotency and bounded readiness

Run one migration at a time under deployment serialization. Search all pages before CREATE. Zero candidate matches permits one CREATE; one exact candidate is reused without PUT; duplicates or mismatches stop before any activation. Record the returned nonsecret ID in activation evidence before proceeding. If CREATE times out, reconcile inventory and event/projection evidence; never automatically repeat CREATE when its outcome remains ambiguous. An invisible failed create is not evidence that no profile exists.

Readiness uses a **120-second absolute deadline**, 1-second polling interval and 5-second request cap (each request clipped to the remaining deadline). Require exact metadata and expected state; failure preserves or restores the old selection. This bounded budget accommodates the pinned [projection defaults](https://github.com/zitadel/zitadel/blob/v4.15.0/cmd/defaults.yaml): `RequeueEvery: 60s`, `RetryFailedAfter: 1s`, `MaxFailureCount: 5`; it is not a guarantee of convergence. A successful HTTP mutation, processed sequence or zero new failed events alone is insufficient. `_test` does not prove production recipient delivery or equivalence of a previously poisoned profile's models.

## Deployment and rollback

Use the existing provisioner, runtime reconciler and canonical `pnpm deploy:prod` flow. `IDP_SMTP_REAL_PROVIDER` selects the same provider in the BFF and native reconciler. Keep runtime flag synchronization, nonproduction intercept and SMS behavior. Adding Postbox requires provider-scoped selection in these existing paths; it does not require an ownership mode, compatibility release, supervisor, phase journal or separate rehearsal framework.

Preserve the complete protected mail.ru environment and original native ID before changing the deployment configuration. Prepare and test the inactive candidate before activation. Keep the existing pre-replacement native readback guard (#2151), then verify the selected active ID again after the new application starts and reconciles. During replacement the old BFF can still use mail.ru and its reconciler can reselect mail.ru; the operation is not atomic and is not complete until the new application and native selection agree.

On a failed or uncertain activation/deploy, inspect the actual application and native selection before another attempt. Restore the coherent previous BFF environment before the canonical rollback to the previous application, reactivate the retained mail.ru ID and verify its projected metadata. Confirm actual native and BFF receipt through mail.ru. An incomplete restoration remains a failed activation, not a successful release. Keep both profiles; do not update credentials or delete profiles as a recovery step.

## Verification and acceptance

Focused TDD covers explicit provider selection in the reconciler, preservation of mail.ru, candidate creation/reuse, duplicate or mismatched identity rejection, ambiguous CREATE and bounded readback failure. Preserve the existing deploy guard tests and nonproduction intercept behavior. The recorded pinned-version vendor check already establishes create/activate/reactivate feasibility; repeating its full infrastructure fixture is not a prerequisite for this addition.

Production acceptance in #2116 uses the real providers and existing product templates: controlled register/resend/reset and verified-account login OTP, with SMTP acceptance, received headers and mailbox placement recorded separately. A by-ID test is not receipt proof. No message content or authentication flow changes are included. Quota readiness remains required before a mass-registration ramp; Microsoft proof remains #1120 and the prior release exception is single-use.

## Existing vendor evidence

The 2026-09-10 isolated check of Zitadel v4.15.0 reproduced SQLSTATE 42601 on password update, delayed query visibility, successful native routing to a new profile after readback, and native routing back to the retained original ID. Duplicate CREATE returned a different ID. GET-by-ID used inactive state `3`; inventory used `SMTP_CONFIG_INACTIVE`. Evidence is retained outside git in `2116-smtp-rehearsal.json`, `2116-smtp-rehearsal-idp.log` and `stand-ops-2116-rehearsal.log`. Test sinks prove routing only, not real provider credentials, TLS or delivery.
