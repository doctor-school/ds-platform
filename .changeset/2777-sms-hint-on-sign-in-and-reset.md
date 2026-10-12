---
"@ds/auth-flow": minor
"@ds/design-system": minor
---

SMS truthfulness on sign-in and reset (003 EARS-54, 55, 59, #2777). `LoginCard` gains an optional `copy.otp.channelSmsHint`, drawn under «Канал кода» only while «SMS» is selected; `PasswordRecoveryCard` gains an optional `copy.request.identifierHint(identifier)`, drawn under the identifier from its live value. The shared `@ds/auth-flow` doors fill both on every storefront: «Код по SMS придёт, только если телефон подтверждён в профиле…» under the SMS switch and, on `/reset`, while the identifier holds a phone; the reset code step for a phone now reads «Если телефон **N** подтверждён в профиле, мы отправили на него код по SMS…» (an email keeps «Код отправлен на …»). New copy keys `login.otp.channelSmsHint`, `reset.identifierPhoneHint`, `reset.completeDescriptionPhone`; new helper `isPhoneIdentifier` (the E.164 branch of the identifier union).
