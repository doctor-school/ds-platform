---
"@ds/api": minor
"@ds/api-client": minor
"@ds/auth-flow": minor
"@ds/schemas": patch
---

#3565: the five legacy routes that minted a storefront session with no link to a shared (Zitadel) session are retired — `POST /v1/auth/login`, `/v1/auth/login/otp`, `/v1/auth/password/reset/complete`, `/v1/auth/verify` and `/v1/storefront/doctor/verify` now answer 404, and the unlinked `SessionService.establish` path is gone. Every credential check runs on the sign-in host, and a storefront session is minted only by the storefront callback (003 EARS-8 amended, EARS-69), so every session takes part in the one sign-out. The SDK drops the retired operations.
