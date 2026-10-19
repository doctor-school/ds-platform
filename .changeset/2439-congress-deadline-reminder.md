---
"@ds/api": minor
"@ds/schemas": minor
---

Congress submissions deadline reminder (046 EARS-33, #2439): every 15 minutes the api sweeps open kinds whose intake closes within 72 hours and sends each account with unsent drafts of that kind one letter «Doctor.School — приём {вида} заканчивается {дата}» listing the drafts and the last day, with no link and the cabinet-entry paragraph — at most once per account, event, kind and closing instant (a conditional claim on `reminded_for_closes_at`, safe across parallel api instances); a moved closing instant re-arms it. The outcome is recorded on every listed draft (`last_letter_kind = 'reminder'`). `@ds/schemas` adds `CONGRESS_SUBMISSION_KIND_GENITIVE_PLURAL`.
