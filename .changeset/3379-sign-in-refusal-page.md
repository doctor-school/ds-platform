---
"@ds/auth-flow": major
"@ds/portal": minor
"@ds/doctor": minor
"@ds/login": minor
---

A refused sign-in entry (too many attempts from one address, or the service not answering) now opens a refusal page instead of a bare server error on the storefronts and a lone error banner on the sign-in site: a light-hearted heading and text, a retry button that counts down the wait when the service names one, and a way back to the эфир, the home page or the two storefronts (003 EARS-72).

Breaking for `@ds/auth-flow`: `storefrontEntry` returns a typed refusal (`{ refused }`) instead of throwing, the storefront doors are answered by `storefrontDoorGate` from each storefront's gate, and `SIGN_IN_HOST_UNAVAILABLE_HEADER` / `readSignInHostUnavailable` / `SignInHostUnavailable` are replaced by `ENTRY_REFUSAL_HEADER` / `readEntryRefusal` / `EntryRefusal`.
