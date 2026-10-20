---
"@ds/auth-flow": patch
---

Keep the sign-in form unmounted while a signed-in congress handoff resolves and returns to the account. Another account still receives the existing code step, and failed requests retain the existing retry form.
