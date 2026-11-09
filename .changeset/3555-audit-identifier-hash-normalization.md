---
"@ds/api": patch
---

The auth audit ledger hashes the normalized sign-in identifier (trim + NFKC + lower-case), so variant spellings of one login record one `identifier_hash` (#3555).
