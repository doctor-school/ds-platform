---
"@ds/api": patch
---

019 LD-2 — «показать ещё» is offered only when something lies beyond the
horizon. `GET /v1/storefront/doctor/events` decided `nextTo` from the horizon
WIDTH alone, so every read below the 365-day maximum named a next `to`, even
when the doctor's whole future was empty — the control walked into an empty
widening. `nextTo` is now answered from the data, under the same predicate the
feed selects with: `null` when no feed-eligible event lies in
`[to, from + MAX_HORIZON)`, otherwise the smallest whole-step boundary that
COVERS the nearest such event. The response contract is unchanged.
