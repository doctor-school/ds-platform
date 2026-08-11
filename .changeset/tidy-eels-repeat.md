---
"@ds/admin": minor
---

Admin MFA screens now tell an operator the truth when the IdP is down. A 503 from
`mfa/enroll/start`, `mfa/enroll/verify` or `mfa/verify` renders a warning alert
(«Сервис проверки кода временно недоступен…») instead of the wrong-code verdict,
keeps the typed code and leaves the submit button active, and — on the enrollment
offer — no longer bounces the operator to `/login`. The uniform 401 refusal and the
429 throttling message are unchanged.
