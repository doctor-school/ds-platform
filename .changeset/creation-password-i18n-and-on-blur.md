---
"@ds/schemas": minor
"@ds/portal": patch
---

Localize the creation-password complexity error to RU and validate auth forms on blur (#200, 003).

`@ds/schemas` now exports `NEW_PASSWORD_COMPLEXITY`, the bare creation-password
complexity regex, as the single SSOT for the pattern. `NewPasswordSchema` is
rebuilt from it and keeps its deliberately-generic English DTO message unchanged
(no API behavior change). The portal's `NewPasswordFieldSchema` composes the regex
**without** a message so the localized resolver maps the resulting `invalid_format`
issue to the RU `errors.validation.passwordComplexity` copy — in zod v4 a
schema-level message would otherwise outrank the contextual error map and leak
English on `/register` and `/reset`.

`/register` and `/reset` (complete step) now resolve from portal-composed,
channel-specific schemas built from the field primitives (mirroring the existing
OTP-login pattern) instead of the request schemas; the submitted body and the API
contract are unchanged. All auth forms run in `mode: "onTouched"` so a malformed
email/phone/password is flagged on blur, before submit.
