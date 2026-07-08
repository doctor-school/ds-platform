---
"@ds/admin": minor
"@ds/schemas": major
---

Admin forms now validate on the client with rendered RU error messages (#665, 007
EARS-10, Stage-B feedback on #660 + rework round 2). ALL admin forms — the login
form, the create/edit event form, and the stream-config form — derive their rules
from the `@ds/schemas` / `@ds/design-system` field-schema SSOT (react-hook-form + a
localized zod→RHF resolver mapping structured issues to the RU catalog), with
native browser validation suppressed (`noValidate`), surfacing required / bounds /
format errors inline before the round-trip while the server Zod DTO stays the
authority.

**Breaking (`@ds/schemas`):** the stream `embedRef` SSOT is tightened from a
bounded free token to the provider's REAL id shape (`EMBED_REF_SHAPES`): `youtube`
= the 11-char video id (`[A-Za-z0-9_-]{11}`), `rutube` = the 32-char lowercase-hex
video id. A URL-shaped value stays refused with its own message; a garbage token
(the Stage-B repro `ччсапп`) is now rejected with a provider-specific structured
issue (`custom` + `params.shape`) — enforced identically at the api DTO boundary
and in the admin form. Previously-accepted free-token references no longer
validate, hence the major bump.
