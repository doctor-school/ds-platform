---
"@ds/api": patch
---

fix(api): #145 send a `profile` on Zitadel `createUser` + live login wire-shape fixes (003)

First live smoke-test of the real `ZitadelIdpClient` against a dev-stand Zitadel
v4.15 surfaced three wire-shape deltas masked by the `FakeIdpClient` override in
every auth e2e:

1. **`createUser` → 400**: Zitadel v4 requires a `profile` object
   (`givenName`/`familyName`) on `POST /v2/users/human`. Self-service
   registration (EARS-1/2) collects no name (the `users` mirror has no name
   column, design §5), so the adapter now sends a minimal placeholder profile
   (`givenName` = email local-part or `"doctor"`, `familyName` = `"guest"`) —
   a pure adapter detail the domain never reads, mirrors, or surfaces.
2. **`passwordLogin` rejected**: the `POST /v2/sessions` response does not echo
   the `factors` object live, so the checked user's id (our `sub`) is now read
   via a follow-up `GET /v2/sessions/{id}`.
3. **OIDC authorize param**: the authorize 302 carries `authRequestID` (capital
   `ID`) live, not the lowercase `authRequest` the merged #122 code parsed.

No portal-facing contract change — internal Zitadel-adapter fixes only.

Adds an `IDP_ISSUER`-gated live integration spec
(`test/auth/zitadel-create-user.e2e-spec.ts`) pinning the `createUser` wire
shape (creation + the 409 duplicate→`alreadyExisted` enumeration hinge) so the
delta cannot regress silently; it skips in CI (no `IDP_ISSUER`).
