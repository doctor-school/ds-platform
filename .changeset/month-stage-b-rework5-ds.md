---
"@ds/design-system": patch
---

Month view Stage-B rework #5 (004, #1102, owner verdict #6): `MonthPicker` trigger
now renders one equal height with the toolbar's neighbour controls — the
`<details>` wrapper is a `flex flex-col` and the `<summary>` fills it (`h-full`), so
under the toolbar's `items-stretch` row the trigger no longer sits SHORTER than the
‹ › / «Сегодня» buttons. The client year state now resyncs to `initialYear` when it
changes (a sibling soft-navigation re-renders the picker while the popover may be
open), so it never shows the stale mount-seeded year. No prop-signature change —
the app widens the `years` window and re-centres the edge-fallback href.
