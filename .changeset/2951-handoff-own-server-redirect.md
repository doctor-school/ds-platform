---
"@ds/api": patch
"@ds/auth-flow": patch
"@ds/schemas": patch
"@ds/api-client": patch
---

A signed-in visitor opening their own congress sign-in link is now redirected by the server straight to the account, with no login page shown. The api gains a read-only `POST /v1/auth/login/otp/handoff/own` check (session required; never redeems the link or sends a code).
