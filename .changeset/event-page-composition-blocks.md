---
"@ds/design-system": minor
---

020 EARS-1: event-page composition blocks (EventPageShell/Hero, EventSignupCard,
EventSpeakerCard, EventFormatBlock) from the variant-А canvas. The composed
event page becomes one canonical unit in `@ds/design-system` that both
storefronts mount, instead of a host-local composition in `apps/portal`. The
sign-up card renders the server-resolved `ParticipationCta` policy object
verbatim and computes no eligibility client-side; `EventFormatBlock` covers the
online format only, with offline and hybrid tracked at #1771.
