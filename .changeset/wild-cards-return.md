---
"@ds/design-system": minor
"@ds/doctor": minor
---

021 EARS-2 — the registration surface shows the doctor what they will return to.

A doctor who arrives from a content gate (`/register?from=<event>`) now sees that эфир in the left half of the auth split, rendered through the one shared `WebinarCard` unit, and as the background plate above the form on a phone. The card carries no control that navigates back out of the form: `WebinarCard` gains a `navigable` prop whose `false` reading renders the card as a pure context plate — plain title, no CTA, no link or button anywhere in its subtree. With no resolvable return context nothing is rendered in its place.
