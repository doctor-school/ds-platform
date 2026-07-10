---
"@ds/design-system": major
"@ds/portal": minor
---

feat(webinars): 006 EARS-6 — «мои события» room-entry CTA + WebinarCard nested-anchor resolution (#689)

A registered doctor could enter a live webinar room from the event page (#584) but
not from «мои события», where each event renders as a `WebinarCard`. The card was a
whole-card `<a>`, so a room-entry CTA could not be added without nesting interactive
content inside an anchor.

- `@ds/design-system`: `WebinarCard` now matches its canvas — the root is a
  container and the title is a stretched link (`::after` overlay), so the whole card
  still opens its event page while an optional secondary action fits alongside with
  no nested anchor. Two additive props (`ctaHref`, `ctaLabel`) render a room-entry
  button (`Button`, filled primary) as a sibling with its own stacking context;
  omitting them keeps the listing card rendering as a single link. **BREAKING:**
  `WebinarCard`'s root element changes `<a>` → `<div>`, its forwarded ref type
  changes `HTMLAnchorElement` → `HTMLDivElement`, and its props base changes
  `ComponentPropsWithoutRef<"a">` → `ComponentPropsWithoutRef<"div">` (anchor-only
  props such as `target`/`rel` are no longer accepted on the card root).
- `@ds/portal`: `/account/events` renders the «Войти в эфир» room-entry CTA on a
  registered + `live` event, routing to `/webinars/:slug/room` via the hardened
  `resolveRoomEntryHref`; copy reuses the `webinar.registered.live.cta` catalog key.
