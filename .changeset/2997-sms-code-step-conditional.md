---
"@ds/auth-flow": patch
"@ds/design-system": patch
---

The sign-in code step reached by SMS no longer claims the code was sent (#2997): it reads «Если номер … подтверждён в профиле, мы отправили на него код.» and, after a resend, «… новый код.». `login.otp.sentTo` / `resentTo` become per-channel (`{ email, sms }`) and `LoginCard`'s `sentTo` / `resentTo` receive the channel as their second argument. The e-mail branch is unchanged.
