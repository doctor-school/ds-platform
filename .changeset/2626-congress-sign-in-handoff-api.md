---
"@ds/api": minor
"@ds/schemas": minor
"@ds/api-client": minor
---

Congress sign-in hand-off (003 EARS-44, 044 EARS-39): an accepted `POST /v1/congress/sign-up` now answers `{status:"accepted", handoff}` — an opaque 32-byte random reference, the same shape for new, existing and repeat submissions; only its SHA-256 is kept in Redis for 24 h. The new public `POST /v1/auth/login/otp/handoff {ref}` (no captcha, EARS-13 limits, timing-equalized) sends the account's login code as a code request does and returns the address; a reference redeems at most three times, and a missing, malformed, unknown, expired or exhausted one gets the one `handoff_refused` answer with no mail.
