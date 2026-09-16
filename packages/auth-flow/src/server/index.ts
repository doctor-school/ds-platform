/**
 * `@ds/auth-flow/server` - the SERVER half of the shared auth flow (#2027 PR
 * 1.4, wave-1 gate rows 22-31).
 *
 * A separate subpath rather than a separate package: these modules read the
 * incoming request and the process environment, and one of them hands a redirect
 * to Next, so none of them can ride into a browser bundle. `@ds/room/server` and
 * `@ds/events-storefront/server` draw the same line the same way, and that is
 * the repo convention.
 */
export {
  SESSION_COOKIE_NAME,
  fetchSessionClaims,
  forwardedHeaders,
  forwardedSessionFrom,
  hasSessionCookie,
  resolveServerAuth,
  serverApiBase,
  type ForwardedSession,
  type ServerAuth,
} from "./session";
export {
  guardAuthRoute,
  resolveAuthRouteGuard,
  type AuthRouteGuardDecision,
  type AuthRouteGuardInput,
} from "./auth-route-guard";
export { parkReturnTarget } from "./return-target-parking";
/**
 * Row 32 / #1987 - the account shape of the LANDING codec. It rides on the
 * server subpath because its only consumers are the hosts' server-side landing
 * resolvers, which decide where a signed-in visitor is sent before paint; the
 * codec itself is pure and framework-free.
 */
export { parseAccountReturnTarget } from "../return-target";
