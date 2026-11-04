---
"@ds/auth-flow": patch
---

003 EARS-63 (a): a sign-in on one storefront voids the other storefront's older guest marker through a sign-in signal cookie on the shared parent domain, so the next navigation there runs the silent check instead of staying a guest for up to 10 minutes (#3685).
