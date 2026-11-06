---
"@ds/api": patch
---

A silent (`prompt=none`) sign-in-host entry now counts only in the silent-check bucket, so a tripped entry limit ends it with `login_required` (a quiet guest render) instead of a throttled refusal; interactive entries keep their per-IP and per-ASN ceiling.
