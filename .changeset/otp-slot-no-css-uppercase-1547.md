---
"@ds/design-system": minor
---

`InputOTPSlot` no longer carries a CSS `uppercase` transform. The alphanumeric `OtpField` already uppercases the value in JS, so the transform only risked showing a character the field had not actually stored — LD-9 of the 021 spec forbids a display-only case transform on the code field. Rendering is unchanged for both the alphanumeric and the digits variants, and an RTL assertion now pins the absence of the class.
