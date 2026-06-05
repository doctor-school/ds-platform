---
"@ds/api": patch
---

fix(api): #122 EARS-9 refresh grant omits the project-roles scope (live wire-shape)

Proving the EARS-8/9 token exchange against a live dev-stand Zitadel (v4.15)
surfaced a refresh-grant delta in the merged `ZitadelIdpClient.refreshTokens`: it
sent the full default scope set — including the reserved
`urn:zitadel:iam:org:project:roles` scope — on the refresh request, which Zitadel
rejects with `invalid_scope` (per RFC 6749 §6 a refresh may only narrow to a
subset of the originally-granted scopes). The fix sends **no** `scope` param on the
refresh grant, which re-issues the full originally-granted set; the project-roles
claim still rides the rotated id_token via the app's role-assertion config
(`accessTokenRoleAssertion` / `idTokenRoleAssertion` + `projectRoleAssertion`), so
`parseIdpClaims` still recovers `roles[]`. With this, the
`zitadel-token-exchange.e2e-spec.ts` integration spec passes GREEN (EARS-8 + EARS-9)
against the provisioned dev-stand OIDC app. Unit spec unchanged (it does not assert
the refresh scope param).
