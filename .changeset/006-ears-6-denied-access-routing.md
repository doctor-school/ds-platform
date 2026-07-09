---
"@ds/portal": minor
---

feat(room): 006 EARS-6 — denied-access routing (auth/register/not-live front door)

When a caller reaches `/webinars/:slug/room` but is not admissible, the room now
routes them TRUTHFULLY per the server-side gate outcome (EARS-1) — never a soft
wall over a rendered player (feature 006, EARS-6; realizes US-1, US-5). The room
adds no auth or registration primitive; it consumes the shipped 003 auth and 005
register flows and makes each denied branch a complete, guided front door.

- Unauthenticated → through the 003 auth flow carrying a `returnTo` back to the
  ROOM url, so on login (or signup) the gate RE-RUNS on return and admits a
  registered doctor to a live room. New `lib/room-return.ts` guard parses the
  room-return target (`/webinars/<slug>/room`) reusing the hardened `@ds/schemas`
  slug validation (open-redirect-safe); `completeReturnTarget` routes a room
  return to the room and fires NO registration (a visitor is never silently joined
  to the roster), and `withReturnTarget` carries it through the signup hop.
- Authenticated-but-unregistered → guided to the 005 register front door on the
  event page (`?from=room`), which surfaces catalog-sourced access-branch guidance
  (EARS-10) above the one-tap register CTA; on register the doctor re-enters the
  room, admitted.
- Event not `live` → the truthful 004 lifecycle state on the event page, with no
  watchable room and no register banner.

All copy resolves through the typed message catalog (new `room.accessGuidance`,
EARS-10). Verified end-to-end on the live stand
(`e2e/room-access-branches.spec.ts`, all three branches) — no branch renders the
player, chat, or room composition. The 006↔007 lifecycle seam (live/ended driven
by seeded events until 007 lands) is unchanged; Stage-B canvas fidelity is batched
at #584.
