---
"@ds/api": minor
---

025 EARS-9: when an event ends (007 `CloseRoom`), the room reports `attendance.confirmed` for every doctor with presence through `PointsEngine.record`, inside the end's transaction — presence share over the scheduled duration, below-threshold shares included; the seeded `accrual.participation` credits +2 Bre +1 Con at ≥ 30 %, `PointsCredited` after COMMIT only. EARS-10 engagement producers are deferred to #3879.
