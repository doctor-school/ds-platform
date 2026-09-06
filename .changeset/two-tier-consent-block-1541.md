---
"@ds/schemas": minor
---

021 EARS-5 — the two-tier consent block on the doctor registration door.

Adds the `partner-data-sharing` access-condition purpose to
`REQUIRED_DOCTOR_REGISTER_CONSENT_PURPOSES` (so the `RegisterDoctor` command now
refuses a payload that omits it), its own stable refusal code
`partner_data_sharing_required` beside the declaration's, the
`PARTNER_DATA_COMPOSITION` / `PARTNER_DATA_EXCLUDED` source of the doctor-facing
statement with the `formatPartnerDataStatement` builder that renders it, the
optional `marketing-communications` purpose, and the `ConsentTier` /
`ConsentItem` read-model schemas the registration screen renders from.
