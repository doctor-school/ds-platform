---
"@ds/admin": patch
---

Admin sign-in after a dropped session (#2998): a refused admin data read (401 or 403) is no longer retried by the query layer, and the 401 path signs out itself instead of through Refine's logout hook — whose auth-store invalidation remounted the still-open page and re-sent the refused read several times — so the sign-in screen follows the first refusal. The return target carries a Cyrillic path in its readable form, so `/mfa/challenge?to=` encodes it once (no `%25D0…`) and the sign-in lands on the same page.
