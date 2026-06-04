---
"@ds/api": minor
---

feat(api): #122 wire real Zitadel OIDC session→token exchange (003 F2 decision-debt)

Replaces the fail-closed seam in `ZitadelIdpClient.exchangeSessionForTokens`
(EARS-8) and `refreshTokens` (EARS-9) with the real OIDC dance against a live
Zitadel: authorize-with-session → link the checked session
(`POST /v2/oidc/auth_requests/{id}`) → `authorization_code` token exchange, plus
the `refresh_token` grant. Principal claims are parsed from the id_token —
`roles[]` from the Zitadel project-roles claim
(`urn:zitadel:iam:org:project:roles`) and `mfa` from `amr` — per 003-design §3.

The exchange requires the OIDC **application** config, now plumbed end-to-end:
`IDP_CLIENT_ID` / `IDP_CLIENT_SECRET` / `IDP_REDIRECT_URI` / `IDP_SCOPES`
(`apps/api/src/config/env.schema.ts` → the `IdpModule` factory →
`ZitadelConfig`). When that config is absent, both paths still fail closed (throw,
mint nothing) — never an open gate (ADR-0001 §7) — while the rest of the adapter
is unaffected. `FakeIdpClient` is unchanged (the dev/unit seam). Claim parsing
and the three-hop wire shape are pinned by `idp/zitadel.idp.spec.ts`; the live
path is asserted by an `IDP_ISSUER`-gated integration spec that skips in CI and
until the dev-stand `ds-platform-dev` OIDC app is provisioned. Also records the
003-design §11 decision that the Zitadel Action webhook authenticates with a
shared secret (mTLS rejected for v1), feeding #119.
