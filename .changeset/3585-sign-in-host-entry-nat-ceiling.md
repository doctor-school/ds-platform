---
"@ds/api": patch
---

#3585: the sign-in host form entry gets a NAT-sized ceiling. Opening `/login`, `/register` or `/reset` on the sign-in host now counts in its own `sign-in-host:entry` per-IP bucket of 1200 per 15 minutes — the storefront entry's sizing — instead of falling back to the password limiter's 20, so people behind one shared address (a hospital, a congress hall) are no longer refused when they open the sign-in form; a page view never spends the EARS-13 credential budget (003 EARS-69, ADR-0015 §4 req. 9).
