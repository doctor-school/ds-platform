---
"@ds/api": patch
---

A successful sign-in by code (003 EARS-13) — `/v1/auth/login/otp`, `/v1/auth/verify` and the doctor-host `/v1/storefront/doctor/verify` — now forgives the per-user rate-limit window for that address exactly as a password login does; the per-IP / per-ASN windows stay intact and a wrong code forgives nothing.
