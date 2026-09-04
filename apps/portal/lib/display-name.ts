/**
 * 006 EARS-15 — `initialsFromDisplayName` now lives in the shared room unit
 * (`@ds/room`, #1722): it is room-header code, and the doctor storefront renders
 * the same header. This module stays as the portal's stable import path for the
 * NON-room consumers that also derive an avatar from a saved display name —
 * `app/account/page.tsx` and `lib/header-auth.ts`.
 *
 * Re-exported from the `./display-name` SUBPATH, never the client barrel `.` (D20):
 * `header-auth.ts` runs in a server component, and the barrel carries the room
 * parts.
 */
export { initialsFromDisplayName } from "@ds/room/display-name";
