---
"@ds/design-system": minor
"@ds/auth-flow": patch
"@ds/portal": patch
"@ds/doctor": patch
---

One confirmation step on both storefronts (#2027, epic #2020 wave 1).
`@ds/auth-flow/verify` owns the «Проверьте почту» step — the code field, the
resend link with its notice line, the success banner and the «Уже
регистрировались?» way out — and both hosts render it: the Academy mounts
`@ds/auth-flow/verify/route` from `apps/portal/app/verify/page.tsx`, the doctor
storefront renders the same body inline on its registration door. The Academy
deep link from the verification mail (`/verify#email=…`) keeps working; a host
opts into it with `verify.deepLinkEntry`.

What a visitor can notice: every failure — a wrong code, a refused resend, a
rate-limited (429) or failing (5xx) request — now appears as ONE banner above the
title, worded by the shared error dictionary on both hosts; an incomplete code
says «Введите код.»; the doctor storefront shows «Код принят — входим…» once the
code is accepted and refreshes the page after landing, as the Academy did.
The code stays six characters with a letter-capable keyboard.

`<EmailConfirmCard>` follows the owner's canvas: canvas eyebrows and gaps, the
hint and the resend notice at the 13px `caption` step, a hairline rule above the
already-registered block, the two actions sharing one
wrapping row, and the error plate above the title. New, additive: a `testIds`
prop (defaults are the ids the block shipped with) and the exported
`EMAIL_CONFIRM_TEST_IDS` / `EmailConfirmCardTestIds`.
