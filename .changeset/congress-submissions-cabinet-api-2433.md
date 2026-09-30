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
«Отозвана», and deletes a draft by retiring the row. Migration 0043 adds
`congress_submissions` with `revision_due_at`.
