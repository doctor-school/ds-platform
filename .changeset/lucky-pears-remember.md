---
"@ds/schemas": minor
"@ds/db": minor
"@ds/api": minor
---

017 EARS-6: a doctor's chosen specialty is remembered, and the platform keeps
remembering it across sign-in.

`@ds/db` gains the `(doctor, specialty, role)` link row (LD-1) with restrictive
foreign keys, one primary specialty per doctor enforced by a partial unique
index, the retained-row lifecycle columns, and an audit trigger — the choice is
personal data with a recorded history, not a preference blob.

`@ds/api` gains ONE command with two routes, because the ACTOR decides where the
choice belongs and the actor is resolved from the request, never submitted:
`POST /v1/public/specialty-choice` writes a guest's answer into the anonymous
session, and `PUT /v1/me/specialty` writes a signed-in doctor's into the profile
link row. Both are idempotent, both reject a reference that is not a member of
the closed book, and «Другое» is a member like any other (LD-5). No client can
name a subject, so no client can write another doctor's specialty.

On the first authenticated read the sign-in cascade runs (LD-2): an anonymous
choice is ADOPTED into an empty profile and DISCARDED when the profile already
carries one — the profile always wins, with no prompt, no merge and no
cross-device carry. `@ds/schemas` carries the shared `SpecialtyChoice` contract,
where «resolved: nothing chosen» is a distinct answer from an unresolved read.
