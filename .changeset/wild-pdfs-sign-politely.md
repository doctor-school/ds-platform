---
"@ds/api": patch
---

fix: program-PDF download from the public event page (#842) — `ObjectStorage.urlFor` now issues a short-lived SigV4 presigned GET (15 min TTL) instead of a plain unsigned object URL, which the private prod bucket denied with `AccessDenied`. The in-memory fake mirrors the signed-GET contract (unsigned URL shape → 403), so dev/test verification can no longer pass a URL shape prod refuses.
