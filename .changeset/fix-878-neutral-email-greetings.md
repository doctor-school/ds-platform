---
"@ds/api": patch
---

Identity emails no longer greet users with the internal «<local-part> guest» placeholder (#878): user creation now sends an explicit Zitadel `displayName` = the registration email, and every user-facing IdP email greets with a neutral «Здравствуйте!» — the email-OTP login mail is fully branded code-only (subject leads with the code), and the dormant verify-phone / password-change / init templates get the same neutral greeting. Password-reset rework is tracked separately (#880).
