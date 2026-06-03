---
"@ds/api": minor
"@ds/schemas": minor
---

feat(api): #85 registration + verification + consent + mirror sync (003 F1, EARS-1,2,3,4,19,20)

The first functional slice of the 003 auth vertical. `@ds/api` gains an `auth`
module (the BFF over Zitadel, design §1/§2): self-service registration with
email+password or phone+password (EARS-1/2), a consent gate that records the
accepted per-purpose versions atomically with the `doctor_guest` mirror row and
refuses any PD-bearing row without consent (EARS-20), email/SMS OTP verification
that flips the mirror `*_verified` flag (EARS-3/4), and a Zitadel Action webhook
plus reconciliation sweep that upsert the mirror and ensure the role grant
(EARS-19). Register/verify responses are enumeration-resistant — an existing
identifier yields the identical response with no duplicate account (EARS-16) —
and registration is `@BotProtected` (EARS-17 mechanism from #84).

Every credential operation is delegated to Zitadel through a new `IdpClient`
port (design §2 native-vs-custom boundary): `apps/api` hashes no password,
generates no code, and verifies none itself. The port is bound to the real
`ZitadelIdpClient` (User v2 API) when a service token is configured and to an
in-memory fake otherwise, so the cascade runs end-to-end against a real Postgres
without a live IdP. `@ds/schemas` gains the F1 request/response contracts.
Audit-ledger emission (EARS-18) and the periodic reconcile schedule remain
documented seams for F6. Closes #85.
