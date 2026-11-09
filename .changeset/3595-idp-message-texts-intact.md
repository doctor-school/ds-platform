---
"@ds/api": patch
---

#3595: IdP provisioning no longer stores sign-in, phone-confirmation or password-reset SMS and email texts as `?`. Request bodies reach curl on stdin, because a Windows curl turned Cyrillic in its arguments into `?` before sending. A shell whose jq mangles non-ASCII is refused before any write. Every message-text write is read back, and a stored copy that differs from the source fails the run.
