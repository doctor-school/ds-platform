---
"@ds/api": minor
"@ds/db": minor
"@ds/schemas": minor
"@ds/api-client": minor
---

A congress registrar can enter a walk-in participant at the desk (044 EARS-35,
#2382). The new route `POST /v1/admin/events/:idOrSlug/registrations`
(`check: policy`, bound to the registrar's event per EARS-38; the platform
administrator is not limited) runs the SAME congress intake use-case as the site
form — one credential-less account per email, one registration per pair, one
consent per version, the same confirmation email — without the captcha, the rate
limit and the registration window, and requires `paperConsent: true`. It answers
`{ status: "accepted" | "existing", registrationId }` and never whether the
account existed before. Migration 0040 adds `registrations.intake_origin`
(`site` | `desk` | `platform`, backfilled `site` where answers exist and
`platform` otherwise, then `NOT NULL DEFAULT 'platform'`) and the nullable
`consent_records.origin` (`paper` for a desk-recorded consent). `@ds/db` exports
`IntakeOrigin` / `ConsentOrigin`; `@ds/schemas` exports
`CongressDeskRegistrationRequestSchema` / `CongressDeskRegistrationResponseSchema`;
`@ds/api-client` is the regenerated SDK.
