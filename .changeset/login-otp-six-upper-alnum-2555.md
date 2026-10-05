---
"@ds/api": patch
---

Login codes sent by email and SMS now have the same format as the email-confirmation
code: 6 characters, upper-case letters and digits (previously 8 digits). The IdP
provisioning run converges the OTP email/SMS secret generators; the 5-minute
lifetime is unchanged (#2555, epic #2552).
