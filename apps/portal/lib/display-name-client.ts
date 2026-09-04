"use client";

/**
 * 006 EARS-14 — the `SetDisplayName` client now lives in the shared room unit
 * (`@ds/room`, #1722), because the doctor storefront drives the same JIT room-entry
 * prompt against its own origin. This module stays as the portal's stable import
 * path: `app/account/page.tsx` imports it and `app/account/page.test.tsx` mocks
 * `@/lib/display-name-client`, neither of which is room code.
 *
 * The re-export deliberately targets the `./display-name` SUBPATH, never the client
 * barrel `.` — the barrel carries the room parts, and pulling those into a plain
 * account route would drag the chat transport (and `centrifuge`) into its module
 * graph for nothing.
 */
export { setDisplayName, DisplayNameError } from "@ds/room/display-name";
