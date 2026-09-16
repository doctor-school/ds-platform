---
"@ds/auth-flow": patch
"@ds/portal": patch
"@ds/doctor": patch
---

#2027 — the account FAMILY is a legal return target on both storefronts. The
shared return-target codec derives the family from the one `routes.account` each
host already declares (a prefix with a segment boundary, so `/accounts` and
`/account-evil` are still refused) and hands back the matched page rather than
the cabinet root. The Academy's `/account` and `/account/events` guest bounces
now carry their own page to the door, so a doctor who opened «Мои события» and
signed in comes back to it instead of landing on the discovery listing.
