---
"@ds/design-system": minor
"@ds/portal": minor
---

feat(events): 004 EARS-4 — event-page lifecycle render swap (upcoming/live/ended)

The public event page (`/webinars/:slug`) now reflects the event's current
lifecycle from the single `EventLifecycleState`, swapping the hero badge, the
status-card time plate, the CTA affordance, and the footer band per the canvas
`status` enum — never a signal that contradicts the machine (feature 004,
EARS-4; realizes US-6).

- `@ds/design-system` — new `WebinarStatusCard` primitive: the pulled-up
  «статус-карточка» from `webinar-page.dc.html`, reusing the webinar-card
  time-plate geometry (desktop `196px 1fr` grid, 2px border, `6px 6px 0` cast,
  56px time) with a head/sub signal and a single primary-CTA **slot**. Off-scale
  geometry lives in the DS SoT; tokens only, both themes; the `ended` render
  passes no CTA (no dead link). Registered in the showcase `/primitives` route
  (unit-as-subject) so the `playwright-axe` gate scans it — WCAG AA in both themes.
- `@ds/portal` — `/webinars/:slug` composes the status card + footer band and
  drives the per-state swap via the pure `lib/event-lifecycle` mapping:
  **upcoming** (`published`) → «Участвовать» into the registration handoff
  (EARS-3); **live** → a «В эфире» signal + «Участвовать» routing TOWARD the
  room (feature 006, `buildRoomHref` → `/webinars/:slug/room`; 004 asserts the
  route, not the room); **ended** → the ended affordance with NO participation
  CTA and no footer band. The single primary «Участвовать» CTA is preserved
  (EARS-3 invariant); the footer band carries a distinct verb («Записаться» /
  «Смотреть эфир»). МСК time (EARS-12), catalog copy (EARS-13), DS tokens
  (EARS-14). Archived is the sibling EARS-5 notice — not built here.

004 asserts the live-state routing target only — the webinar room and its
server-side join gating are feature 006 (a tracked seam, parent #549, design §8).
