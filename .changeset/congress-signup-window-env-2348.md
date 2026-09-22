---
"@ds/api": patch
---

The congress registration window is now API configuration rather than two
constants in the code (#2348, feature 044 EARS-28). Two required env keys,
`CONGRESS_SIGNUP_WINDOW_OPENS_AT` and `CONGRESS_SIGNUP_WINDOW_CLOSES_AT`, state
the instant the public congress intake starts accepting submissions and the
instant it stops. Each is an ISO-8601 date-time that states its own offset
(`2026-10-01T00:00:00.000+03:00`, or a `Z` value); an offset-less string is
refused rather than guessed, because the API runs in UTC while the congress is
in Moscow and the silent three-hour shift would open registration a day the
owner did not approve. The close must be strictly after the open.

They are configuration for the reason the event id and the consent version
already are: the instants differ per environment. A dev stand and each stage
slot need a window that is open right now for the form to be reviewable at all,
production carries the owner's real dates — and the closing date-time, which
lands as a launch input, must not cost an API release. The pair is validated
beside the other 044 keys and fails CLOSED: unset, unparseable or inverted
refuses the submission through the one generic refusal every submitter gets,
before any account, registration, consent row or email — not through a window
refusal, since a deployment that has no opening instant cannot honestly announce
one. The wire is unchanged: `not-yet-open` still carries the opening instant
exactly as configured, and `closed` is still the same refusal.

Deployment note: every environment running the intake must carry both keys
before this version is deployed, or the intake refuses every submission.
