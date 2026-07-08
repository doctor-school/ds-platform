---
"@ds/admin": minor
"@ds/schemas": minor
---

Admin forms now validate on the client with rendered RU error messages (#665, 007
EARS-10, Stage-B feedback on #660). The create/edit event form and the stream-config
form derive their rules from the `@ds/schemas` SSOT (react-hook-form + a localized
zod→RHF resolver that maps structured issues to the `events.validation.*` catalog),
surfacing required / bounds errors inline before the round-trip while the server Zod
DTO stays the authority. The stream `embedRef` SSOT is tightened to refuse a
URL-shaped value (a provider-scoped stream id is never a URL), enforced on both the
api boundary and the admin form.
