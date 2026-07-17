---
"@ds/design-system": patch
"@ds/api": patch
---

fix: registration / password-reset verification code is now case-insensitive end-to-end. The `OtpField` slotted variant uppercases each keystroke, and the auth BFF trims + uppercases the code before the Zitadel verify / reset hop, so a doctor who types the UPPERCASE code lowercased (or whose keyboard/paste pads it) still verifies. No consumer-visible API change.
