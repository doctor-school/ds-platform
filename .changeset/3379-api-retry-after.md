---
"@ds/api": patch
---

A request refused by a per-IP auth rate-limit window now answers 429 with `Retry-After` in whole seconds until that window resets (003 EARS-13). A refusal by the per-user or per-ASN window stays header-less (003 EARS-16).
