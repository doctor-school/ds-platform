---
"@ds/api": minor
"@ds/schemas": minor
"@ds/api-client": minor
---

The congress sign-up intake is live on the API (#2294, feature 044 slice 2):
`POST /v1/congress/sign-up` takes a submission from the congress site — public,
captcha-gated and throttled — and, for an address the platform does not know
yet, creates the whole cascade in one transaction: a credential-less account
through the shared 003 engine, a registration for the configured congress event
carrying the typed answers, and one personal-data consent row stamped at the
server-configured version (ADR-0009 §2.1). Nothing asks the participant for a
password, and nothing sends a verification mail: a congress sign-up is not a
platform registration.

The registration window is decided first and from the clock alone, before the
configuration is read and before the account lookup, so a submission outside it
is refused identically for a known and an unknown address and provably writes
nothing. Outside the window the refusal names the state (`not-yet-open`, with
the opening instant, or `closed`); every other reason the intake cannot take a
submission collapses into one generic refusal, so the unauthenticated endpoint
is no «is this doctor on the platform?» oracle.

`@ds/schemas` gains the congress request/response contract and the
personal-data consent purpose; `@ds/api-client` is the regenerated SDK for the
new route. The rate limiter gains a per-scope ceiling map: the intake keeps its
own 60 / 15 min per client address — a congress landing page behind one
corporate NAT legitimately submits far more than an auth door does — while the
platform default of 20 for register / login / reset is untouched.

The existing-email path is refused generically until slice 3 (#2299 / #2300 /
#2301), and the confirmation email lands with slice 4 (#2304–#2306).
