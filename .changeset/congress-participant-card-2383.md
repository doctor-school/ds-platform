---
"@ds/api": minor
"@ds/schemas": minor
"@ds/api-client": minor
---

A congress registrar can read one participant's card (044 EARS-36, #2383,
backend layer). New read-only route
`GET /v1/admin/events/:idOrSlug/registrations/:registrationId` (`check: policy`,
bound to the registrar's event per EARS-38, `revalidate: none`): every stored
answer (surname, first name, patronymic, full name, specialty, workplace, city,
region, phone as typed, email), the registration date and `intakeOrigin`
(`site` | `desk` | `platform`), the congress consent rows (purpose, version,
captured-at, `paper` origin), the confirmation-mail outcome with its time, the
read-time «возможный дубль» marker, and per congress day the current mark
(`null` = never marked) with its history of changes — value, time, actor name,
source — read from the 010 change audit (the first reader of `audit_ledger`).
The card never carries whether the account pre-existed the registration. A
registration of another event through this event's path is a 404. `@ds/schemas`
exports the `CongressParticipantCard*` schemas; `@ds/api-client` is the
regenerated SDK.
