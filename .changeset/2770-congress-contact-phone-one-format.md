---
"@ds/schemas": major
"@ds/api": major
"@ds/admin": minor
---

044 EARS-29/36, 046 EARS-28 (#2770): the admin shows every congress contact phone in one format built from its normalised E.164 value — a Russian number as `+7 (XXX) XXX-XX-XX`, any other as plain `+<digits>` — in the roster, the participant card and the 046 submission card, so one number typed two ways never reads two ways. The typed phone stays stored but is no longer displayed.

**Breaking (`@ds/api`, `@ds/schemas`):** changed field semantics — `phone` on `CongressRosterRow`, `CongressParticipantCard` and `CongressSubmissionCard.submitter` now carries the normalised E.164 value instead of the phone exactly as typed (field names and shapes unchanged). `@ds/schemas` also adds `formatContactPhone`. `@ds/admin` (minor): the three surfaces render the phone through it.
