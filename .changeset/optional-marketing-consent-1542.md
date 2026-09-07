---
"@ds/schemas": minor
"@ds/api": minor
---

021 EARS-6 (#1542) / EARS-7 (#1543): the doctor registration command now records consents on its own terms. `packages/schemas` declares the closed list of purposes the 021 surface renders (`DOCTOR_REGISTER_CONSENT_PURPOSES` + `isDoctorRegisterConsentPurpose`) and the command's `consent` items are refused at the I/O boundary when they name anything else — 003's `ConsentAcceptanceSchema` stays open, because it serves every surface. `doctor-register.service.ts` gains `MARKETING_COMMUNICATIONS_VERSION` and stamps the server's wording version on the marketing row exactly as it already did for the partner-data row, so a recorded consent can only ever claim wording this surface actually rendered; an undeclared purpose is dropped there too, as the domain half of the same rule.

Net effect on the doctor: withholding the marketing opt-in costs nothing and leaves no row at all, granting it writes exactly one dated, versioned row, and a purpose no screen ever displayed can no longer reach the append-only `consent_records` table. No rendered change on either storefront.
