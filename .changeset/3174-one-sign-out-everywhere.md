---
"@ds/api": minor
"@ds/auth-flow": minor
"@ds/portal": patch
"@ds/doctor": patch
---

#3174: one sign-out everywhere (003 EARS-10 amended, EARS-65). `POST /v1/auth/back-channel-logout` serves the storefront clients' provisioned OIDC Back-Channel Logout URI: a verified logout token revokes every storefront session linked to its `sid` on both storefronts; an invalid one revokes nothing. Refresh-token reuse on a linked session (a refresh Zitadel refuses as `invalid_grant`) now ends every linked session too; any other refused refresh — an IdP outage, a locked person — ends only the presenting session and records no theft. An IdP admin or console lock (failed passwords never lock) ends the person's sessions inside Zitadel, which refuses their refresh; the API adds no revocation of its own. Revocations record their ADR-0001 §7.3 reason: `logout`, `force` (back-channel logout, a refused refresh) or `theft_detected` (the reuse cascade). The storefront sign-out runs through its own `/auth/sign-out` route (`storefrontSignOut`, both storefronts), which calls the API sign-out and sets the signed guest marker so the next navigation runs no silent check.
