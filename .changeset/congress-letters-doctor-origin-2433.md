---
"@ds/api": minor
"@ds/schemas": minor
---

Congress letters (046 EARS-14, EARS-15, #2433): a sent submission gets the
receipt «Doctor.School — заявка получена» after commit, with the outcome
recorded on the submission and a mail failure never touching the status; the
044 confirmation letter (site form and desk) gains its one action «Подать
материалы в кабинете». Both link to `{MAILER_DOCTOR_BASE_URL}/account/congress`
— a new REQUIRED api key: the api refuses to boot without it. `@ds/schemas`
exports `CONGRESS_SUBMISSION_KIND_LABELS`.
