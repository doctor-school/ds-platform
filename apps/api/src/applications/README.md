# `applications` — the shared application queue (033)

Backend core of the application queue (`033-design.md` «Capability owner»): the
tables `applications` / `application_notes` (`packages/db/src/schema/applications.ts`),
the contract in `packages/schemas/src/applications/`, and this module.

| File                            | What it owns                                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `applications.kinds.ts`         | `APPLICATION_KIND_TABLE` — per kind: payload/contact schema, subject line, intake, consent purpose, `receiptTo` |
| `applications-consent.ts`       | the current consent version tag, stamped from the `@ds/legal-content` document (edition + sha256)               |
| `applications.service.ts`       | the author intake; `eraseApplication` (EARS-20); `eraseApplicationsOfAccount` (EARS-24); the purge steps        |
| `applications.purge.ts`         | the daily retention pass: expiry (EARS-23), then erasure one year after closing (EARS-20)                       |
| `applications.me.controller.ts` | `POST /v1/me/applications/author` (EARS-6, EARS-7)                                                              |

## Intake

`POST /v1/me/applications/author` — signed in, `@BotProtected("application")`,
`Idempotency-Key` (canonical lowercase UUID; absent `428`, malformed `400`).
One transaction: a per-key advisory lock, the replay lookup on
`(kind, idempotency_key)`, then the consent version check (`400` on `consent`
when it is not the current tag of `consent-author-application`), the specialty
check (`400` on `specialtyCode` for an unknown code or the «Другое» row), one
`consent_records` row of purpose `author-application-personal-data` and the
`applications` row linked to it. A replay by the same account with the same
body answers the stored `{ id, submittedAt }` and writes nothing; any other
reuse of the key is `422 IDEMPOTENCY_KEY_REUSED`.

## Retention and erasure

- **Expiry (EARS-23).** An open application whose `coalesce(status_changed_at,
submitted_at)` is a year old is closed with outcome `expired`,
  `status_changed_by = null`. `expired` is not an admin outcome.
- **Erasure (EARS-20).** One year after `closed_at`, or on an administrator's
  request: `payload = {"erased": true}`, `contact`/`subject_line`/
  `applicant_user_id` `null`, every note body `[стёрто]`, `pd_erased_at` set.
  Kind, status, outcome and times stay; no row is deleted. A second erasure is
  a no-op (`false`).
- **Account erasure (EARS-24).** `eraseApplicationsOfAccount(userId, tx)` runs
  the tombstone on every not-yet-erased application of the account in the
  caller's transaction. It is the `applications` mechanism of the ADR-0009
  design §3 matrix; the ADR-0009 erasure executor (not on `main` yet) calls it.
  Until then an account-erasure request is served by the administrator erasure
  of EARS-20 on each of the subject's applications.

The purge runs one minute after boot and then every 24 hours (a release
restarts the api, so an interval alone could never fire); both steps are
idempotent conditional updates.

## Audit

Both tables carry the 010 capture trigger; `payload`, `contact`,
`subject_line` and `application_notes.body` are in `AUDIT_PD_COLUMNS` and
`audit_pd_columns()` (migration `0073`), so the ledger records them as
`{masked: true}` (EARS-25).

## Adding a kind (the 034 seam)

Extend `APPLICATION_KINDS` in `@ds/schemas`, add the kind's entry to
`APPLICATION_KIND_TABLE`, widen `applications_kind_check` in a migration, and
add the kind's intake. Storage, retention, erasure and audit need no change.

## Sibling slices

Notifications (EARS-11, EARS-12) — #4029; admin queue (EARS-13…17, the
`erase-personal-data` endpoint over `ApplicationsService.eraseOnRequest`) —
#4030; the «Подать заявку» page and `GET /v1/me/applications` — #4031; the
interim partnership intake and import — #4034.
