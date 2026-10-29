---
"@ds/api": minor
"@ds/auth-flow": minor
"@ds/portal": patch
"@ds/doctor": patch
---

#3174: one sign-out everywhere (003 EARS-10 amended, EARS-65). `POST /v1/auth/back-channel-logout` serves the storefront clients' provisioned OIDC Back-Channel Logout URI: a verified logout token revokes every storefront session linked to its `sid` on both storefronts; an invalid one revokes nothing. Refresh-token reuse on a linked session now ends every linked session too; an automatic lockout leaves live sessions in place. The storefront sign-out runs through its own `/auth/sign-out` route (`storefrontSignOut`, both storefronts), which calls the API sign-out and sets the signed guest marker so the next navigation runs no silent check.
