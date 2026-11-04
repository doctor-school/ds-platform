---
"@ds/api": patch
---

Silent check on the other storefront (#3660, 003 EARS-63): a browser prerender (`Sec-Purpose: prefetch;prerender`, e.g. Chrome's address bar) of a checkable page is now refused with `503`, so the browser discards it and the real navigation runs the check — a doctor signed in on the Academy who types the doctor storefront's address now arrives signed in instead of on an unchecked guest page. The storefront proxy logs one line per check decision and the sign-in-host entry one line per record outcome, with no identifiers.
