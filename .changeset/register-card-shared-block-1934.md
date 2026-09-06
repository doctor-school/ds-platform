---
"@ds/design-system": minor
"@ds/doctor": patch
"@ds/portal": patch
---

`<RegisterCard>` — the ONE canonical registration composition both storefronts mount (021 EARS-5/12, 003 EARS-16/17). The block owns the structure the Academy `/register` and the doctor storefront door must not drift apart on: the two consent tiers told apart by their rendering (F-021-1 «вариант Б» — access conditions framed above the submit, the optional marketing opt-in outside that frame below it), the stated reason beside a disabled submit, and the challenge and command statements held apart at form level. Copy, the consent read model, validation messages and transport stay host-side.

Both registration screens are now thin projections over that block instead of screen-local compositions. The Academy `/register` render is unchanged — its consent statement keeps its shipped position under the credentials (`belowFieldsSlot`), its submit group keeps the challenge → statement → button order (`submitBlock="error-first"`) and its row rhythm (`spacing="sm"`). One deliberate render delta on the doctor side: the two form-level statements move from screen-local styling to the canonical `<FormError>` (`role="alert"` and both testids kept).
