---
"@ds/api": patch
---

An email address typed in a different letter case now finds the existing account (003 EARS-16, 044 EARS-7): the Zitadel account lookup behind Congress sign-up, sign-in by code and password reset matches the email case-insensitively, so a repeat Congress sign-up no longer fails with 503 and the code / reset letters reach the account's owner.
