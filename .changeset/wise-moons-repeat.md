---
"@ds/schemas": patch
"@ds/doctor": patch
---

019 EARS-8 (#1523): extract the portable event-listing query codec to `packages/schemas/src/events/event-listing-query.schema.ts`. The wire grammar (repeatable-parameter and boolean spelling, drop-unknown, deterministic key order) and the encode/decode round-trip now live in one shared unit; `doctor-events-feed.schema.ts` mounts it with the doctor vocabulary and defaults, and `apps/doctor/lib/events-feed.ts` keeps only the one-line `URLSearchParams` host adapter. No behaviour change and no rendered pixel changes — the same URLs decode and re-encode identically.
