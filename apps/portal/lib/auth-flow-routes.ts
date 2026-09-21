import { ACADEMY_AUTH_FLOW } from "./auth-flow.host-config";

/**
 * The Academy's auth-flow ROUTE VALUES (#2027 PR 1.5, wave-1 gate §4.2).
 *
 * The table itself is stated in `lib/auth-flow.host-config.ts`, because a host
 * config is data a server route file hands to `@ds/auth-flow` and therefore may
 * not read back out of `lib/`. This module is the projection the rest of the
 * Academy reads: `middleware.ts` and the server auth layouts run on the edge and
 * on the server, and they keep importing the same two names they always did.
 */

/** The auth routes `academy.doctor.school` serves (gate §4.2). */
export const ACADEMY_AUTH_ROUTES = ACADEMY_AUTH_FLOW.routes;

/**
 * 014 EARS-6 — the Academy's parking declaration for a carried return target.
 */
export const ACADEMY_AUTH_RETURN_TO = ACADEMY_AUTH_FLOW.returnTo;
