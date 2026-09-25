---
"@ds/admin": minor
---

The admin navigation follows the signed-in principal's role and event binding
(044 EARS-20 / EARS-38, #2384). A congress registrar sees exactly one link —
the participant roster of its bound event — and no events list, no other section
and no link back to the event; any other admin route renders the existing «нет
прав» message in place of the page (the server refuses its data regardless). A
registrar with no binding sees no link at all. The platform administrator's
navigation is unchanged. The Refine access-control provider now answers from
`GET /v1/admin/auth/session` (`roles` + `eventGrants`) instead of session presence.
