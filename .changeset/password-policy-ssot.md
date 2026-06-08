---
"@ds/schemas": minor
"@ds/api": patch
---

fix(schemas): #147 raise creation password contract to mirror Zitadel policy

The `@ds/schemas` creation-password contract was weaker than the live Zitadel
default complexity policy (`min8 + upper/lower/digit/symbol`), so a registrant
could pass schema validation with a password Zitadel rejects (400 inside
`createUser`) — a divergence that was neither aligned nor enumeration-checked.

`@ds/schemas`: a new `NewPassword` (creation) schema adds the four-class
complexity requirement and applies it to `RegisterRequest.password` and
`PasswordResetCompleteRequest.newPassword`, mirroring the Zitadel default as a
**baseline, not a ceiling** (Zitadel remains the credential authority and may be
configured stricter). `LoginPassword` (login) stays permissive — no complexity —
so legacy credentials that predate the policy can still authenticate. This is a
consumer-visible contract tightening (a password that previously validated may
now be rejected), hence a pre-1.0 minor bump.

`@ds/api`: closes the enumeration-safe residual race where a live Zitadel
configured stricter than baseline 400s inside `createUser`. The adapter raises a
typed `IdpPasswordPolicyError` only on a password/complexity 400 (any other 4xx
stays opaque → 500, fail-closed), and `AuthService.register` maps it to a generic
**422** identical regardless of account existence — never a 500, never an oracle.
The existing 409→`alreadyExisted` enumeration hinge is untouched.
