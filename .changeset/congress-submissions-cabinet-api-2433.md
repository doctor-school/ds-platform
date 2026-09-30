---
"@ds/api": minor
"@ds/db": minor
"@ds/schemas": minor
---

The author's congress submissions API (046 EARS-5…13, 16, 17, #2433):
`/v1/me/congress-submissions` lists the section for an event, creates an oral
talk draft with author 1 from the 044 registration answers, autosaves it, sends
it through one cascade (registration, kind window, field set, limit over every
sent status, submission consent), takes it back to a draft or withdraws it to
«Отозвана», resends a `needs_revision` talk before its revision deadline
(`revision-closed` after it; a new receipt, never counted against the limit a
second time), and deletes a draft by retiring the row. Migration 0043 adds
`congress_submissions` with `revision_due_at`; migration 0044 adds a partial
unique index keeping one `congress-submission-personal-data` consent row per
account and version. The section reads without `CONGRESS_SIGNUP_CONSENT_VERSION`
(the consent then reads as required); only the send needs it — a local
dev-stand `~/.ds-platform/.env.local` gets the dev stamp from
`infra/dev-stand/.env.example`. Each submission carries
`statusChangedAt`, the date its committee comment is shown with.
