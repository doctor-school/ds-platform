---
"@ds/admin": patch
---

Admin sign-in (#2781, #2782): the TOTP code field (challenge and enrollment) takes the caret as the step appears, and a completed sign-in — including after a session dropped mid-work — returns the operator to the admin page they came from, query included (validated same-origin admin path carried as `?to=`; anything else lands on `/events`).
