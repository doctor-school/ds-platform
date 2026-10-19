---
"@ds/event-page": minor
"@ds/events-storefront": minor
"@ds/design-system": minor
"@ds/doctor": minor
"@ds/portal": minor
---

The doctor storefront's event page `/events/[slug]` mounts `@ds/event-page` (#2072, wave-3 PR 3.2), so it gains the Academy's ended-event recording badge, readiness plaque, guest sign-in gate, signed-in player and the room-guidance strip. On both hosts: the partners plate names the partners without a financing note; the guest gate's sub-line reads «Вход — по почте, две минуты.»; a failed page read shows an explicit error with «Повторить» and loading shows the page skeleton (`EventPageError` and `EventPageSkeleton` of `@ds/event-page`, the skeleton block in `@ds/design-system`); online and hybrid times are re-formatted into the viewer's zone after hydration while offline stays МСК. `fetchPublicEventPage` reads at the host's `contentSet` with its relay cookie and gives up after 10 seconds, so a hung api renders the error state its copy promises. The `@ds/design-system` `WebinarPageContent` primitive drops its `sponsorNote` prop (no financing note, D5).
