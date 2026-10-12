---
"@ds/api": minor
---

A password reset requested with a confirmed phone sends the code by SMS (#2775): the IdP generates and texts the code to that phone and checks it on completion, so it never passes through the BFF. An unknown or unconfirmed number gets the same answer as any reset request and nothing is sent; such SMS sign-in and reset requests are counted (`auth_sms_unconfirmed_phone_requests_total`, by flow) with a masked log line. A reset completed with a phone leaves the email's verification state unchanged.
