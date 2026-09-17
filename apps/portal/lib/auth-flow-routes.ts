import type {
  AuthFlowReturnToConfig,
  AuthFlowRoutes,
} from "@ds/auth-flow/host-config";

import { ACADEMY_ROOM_ROUTES } from "@/lib/room-config";
import { LOGIN_HREF, PROFILE_HREF } from "@/lib/shell-config";

/**
 * The Academy's auth-flow ROUTE VALUES (#2027 PR 1.4, wave-1 gate §4.2).
 *
 * A module of its own, deliberately NOT part of `lib/auth-flow-config.ts`: that
 * file is a `"use client"` hook (its copy comes from `next-intl`), and these
 * same values are read from `middleware.ts` and from the four server auth
 * layouts, which run on the edge and on the server and cannot import a client
 * module. Splitting the DATA out is what lets both sides state the same table
 * once instead of the server growing a second copy of it.
 */

/** The auth routes `academy.doctor.school` serves (gate §4.2). */
export const ACADEMY_AUTH_ROUTES = {
  login: LOGIN_HREF,
  register: "/register",
  // The Academy's confirmation is a standalone surface the verification mail
  // links into, so it has a path (the doctor storefront confirms inline).
  verify: "/verify",
  reset: "/reset",
  account: PROFILE_HREF,
  // 003 EARS-28 pins the `/account` change-password action as a handoff to the
  // reset flow, so a signed-in doctor must still be able to complete `/reset`.
  allowAuthenticated: ["/reset"],
  // 005 EARS-2 — the event page a carried registration intent lands on.
  eventPathTemplate: "/webinars/:slug",
  // 006 EARS-6 — the room a bounced visitor returns to; the same value
  // `@ds/room` reads, stated once in `lib/room-config.ts`.
  room: ACADEMY_ROOM_ROUTES.room,
} satisfies AuthFlowRoutes;

/**
 * 014 EARS-6 — the Academy parks the carried return target in a short-lived
 * same-origin cookie, because its registration branch leaves the browser for the
 * verification mail and comes back on a cold `/verify#email=…` with no query at
 * all. The name and the lifetime are host values; the parking RULE lives in
 * `@ds/auth-flow/server`.
 */
export const ACADEMY_AUTH_RETURN_TO = {
  parkingCookie: {
    name: "ds_return_to",
    /** Long enough to open a verification mail and come back, short enough that
     *  an abandoned flow never resurfaces on an unrelated sign-in days later. */
    maxAgeSeconds: 900,
  },
} satisfies AuthFlowReturnToConfig;
