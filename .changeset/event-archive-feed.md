---
"@ds/schemas": minor
"@ds/api": minor
"@ds/design-system": minor
"@ds/portal": minor
---

Add the shared, controlled `EventList` and the Academy `/webinars` upcoming/past tabs. The public event feed now exposes an opaque cursor page with tab counts; ended events are newest-first and carry the canonical batch-resolved recording state. Academy keeps URL state for tabs, facets, cursor/page and week/month view while preserving its registered-event overlay.
