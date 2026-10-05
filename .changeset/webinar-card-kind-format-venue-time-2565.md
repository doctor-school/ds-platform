---
"@ds/design-system": minor
---

`WebinarCard`: new `kindLabel` prop — the event kind and the participation format (`formatLabel`) are two separate parts of the time-plate label row («Мастер-класс · гибрид»); a format-only caller renders as before. New `venueTimeLabel` prop — a hybrid event's start in the venue's local time («На площадке 16:00 GMT+7») in its own line under the date. `recordingLabel` now renders on past cards only.

Past cards (`variant="past"`) are no longer dimmed with whole-card opacity, which pushed the time-plate text below WCAG AA contrast: the time plate now uses the full-strength muted tokens (`bg-muted` / `text-muted-foreground`).
