---
"@ds/api": minor
"@ds/schemas": patch
"@ds/db": patch
---

The attention-points event advance (025 EARS-15, 16, 20 and the advance parts of EARS-13 and 18, #3811). A sign-up on an advance-mode priced event with too little Pul now reserves the available Pul and covers exactly the shortfall from the system advance account (`reserve:advance`), opening a per-registration obligation — while the person's open obligations stay within `setting.advance.cap`; beyond the cap the item refuses `points-threshold-short` like a threshold one. Every later Pul credit first nets the beneficiary's open obligations in the same ledger fact (`obligation-settle:<obligationId>`, oldest first) and publishes `AdvanceSettled` after COMMIT. A release reverses the hold's advance and its own obligation's netting and annuls the obligation; other obligations keep their remaining amounts. `GET /v1/me/points/gating/:itemRef` answers `reserve-with-advance` (`reservedFromBalance` + `coveredByAdvance`), and `GET /v1/me/points` reads `advance` from the obligation projection. No migration, no contract change (doc comments only in `@ds/schemas` / `@ds/db`).
