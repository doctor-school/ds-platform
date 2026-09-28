---
"@ds/design-system": minor
---

`Combobox` takes a `ref` (React 19 ref-as-prop) and hands it to its closed
control, so a form library can move focus to it — `react-hook-form` focuses the
first invalid field through `field.ref` (#2382).
