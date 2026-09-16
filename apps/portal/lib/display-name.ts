/**
 * 006 EARS-15 — `initialsFromDisplayName` now lives in the shared room unit
 * (`@ds/room`, #1722): it is room-header code, and the doctor storefront renders
 * the same header. This module stays as the portal's stable import path for the
 * NON-room consumers that also derive an avatar from a saved display name —
 * `app/account/page.tsx` and `components/academy-shell-header-client.tsx`.
 *
 * Re-exported from the `./display-name` SUBPATH, never the client barrel `.` (D20):
 * the barrel carries the room parts, which these consumers never render.
 */
export { initialsFromDisplayName } from "@ds/room/display-name";
