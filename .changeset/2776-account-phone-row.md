---
"@ds/design-system": major
"@ds/auth-flow": minor
"@ds/portal": minor
"@ds/doctor": minor
---

The phone row in /account can be filled in and confirmed on both storefronts (#2776, 003 EARS-47…51, 59). A doctor adds or changes a number, receives a 6-digit SMS code, and the row shows the confirmed number with its badge. A number from the doctor's congress application is offered as «Из заявки на конгресс». A wrong code, and a number already confirmed on another account, get the same generic «Неверный код». `@ds/auth-flow/client` gains `requestPhoneCode` / `confirmPhone` and the shared `accountPhoneActions` adapter.

BREAKING (`@ds/design-system`): `AccountProfileCard` takes a **required** `phoneActions` prop and a `copy.phone` block (`AccountPhoneCopy`). Every host must wire the phone transport, so no surface can render a phone row that does nothing.
