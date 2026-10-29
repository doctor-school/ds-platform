---
"@ds/api": patch
---

A request refused by a per-IP auth rate-limit window now answers 429 with `Retry-After` in whole seconds until that window resets (003 EARS-13). A refusal by the per-user window stays header-less (003 EARS-16), and so does a refusal by the per-ASN window: a whole network shares it, so its reset reflects other clients' traffic.
