---
"@ds/api": patch
---

#2885: the doctor events reads (`GET /v1/storefront/doctor/events`, `…/month`, `…/month-counts`, `…/live`) target a signed-in doctor on the specialty their profile holds, even with no `__Host-ds_specialty` cookie, and the profile wins over a stale cookie of another specialty (019 EARS-3, 017 LD-2). A guest is unchanged: the cookie when present, the untargeted read when not.
