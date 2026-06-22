---
"@ds/design-system": minor
---

feat(273): interaction-state contract on primitives (ADR-0013 §7 layer 2). A shared `interactiveBase` fragment (focus-visible ring + colour transition + disabled dim, token-only) is now composed into `Button`, `Input`, and `TabsTrigger` so the contract travels with the component. `Button` gains an `active:` press state per variant and a `loading` prop (renders a spinner, sets `aria-busy`, and blocks interaction; `asChild` keeps its single-child Slot contract and only forwards `aria-busy`). `TabsTrigger` gains a hover affordance on inactive tabs. `interactiveBase` is exported for app-authored interactive elements. Layer 1 (#272) still owns cursor + `prefers-reduced-motion` globally.
