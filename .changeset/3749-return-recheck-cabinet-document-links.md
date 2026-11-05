---
"@ds/portal": patch
"@ds/doctor": patch
---

#3749 (003 EARS-73/74): a signed-in storefront tab that is returned to re-checks its session once (`GET /v1/auth/session`) and turns guest in place — or, on `/account/**`, takes that route's own guest bounce by document — when a sign-out on either storefront ended it; the profile chip and «Мои события» open the cabinet by a document request, so a revoked session no longer flashes an empty page before the sign-in host.
