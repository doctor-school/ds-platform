---
"@ds/admin": minor
---

012 EARS-24 — the event form has one place to name speakers. The free-text
«Спикеры» section is removed from `components/event-form.tsx` (and from the
create page's defaults, the form schema, the field list and the update vars);
the experts panel no longer renders the legacy match/unmatch affordances, and
the `LEGACY_SPEAKER_CONFLICT` copy is retired from `messages/ru.json` along with
the removed section's strings. The line-up is edited solely through the
`event_experts` panel.
