---
"@ds/api": patch
"@ds/auth-flow": patch
"@ds/doctor": patch
"@ds/portal": patch
---

Silent check on the other storefront (#3660, 003 EARS-63): a browser prerender or navigational prefetch of a checkable page (`Sec-Purpose: prefetch` / `prefetch;prerender`, e.g. Chrome's address bar, also when the legacy `Purpose: prefetch` is sent beside it) is now refused with `503`, so the browser discards it and the real navigation runs the check — a doctor signed in on the Academy who types the doctor storefront's address now arrives signed in instead of on an unchecked guest page. The storefront proxy logs one line per check decision and the sign-in-host entry one line per entry decision (the record it met and how the entry ended), with no identifiers.
