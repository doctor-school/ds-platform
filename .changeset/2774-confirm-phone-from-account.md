---
"@ds/api": minor
"@ds/schemas": minor
"@ds/api-client": minor
---

A signed-in user can confirm a phone number from `/account` (#2774): `POST /v1/me/phone` sends a six-digit code by SMS through the IdP, `POST /v1/me/phone/confirm` makes the number the account's confirmed phone and emails a security notice. A phone signs in and resets only while it is confirmed, and `GET /v1/me/profile` suggests the phone from the latest congress registration (`suggestedPhone`). A number confirmed on another account gets the ordinary answer and no SMS, so the surface reveals no registered numbers.
