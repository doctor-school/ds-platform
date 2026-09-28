---
"@ds/admin": minor
---

The admin navigation follows the signed-in principal's role and event binding
(044 EARS-20 / EARS-38, #2384). A congress registrar sees exactly one link —
the participant roster of its bound event — and no events list, no other section
and no link back to the event, and lands on that roster after sign-in (the
admin landings `/` and `/events` send a one-link principal there); any other
admin route reached directly renders the existing «нет
прав» message in place of the page (the server refuses its data regardless). A
registrar with no binding sees no link at all. The platform administrator's
navigation is unchanged. The Refine access-control provider now answers from
`GET /v1/admin/auth/session` (`roles` + `eventGrants`) instead of session presence,
the same cached read the chrome draws from; sign-in and sign-out drop that cache.
