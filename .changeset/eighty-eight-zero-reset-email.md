---
"@ds/api": patch
---

Password-reset email is code-only (#880): the EARS-11 reset send now carries the `sendLink` oneof with a bare portal `/reset` urlTemplate, so the email's button never lands on Zitadel's hosted set-password page and no URL in the mail consumes anything on GET; the `passwordreset` message text is branded (ru+en) at provisioning with the #869 code-only contract (code as one unbroken enlarged token, subject leading with the code, explicit 1-hour expiry, ignore-if-not-requested line).
