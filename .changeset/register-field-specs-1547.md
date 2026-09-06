---
"@ds/schemas": minor
"@ds/doctor": minor
---

021 EARS-11 — the doctor registration fields declare their rules once. `@ds/schemas` gains `DOCTOR_REGISTER_FIELD_SPECS` (a `FieldSpec` per `email` / `password` / `promoCode` / `code`, each carrying its rule, mask, hint and error slot) plus the `PROMO_CODE_MAX_LENGTH`, `VERIFY_CODE_LENGTH` and `VERIFY_CODE_PATTERN` constants. `apps/doctor` derives its react-hook-form rules, its RU messages and its confirmation-code resolver from that single source, so no bound is a literal in the registration screen any more. The confirmation code is typed for the real code: alphanumeric, fixed length, accepted case-insensitively on the client because the 003 engine normalizes server-side.
